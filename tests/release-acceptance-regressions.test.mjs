import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceFixture} from './helpers/service-fixture.mjs';
import {DoctorService} from '../lib/service.js';
import {TaskGate} from '../lib/task-gate.js';
const name='sample-plugin';
async function update(f){const plan=await f.service.prepareBatch([{name,version:'1.1.0'}]);const start=await f.service.commit(plan.ticket);await f.service.jobs.get(start.operationId).work;return f.service.operation(start.operationId).record.items[0];}
test('disabled registry bundle updates with no live rows and does not become an unknown outcome',async t=>{
 const f=await serviceFixture(t);f.bundles[0].enabled=false;f.manager.listPlugins=async()=>[];
 const item=await update(f);assert.equal(item.status,'updated');assert.equal(item.verification.package.status,'verified');assert.equal(item.verification.host.status,'disabled');assert.equal(f.bundles[0].enabled,false);assert.equal(f.service.recoveryFor(name),undefined);
});
test('enabled registry bundle respects independently disabled Host rows without claiming they are active',async t=>{
 const f=await serviceFixture(t);f.manager.listPlugins=async()=>[{entryId:'include:'+name+'-feature',patchId:name+'-feature',moduleName:name,enabled:false,fiberPhase:'disposed'}];
 const item=await update(f);assert.equal(item.status,'updated');assert.equal(item.verification.host.status,'disabled');assert.equal(item.verification.host.activeRows,0);assert.equal(f.service.recoveryFor(name),undefined);
});
test('missing foreign and failed enabled Host rows still refuse registry success',async t=>{
 for(const rows of [[],[{entryId:'include:'+name+'-feature',patchId:name+'-feature',moduleName:'foreign-plugin',enabled:false,fiberPhase:'disposed'}],[{entryId:'include:'+name+'-feature',patchId:name+'-feature',moduleName:name,enabled:true,fiberPhase:'failed'}]]){
  const f=await serviceFixture(t);f.manager.listPlugins=async()=>rows;const item=await update(f);assert.notEqual(item.status,'updated');assert.equal(f.service.recoveryFor(name).status,'unknown');
 }
});
test('cancelled untouched migration retains independent archive identity after history rotation and reinitialization',async t=>{
 const f=await serviceFixture(t),old=await f.stager.stage(name,'1.0.0');Object.assign(f.bundles[0],{source:'file:'+old.archivePath,update:undefined});const reference=f.stager.reference(old);await f.service.identities.remember(reference);await f.service.store.put({id:'unrelated',phase:'finished',outcome:'applied'});
 const waiting=Promise.withResolvers(),held=Promise.withResolvers();f.service.taskGate=new TaskGate({list:()=>[{status:'running',whenIdle:()=>held.promise}]},{timeoutMs:5000});
 const run=f.service.taskGate.run.bind(f.service.taskGate);f.service.taskGate.run=(op,options)=>run(op,{...options,onWaiting:state=>{options.onWaiting?.(state);waiting.resolve();}});
 const plan=await f.service.prepareMigration(name),start=await f.service.commit(plan.ticket);await waiting.promise;assert.equal(f.service.recoveryFor(name).dispatchStarted,undefined);f.service.cancelWait(start.operationId);await f.service.jobs.get(start.operationId).work;assert.deepEqual(f.calls,[]);
 await f.service.initialize();assert.equal(f.service.lineageOf(f.bundles[0])?.sha256,reference.sha256);assert.equal(f.service.recoveryFor(name),undefined);assert.equal((await f.service.list()).bundles[0].canMigrate,true);
});
test('untouched skipped migration settlement preserves verified archive identity without old history',async t=>{
 const f=await serviceFixture(t),old=await f.stager.stage(name,'1.0.0'),reference=f.stager.reference(old);Object.assign(f.bundles[0],{source:'file:'+old.archivePath,update:undefined});await f.service.identities.remember(reference);const plan=await f.service.prepareMigration(name),item={...plan.items[0],status:'skipped'};await f.service.identities.prepare({id:'owned-skipped',failedBatchId:'owned',name,from:'1.0.0',to:'1.0.0',enabled:true,previous:reference,next:plan.items[0].nextReference,status:'prepared',expectedFingerprint:f.service.fingerprint(f.bundles[0]),installMode:'registry-migration'});await f.service.persistItemOutcome({record:{}},item);assert.equal(f.service.lineageOf(f.bundles[0])?.sha256,reference.sha256);assert.equal(f.service.recoveryFor(name),undefined);
});
test('generation verification respects disabled selection and disabled rows while still refusing foreign or failed rows',async()=>{
 for(const {enabled,rows,ok} of [{enabled:false,rows:[],ok:true},{enabled:true,rows:[{patchId:'owned-row',moduleName:'owned-package/_g/a',enabled:false,fiberPhase:'disposed'}],ok:true},{enabled:true,rows:[{patchId:'owned-row',moduleName:'foreign-package',enabled:false,fiberPhase:'disposed'}],ok:false},{enabled:true,rows:[{patchId:'owned-row',moduleName:'owned-package/_g/a',enabled:true,fiberPhase:'failed'}],ok:false}]){
  const bundle={name:'owned-package',version:'1.1.0',enabled},service=Object.create(DoctorService.prototype);service.manager={setBundleEnabled:async()=>({application:'applied'}),listBundles:async()=>[bundle],listPlugins:async()=>rows};const operation=()=>service.verifyGeneration({name:'owned-package',to:'1.1.0',enabled},{rows:[{id:'owned-row',name:'owned-package/feature'}],runtimeGeneration:{moduleAliases:[['owned-package/feature','owned-package/_g/a']]}},{application:'applied'});if(ok)assert.equal((await operation()).generationVerified,true);else await assert.rejects(operation,e=>e.code==='generation-row-not-active');
 }
});
test('Union HMR recovery capability stays disabled for installed and missing recorded targets',async t=>{
 for(const installed of [true,false]){const f=await serviceFixture(t,{names:['dsh-union-search']}),old=await f.stager.stage('dsh-union-search','1.0.0'),next=await f.stager.stage('dsh-union-search','1.1.0');f.bundles[0].installed=installed;await f.service.identities.prepare({id:'owned-recovery',failedBatchId:'owned-batch',name:'dsh-union-search',from:'1.0.0',to:'1.1.0',enabled:true,previous:f.stager.reference(old),next:f.stager.reference(next),status:'failed',expectedFingerprint:f.service.fingerprint(f.bundles[0]),installMode:'registry-spec'});const row=(await f.service.list()).bundles.find(v=>v.name==='dsh-union-search');assert.equal(row.canRestore,false);assert.equal(row.restoreVersion,null);assert.equal(row.recoveryId,null);await assert.rejects(()=>f.service.prepareRestore('dsh-union-search'),e=>e.code==='dependency-runtime-reload-unverified');}
});
