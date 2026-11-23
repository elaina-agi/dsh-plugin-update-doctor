import test from 'node:test';
import assert from 'node:assert/strict';
import {DoctorService} from '../lib/service.js';
import {verifyUnionGeneration,performUnionGeneration,persistUnionOutcome} from '../lib/union-service.js';
const name='dsh-union-search',root='C:\\owned\\union-staged',reference=version=>({name,version,archiveKey:'1234/package.tgz',runtimeGeneration:{kind:'union-dependency',generation:'g/'+'a'.repeat(32)},rows:[{id:'web-search-free',name}]});
function fakeService({result={application:'applied'},runtime=true,source=true}={}){
 let bundle={name,version:'0.10.25',enabled:true,installed:true,source:source?'file:'+root+'\\1234\\package.tgz':name+'@0.10.25',update:source?undefined:'registry'},calls=[];
 const s=Object.create(DoctorService.prototype);s.unionStager={root,verifyInstalledArchive:async()=>{},verify:async()=>{},verifyBaseline:async()=>{}};s.verifyRunningGeneration=async()=>runtime;s.resolvePackage=async()=>root+'\\package';s.snapshot=async()=>({bundles:[bundle],rows:[{patchId:'web-search-free',moduleName:name,enabled:true,fiberPhase:'active'}]});s.identities={prepare:async()=>{}};s.completeResult=async v=>v;s.recoveryFor=()=>({id:'owned',installMode:'union-generation'});s.unionPair=()=>true;s.redact=v=>v;s.manager={removeBundle:async()=>{calls.push('remove');bundle={...bundle,installed:false};return{application:'applied'};},installBundle:async()=>{calls.push('install');bundle={...bundle,installed:true};return result;}};return{s,calls,get bundle(){return bundle;}};
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

test('unreviewed Union pair or absent runtime verifier stays blocked',()=>{
 const s=Object.create(DoctorService.prototype);s.identities={get:()=>null};s.stager={};s.hmrAvailable=true;s.unionStager={canAdmit:()=>true};s.verifyRunningGeneration=()=>true;assert.equal(s.unionPair({name,version:'0.10.24',update:'registry'},'0.10.25'),true);assert.equal(s.unionPair({name,version:'0.10.25',update:'registry'},'0.10.26'),false);s.verifyRunningGeneration=null;assert.equal(s.unionPair({name,version:'0.10.24',update:'registry'},'0.10.25'),false);
});
