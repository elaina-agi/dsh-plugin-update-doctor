import test from 'node:test';
import assert from 'node:assert/strict';
import {DoctorService} from '../lib/service.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPendingRestart } from '../lib/restart-lane.js';
import {verifyUnionGeneration,performUnionGeneration,persistUnionOutcome} from '../lib/union-service.js';
const name='dsh-union-search',root='C:\\owned\\union-staged',reference=version=>({name,version,archiveKey:'1234/package.tgz',runtimeGeneration:{kind:'union-dependency',generation:'g/'+'a'.repeat(32)},rows:[{id:'web-search-free',name}]});
function fakeService({result={application:'applied'},runtime=true,source=true}={}){
 let bundle={name,version:'0.10.25',enabled:true,installed:true,source:source?'file:'+root+'\\1234\\package.tgz':name+'@0.10.25',update:source?undefined:'registry'},calls=[];
 const s=Object.create(DoctorService.prototype);s.unionStager={root,verifyInstalledArchive:async()=>{},verify:async()=>{},verifyBaseline:async()=>{}};s.verifyRunningGeneration=async()=>runtime;s.resolvePackage=async()=>root+'\\package';s.snapshot=async()=>({bundles:[bundle],rows:[{patchId:'web-search-free',moduleName:name,enabled:true,fiberPhase:'active'}]});s.identities={prepare:async()=>{},get:()=>null};s.manifests=new Map();s.completeResult=async v=>v;s.recoveryFor=()=>({id:'owned',installMode:'union-generation'});s.unionPair=()=>true;s.redact=v=>v;s.manager={removeBundle:async()=>{calls.push('remove');bundle={...bundle,installed:false};return{application:'applied'};},installBundle:async()=>{calls.push('install');bundle={...bundle,installed:true};return result;}};return{s,calls,get bundle(){return bundle;}};
}
test('derived Union verification keeps local source and requires exact running namespace',async()=>{
 const good=fakeService(),item={name,enabled:true};assert.equal((await verifyUnionGeneration(good.s,item,reference('0.10.25'),{application:'applied'})).application,'applied');assert.equal(item.verification.source.kind,'local');assert.equal(item.verification.source.officialVersionCheckEligible,false);
 for(const options of [{runtime:false},{source:false}]){const f=fakeService(options),i={name,enabled:true};const answer=await verifyUnionGeneration(f.s,i,reference('0.10.25'),{application:'applied'});assert.equal(answer.application,'unknown');assert.equal(answer.observedApplication,'applied');}
});
test('lost Union install reply remains unknown and never dispatches speculative recovery',async()=>{
 const f=fakeService({result:null}),item={name,enabled:true,from:'0.10.24',to:'0.10.25',nextReference:reference('0.10.25'),previousReference:reference('0.10.24'),baseline:{},fingerprint:f.s.fingerprint(f.bundle)},job={id:'owned',controller:new AbortController()};await performUnionGeneration(f.s,job,item,{archivePath:'next'},{archivePath:'old'});assert.equal(item.status,'unknown');assert.equal(item.unionOutcomeUnknown,true);assert.deepEqual(f.calls,['remove','install']);
});
test('ordinary confirmation does not grant derived Union source acknowledgement',async()=>{
 const s=Object.create(DoctorService.prototype);await assert.rejects(()=>s.commitBatch('owned',{plan:{items:[{installMode:'union-generation'}]}},{}),e=>e.code==='union-generation-confirmation-required');
});
test('disabled generation verification records no executed runtime',async()=>{
 const f=fakeService(),item={name,enabled:false};f.s.snapshot=async()=>({bundles:[{...f.bundle,enabled:false}],rows:[]});const result=await verifyUnionGeneration(f.s,item,reference('0.10.25'),{application:'applied'});assert.equal(result.application,'applied');assert.equal(item.verification.runtime.status,'disabled');assert.equal(item.verification.runtime.executed,false);
});

