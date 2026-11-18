import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGate } from '../lib/task-gate.js';

test('a later activity on the same Agent is outside the confirmed cancellation target', async () => {
    let cancelled=0;
    const agent={status:'running',cancel(){cancelled++;},whenIdle:async()=>{},runMaintenance:async job=>job()};
    const gate=new TaskGate({list:()=>[agent]});
    const targets=gate.cancellationTargets();
    agent.status='idle';gate.observeStatus({agent,status:'idle'});
    agent.status='running';gate.observeStatus({agent,status:'running'});
    await gate.run(async()=>{}, {taskPolicy:'cancel-active',confirmCancel:true,cancelTargets:targets});
    assert.equal(cancelled,0);
});
