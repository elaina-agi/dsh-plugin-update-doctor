import test from 'node:test';
import assert from 'node:assert/strict';
import { readRegistryVersions } from '../lib/source.js';
import { scanUpdates, versionDiscovery, onlineSafety } from '../lib/online.js';
import { serviceFixture } from './helpers/service-fixture.mjs';

const PUBLIC = 'https://registry.npmjs.org', MIRROR = 'https://registry.npmmirror.com';
const summary = { name:'sample-plugin', version:'1.0.0', sourceKind:'registry', canUpdate:true, reasons:[] };
const version = { version:'1.1.0', bundle:true };
const queried = registry => ({ status:'listed', registry, installed:'1.0.0', versions:[version], omitted:0 });
function managerFor(registry, resolved) { return { registries:async()=>({registry:null,resolved,fallbackRegistries:[]}), listVersions:async()=>queried(registry) }; }

test('Host null registry resolves only from stable before/after public service snapshots', async () => {
    for (const [resolved, allowed] of [[PUBLIC,true],[MIRROR,true],['https://private.example.invalid',false],[null,false],[undefined,false]]) {
        const manager=managerFor(null,resolved), answer=await readRegistryVersions(manager,'sample-plugin');
        assert.equal(answer.registry,resolved??null);
        const [row]=await scanUpdates(manager,[summary]);
        assert.equal(row.canUpdate,allowed); assert.equal(row.versionStatus,resolved?'available':'unknown');
        assert.equal(row.updateStatus,allowed?'available':'blocked');
    }
});

test('explicit mirror origin is never overridden by public resolved configuration', async () => {
    const [row]=await scanUpdates(managerFor(MIRROR,PUBLIC),[summary]);
    assert.equal(row.registry,MIRROR); assert.equal(row.versionStatus,'available'); assert.equal(row.canUpdate,true);
    assert(!row.reasons.includes('registry-origin-unsupported'));
});

test('changing resolved registry cannot attribute a null-origin answer or claim no newer version', async () => {
    for (const pair of [[PUBLIC,MIRROR],[MIRROR,PUBLIC]]) {
        let index=0; const manager={registries:async()=>({resolved:pair[index++]}),listVersions:async()=>({...queried(null),versions:[]})};
        const [row]=await scanUpdates(manager,[summary]);
        assert.equal(row.registry,null); assert.equal(row.versionStatus,'unknown'); assert.equal(row.canUpdate,false);
        assert(row.reasons.includes('registry-origin-changed'));
    }
});

test('credential and path-bearing registry plans never leak through the normalized answer', async () => {
    for (const resolved of ['https://user:secret@example.invalid/','https://example.invalid/?token=secret','https://example.invalid/private','http://registry.npmjs.org/']) {
        const answer=await readRegistryVersions(managerFor(null,resolved),'sample-plugin');
        assert.equal(answer.registry,null); assert(!JSON.stringify(answer).includes('secret'));
    }
});

test('no newer source version is independent of dependency and mirror eligibility refusals', async () => {
    const blocked={...summary,canUpdate:false,reasons:['dependency-graph-update-requires-separate-review','host-runtime-dependencies']};
    const manager=managerFor(null,MIRROR); manager.listVersions=async()=>({...queried(null),versions:[]});
    const [row]=await scanUpdates(manager,[blocked]);
    assert.equal(row.versionStatus,'up-to-date'); assert.equal(row.updateStatus,'blocked'); assert.equal(row.registry,MIRROR);
    assert.equal(row.latestVersion,null); assert(row.reasons.includes('dependency-graph-update-requires-separate-review'));
});

test('WSL discovery alone cannot replace mandatory archive structural inspection', async () => {
    const row={...summary,name:'dsh-plugin-wsl-env',version:'0.26.2'};
    const manager={listVersions:async()=>({status:'listed',registry:PUBLIC,versions:[{version:'0.29.0',bundle:true}]})};
    const [answer]=await scanUpdates(manager,[row]);
    assert.equal(answer.latestVersion,'0.29.0'); assert.equal(answer.versionStatus,'available');
    assert.equal(answer.updateStatus,'blocked'); assert.equal(answer.canUpdate,false);
    assert(answer.reasons.includes('wsl-archive-preflight-unavailable'));
    // Metadata recognizes the route; source/structure permission comes only from archive inspection.
    const targetMetadata={name:row.name,version:'0.29.0'};
    assert.equal(onlineSafety({...row,update:'registry',removable:true,availability:'profile'},targetMetadata).permitted,false,'A target manifest cannot validate the currently installed version');
    assert.equal(onlineSafety({...row,version:'0.29.0',update:'registry',removable:true,availability:'profile'},targetMetadata).permitted,true);
});

