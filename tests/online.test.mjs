import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGate } from '../lib/task-gate.js';
import { scanUpdates, onlineSafety } from '../lib/online.js';

function fakeAgent({ running = false } = {}) {
    const idle = Promise.withResolvers(); if (!running) idle.resolve();
    return { status: running ? 'running' : 'idle', idle, maintenance: false, inputs: [],
        whenIdle() { return this.idle.promise; },
        runMaintenance(task) { if (this.status !== 'idle' || this.maintenance) throw new Error('busy'); this.maintenance = true; return task(new AbortController().signal).finally(() => { this.maintenance = false; }); },
        finish() { this.status = 'idle'; this.idle.resolve(); },
    };
}
test('existing task finishes naturally before update and maintenance releases afterward', async () => {
    const agent = fakeAgent({ running: true }); const gate = new TaskGate({ list: () => [agent] });
    let entered = false;
    const update = gate.run(async () => { entered = true; assert.equal(agent.maintenance, true); return 'updated'; });
    await Promise.resolve(); assert.equal(entered, false); agent.finish();
    assert.equal(await update, 'updated'); assert.equal(agent.maintenance, false); assert.equal(gate.active, false);
});
test('new agent creation is allowed while waiting and parked only during replacement', async () => {
    const agents = [fakeAgent({ running: true })]; const gate = new TaskGate({ list: () => agents });
    const inner = Promise.withResolvers(), entered = Promise.withResolvers();
    const update = gate.run(async () => { entered.resolve(); return inner.promise; });
    const early = fakeAgent(); agents.push(early);
    await gate.beforeStep({}); // A running parent may create children while waiting.
    agents[0].finish(); await entered.promise;
    const fresh = fakeAgent(); agents.push(fresh);
    let started = false; const step = gate.beforeStep({}).then(()=>{started=true;});
    await Promise.resolve(); assert.equal(started,false); // Creation is not blocked; first step waits.
    inner.resolve('done'); await update; await step; assert.equal(started,true);
});
test('user cancelling wait never enters update and releases admission', async () => {
    const agent = fakeAgent({ running: true }); const gate = new TaskGate({ list: () => [agent] }); const controller = new AbortController();
    let entered = false; const work = gate.run(async () => { entered = true; }, { signal: controller.signal });
    controller.abort(new Error('cancel wait')); await assert.rejects(work, /cancel wait/); assert.equal(entered, false); assert.equal(gate.active, false);
});
test('latest compatible stable bundle chosen, prerelease/incompatible/deprecated excluded', async () => {
    const manager = { listVersions: async () => ({ status: 'listed', registry: 'https://registry.npmjs.org', versions: [{ version: '2.0.0-beta.1', bundle: true, prerelease: true }, { version: '1.9.0', bundle: true, incompatible: {} }, { version: '1.8.0', bundle: true, deprecated: 'old' }, { version: '1.7.0', bundle: true }] }) };
    const result = await scanUpdates(manager, [{ name: 'sample', version: '1.0.0', canUpdate: true, reasons: [] }]); assert.equal(result[0].latestVersion, '1.7.0');
});
test('high-risk Host/core/native runtime updates are blocked', () => {
    const base = { name: 'sample', version: '1.0.0', removable: true, availability: 'profile', update: 'registry' };
    assert.equal(onlineSafety(base, { name: 'sample', version: '1.0.0' }).permitted, true);
    assert.equal(onlineSafety(base, { name: 'sample', version: '1.0.0', dependencies: { '@deepseek-ai/dsh-agent': '1' } }).permitted, false);
    assert.equal(onlineSafety({ ...base, overrides: ['subprocess'] }, { name: 'sample', version: '1.0.0' }).permitted, false);
});
