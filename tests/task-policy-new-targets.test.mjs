import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskGate } from '../lib/task-gate.js';

test('confirmed stop does not cancel tasks started after confirmation snapshot', async () => {
    let oldCancelled=0,newCancelled=0;
    const old={status:'running',cancel(){oldCancelled++;this.status='idle';},whenIdle:async()=>{},runMaintenance:async job=>job()};
    const newer={status:'running',cancel(){newCancelled++;},whenIdle:async()=>{newer.status='idle';},runMaintenance:async job=>job()};
    const gate=new TaskGate({list:()=>[old,newer]});
    await gate.run(async()=>{}, {taskPolicy:'cancel-active',confirmCancel:true,cancelTargets:[{agent:old,epoch:0}]});
    assert.equal(oldCancelled,1);assert.equal(newCancelled,0);
});
