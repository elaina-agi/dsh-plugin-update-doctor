import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { TaskGate } from '../lib/task-gate.js';
const anchor=process.env.DSH_INSTALL_DIR;
const require=createRequire(join(anchor,'package.json'));
const app=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href);
const root=await fs.mkdtemp(join(tmpdir(),'dsh-real-agent-gate-'));process.env.DSH_HOME=root;
const config=join(root,'cordis.yml');
const names=['@deepseek-ai/dsh-session','@deepseek-ai/dsh-session-projection','@deepseek-ai/dsh-agent','@deepseek-ai/dsh-llm','@deepseek-ai/dsh-system-prompt','@deepseek-ai/dsh-tools','@deepseek-ai/dsh-tool-executor-native','@deepseek-ai/dsh-agent-loop'];
await fs.writeFile(config,JSON.stringify(names.map((name,index)=>({id:'agent-gate-'+index,name}))));
let ctx,gate,handle,newHandle;
const evidence={schemaVersion:1,runtimeVersion:app.getDshRuntimeVersion(),pid:process.pid,steps:[],limitations:['Real public AgentRegistry/AgentLoop/Session/projections and current TaskGate implementation.','Active work is a real Agent maintenance operation, not a model request; no LLM provider or network call.']};
async function step(name,fn){try{const value=await fn();evidence.steps.push({name,ok:true,value});console.log('AGENT_GATE',name,JSON.stringify(value));return value;}catch(error){evidence.steps.push({name,ok:false,error:String(error.stack||error)});throw error;}}
try{
 ctx=await app.boot('agent-gate-proof',config,undefined,async rootCtx=>{const resolution=await app.createRuntimeResolution({installAnchor:join(anchor,'package.json'),home:root});await rootCtx.plugin(app.PluginPackages,{resolution});},pathToFileURL(join(anchor,'package.json')).href);
 const agents=ctx.get('agents');assert(agents);assert(ctx.get('agentLoop'));
 handle=await agents.create({sessionId:'online-gate-proof-session',agentOptions:{},meta:{}});
 await step('create-real-agent',async()=>({id:handle.agent.id,status:handle.agent.status,pid:process.pid}));
 const agent=handle.agent;gate=new TaskGate(agents,{timeoutMs:5000});
 let preStepEntered=false,preStepPassed=false;const enteredGate=Promise.withResolvers(),passedGate=Promise.withResolvers();
 ctx.on('agent/pre-step',async function(args,next){preStepEntered=true;enteredGate.resolve();await gate.beforeStep(args);preStepPassed=true;passedGate.resolve();return {kind:'reject'};},{global:true});
 const work=Promise.withResolvers(),workEntered=Promise.withResolvers();
 const oldWork=agent.runMaintenance(async()=>{workEntered.resolve();await work.promise;return 'active-maintenance-finished';});await workEntered.promise;
 let updating=false;const updateEntered=Promise.withResolvers(),updateReleased=Promise.withResolvers();
 const pending=gate.run(async()=>{updating=true;updateEntered.resolve();await updateReleased.promise;return 'update-finished';});
 await step('task-gate-waits-without-cancelling',async()=>{assert.equal(updating,false);assert.equal(gate.active,false);work.resolve();assert.equal(await oldWork,'active-maintenance-finished');return{existingWorkCompleted:true,waitingDidNotBlockAgentCreation:true};});
 await updateEntered.promise;
 await step('maintenance-claims-real-idle-agent',async()=>{assert.equal(gate.active,true);assert.throws(()=>agent.runMaintenance(async()=>{}),/already has active work/);return{claimPreventsOverlappingMaintenance:true};});
 await step('new-agent-creation-completes-during-maintenance',async()=>{newHandle=await agents.create({sessionId:'online-gate-new-agent',agentOptions:{provider:'proof-no-provider',model:'proof-no-model'},meta:{}});assert.equal(gate.active,true);assert.equal(newHandle.agent.status,'idle');return{creationCompletedWithoutDeadlock:true,newAgentIdle:true};});
 newHandle.agent.followup({role:'user',content:[{type:'text',text:'owned test input; stopped at pre-step without model call'}],source:{kind:'user'}});
 const enteredOrErrored=Promise.race([enteredGate.promise,newHandle.agent.whenIdle().then(()=>{if(!preStepEntered)throw Error('Agent returned idle before gate: '+JSON.stringify(newHandle.agent.session.snapshotEvents().filter(e=>e.type==='turn/end')));})]);
 const aliveTimer=setInterval(()=>{},1000);try{await enteredOrErrored;}finally{clearInterval(aliveTimer);}
 await step('new-agent-first-step-pauses-during-maintenance',async()=>{assert.equal(preStepEntered,true);assert.equal(preStepPassed,false);assert.equal(newHandle.agent.status,'running');assert.equal(newHandle.agent.session.snapshotEvents().filter(e=>e.type==='step/start').length,0);updateReleased.resolve();assert.equal(await pending,'update-finished');await passedGate.promise;await newHandle.agent.whenIdle();assert.equal(newHandle.agent.status,'idle');await newHandle.dispose();return{preStepHeld:true,continuedAfterRelease:true,noModelCall:true};});
 await step('existing-real-agent-resumes',async()=>{assert.equal(gate.active,false);assert.equal(await agent.runMaintenance(async()=> 'later-maintenance'),'later-maintenance');return{realAgentAlive:true};});
 evidence.passed=true;
}catch(error){evidence.passed=false;evidence.fatal=String(error.stack||error);console.error(evidence.fatal);process.exitCode=1;}
finally{gate?.dispose();await gate?.release();await newHandle?.dispose();await handle?.dispose();if(ctx)await ctx.fiber.dispose();await fs.writeFile(process.argv[2],JSON.stringify(evidence,(key,value)=>key==='agent'||key==='dispose'?undefined:value,2));await fs.rm(root,{recursive:true,force:true});}