test('pre-dispatch Union verification failure leaves no unknown outcome and preserves prior identity',async()=>{
 const f=fakeService(),item={name,enabled:true,from:'0.10.24',to:'0.10.25',fingerprint:f.s.fingerprint(f.bundle),baseline:{},nextReference:reference('0.10.25'),previousReference:reference('0.10.24')},job={id:'owned',record:{operation:'batch-update'},controller:new AbortController()};f.s.unionStager.verifyBaseline=async()=>{throw Error('owned changed dependency');};await assert.rejects(()=>performUnionGeneration(f.s,job,item,{},{}),/changed dependency/);assert.equal(item.unionDispatchStarted,undefined);assert.deepEqual(f.calls,[]);item.status='skipped';const prior=reference('0.10.25');f.s.lineageOf=()=>prior;let settlement;f.s.identities.settle=async(...args)=>{settlement=args;};await persistUnionOutcome(f.s,job,item,f.bundle,{id:'owned',status:'prepared'});assert.equal(settlement[1],prior);assert.equal(settlement[2],null);
});
test('known failed removal with untouched npm installation does not invent derived recovery authority',async()=>{
 const f=fakeService(),item={name,enabled:true,from:'0.10.24',to:'0.10.25',fingerprint:f.s.fingerprint(f.bundle),baseline:{},nextReference:reference('0.10.25'),previousReference:reference('0.10.24')},job={id:'owned',record:{operation:'batch-update'},controller:new AbortController()};f.s.manager.removeBundle=async()=>({application:'failed',changed:false});await performUnionGeneration(f.s,job,item,{},{});assert.equal(item.unionUntouched,true);let settlement;f.s.lineageOf=()=>null;f.s.identities.settle=async(...args)=>{settlement=args;};await persistUnionOutcome(f.s,job,item,f.bundle,{id:'owned',status:'prepared'});assert.equal(settlement[2],null);
});

