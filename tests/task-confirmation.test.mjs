import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceFixture } from './helpers/service-fixture.mjs';

async function make(t) {
    let choices;
    const gate = { run: async (fn, value) => { choices = value; return fn(new AbortController().signal); } };
    return { ...await serviceFixture(t, { gate }), choices: () => choices };
}
test('commit rejects stop policy without extra user consent and never enters task gate', async t => {
    const { service, choices } = await make(t); const plan = await service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]);
    await assert.rejects(() => service.commit(plan.ticket, { taskPolicy: 'cancel-active' }), /explicit user confirmation/); assert.equal(choices(), undefined);
});
test('confirmed stop is passed only after exact archive preparation and state review', async t => {
    const { service, choices } = await make(t); const plan = await service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]);
    assert(plan.items[0].nextReference.sha256); const start = await service.commit(plan.ticket, { taskPolicy: 'cancel-active', confirmCancel: true }); await service.jobs.get(start.operationId).work;
    assert.equal(choices().taskPolicy, 'cancel-active'); assert.equal(choices().confirmCancel, true);
});
