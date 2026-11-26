import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { serviceFixture, tar } from './helpers/service-fixture.mjs';
import { createHandler } from '../lib/http.js';

const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
function replaceCandidate(f, changes) {
    const original = f.stager.fetcher, name = f.bundles[0].name, version = '1.1.0';
    const manifest = { name, version, type: 'module', exports: { '.': './index.js' }, dsh: { bundle: { patch: 'cordis.patch.yml' } }, ...changes };
    const bytes = tar([['package/package.json', JSON.stringify(manifest)], ['package/cordis.patch.yml', `- insert:\n    - id: ${name}-feature\n      name: ${name}\n`], ['package/index.js', 'export function apply(){}']]);
    f.stager.fetcher = async (url, options) => String(url).includes('1.1.0')
        ? String(url).endsWith('.tgz') ? new Response(bytes)
            : Response.json({ ...manifest, dist: { tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: integrity(bytes) } })
        : original(url, options);
}

test('ordinary scan requires full read-only archive evidence and creates no stages or tickets', async t => {
    const f = await serviceFixture(t), before = await readdir(f.stager.root);
    const scan = await f.service.scan(), item = scan.items[0];
    assert.equal(item.versionStatus, 'available'); assert.equal(item.canUpdate, true);
    assert.equal(item.packagePreflight.status, 'passed'); assert.match(item.packagePreflight.digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(await readdir(f.stager.root), before);
    assert.equal(f.service.tickets.size, 0); assert.deepEqual(f.calls, []);
    assert(!JSON.stringify(scan).includes('sourceBytes')); assert(!JSON.stringify(scan).includes('sourceArchivePath'));
});

test('archive network failure preserves discovered version but blocks update before confirmation', async t => {
    const f = await serviceFixture(t), original = f.stager.fetcher;
    f.stager.fetcher = async (url, options) => {
        if (String(url).includes('1.1.0') && String(url).endsWith('.tgz')) throw new TypeError('fetch failed', { cause: Error('private token=secret') });
        return original(url, options);
    };
    const scan = await f.service.scan(), item = scan.items[0];
    assert.equal(item.versionStatus, 'available'); assert.equal(item.latestVersion, '1.1.0');
    assert.equal(item.canUpdate, false); assert.equal(item.updateStatus, 'blocked');
    // A transport drop behind the verified public source is retryable, not a policy refusal.
    assert(item.reasons.includes('preflight-network-failed')); assert.equal(item.packagePreflight.phase, 'archive');
    assert.equal(item.packagePreflight.causeKind, 'network'); assert.equal(item.preflightError?.retryable, true);
    assert(!JSON.stringify(scan).includes('secret'));
    await assert.rejects(() => f.service.prepareBatch([{ name: f.bundles[0].name, version: '1.1.0' }]), error => error.code === 'preflight-network-failed');
    assert.equal(f.service.tickets.size, 0); assert.deepEqual(f.calls, []);
});

test('authenticated-shaped prepare reports sanitized archive failure details without dispatching an update', async t => {
    const f = await serviceFixture(t), original = f.stager.fetcher;
    f.stager.fetcher = async (url, options) => {
        if (String(url).includes('1.1.0') && String(url).endsWith('.tgz')) throw new TypeError('fetch failed', { cause: Error('private token=secret') });
        return original(url, options);
    };
    const handler = createHandler(f.service);
    const response = await handler(new Request('http://dsh.internal/api/plugin-update-doctor', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-plugin-update-doctor': 'panel-v1' },
        body: JSON.stringify({ action: 'prepare-batch', items: [{ name: f.bundles[0].name, version: '1.1.0' }] }) }));
    const result = await response.json();
    assert.equal(response.status, 400); assert.equal(result.code, 'preflight-network-failed');
    assert.equal(result.preflight.phase, 'archive'); assert.equal(result.preflight.registry, 'https://registry.npmjs.org');
    assert.equal(result.preflight.causeKind, 'network');
    assert(!JSON.stringify(result).includes('secret')); assert.deepEqual(f.calls, []); assert.equal(f.service.tickets.size, 0);
});

