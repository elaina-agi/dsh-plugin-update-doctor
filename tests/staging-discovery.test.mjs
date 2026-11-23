import test from 'node:test';
import assert from 'node:assert/strict';
import { RegistryStager } from '../lib/staging.js';
const name='dsh-plugin-wsl-env', prior='0.26.2';
const manifest=(version,dsh={bundle:{patch:'./cordis.patch.yml'}})=>({name,version,dsh});
const full=()=>({name,versions:{[prior]:manifest(prior),'0.28.0':manifest('0.28.0'),'0.27.0':manifest('0.27.0'),'0.26.4':manifest('0.26.4')}});
const stager=(data, fetcher)=>new RegistryStager('unused-owned-fixture',{fetcher:fetcher??(async()=>Response.json(data)),compatibility:()=>undefined});

test('registry discovery requests full JSON and preserves WSL custom bundle metadata', async () => {
    let requests=0;
    const tool=stager(null,async(url,options)=>{
        requests++; assert.equal(String(url),'https://registry.npmjs.org/dsh-plugin-wsl-env');
        assert.equal(options.headers.accept,'application/json'); assert.equal(options.credentials,'omit'); assert.equal(options.redirect,'error');
        return Response.json(full());
    });
    const result=await tool.listVersions(name,prior);
    assert.deepEqual(result.versions.map(value=>value.version),['0.28.0','0.27.0','0.26.4']);
    assert(result.versions.every(value=>value.bundle&&!value.metadataIncomplete)); assert.equal(result.omitted,0); assert.equal(requests,1);
});

test('server returning abbreviated metadata still exposes newer version as incomplete', async () => {
    const data=full(); for (const value of Object.values(data.versions)) delete value.dsh;
    const result=await stager(data).listVersions(name,prior);
    assert.equal(result.versions[0].version,'0.28.0'); assert.equal(result.versions[0].metadataIncomplete,true); assert.equal(result.versions[0].bundle,false);
});

test('bad package or version identity and absent current/version map cannot report an empty successful list', async () => {
    for (const change of [data=>delete data.versions,data=>data.versions=[],data=>data.versions={},data=>data.name='foreign',
        data=>data.versions['0.28.0'].name='foreign',data=>data.versions['0.28.0'].version='0.99.0']) {
        const data=full();change(data);await assert.rejects(()=>stager(data).listVersions(name,prior),/invalid/);
    }
});

test('discovery bounds window and keeps explicit omitted count, compatibility and deprecation facts', async () => {
    const data={name,versions:{[prior]:manifest(prior)}};
    for(let index=0;index<25;index++) data.versions[`1.0.${index}`]=manifest(`1.0.${index}`);
    data.versions['1.0.24'].deprecated='old';
    const tool=new RegistryStager('unused-owned-fixture',{fetcher:async()=>Response.json(data),compatibility:value=>value.version==='1.0.23'?{reason:'incompatible'}:undefined});
    const result=await tool.listVersions(name,prior);
    assert.equal(result.versions.length,20);assert.equal(result.omitted,5);
    assert.equal(result.versions[0].deprecated,'old');assert(result.versions[1].incompatible);
});

test('discovery rejects excessive body, HTTP failure, missing stream, abort, and non-public registry', async () => {
    await assert.rejects(()=>stager(null,async()=>new Response('x'.repeat(10*1024*1024+1))).listVersions(name,prior),/size/);
    await assert.rejects(()=>stager(null,async()=>new Response('',{status:404})).listVersions(name,prior),/unavailable/);
    await assert.rejects(()=>stager(null,async()=>new Response(null)).listVersions(name,prior));
    const controller=new AbortController();controller.abort(new Error('owned abort'));let requests=0;
    await assert.rejects(()=>stager(null,async(url,options)=>{requests++;options.signal.throwIfAborted();return Response.json(full());}).listVersions(name,prior,controller.signal),/owned abort/);
    const mirror=new RegistryStager('unused-owned-fixture',{registry:'https://registry.npmmirror.com',fetcher:async()=>{requests++;return Response.json(full());}});
    const before=requests;await assert.rejects(()=>mirror.listVersions(name,prior),/origin-unsupported/);assert.equal(requests,before);
});
