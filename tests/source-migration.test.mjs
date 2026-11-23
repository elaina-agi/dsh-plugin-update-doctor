import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceFixture} from './helpers/service-fixture.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const name='sample-plugin';
async function oldArchive(t){const f=await serviceFixture(t),original=await f.stager.stage(name,'1.0.0');Object.assign(f.bundles[0],{source:'file:'+original.archivePath,update:undefined});await f.service.identities.remember(f.stager.reference(original));return f;}

test('identified old archive migrates same version only after a separate single-use confirmation',async t=>{
 const f=await oldArchive(t);assert.equal((await f.service.list()).bundles[0].canMigrate,true);
 const plan=await f.service.prepareMigration(name);assert.equal(plan.operation,'source-migration');assert.equal(plan.items[0].from,plan.items[0].to);assert.deepEqual(f.calls,[]);
 const start=await f.service.commit(plan.ticket);await f.service.jobs.get(start.operationId).work;
 assert.equal(f.bundles[0].source,name+'@1.0.0');assert.equal(f.bundles[0].update,'registry');
 assert.equal(f.service.operation(start.operationId).record.items[0].verification.source.officialVersionCheckEligible,true);
 await assert.rejects(()=>f.service.commit(plan.ticket));assert.equal(f.service.lineageOf(f.bundles[0]),null);
});

test('migration rejects arbitrary local sources, self/WSL, changed bytes and missing old identity',async t=>{
 const f=await serviceFixture(t);Object.assign(f.bundles[0],{source:'file:/private/example.tgz',update:undefined});
 await assert.rejects(()=>f.service.prepareMigration(name));await assert.rejects(()=>f.service.prepareMigration('dsh-plugin-wsl-env'));await assert.rejects(()=>f.service.prepareMigration('dsh-plugin-update-doctor'));
 const identified=await oldArchive(t);await writeFile(join(identified.root,name,'index.js'),'changed');await assert.rejects(()=>identified.service.prepareMigration(name));assert.deepEqual(identified.calls,[]);
});

test('migration source change after confirmation does not remove external targets',async t=>{
 const f=await oldArchive(t),plan=await f.service.prepareMigration(name);f.bundles[0].source='file:/different.tgz';
 await assert.rejects(()=>f.service.commit(plan.ticket));assert.deepEqual(f.calls,[]);
});

test('migration automatic archive recovery with changed live bytes stays unknown',async t=>{
 const f=await oldArchive(t),install=f.manager.installBundle;let targetRejected=false;
 f.manager.installBundle=async(spec,options)=>{
  if(spec===name+'@1.0.0'&&!targetRejected){targetRejected=true;return {application:'failed',stage:'install'};}
  const result=await install(spec,options);if(String(spec).includes('package.tgz'))await writeFile(join(f.root,name,'index.js'),'changed recovered runtime');return result;
 };
 const plan=await f.service.prepareMigration(name),start=await f.service.commit(plan.ticket);await f.service.jobs.get(start.operationId).work;
 const item=f.service.operation(start.operationId).record.items[0];assert.equal(item.restore.application,'failed');assert.equal(f.service.recoveryFor(name).status,'unknown');
 assert.equal((await f.service.list()).bundles[0].canRestore,false);
});

test('known migration target failure is retained when archive restoration throws',async t=>{
 const f=await oldArchive(t);f.manager.installBundle=async(spec)=>{if(spec===name+'@1.0.0')return {application:'failed',stage:'install',error:{code:'known-target-failure'}};throw Error('restore response lost');};
 const plan=await f.service.prepareMigration(name),start=await f.service.commit(plan.ticket);await f.service.jobs.get(start.operationId).work;
 const item=f.service.operation(start.operationId).record.items[0];assert.equal(item.result.application,'failed');assert.equal(item.result.error.code,'known-target-failure');assert.equal(item.restore.application,'unknown');assert.equal(f.service.recoveryFor(name).status,'unknown');
});

test('changed archive bytes are rejected before confirmed task cancellation',async t=>{
 let entered=0;const f=await oldArchive(t);f.service.taskGate={cancellationTargets:()=>[],run:async()=>{entered++;}};
 const plan=await f.service.prepareMigration(name);await writeFile(join(f.root,name,'index.js'),'changed after confirm');
 const start=await f.service.commit(plan.ticket,{taskPolicy:'cancel-active',confirmCancel:true});await f.service.jobs.get(start.operationId).work;
 assert.equal(entered,0);assert.deepEqual(f.calls,[]);
});

test('public mirror normal update requires extra consent and retains chosen registry',async t=>{
 const f=await serviceFixture(t);f.state.registry='https://registry.npmmirror.com';
 const plan=await f.service.prepareBatch([{name,version:'1.1.0'}]);assert.equal(plan.mirrorRiskRequiresAcknowledgement,true);
 await assert.rejects(()=>f.service.commit(plan.ticket),/acknowledgement/);assert.deepEqual(f.calls,[]);
 const reviewed=await f.service.prepareBatch([{name,version:'1.1.0'}]);let seen;
 const update=f.manager.updateBundle;f.manager.updateBundle=async(pkg,version,options)=>{seen=options.registry;return update(pkg,version,options);};
 const start=await f.service.commit(reviewed.ticket,{confirmPublicMirror:true});await f.service.jobs.get(start.operationId).work;assert.equal(seen,'https://registry.npmmirror.com');
 assert.equal(f.bundles[0].update,'registry');
});
