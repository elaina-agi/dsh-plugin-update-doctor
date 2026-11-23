import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceFixture} from './helpers/service-fixture.mjs';

test('known Union Search HMR reload failure is specific, not a blanket dependency refusal',async t=>{
 const f=await serviceFixture(t,{names:['dsh-union-search']});const row=(await f.service.list()).bundles[0];
 assert.equal(row.canUpdate,false);assert(row.reasons.includes('dependency-runtime-reload-unverified'));
 await assert.rejects(()=>f.service.prepareBatch([{name:'dsh-union-search',version:'1.1.0'}]),e=>e.code==='dependency-runtime-reload-unverified');assert.deepEqual(f.calls,[]);
});

test('non-HMR profile can discover registry candidate without falsely claiming new code is active',async t=>{
 const f=await serviceFixture(t,{names:['dsh-union-search']});f.service.hmrAvailable=false;
 const row=(await f.service.list()).bundles[0];assert(!row.reasons.includes('dependency-runtime-reload-unverified'));
 assert.equal(row.canUpdate,true);
});