test('dependency and Host peer changes are admitted and verified after installation', async t => {
    const f = await serviceFixture(t);
    replaceCandidate(f, { dependencies: { 'owned-unused-library': '1.0.0' } });
    const dependency = (await f.service.scan()).items[0];
    assert.equal(dependency.versionStatus, 'available'); assert.equal(dependency.canUpdate, true);
    assert.equal(dependency.packagePreflight.status, 'passed');
    assert.equal(dependency.packagePreflight.dependencyDeclaration, 'changed');
    replaceCandidate(f, { peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.2-rc.3 <0.3.0' } });
    const peers = (await f.service.scan()).items[0];
    assert.equal(peers.canUpdate, true); assert.equal(peers.packagePreflight.status, 'passed');
    const plan = await f.service.prepareBatch([{ name: f.bundles[0].name, version: '1.1.0' }]);
    assert.equal(plan.items[0].to, '1.1.0');
    assert.deepEqual(f.calls, [], 'no Host mutation happens before the authenticated confirmation');
});

test('a declared runtime dependency is admitted and left to the install and rollback path', async t => {
    const f = await serviceFixture(t);
    replaceCandidate(f, { dependencies: { 'node-pty': '1.0.0' } });
    const item = (await f.service.scan()).items[0];
    assert.equal(item.canUpdate, true, JSON.stringify(item.reasons));
    assert.equal(item.packagePreflight.status, 'passed');
    assert.deepEqual(f.calls, []);
});

test('missing preflight capability cannot be shown as available for update', async t => {
    const f = await serviceFixture(t); f.stager.inspectPackage = undefined;
    const item = (await f.service.scan()).items[0];
    assert.equal(item.versionStatus, 'available'); assert.equal(item.canUpdate, false);
    assert(item.reasons.includes('package-preflight-unavailable')); assert.deepEqual(f.calls, []);
});

test('preparing a selection never preflights unselected packages', async t => {
    const f = await serviceFixture(t, { names: ['selected-plugin', 'other-plugin'] });
    const inspect = f.stager.inspectPackage.bind(f.stager);
    const inspected = [];
    f.stager.inspectPackage = async (name, ...args) => { inspected.push(name); return inspect(name, ...args); };
    const plan = await f.service.prepareBatch([{ name: 'selected-plugin', version: '1.1.0' }]);
    assert.equal(plan.items.length, 1);
    assert.deepEqual(inspected, ['selected-plugin', 'selected-plugin']);
    assert.deepEqual(f.calls, []);
});

test('host without the official update API cannot offer an ordinary update', async t => {
    const f = await serviceFixture(t); f.manager.updateBundle = undefined;
    const item = (await f.service.scan()).items[0];
    assert.equal(item.versionStatus, 'available'); assert.equal(item.canUpdate, false);
    assert(item.reasons.includes('registry-handoff-unavailable'));
});

test('external source changes during read-only preflight invalidate candidate evidence', async t => {
    const f = await serviceFixture(t), original = f.stager.inspectPackage.bind(f.stager);
    let once = false;
    f.stager.inspectPackage = async (...args) => {
        const result = await original(...args);
        if (!once) { once = true; f.bundles[0].source = f.bundles[0].name + '@^1.0.0'; }
        return result;
    };
    const item = (await f.service.scan()).items[0];
    assert.equal(item.canUpdate, false); assert(item.reasons.includes('state-changed')); assert.deepEqual(f.calls, []);
});

test('a target that adds a core Host override is refused before selection', async t => {
    const f = await serviceFixture(t), name = f.bundles[0].name, version = '1.1.0';
    const original = f.stager.fetcher;
    const manifest = { name, version, type: 'module', exports: { '.': './index.js' }, dsh: { bundle: { patch: 'cordis.patch.yml' } } };
    const patchText = `- insert:\n    - id: ${name}-feature\n      name: ${name}\n- id: subprocess\n  disabled: true\n`;
    const bytes = tar([['package/package.json', JSON.stringify(manifest)], ['package/cordis.patch.yml', patchText], ['package/index.js', 'export function apply(){}']]);
    const tarball = `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`;
    f.stager.fetcher = async (url, options) => String(url).includes(version)
        ? String(url).endsWith('.tgz') ? new Response(bytes) : Response.json({ ...manifest, dist: { tarball, integrity: integrity(bytes) } })
        : original(url, options);
    const scan = await f.service.scan(), item = scan.items[0];
    assert.equal(item.canUpdate, true, JSON.stringify(item.reasons));
    assert.equal(item.packagePreflight.coreWiring, true, 'the new core wiring is recorded for the plan');
});

test('a network failure during preflight is retryable rather than a policy refusal', async t => {
    const f = await serviceFixture(t), original = f.stager.inspectPackage.bind(f.stager);
    f.stager.inspectPackage = async (name, version, ...rest) => {
        if (version === '1.1.0') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
        return original(name, version, ...rest);
    };
    const item = (await f.service.scan()).items[0];
    assert.equal(item.canUpdate, false);
    assert.equal(item.preflightError?.code, 'preflight-network-failed');
    assert(item.reasons.includes('preflight-network-failed'));
    assert.equal(item.packagePreflight.status, 'failed');
    assert.equal(item.packagePreflight.causeKind, 'network');
    assert.deepEqual(f.calls, []);
});


test('an installed core override that the target keeps does not block a normal update', async t => {
    const f = await serviceFixture(t, { patchSuffix: '- id: hmr\n  disabled: false\n  config:\n    root: []\n', overrides: ['hmr'] });
    const item = (await f.service.scan()).items[0];
    assert.equal(item.canUpdate, true, JSON.stringify(item.reasons));
    assert.equal(item.packagePreflight.status, 'passed');
    const plan = await f.service.prepareBatch([{ name: f.bundles[0].name, version: '1.1.0' }]);
    assert.equal(plan.items[0].installMode, 'registry-spec');
    assert.equal(plan.items[0].registry, 'https://registry.npmjs.org');
    assert.deepEqual(f.calls, [], 'nothing is mutated before the authenticated confirmation');
});

test('a target that changes an installed core override is recorded, not refused', async t => {
    const f = await serviceFixture(t, { patchSuffix: '- id: hmr\n  disabled: false\n  config:\n    root: []\n', overrides: ['hmr'] });
    const name = f.bundles[0].name, version = '1.1.0', original = f.stager.fetcher;
    const manifest = { name, version, type: 'module', exports: { '.': './index.js' }, dsh: { bundle: { patch: 'cordis.patch.yml' } } };
    const patch = `- insert:\n    - id: ${name}-feature\n      name: ${name}\n- id: hmr\n  disabled: false\n  config:\n    root:\n      - src\n`;
    const bytes = tar([['package/package.json', JSON.stringify(manifest)], ['package/cordis.patch.yml', patch], ['package/index.js', 'export function apply(){}']]);
    f.stager.fetcher = async (url, options) => String(url).includes(version)
        ? String(url).endsWith('.tgz') ? new Response(bytes) : Response.json({ ...manifest, dist: { tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: integrity(bytes) } })
        : original(url, options);
    const item = (await f.service.scan()).items[0];
    assert.equal(item.canUpdate, true, JSON.stringify(item.reasons));
    assert.equal(item.packagePreflight.coreWiring, true);
    const plan = await f.service.prepareBatch([{ name, version }]);
    assert.equal(plan.items[0].to, version);
    assert.deepEqual(f.calls, []);
});



test('a version query that fails during preparation is retryable, not a changed selection', async t => {
    const f = await serviceFixture(t);
    assert.equal((await f.service.scan()).items[0].canUpdate, true);
    f.manager.listVersions = async () => { throw new TypeError('fetch failed'); };
    await assert.rejects(() => f.service.prepareBatch([{ name: f.bundles[0].name, version: '1.1.0' }]),
        error => error.code === 'version-query-failed' && error.preflight?.phase === 'metadata' && error.preflight?.causeKind === 'network');
    assert.deepEqual(f.calls, []);
});

test('a dropped archive download during preparation stays a retryable network failure', async t => {
    const f = await serviceFixture(t);
    assert.equal((await f.service.scan()).items[0].canUpdate, true);
    const original = f.stager.fetcher;
    f.stager.fetcher = async (url, options) => {
        if (String(url).endsWith('.tgz') && String(url).includes('1.1.0')) throw new TypeError('terminated');
        return original(url, options);
    };
    await assert.rejects(() => f.service.prepareBatch([{ name: f.bundles[0].name, version: '1.1.0' }]),
        error => error.code === 'preflight-network-failed' && error.preflight?.phase === 'archive');
    assert.deepEqual(f.calls, []);
});


test('a failed version query is surfaced as a retryable row, not a policy refusal', async t => {
    const f = await serviceFixture(t);
    f.manager.listVersions = async () => { throw new TypeError('fetch failed'); };
    const item = (await f.service.scan()).items[0];
    assert.equal(item.canUpdate, false);
    assert.equal(item.versionStatus, 'error');
    assert.deepEqual(item.preflightError, { code: 'version-query-failed', retryable: true });
    assert(item.reasons.includes('version-query-failed'));
});


test('a metadata query that drops during preparation is retryable, not a source refusal', async t => {
    const f = await serviceFixture(t);
    await f.service.scan();
    const original = f.manager.listVersions.bind(f.manager);
    let calls = 0;
    f.manager.listVersions = async (...args) => { calls += 1; return calls === 1 ? original(...args) : { status: 'refused', problem: 'network' }; };
    await assert.rejects(() => f.service.prepareBatch([{ name: f.bundles[0].name, version: '1.1.0' }]),
        error => ['version-query-failed', 'preflight-network-failed'].includes(error.code) && error.preflight?.causeKind === 'network');
    assert.deepEqual(f.calls, []);
});


test('a plugin whose installed tree holds native binaries is the one case still refused', async t => {
    const f = await serviceFixture(t), name = f.bundles[0].name;
    const dir = join(f.root, name);
    const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
    await writeFile(join(dir, 'package.json'), JSON.stringify({ ...manifest, dependencies: { 'native-dep': '1.0.0' } }));
    await mkdir(join(dir, 'node_modules', 'native-dep'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'native-dep', 'package.json'), JSON.stringify({ name: 'native-dep', version: '1.0.0' }));
    await writeFile(join(dir, 'node_modules', 'native-dep', 'addon.node'), 'owned inert fake native');
    const item = (await f.service.scan()).items[0];
    assert.equal(item.canUpdate, false);
    assert(item.reasons.includes('native-payload-not-hot-replaceable'), JSON.stringify(item.reasons));
    assert.deepEqual(f.calls, []);
});

test('a target that declares a Host package as a dependency is recorded, not refused', async t => {
    const f = await serviceFixture(t);
    replaceCandidate(f, { dependencies: { '@deepseek-ai/dsh-tools': '0.1.7-rc.2' } });
    const item = (await f.service.scan()).items[0];
    assert.equal(item.canUpdate, true, JSON.stringify(item.reasons));
    assert.deepEqual(item.packagePreflight.hostDependencies, ['@deepseek-ai/dsh-tools']);
    const plan = await f.service.prepareBatch([{ name: f.bundles[0].name, version: '1.1.0' }]);
    assert.deepEqual(plan.items[0].hostDependencies, ['@deepseek-ai/dsh-tools'], 'the plan carries the warning so the failure is explainable');
    assert.deepEqual(f.calls, []);
});
