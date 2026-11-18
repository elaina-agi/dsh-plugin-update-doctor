import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGate } from '../lib/task-gate.js';

test('stopping tasks requires explicit policy confirmation', async () => {
    let cancelled=0; const agent={status:'running',cancel(){cancelled++;},whenIdle:async()=>{},runMaintenance:async job=>job()};
    const gate=new TaskGate({list:()=>[agent]});
    await assert.rejects(()=>gate.run(async()=>{}, {taskPolicy:'cancel-active'}),/confirmation-required/);
    assert.equal(cancelled,0);
});
test('confirmed stop cancels current agent using user cause then waits for quiescence', async () => {
    const idle=Promise.withResolvers(); let cause, stopped, entered=false;
    const agent={status:'running',cancel(value){cause=value;this.status='idle';idle.resolve();},whenIdle:()=>idle.promise,runMaintenance:async job=>job(new AbortController().signal)};
    const gate=new TaskGate({list:()=>[agent]});
    await gate.run(async()=>{entered=true;}, {taskPolicy:'cancel-active',confirmCancel:true,onCancelled:state=>stopped=state});
    assert.deepEqual(cause,{kind:'user'});assert.equal(stopped.requestedAgents,1);assert.equal(stopped.queueClear,'complete');assert.equal(entered,true);
});
test('default wait does not cancel running tasks', async () => {
    const idle=Promise.withResolvers();let cancelled=0;
    const agent={status:'running',cancel(){cancelled++;},whenIdle:()=>idle.promise,runMaintenance:async job=>job(new AbortController().signal)};
    const gate=new TaskGate({list:()=>[agent]}); const work=gate.run(async()=>{});
    assert.equal(cancelled,0);agent.status='idle';idle.resolve();await work;assert.equal(cancelled,0);
});
