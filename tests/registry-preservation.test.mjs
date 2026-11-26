import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serviceFixture } from './helpers/service-fixture.mjs';
import { IdentityStore } from '../lib/identity.js';

const name='sample-plugin', PUBLIC='https://registry.npmjs.org';
async function update(f) {
    const plan=await f.service.prepareBatch([{name,version:'1.1.0'}]);
    const start=await f.service.commit(plan.ticket);await f.service.jobs.get(start.operationId).work;
    return f.service.operation(start.operationId).record;
}

test('normal updates preserve exact npm source and official registry version-check eligibility', async t=>{
    const f=await serviceFixture(t), registryUpdate=f.manager.updateBundle;let handoffs=0;
    f.manager.updateBundle=async(pkg,version,options)=>{handoffs++;assert.equal(pkg,name);assert.equal(version,'1.1.0');assert.equal(options.registry,PUBLIC);assert.equal(options.spec,undefined);return registryUpdate(pkg,version,options);};
    const record=await update(f), bundle=(await f.service.snapshot()).bundles[0];
    assert.equal(handoffs,1);assert.equal(bundle.source,name+'@1.1.0');assert.equal(bundle.update,'registry');
    assert.equal(record.items[0].verification.source.officialVersionCheckEligible,true);
    assert.equal(record.items[0].verification.package.status,'verified');assert.equal(f.service.lineageOf(bundle),null);
    assert.equal((await f.service.versions(name)).status,'listed');
});

test('Host rollback retains registry source and never turns target failure into success',async t=>{
    const f=await serviceFixture(t,{failTarget:true});const record=await update(f),item=record.items[0];
    assert.equal(item.status,'failed');assert.equal(item.officialUpdate.result.application,'failed');
    assert.equal(item.restore.application,'applied');assert.equal(item.restoreVerification.source.officialVersionCheckEligible,true);
    assert.equal(f.bundles[0].source,name+'@1.0.0');assert.equal(f.bundles[0].update,'registry');
    assert.equal(f.calls.filter(value=>value[0]==='update').length,1);
});

test('known failed automatic rollback can be manually restored by recorded npm spec, not local archive',async t=>{
    const f=await serviceFixture(t,{failTarget:true,failRestore:true});await update(f);
    assert.equal(f.service.recoveryFor(name).installMode,'registry-spec');f.state.failRestore=false;
    const installs=[],install=f.manager.installBundle;
    f.manager.installBundle=async(spec,options)=>{installs.push(spec);assert.equal(options.registry,PUBLIC);return install(spec,options);};
    const plan=await f.service.prepareRestore(name);const job=await f.service.commit(plan.ticket);await f.service.jobs.get(job.operationId).work;
    assert.deepEqual(installs,[name+'@1.0.0']);assert.equal(f.bundles[0].source,name+'@1.0.0');assert.equal(f.service.recoveryFor(name),undefined);
});

test('same-version modified files after Host applied are not called verified or automatically removed',async t=>{
    const f=await serviceFixture(t),updateBundle=f.manager.updateBundle;
    f.manager.updateBundle=async(...args)=>{const result=await updateBundle(...args);await writeFile(join(f.root,name,'index.js'),'// modified after Host');return result;};
    const record=await update(f),item=record.items[0];
    assert.equal(item.result.observedApplication,'applied');assert.equal(item.result.application,'failed');assert.equal(item.verification.package.status,'failed');
    assert.equal(f.calls.filter(value=>value[0]==='remove').length,1,'only the official update removed the original');
    assert.equal(f.service.recoveryFor(name).status,'unknown');assert.equal((await f.service.list()).bundles[0].canRestore,false);
});

test('exception or missing Host update result stays unknown without automatic reinstall or recovery ticket',async t=>{
    for(const result of [null,'throw']){
        const f=await serviceFixture(t);f.manager.updateBundle=async()=>{if(result==='throw')throw Error('owned interrupted');return result;};
        const record=await update(f);assert.equal(record.outcome,'unknown');assert.equal(record.items[0].status,'unknown');assert.deepEqual(f.calls,[]);
        assert.equal((await f.service.list()).bundles[0].canRestore,false);
        await assert.rejects(()=>f.service.prepareRestore(name),/lost registry update/);
    }
});

test('legacy Doctor archive source is disclosed and never silently migrated by a normal update',async t=>{
    const f=await serviceFixture(t);const old=await f.stager.stage(name,'1.0.0');
    Object.assign(f.bundles[0],{source:'file:'+old.archivePath,update:undefined});await f.service.identities.remember(f.stager.reference(old));
    const scan=await f.service.scan(),row=scan.items[0];assert.equal(row.canUpdate,false);
    assert(row.reasons.includes('legacy-archive-source-requires-migration'));
    await assert.rejects(()=>f.service.prepareBatch([{name,version:'1.1.0'}]));assert.deepEqual(f.calls,[]);
    assert.equal(f.bundles[0].source,'file:'+old.archivePath);
});

test('existing Host fallback is not rewritten or silently promoted to preflight evidence',async t=>{
    const f=await serviceFixture(t);f.manager.registries=async()=>({registry:PUBLIC,resolved:PUBLIC,fallbackRegistries:['https://registry.npmmirror.com']});
    const record=await update(f);assert.equal(record.outcome,'applied');assert.equal(f.bundles[0].update,'registry');
    assert.deepEqual((await f.manager.registries()).fallbackRegistries,['https://registry.npmmirror.com']);
});

