import test from 'node:test';
import assert from 'node:assert/strict';
import { DoctorService } from '../lib/service.js';

const make=(overrides={})=>new DoctorService({manager:{...overrides},profile:{name:'test',dir:'owned',home:'owned'},runtimeVersion:'test',resolvePackage:async()=>'',probeLocks:async()=>({}),statePath:'unused'});
const staged={rows:[{id:'wsl-env-client-host',name:'dsh-plugin-wsl-env'},{id:'wsl-status',name:'dsh-plugin-wsl-env/status'}],runtimeGeneration:{moduleAliases:[['dsh-plugin-wsl-env/status','dsh-plugin-wsl-env/_g/verified/status']]}};

test('generation success requires exact target version, alias, enablement and active row',async()=>{
 const rows=[{patchId:'wsl-env-client-host',moduleName:'dsh-plugin-wsl-env',enabled:true,fiberPhase:'active'},{patchId:'wsl-status',moduleName:'dsh-plugin-wsl-env/_g/verified/status',enabled:true,fiberPhase:'active'}];
 const service=make({setBundleEnabled:async()=>({application:'applied',warnings:[]}),listBundles:async()=>[{name:'dsh-plugin-wsl-env',version:'0.26.2',enabled:true}],listPlugins:async()=>rows});
 const result=await service.verifyGeneration({name:'dsh-plugin-wsl-env',to:'0.26.2',enabled:true},staged,{application:'restart-required',restartReason:'unmanaged-plugin',warnings:[]});assert.equal(result.application,'applied');assert.equal(result.generationVerified,true);
 rows[1].enabled=false;await assert.rejects(()=>service.verifyGeneration({name:'dsh-plugin-wsl-env',to:'0.26.2',enabled:true},staged,{application:'applied'}),/did not activate/);
});
test('other genuine restart requirements never become generation success',async()=>{
 let reapplied=false;const service=make({setBundleEnabled:async()=>{reapplied=true;return{application:'applied'};}});
 const result=await service.verifyGeneration({name:'dsh-plugin-wsl-env',to:'0.26.2',enabled:true},staged,{application:'restart-required',restartReason:'host-module'});
 assert.equal(result.application,'restart-required');assert.equal(reapplied,false);
});
