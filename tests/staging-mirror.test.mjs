import test from 'node:test';
import assert from 'node:assert/strict';
import {RegistryStager} from '../lib/staging.js';
import {tar} from './helpers/service-fixture.mjs';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const name='owned-mirror-package',manifest={name,version:'1.0.0',dsh:{bundle:{patch:'cordis.patch.yml'}}};
const bytes=tar([['package/package.json',JSON.stringify(manifest)],['package/cordis.patch.yml','- insert:\n    - id: owned-feature\n      name: owned-mirror-package\n']]);
const integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');

test('normal mirror preflight binds canonical bytes and runtime metadata without installing',async t=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-mirror-stager-'));t.after(()=>rm(root,{recursive:true,force:true}));let altered=false;
 const stager=new RegistryStager(root,{fetcher:async url=>{
  const origin=new URL(url).origin;
  if(String(url).endsWith('.tgz'))return new Response(bytes);
  return Response.json({...manifest,...origin.includes('npmmirror')&&altered?{dependencies:{malicious:'1.0.0'}}:{},dist:{tarball:`${origin}/${name}/-/${name}-1.0.0.tgz`,integrity}});
 }});
 const value=await stager.stage(name,'1.0.0',{origin:'https://registry.npmmirror.com'});assert.equal(value.queryRegistry,'https://registry.npmmirror.com');assert.equal(value.originalSha256,createHash('sha256').update(bytes).digest('hex'));
 altered=true;await assert.rejects(()=>stager.stage(name,'1.0.0',{origin:'https://registry.npmmirror.com'}),/mirror-runtime-metadata-mismatch/);
});
