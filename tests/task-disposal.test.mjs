import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGate } from '../lib/task-gate.js';

// Models only the public maintenance/cancel/whenIdle contract. The separate
// owned-profile experiment verifies the real installed Agent and manager.
function agentFixture() {
    let active = null;
    return {
        status: 'idle',
        get claimed() { return active !== null; },
        whenIdle() { return active?.done.promise ?? Promise.resolve(); },
        runMaintenance(job) {
            if (active !== null) throw new Error('already has active work');
            const phase = { abort: new AbortController(), done: Promise.withResolvers() };
            active = phase;
            return Promise.resolve().then(() => job(phase.abort.signal)).finally(() => {
                if (active === phase) active = null;
                phase.done.resolve();
            });
        },
        cancel(cause) { active?.abort.abort(cause); },
    };
}
async function bounded(promise, ms = 300) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('maintenance claim did not settle')), ms); })]); }
    finally { clearTimeout(timer); }
}

for (const cause of [{ kind: 'disposed' }, { kind: 'user' }, { kind: 'parent' }, { kind: 'hook', reason: 'owned-fixture' }]) {
    test(`Agent ${cause.kind} cancellation releases only its own maintenance claim`, async () => {
        const target = agentFixture(), unrelated = agentFixture();
        const gate = new TaskGate({ list: () => [target, unrelated] });
        const entered = Promise.withResolvers(), finish = Promise.withResolvers();
        const update = gate.run(async () => { entered.resolve(); await finish.promise; return 'updated'; });
        await entered.promise;
        let passed = false;
        const step = gate.beforeStep({}).then(() => { passed = true; });
        try {
            assert.equal(target.claimed, true);
            assert.equal(unrelated.claimed, true);
            target.cancel(cause);
            await bounded(target.whenIdle());
            assert.equal(target.claimed, false);
            assert.equal(unrelated.claimed, true);
            assert.equal(gate.active, true);
            assert.equal(gate.inFlight, true);
            assert.equal(passed, false);
            assert.throws(() => unrelated.runMaintenance(async () => {}), /already has active work/);
            // A user-cancelled signal cannot change reason on a later disposal.
            // Its claim must already have settled so disposal cannot wait forever.
            target.cancel({ kind: 'disposed' });
            await bounded(target.whenIdle());
        } finally {
            finish.resolve();
            await update;
            await step;
        }
        assert.equal(passed, true);
        assert.equal(gate.active, false);
        assert.equal(unrelated.claimed, false);
        assert.equal(await unrelated.runMaintenance(async () => 'usable'), 'usable');
    });
}

test('an already-aborted maintenance signal settles without opening the global step barrier', async () => {
    const controller = new AbortController(); controller.abort({ kind: 'disposed' });
    let settled = false;
    const target = { status: 'idle', whenIdle: async () => {}, runMaintenance: job => Promise.resolve(job(controller.signal)).finally(() => { settled = true; }) };
    const gate = new TaskGate({ list: () => [target] });
    const entered = Promise.withResolvers(), finish = Promise.withResolvers();
    const update = gate.run(async () => { entered.resolve(); await finish.promise; });
    await entered.promise;
    try {
        await bounded(Promise.allSettled(gate.claims));
        assert.equal(settled, true);
        assert.equal(gate.active, true);
    } finally { finish.resolve(); await update; }
});

test('global release and concurrent local disposal settle each claim once and permit a later gate', async () => {
    const target = agentFixture();
    const gate = new TaskGate({ list: () => [target] });
    await gate.run(async () => { target.cancel({ kind: 'disposed' }); });
    assert.equal(target.claimed, false);
    assert.equal(gate.active, false);
    assert.equal(gate.claims.length, 0);
    assert.equal(await gate.run(async () => 'second-update'), 'second-update');
    assert.equal(gate.inFlight, false);
});
