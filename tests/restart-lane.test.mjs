import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    RESTART_MAX_ATTEMPTS, clearPendingRestart, pendingRestartPath, readPendingRestart, readRestartResult,
    resumePendingRestart, writePendingRestart,
} from '../lib/restart-lane.js';

const reference = (version, rows = [{ id: 'web-search-free', name: 'dsh-union-search' }]) => ({
    name: 'dsh-union-search', version, archiveKey: `${version}/package.tgz`, originalSha256: 'a'.repeat(64), rows,
});

async function fixture({ verified = true, rollback = { application: 'applied', stage: 'install', bytesVerified: true }, installed = true, version = '0.11.0' } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-restart-lane-'));
    const calls = [];
    let bundle = { name: 'dsh-union-search', version, installed, enabled: true, source: 'file:owned' };
    const service = {
        restartRoot: root,
        snapshot: async () => ({ bundles: [bundle], rows: [{ patchId: 'web-search-free', moduleName: 'dsh-union-search', enabled: true, fiberPhase: 'active' }] }),
        resolvePackage: async () => join(root, 'package'),
        expectedHostState: () => ({ verified: verified, status: verified ? 'active' : 'unknown', activeRows: 1, totalRows: 1 }),
        verifyRunningGeneration: async () => verified,
        unionStager: {
            verifyInstalledArchive: async ref => { if (!verified && ref?.version === '0.11.0') throw Error('owned bytes differ'); },
            reopen: async () => ({ archivePath: join(root, 'previous.tgz') }),
        },
        stager: { verifyInstalledArchive: async () => {}, reopen: async () => ({ archivePath: join(root, 'previous.tgz') }) },
        manager: {
            removeBundle: async () => { calls.push(['remove']); bundle = { ...bundle, installed: false }; return { application: 'applied', changed: true }; },
            installBundle: async (path, options) => {
                calls.push(['install', path, options.expected.version]);
                if (rollback?.application === 'applied' || rollback?.application === 'restart-required') bundle = { ...bundle, installed: true, version: options.expected.version };
                return rollback;
            },
        },
        identities: { settle: async (...args) => calls.push(['settle', ...args.slice(0, 1)]) },
    };
    const cleanup = () => rm(root, { recursive: true, force: true });
    return { root, service, calls, cleanup };
}

const record = (overrides = {}) => ({ name: 'dsh-union-search', from: '0.10.25', to: '0.11.0', installMode: 'union-generation',
    enabled: true, rows: [{ id: 'web-search-free', name: 'dsh-union-search' }], nextReference: reference('0.11.0'), previousReference: reference('0.10.25'), ...overrides });

test('a pending handoff round-trips, is bounded and ignores a corrupt record', async () => {
    const { root, service, cleanup } = await fixture();
    try {
        await assert.equal(await readPendingRestart(root), null);
        await writePendingRestart(root, record({ attempts: 9 }));
        const pending = await readPendingRestart(root);
        assert.equal(pending.name, 'dsh-union-search');
        assert.equal(pending.attempts, RESTART_MAX_ATTEMPTS, 'attempts never exceed the bound');
        assert.deepEqual(pending.rows, [{ id: 'web-search-free', name: 'dsh-union-search' }]);
        await writeFile(pendingRestartPath(root), '{"schema":99}');
        assert.equal(await readPendingRestart(root), null, 'an unknown schema is not acted on');
        await writeFile(pendingRestartPath(root), 'not json');
        assert.equal(await readPendingRestart(root), null);
        await clearPendingRestart(root);
        assert.equal(await readPendingRestart(root), null);
        assert.equal(await readRestartResult(root), null);
        void service;
    } finally { await cleanup(); }
});

test('a verified target settles as applied and clears the pending record', async () => {
    const { root, service, calls, cleanup } = await fixture({ verified: true });
    try {
        await writePendingRestart(root, record());
        const result = await resumePendingRestart(service);
        assert.equal(result.outcome, 'applied');
        assert.equal(result.target.status, 'verified');
        assert.equal(await readPendingRestart(root), null);
        assert.equal((await readRestartResult(root)).outcome, 'applied');
        assert.deepEqual(calls, [], 'a verified target is not reinstalled or removed');
    } finally { await cleanup(); }
});

test('a target that fails verification is rolled back to the staged previous archive', async () => {
    const { root, service, calls, cleanup } = await fixture({ verified: false });
    try {
        await writePendingRestart(root, record());
        const result = await resumePendingRestart(service);
        assert.equal(result.outcome, 'rolled-back');
        assert.equal(result.rollback.bytesVerified, true);
        assert.deepEqual(calls[0], ['remove']);
        assert.deepEqual(calls[1], ['install', join(root, 'previous.tgz'), '0.10.25']);
        assert.equal(await readPendingRestart(root), null);
        assert.equal((await readRestartResult(root)).outcome, 'rolled-back');
    } finally { await cleanup(); }
});

test('an unverified rollback stays unknown and keeps the pending record for one more attempt', async () => {
    const { root, service, cleanup } = await fixture({ verified: false, rollback: { application: 'failed', stage: 'install' } });
    try {
        await writePendingRestart(root, record());
        const result = await resumePendingRestart(service);
        assert.equal(result.outcome, 'unknown');
        assert.equal(result.rollback.application, 'failed');
        const pending = await readPendingRestart(root);
        assert.equal(pending.attempts, RESTART_MAX_ATTEMPTS, 'the next start retries once, then stops');
        assert.equal((await readRestartResult(root)).outcome, 'unknown');
    } finally { await cleanup(); }
});

test('a missing target is reported as not installed and rolled back, never as success', async () => {
    const { root, service, cleanup } = await fixture({ installed: false });
    try {
        await writePendingRestart(root, record());
        const result = await resumePendingRestart(service);
        assert.equal(result.target.reason, 'target-not-installed');
        assert.equal(result.outcome, 'rolled-back');
    } finally { await cleanup(); }
});

test('the attempt limit stops the loop without touching the profile', async () => {
    const { root, service, calls, cleanup } = await fixture();
    try {
        await writePendingRestart(root, record({ attempts: RESTART_MAX_ATTEMPTS }));
        const result = await resumePendingRestart(service);
        assert.equal(result.outcome, 'unknown');
        assert.equal(result.reason, 'attempt-limit');
        assert.deepEqual(calls, []);
        assert.equal(await readPendingRestart(root), null);
        const stored = await readRestartResult(root);
        assert.equal(stored.outcome, 'unknown');
        assert(String(await readFile(pendingRestartPath(root), 'utf8').catch(() => 'gone')) === 'gone');
    } finally { await cleanup(); }
});
