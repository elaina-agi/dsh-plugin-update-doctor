import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SELF } from '../lib/service.js';
import { createHandler } from '../lib/http.js';
import { serviceFixture } from './helpers/service-fixture.mjs';

test('diagnostics and plans never perform management operations or issue confirmation tickets', async t => {
    const { service, calls } = await serviceFixture(t);
    assert.equal((await service.list()).bundles[0].state, 'active');
    await service.diagnose('sample-plugin'); await service.locks('sample-plugin'); await service.versions('sample-plugin');
    const plan = await service.prepare({ name: 'sample-plugin', version: '1.1.0' }); assert.equal(plan.ticket, undefined);
    await assert.rejects(() => service.prepare({ name: 'sample-plugin', version: '1.1.0' }, { issueTicket: true }), /User-only/);
    await assert.rejects(() => service.commit('invented'), /Confirmation expired/); assert.deepEqual(calls, []);
});
test('user batch confirmation is single-use and installed version is independently verified', async t => {
    const { service } = await serviceFixture(t); const plan = await service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]);
    const start = await service.commit(plan.ticket); await service.jobs.get(start.operationId).work;
    assert.equal(service.operation(start.operationId).record.items[0].result.application, 'applied');
    await assert.rejects(() => service.commit(plan.ticket), /Confirmation expired/);
});
test('incompatible, arbitrary downgrade and self update are rejected before mutation', async t => {
    const { service, bundles, calls } = await serviceFixture(t);
    await assert.rejects(() => service.prepare({ name: 'sample-plugin', version: '2.0.0' }), /compatible/);
    await assert.rejects(() => service.prepareRestore('sample-plugin'), /recorded failed update/);
    bundles[0].name = SELF; await assert.rejects(() => service.prepare({ name: SELF, version: '1.1.0' }), /cannot be safely updated/); assert.deepEqual(calls, []);
});
test('state changes invalidate prepared batch confirmation', async t => {
    const { service, bundles, calls } = await serviceFixture(t); const plan = await service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]);
    bundles[0].enabled = false; await assert.rejects(() => service.commit(plan.ticket), /state changed/); assert.deepEqual(calls, []);
});
test('failed activation captures sanitized result independently of a successful old-version restore', async t => {
    const { service, root } = await serviceFixture(t, { failTarget: true }); const plan = await service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]);
    const start = await service.commit(plan.ticket); await service.jobs.get(start.operationId).work;
    const item = service.operation(start.operationId).record.items[0]; assert.equal(item.result.application, 'failed'); assert.equal(item.restore.application, 'applied');
    const saved = await readFile(join(root, 'cache', 'dsh-plugin-update-doctor', 'test', 'history.json'), 'utf8'); assert(!saved.includes('hidden'));
});
test('official events retain whitelisted facts and block concurrent prepare', async t => {
    const { service } = await serviceFixture(t); await service.observe({ id: 'outside', phase: 'started', target: 'sample-plugin', reason: 'install', stage: 'install', time: new Date().toISOString() });
    await assert.rejects(() => service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]), /Another plugin operation/);
    await service.observe({ id: 'outside', phase: 'settled', target: 'sample-plugin', reason: 'install', application: 'failed', errorCode: 'operation-error', stage: 'enable' });
    assert.equal(service.store.records[0].detailedDiagnosticAvailable, false);
});
test('HTTP refuses non-panel mutation and arbitrary recovery arguments', async t => {
    const { service, calls } = await serviceFixture(t), handler = createHandler(service);
    assert.equal((await handler(new Request('http://localhost/api/plugin-update-doctor', { method: 'POST', body: JSON.stringify({ action: 'commit', ticket: 'invented' }) }))).status, 403);
    const headers = { 'content-type': 'application/json', 'x-dsh-plugin-update-doctor': 'panel-v1' };
    assert.equal((await handler(new Request('http://localhost/api/plugin-update-doctor', { method: 'POST', headers, body: JSON.stringify({ action: 'prepare-restore', name: 'sample-plugin', version: '0.9.0' }) }))).status, 400);
    assert.deepEqual(calls, []);
});
