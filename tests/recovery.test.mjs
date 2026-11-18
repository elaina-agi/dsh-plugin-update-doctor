import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceFixture } from './helpers/service-fixture.mjs';

async function failedBatch(t) {
    const fixture = await serviceFixture(t, { failTarget: true, failRestore: true });
    const plan = await fixture.service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]);
    const start = await fixture.service.commit(plan.ticket); await fixture.service.jobs.get(start.operationId).work;
    return fixture;
}
test('failed batch retains a separate exact recovery identity and offers name-only confirmed recovery', async t => {
    const { service, state, calls } = await failedBatch(t);
    const listed = await service.list(); const target = listed.bundles.find(b => b.name === 'sample-plugin');
    assert.equal(target.canRestore, true); assert.equal(target.restoreVersion, '1.0.0'); assert(target.recoveryId);
    const diagnostic = await service.prepare({ name: 'sample-plugin', version: '1.0.0', operation: 'restore' }); assert.equal(diagnostic.ticket, undefined);
    await assert.rejects(() => service.prepare({ name: 'sample-plugin', version: '0.9.0', operation: 'restore' }), /exact recorded/);
    state.failRestore = false; const plan = await service.prepareRestore('sample-plugin');
    assert.equal(plan.operation, 'batch-restore'); assert.equal(plan.items[0].to, '1.0.0');
    const job = await service.commit(plan.ticket); await service.jobs.get(job.operationId).work;
    assert.equal(service.operation(job.operationId).record.items[0].status, 'restored');
    assert.equal(service.recoveryFor('sample-plugin'), undefined); assert(calls.some(c => c[1] === 'sample-plugin@1.0.0'));
});
test('changed external package state invalidates a recorded restore without deleting the external target', async t => {
    const { service, bundles, calls } = await failedBatch(t);
    const before = calls.length; bundles[0].version = '9.0.0'; bundles[0].source = 'external-plugin@9.0.0';
    await assert.rejects(() => service.prepareRestore('sample-plugin'), /no longer matches/); assert.equal(calls.length, before);
});
test('rotating diagnostic history does not remove installed identity or failed recovery eligibility', async t => {
    const { service } = await failedBatch(t); const identity = service.recoveryFor('sample-plugin').id;
    for (let i = 0; i < 90; i++) await service.store.put({ id: 'outside-' + i, package: 'other', phase: 'settled', operation: 'install', event: { application: 'applied' } });
    assert.equal(service.store.list('sample-plugin').length, 0); assert.equal(service.recoveryFor('sample-plugin').id, identity);
    assert.equal((await service.list()).bundles.find(b => b.name === 'sample-plugin').canRestore, true);
});
