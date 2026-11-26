import test from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile as writeFileText } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/http.js';
import { buildReport, reportOperation, REPORT_SCHEMA } from '../lib/report.js';
import { serviceFixture } from './helpers/service-fixture.mjs';
import { FailureLog } from '../lib/failure-log.js';
import { makeRedactor } from '../lib/redact.js';

test('the report builder bounds operations, steps and oversized diagnostics', () => {
    const operations = Array.from({ length: 10 }, (_, index) => reportOperation({
        id: 'op-' + index, operation: 'batch-update', origin: 'doctor', phase: 'finished', outcome: 'failed',
        startedAt: new Date().toISOString(),
        steps: Array.from({ length: 80 }, (_, step) => ({ step: 'step-' + step, time: new Date().toISOString() })),
        items: [{ name: 'owned-plugin', from: '1.0.0', to: '2.0.0', status: 'failed',
            result: { application: 'failed', stage: 'enable', error: { code: 'activation-failed', diagnostic: 'x'.repeat(50_000) } } }],
    }, { name: 'owned-plugin' }));
    const report = buildReport({ generatedAt: new Date().toISOString(), doctorVersion: '1.2.3', runtimeVersion: '0.2.2-rc.5',
        host: { node: '24.21.0', electron: '44.7.0', platform: 'win32', arch: 'x64' }, profile: 'desktop',
        subject: { name: 'owned-plugin', version: '1.0.0' }, operations });
    assert.equal(report.schema, REPORT_SCHEMA);
    assert(report.operations.length <= 6);
    assert(report.operations[0].steps.length <= 60);
    assert(Buffer.byteLength(JSON.stringify(report), 'utf8') <= 200_000);
    assert.match(JSON.stringify(report), /<report-truncated>/);
});

test('the service report is sanitized, bounded and exposed by the read-only panel route', async t => {
    const f = await serviceFixture(t);
    const time = new Date().toISOString();
    await f.service.store.put({
        id: 'owned-failure', package: 'sample-plugin', operation: 'batch-update', origin: 'doctor', phase: 'finished', outcome: 'failed',
        time, startedAt: time, finishedAt: time,
        steps: [{ step: 'preparing-sample-plugin', time }, { step: 'updating-sample-plugin', time }],
        items: [{ name: 'sample-plugin', from: '1.0.0', to: '1.1.0', status: 'failed', installMode: 'registry-spec',
            result: { application: 'failed', stage: 'enable',
                error: { code: 'activation-failed', diagnostic: `activation failed in ${f.root}\\sample-plugin password=hidden` } } }],
    });
    await f.service.rememberFailure({ id: 'owned-job', record: { operation: 'batch-update', phase: 'finished', steps: [{ step: 'updating-sample-plugin', time }] } }, {
        name: 'sample-plugin', from: '1.0.0', to: '1.1.0', status: 'failed', installMode: 'registry-spec',
        result: { application: 'failed', error: { code: 'activation-failed', diagnostic: 'retained failure detail' } },
        verification: { package: { status: 'verified' } },
    });
    const report = await f.service.report('sample-plugin');
    assert.equal(report.schema, REPORT_SCHEMA);
    assert.equal(report.subject.name, 'sample-plugin');
    assert.equal(report.doctor.version, JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
    assert.equal(report.operations[0].id, 'owned-failure');
    assert.equal(report.failures[0].error.code, 'activation-failed');
    assert.match(report.failures[0].error.diagnostic, /retained failure detail/);
    assert.deepEqual(report.failures[0].verification, { package: 'verified', source: null, host: null, runtime: null });
    const error = report.operations[0].items[0].result.error;
    assert.equal(error.code, 'activation-failed');
    assert.match(error.diagnostic, /activation failed/);
    const text = JSON.stringify(report);
    assert(!text.includes(f.root), 'the profile path is redacted');
    assert(!text.includes('password=hidden'), 'credential text is redacted');
    assert(text.includes('failure') || text.includes('failed'));

    const handler = createHandler(f.service);
    const named = await handler(new Request('http://dsh.internal/api/plugin-update-doctor?action=report&name=sample-plugin'));
    assert.equal(named.status, 200);
    assert.equal((await named.json()).schema, REPORT_SCHEMA);
    const all = await handler(new Request('http://dsh.internal/api/plugin-update-doctor?action=report'));
    assert.equal(all.status, 200);
    assert.equal((await all.json()).schema, REPORT_SCHEMA);
});

test('an invalid report subject is refused instead of returning a partial report', async t => {
    const f = await serviceFixture(t);
    const handler = createHandler(f.service);
    const response = await handler(new Request('http://dsh.internal/api/plugin-update-doctor?action=report&name=../escape'));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid-name');
});

test('the retained failure log is bounded, sanitized and reloadable after history compaction', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-failure-log-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const path = join(root, 'failures.json');
    const redact = makeRedactor({ home: root, profileDir: join(root, 'profile') });
    const log = new FailureLog(path, redact, { maxEntries: 3, maxBytes: 192_000 });
    const time = new Date().toISOString();
    for (let index = 0; index < 5; index++) {
        await log.remember({ id: 'op-' + index, time, package: index % 2 ? 'a-plugin' : 'b-plugin',
            operation: 'batch-update', phase: 'finished', status: 'failed', from: '1.0.0', to: '1.1.0',
            error: { code: 'activation-failed', diagnostic: join(root, 'profile') + ' password=hidden ' + 'x'.repeat(40_000) },
            steps: [{ step: 'updating', time }] });
    }
    assert.equal(log.entries.length, 3);
    assert.equal(log.entries[0].id, 'op-4');
    const text = JSON.stringify(log.entries);
    assert(!text.includes('password=hidden'));
    assert(!text.includes(join(root, 'profile')));
    assert(text.includes('<profile>'));
    assert((await stat(path)).size <= 256_000);
    const fresh = new FailureLog(path, redact, { maxEntries: 3, maxBytes: 192_000 });
    await fresh.load();
    assert.equal(fresh.entries.length, 3);
    assert.equal(fresh.list('a-plugin').length, 1);
    assert.equal(fresh.warning, null);
});