test('restart-required removal keeps the verified target on disk and records a restart handoff',async()=>{
 const calls=[];
 let bundle={name,version:'0.10.25',enabled:true,installed:true,source:name+'@0.10.25',update:'registry'};
 const restartRoot=await mkdtemp(join(tmpdir(),'dsh-union-handoff-'));
 const s=Object.create(DoctorService.prototype);
 s.unionStager={root,verifyInstalledArchive:async()=>{},verify:async()=>{},verifyBaseline:async()=>{}};
 s.verifyRunningGeneration=async()=>true;s.resolvePackage=async()=>root+'\\package';s.restartRoot=restartRoot;
 s.snapshot=async()=>({bundles:[bundle],rows:[]});s.identities={prepare:async()=>{},get:()=>null};
 s.manifests=new Map();s.completeResult=async v=>v;s.recoveryFor=()=>({id:'owned',installMode:'union-generation'});
 s.unionPair=()=>true;s.redact=v=>v;
 s.manager={
  removeBundle:async()=>{calls.push(['remove']);bundle={...bundle,installed:false};return{application:'restart-required',changed:true,stage:'remove',restartReason:'unmanaged-plugin'};},
  installBundle:async(path,options)=>{calls.push(['install',path,options.expected.version]);bundle={...bundle,installed:true,version:options.expected.version,source:name+'@'+options.expected.version,update:'registry'};return{application:'applied',stage:'install',changed:true};}
 };
 const item={name,enabled:true,from:'0.10.24',to:'0.10.25',fingerprint:s.fingerprint(bundle),nextReference:reference('0.10.25'),previousReference:reference('0.10.24'),baseline:{}};
 try {
  await performUnionGeneration(s,{id:'owned',record:{operation:'batch-update'},controller:new AbortController()},item,{archivePath:'next'},{archivePath:'old'});
  assert.deepEqual(calls,[['remove'],['install','next','0.10.25']],'the verified target is written for the next start');
  assert.equal(item.status,'restart-required');assert.equal(item.restartHandoff,true);
  const pending=await readPendingRestart(restartRoot);
  assert.equal(pending.name,name);assert.equal(pending.from,'0.10.24');assert.equal(pending.to,'0.10.25');
  assert.equal(pending.installMode,'union-generation');
 } finally { await rm(restartRoot,{recursive:true,force:true}); }
});
test('a target that cannot be written after a refused unplug restores the original archive',async()=>{
 const calls=[];
 let bundle={name,version:'0.10.25',enabled:true,installed:true,source:name+'@0.10.25',update:'registry'};
 const restartRoot=await mkdtemp(join(tmpdir(),'dsh-union-handoff-fail-'));
 const s=Object.create(DoctorService.prototype);
 s.unionStager={root,verifyInstalledArchive:async()=>{},verify:async()=>{},verifyBaseline:async()=>{}};
 s.verifyRunningGeneration=async()=>true;s.resolvePackage=async()=>root+'\\package';s.restartRoot=restartRoot;
 s.snapshot=async()=>({bundles:[bundle],rows:[]});s.identities={prepare:async()=>{},get:()=>null};
 s.manifests=new Map();s.completeResult=async v=>v;s.recoveryFor=()=>({id:'owned',installMode:'union-generation'});
 s.unionPair=()=>true;s.redact=v=>v;
 s.manager={
  removeBundle:async()=>{calls.push(['remove']);bundle={...bundle,installed:false};return{application:'restart-required',changed:true,stage:'remove'};},
  installBundle:async(path,options)=>{calls.push(['install',path,options.expected.version]);if(options.expected.version==='0.10.25')throw Error('owned target rejected');bundle={...bundle,installed:true,version:options.expected.version};return{application:'applied',stage:'install',changed:true};}
 };
 const item={name,enabled:true,from:'0.10.24',to:'0.10.25',fingerprint:s.fingerprint(bundle),nextReference:reference('0.10.25'),previousReference:reference('0.10.24'),baseline:{}};
 try {
  await performUnionGeneration(s,{id:'owned',record:{operation:'batch-update'},controller:new AbortController()},item,{archivePath:'next'},{archivePath:'old'});
  assert.deepEqual(calls,[['remove'],['install','next','0.10.25'],['install','old','0.10.24']],'the original bytes are restored, never left removed');
  assert.equal(item.restore.application,'applied');
  assert.equal(item.restoreKind,'restart-handoff-unverified');
 } finally { await rm(restartRoot,{recursive:true,force:true}); }
});
test('restart-required removal that changed nothing keeps the untouched package and rolls nothing back',async()=>{
 const calls=[];
 let bundle={name,version:'0.10.25',enabled:true,installed:true,source:name+'@0.10.25',update:'registry'};
 const s=Object.create(DoctorService.prototype);
 s.unionStager={root,verifyInstalledArchive:async()=>{},verify:async()=>{},verifyBaseline:async()=>{}};
 s.verifyRunningGeneration=async()=>true;s.resolvePackage=async()=>root+'\\package';
 s.snapshot=async()=>({bundles:[bundle],rows:[]});s.identities={prepare:async()=>{},get:()=>null};
 s.manifests=new Map();s.completeResult=async v=>v;s.recoveryFor=()=>({id:'owned',installMode:'union-generation'});
 s.unionPair=()=>true;s.redact=v=>v;
 s.manager={removeBundle:async()=>{calls.push('remove');return{application:'restart-required',changed:false,stage:'remove'};},installBundle:async()=>{calls.push('install');return{application:'applied'};}};
 const item={name,enabled:true,from:'0.10.24',to:'0.10.25',fingerprint:s.fingerprint(bundle),nextReference:reference('0.10.25'),previousReference:reference('0.10.24'),baseline:{}};
 await performUnionGeneration(s,{id:'owned',record:{operation:'batch-update'},controller:new AbortController()},item,{archivePath:'next'},{archivePath:'old'});
 assert.deepEqual(calls,['remove']);assert.equal(item.unionUntouched,true);assert.equal(item.restore,undefined);
});
test('isolated route is selected by installed structure, not by a reviewed version pair',()=>{
 const s=Object.create(DoctorService.prototype);s.identities={get:()=>null};s.stager={};s.hmrAvailable=true;s.unionStager={};s.verifyRunningGeneration=()=>true;s.manifests=new Map();
 const stack={'@deepseek-ai/schemastery':'^3.18.4','@joplin/turndown-plugin-gfm':'^1.0.68',cheerio:'^1.2.0',turndown:'^7.2.4'};
 const union={name,version:'0.11.0',dependencies:stack};s.manifests.set(name,union);
 assert.equal(s.unionRoute({name,version:'0.11.0',update:'registry'},union),true);
 assert.equal(s.unionPair({name,version:'0.11.0',update:'registry'},'0.11.1',union),true,'a later stable version needs no new allowlist entry');
 assert.equal(s.unionPair({name,version:'0.11.0',update:'registry'},'0.10.9',union),false,'ordered stable targets only');
 assert.equal(s.unionPair({name,version:'0.11.0',update:'registry'},'0.12.0-beta.1',union),false,'prerelease targets are not admitted');
 const ordinary={name:'owned-plugin',version:'1.0.0',dependencies:{yaml:'2.9.1'}};
 assert.equal(s.unionRoute({name:'owned-plugin',version:'1.0.0',update:'registry'},ordinary),false);
 s.verifyRunningGeneration=null;
 assert.equal(s.unionPair({name,version:'0.10.24',update:'registry'},'0.10.25',union),false,'without the exact-namespace verifier nothing is admitted');
});
