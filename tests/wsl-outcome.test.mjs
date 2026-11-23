import test from 'node:test';
import assert from 'node:assert/strict';
import {DoctorService} from '../lib/service.js';
import {unknownWsl,persistWslOutcome} from '../lib/wsl-outcome.js';
const name='dsh-plugin-wsl-env';
test('WSL unknown recovery is refused at preparation and live dispatch boundaries',async()=>{
 const service=Object.create(DoctorService.prototype);service.identities={warning:null,recovery:()=>({id:'known',status:'unknown',installMode:'archive',expectedFingerprint:'current'})};service.external=new Set();service.fingerprint=()=> 'current';service.snapshot=async()=>({bundles:[{name,installed:true}],rows:[]});let commands=0;service.manager={installBundle:async()=>{commands++;}};
 await assert.rejects(()=>service.prepareRestore(name),error=>error.code==='wsl-generation-outcome-unknown');
 await assert.rejects(()=>service.performRecovery({},{name,recoveryId:'known'},{},{name,installed:true}),error=>error.code==='wsl-generation-outcome-unknown');assert.equal(commands,0);
});
test('a prepared WSL restore ticket cannot override a later unknown recovery',async()=>{
 const service=Object.create(DoctorService.prototype);service.identities={warning:null,recovery:()=>({id:'known',status:'unknown'})};service.external=new Set();service.taskGate={};service.stager={};service.snapshot=async()=>({bundles:[{name}],rows:[]});service.fingerprint=()=> 'current';service.tickets=new Map();service.jobs=new Map();
 await assert.rejects(()=>service.commitBatch('ticket',{plan:{operation:'batch-restore',items:[{name,recoveryId:'known',fingerprint:'current'}]}},{}),error=>error.code==='wsl-generation-outcome-unknown');assert.equal(service.jobs.size,0);
});
test('lost WSL second reapply replies are unknown, not known failures authorizing rollback',async()=>{
 for(const reply of [null,{}, {application:'unknown'}]){const service=Object.create(DoctorService.prototype);service.manager={setBundleEnabled:async()=>reply};await assert.rejects(()=>service.verifyGeneration({name,enabled:true},{},{application:'applied'}),error=>error.code==='wsl-generation-outcome-unknown');}
});
test('WSL unknown settlement retains blocking identity and never grants restore capability',async()=>{
 const service=Object.create(DoctorService.prototype),item={name,enabled:true};unknownWsl(item,'lost result');let settlement;service.identities={settle:async(...value)=>{settlement=value;}};service.fingerprint=()=> 'current';await persistWslOutcome(service,{record:{operation:'batch-update'}},item,{name},{id:'known',status:'prepared'});assert.equal(settlement[1],null);assert.equal(settlement[2].status,'unknown');assert.equal(item.recoveryId,undefined);
});
