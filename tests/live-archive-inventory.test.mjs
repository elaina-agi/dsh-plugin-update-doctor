import test from 'node:test';
import assert from 'node:assert/strict';
import {RegistryStager} from '../lib/staging.js';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {tar} from './helpers/service-fixture.mjs';
import {createHash} from 'node:crypto';
const manifest={name:'owned-inventory',version:'1.0.0',dsh:{bundle:{patch:'cordis.patch.yml'}}};
const contents=[['package/package.json',JSON.stringify(manifest)],['package/cordis.patch.yml','- insert:\n    - id: owned-entry\n      name: owned-inventory\n'],['package/lib/owned.js','// original runtime']];
const bytes=tar(contents),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');

test('installed archive verification rejects changed live resource with untouched cached archive',async t=>{
 const root=await mkdtemp(join(tmpdir(),'dsh-live-archive-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const stager=new RegistryStager(join(root,'staged'),{fetcher:async url=>String(url).endsWith('.tgz')?new Response(bytes):Response.json({...manifest,dist:{tarball:'https://registry.npmjs.org/owned-inventory/-/owned-inventory-1.0.0.tgz',integrity}})});
 const staged=await stager.stage(manifest.name,manifest.version),dir=join(root,'installed');
 for(const [path,text]of contents){const target=join(dir,path.slice(8));await mkdir(join(target,'..'),{recursive:true});await writeFile(target,text);}
 assert((await stager.verifyInstalledArchive(stager.reference(staged),dir)).verified);
 await writeFile(join(dir,'lib','owned.js'),'// modified live');await assert.rejects(()=>stager.verifyInstalledArchive(stager.reference(staged),dir),/installed-generation-unverified/);
});
