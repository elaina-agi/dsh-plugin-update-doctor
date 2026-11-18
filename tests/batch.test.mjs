import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceFixture } from './helpers/service-fixture.mjs';

test('batch confirmation binds exact archives before official remove/install', async t => {
    const { service, calls } = await serviceFixture(t, { names: ['plugin-a', 'plugin-b'] });
    const plan = await service.prepareBatch(['plugin-a', 'plugin-b'].map(name => ({ name, version: '1.1.0' })));
    assert.deepEqual(calls, []); assert(plan.items.every(item => item.registry === 'https://registry.npmjs.org' && item.nextReference.sha256 && item.previousReference.sha256));
    const started = await service.commit(plan.ticket); await service.jobs.get(started.operationId).work;
    const result = service.operation(started.operationId).record;
    assert.equal(result.outcome, 'applied'); assert(result.items.every(item => item.status === 'updated' && item.verification.package.status === 'verified' && item.verification.host.status === 'active'));
    assert.deepEqual(calls.map(call => call.slice(0, 2)), [['remove', 'plugin-a'], ['install', 'plugin-a@1.1.0'], ['remove', 'plugin-b'], ['install', 'plugin-b@1.1.0']]);
});
test('activation failure recovers exact old archive, keeps first failure and skips later targets', async t => {
    const { service, calls } = await serviceFixture(t, { names: ['plugin-a', 'plugin-b'], failTarget: true });
    const plan = await service.prepareBatch(['plugin-a', 'plugin-b'].map(name => ({ name, version: '1.1.0' })));
    const started = await service.commit(plan.ticket); await service.jobs.get(started.operationId).work;
    const result = service.operation(started.operationId).record;
    assert.equal(result.outcome, 'failed'); assert.equal(result.items[0].status, 'failed'); assert.equal(result.items[0].restore.application, 'applied'); assert.equal(result.items[1].status, 'skipped');
    assert(!calls.some(call => call[1]?.includes('plugin-b')));
    const restore = calls.find(call => call[1] === 'plugin-a@1.0.0'); assert(restore); assert.notEqual(restore[2], started.operationId);
    assert.equal(service.recoveryFor('plugin-a'), undefined);
    assert.equal(service.store.list('plugin-a')[0].result.application, 'failed');
});
