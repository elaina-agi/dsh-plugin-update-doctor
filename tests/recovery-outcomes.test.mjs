import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceFixture } from './helpers/service-fixture.mjs';

test('target verification remains separate from automatic old-version restoration', async t => {
    const { service } = await serviceFixture(t, { failTarget: true });
    const plan = await service.prepareBatch([{name:'sample-plugin',version:'1.1.0'}]);
    const start = await service.commit(plan.ticket);await service.jobs.get(start.operationId).work;
    const item=service.operation(start.operationId).record.items[0];
    assert.equal(item.result.application,'failed');assert.equal(item.verification.package.version,'1.1.0');
    assert.equal(item.verification.host.status,'inactive');assert.equal(item.restore.application,'applied');
    assert.equal(item.restoreVerification.package.version,'1.0.0');assert.equal(item.restoreVerification.host.status,'active');
});
test('a persisted interrupted batch reads as unknown rather than finished', async t => {
    const { service } = await serviceFixture(t);
    await service.store.put({id:'interrupted-record',operation:'batch-update',phase:'interrupted',outcome:'unknown',items:[{name:'sample-plugin',status:'unknown'}]});
    assert.equal(service.operation('interrupted-record').phase,'unknown');
});