test('missing custom metadata, truncated window and malformed responses never imply latest', () => {
    for (const result of [{status:'listed',registry:PUBLIC,versions:[{version:'0.29.0',bundle:false,metadataIncomplete:true}]},
        {status:'listed',versions:[],omitted:2},{status:'listed',versions:[{version:'invalid'}]}, {status:'listed',versions:null}]) {
        assert(['unknown','error'].includes(versionDiscovery(result).versionStatus));
    }
    const prerelease=versionDiscovery({status:'listed',versions:[{version:'3.0.0-beta.1',bundle:true,prerelease:true}]});
    assert.equal(prerelease.versionStatus,'up-to-date');assert.equal(prerelease.latestPublishedVersion,null,'No newer stable version is a narrower claim than no publication');
    const result=versionDiscovery({status:'listed',versions:[{version:'2.0.0',bundle:true,incompatible:{}},{version:'1.5.0',bundle:false}]});
    assert.equal(result.versionStatus,'no-compatible-version'); assert.equal(result.latestPublishedVersion,'2.0.0'); assert.equal(result.latestVersion,null);
});

test('all deprecated newer versions remain visible but are not update candidates', () => {
    let result=versionDiscovery({status:'listed',versions:[{version:'2.0.0',bundle:true,deprecated:'withdrawn'}]});
    assert.equal(result.versionStatus,'no-compatible-version');assert.equal(result.latestPublishedVersion,'2.0.0');assert.equal(result.latestVersion,null);
    result=versionDiscovery({status:'listed',versions:[{version:'2.0.0',bundle:true,deprecated:'withdrawn'},{version:'1.1.0',bundle:true}]});
    assert.equal(result.versionStatus,'available');assert.equal(result.latestPublishedVersion,'2.0.0');assert.equal(result.latestVersion,'1.1.0');
});

test('query result projection excludes raw registry attempts and private failure details', async () => {
    const manager=managerFor(PUBLIC,PUBLIC);
    manager.listVersions=async()=>({...queried(PUBLIC),attempts:[{registry:'https://user:secret@private.invalid/config',reason:'secret'}],extra:'secret'});
    let answer=await readRegistryVersions(manager,'sample-plugin');assert(!JSON.stringify(answer).includes('secret'));assert.equal(answer.attempts,undefined);
    manager.listVersions=async()=>({status:'refused',problem:'network',reason:'secret',attempts:[{registry:'https://user@private.invalid/config'}]});
    answer=await readRegistryVersions(manager,'sample-plugin');assert.deepEqual(answer,{status:'refused',problem:'network'});
});

test('source resolves safely during ordinary preparation, without bypassing original archive identity', async t => {
    const f=await serviceFixture(t); f.manager.listVersions=async()=>queried(null); f.manager.registries=async()=>({registry:null,resolved:PUBLIC,fallbackRegistries:[]});
    const plan=await f.service.prepareBatch([{name:'sample-plugin',version:'1.1.0'}]);
    assert.equal(plan.items[0].registry,PUBLIC); assert.deepEqual(f.calls,[]);
    f.manager.registries=async()=>({registry:null,resolved:MIRROR,fallbackRegistries:[]});
    const mirrored=await f.service.prepareBatch([{name:'sample-plugin',version:'1.1.0'}]);
    assert.equal(mirrored.items[0].registry,MIRROR);assert.equal(mirrored.mirrorRiskRequiresAcknowledgement,true);
    assert.deepEqual(f.calls,[]);
});

test('source change during final pre-task checks prevents cancellation and all management operations', async t => {
    let entered=0; const f=await serviceFixture(t,{gate:{cancellationTargets:()=>[],run:async()=>{entered++;}}});
    const plan=await f.service.prepareBatch([{name:'sample-plugin',version:'1.1.0'}]);
    f.service.identities.prepare=async()=>{f.state.registry=MIRROR;};
    const started=await f.service.commit(plan.ticket,{taskPolicy:'cancel-active',confirmCancel:true});
    await f.service.jobs.get(started.operationId).work;
    assert.equal(entered,0); assert.deepEqual(f.calls,[]);
});

test('source change after idle waiting blocks removal and installation', async t => {
    const f=await serviceFixture(t,{gate:{cancellationTargets:()=>[],run:async operation=>{f.state.registry=MIRROR;return operation(new AbortController().signal);}}});
    const plan=await f.service.prepareBatch([{name:'sample-plugin',version:'1.1.0'}]);
    const started=await f.service.commit(plan.ticket); await f.service.jobs.get(started.operationId).work;
    assert.deepEqual(f.calls,[]);
});