test('unknown same-package registry update cannot be overwritten by a fresh update preparation',async t=>{
    const f=await serviceFixture(t);f.manager.updateBundle=async()=>null;await update(f);
    await assert.rejects(()=>f.service.prepareBatch([{name,version:'1.1.0'}]),/Selection changed/);
    assert.equal(f.service.recoveryFor(name).status,'unknown');
});

test('manual registry recovery missing response stays unknown and cannot be prepared again',async t=>{
    for(const returned of [null,{}]){
        const f=await serviceFixture(t,{failTarget:true,failRestore:true});await update(f);
        f.manager.installBundle=async()=>returned;
        const plan=await f.service.prepareRestore(name),start=await f.service.commit(plan.ticket);await f.service.jobs.get(start.operationId).work;
        assert.equal(f.service.operation(start.operationId).record.items[0].status,'unknown');
        assert.equal(f.service.recoveryFor(name).status,'unknown');assert.equal((await f.service.list()).bundles.some(value=>value.name===name&&value.canRestore),false);
        await assert.rejects(()=>f.service.prepareRestore(name),/lost registry update/);
    }
});

test('registry recovery identities upgrade schema and old format is read-only compatible',async t=>{
    const f=await serviceFixture(t,{failTarget:true,failRestore:true});await update(f);
    const {readFile}=await import('node:fs/promises');const disk=JSON.parse(await readFile(f.service.identities.path,'utf8'));
    assert.equal(disk.schemaVersion,2,'old updater schema1 reader must fail closed rather than apply archive recovery');
    const legacy={schemaVersion:1,installed:[],recoveries:[]};await writeFile(f.service.identities.path,JSON.stringify(legacy));
    const reload=new IdentityStore(f.service.identities.path);await reload.load();assert.equal(reload.warning,null);
    assert.equal(JSON.parse(await readFile(f.service.identities.path,'utf8')).schemaVersion,1,'loading legacy schema does not rewrite it');
});

test('unverifiable identity files block update preparation and cannot be silently overwritten',async t=>{
    for(const payload of ['broken JSON',JSON.stringify({schemaVersion:99,installed:[],recoveries:[]})]){
        const f=await serviceFixture(t);await writeFile(f.service.identities.path,payload);await f.service.identities.load();
        await assert.rejects(()=>f.service.prepareBatch([{name,version:'1.1.0'}]),/identities cannot be verified/);
        const {readFile}=await import('node:fs/promises');assert.equal(await readFile(f.service.identities.path,'utf8'),payload);assert.deepEqual(f.calls,[]);
    }
});

test('present malformed Host rollback response stays unknown and never authorizes recovery',async t=>{
    for(const restore of [{},null,{application:'applied',target:'other@1.0.0'}]){
        const f=await serviceFixture(t);f.manager.updateBundle=async()=>({from:'1.0.0',to:'1.1.0',result:{application:'failed',stage:'install'},restore});
        await update(f);assert.equal(f.service.recoveryFor(name).status,'unknown');assert.equal((await f.service.list()).bundles[0].canRestore,false);
    }
});

test('external source changing during final identity marker is not removed or updated',async t=>{
    const f=await serviceFixture(t),original=f.service.identities.prepare.bind(f.service.identities);
    f.service.identities.prepare=async recovery=>{await original(recovery);if(recovery.dispatchStarted){f.bundles[0].version='9.0.0';f.bundles[0].source='external@9.0.0';}};
    await update(f);assert.deepEqual(f.calls,[]);assert.equal(f.bundles[0].version,'9.0.0');
});

test('registry recovery mode reads with archive schema1 compatibility and rejects generation misuse',async t=>{
    const f=await serviceFixture(t),old=await f.stager.stage(name,'1.0.0'),next=await f.stager.stage(name,'1.1.0');
    const recovery={id:'owned-mode',failedBatchId:'owned-batch',name,from:'1.0.0',to:'1.1.0',enabled:true,previous:f.stager.reference(old),next:f.stager.reference(next),status:'failed',expectedFingerprint:f.service.fingerprint(f.bundles[0])};
    await f.service.identities.prepare(recovery);const reload=new IdentityStore(f.service.identities.path);await reload.load();assert.equal(reload.warning,null);assert.equal(reload.recovery(name).installMode,undefined);
    assert.throws(()=>reload.validateRecovery({...recovery,installMode:'unexpected'}));
    assert.throws(()=>reload.validateRecovery({...recovery,installMode:'registry-spec',next:{...recovery.next,runtimeGeneration:{}}}));
});


test('a recovery whose installed tree could not be inspected stores an unavailable graph safely', async t => {
    const f = await serviceFixture(t), old = await f.stager.stage(name, '1.0.0'), next = await f.stager.stage(name, '1.1.0');
    const recovery = { id: 'owned-null-graph', failedBatchId: 'owned-batch', name, from: '1.0.0', to: '1.1.0', enabled: true,
        previous: f.stager.reference(old), next: f.stager.reference(next), status: 'prepared',
        expectedFingerprint: f.service.fingerprint(f.bundles[0]), installMode: 'registry-spec', dependencyGraph: null };
    await f.service.identities.prepare(recovery);
    const reload = new IdentityStore(f.service.identities.path); await reload.load();
    assert.equal(reload.warning, null);
    assert.equal(reload.recovery(name).dependencyGraph, null);
});
