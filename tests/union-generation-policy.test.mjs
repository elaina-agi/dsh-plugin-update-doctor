import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {dependencySnapshot,verifyPublicDependencySnapshot,packGeneration,inspectGenerationArchive} from '../experiments/union-generation-archive.mjs';
import {tar} from './helpers/service-fixture.mjs';

async function fixture(t){const root=await mkdtemp(join(tmpdir(),'dsh-generation-policy-test-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function pkg(dir,name,version,deps={},text=name){await mkdir(dir,{recursive:true});await writeFile(join(dir,'package.json'),JSON.stringify({name,version,main:'index.js',dependencies:deps}));await writeFile(join(dir,'index.js'),text);}

test('same name/version physical packages with different bytes are not collapsed into one generation',async t=>{
 const root=await fixture(t);await pkg(root,'root','1.0.0',{a:'1.0.0',b:'1.0.0'});await pkg(join(root,'node_modules','a'),'a','1.0.0',{x:'1.0.0'});await pkg(join(root,'node_modules','b'),'b','1.0.0',{x:'1.0.0'});await pkg(join(root,'node_modules','a','node_modules','x'),'x','1.0.0',{},'first');await pkg(join(root,'node_modules','b','node_modules','x'),'x','1.0.0',{},'different');const manifest=JSON.parse(await fs.readFile(join(root,'package.json'),'utf8'));await assert.rejects(()=>dependencySnapshot(root,manifest),/Same-version dependency bytes/);
});
test('dependency range mismatch is rejected before copying into a generation',async t=>{
 const root=await fixture(t);await pkg(root,'root','1.0.0',{x:'^1.0.0'});await pkg(join(root,'node_modules','x'),'x','2.0.0');const manifest=JSON.parse(await fs.readFile(join(root,'package.json'),'utf8'));await assert.rejects(()=>dependencySnapshot(root,manifest),/range does not admit/);
});
test('canonical public archive proof checks exact dependency file bytes rather than only name/version',async()=>{
 const manifest={name:'sample',version:'1.0.0'},bytes=tar([['package/package.json',JSON.stringify(manifest)],['package/index.js','public']]),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');const fetcher=async url=>String(url).endsWith('.tgz')?new Response(bytes):Response.json({...manifest,dist:{tarball:'https://registry.npmjs.org/sample/-/sample-1.0.0.tgz',integrity}});
 const snapshot={packages:[{...manifest,files:[{name:'package.json',bytes:Buffer.from(JSON.stringify(manifest))},{name:'index.js',bytes:Buffer.from('public')}]}],digest:'owned-graph'};assert.equal((await verifyPublicDependencySnapshot(snapshot,{fetcher})).canonical,true);snapshot.packages[0].files[1].bytes=Buffer.from('private changed');await assert.rejects(()=>verifyPublicDependencySnapshot(snapshot,{fetcher}),/differs from canonical/);
});
test('generation archive rejects unsafe aliases checksum corruption and hidden trailing entries',()=>{
 for(const name of ['package/../x','package/NUL.txt','package/a:stream','package/a.','package//x'])assert.throws(()=>packGeneration([{name,bytes:Buffer.from('x')}]));assert.throws(()=>packGeneration([{name:'package/A',bytes:Buffer.from('x')},{name:'package/a',bytes:Buffer.from('x')}]));
 const archive=packGeneration([{name:'package/a',bytes:Buffer.from('x')}]),raw=gunzipSync(archive);raw[0]^=1;assert.throws(()=>inspectGenerationArchive(gzipSync(raw)),/checksum/);
 const hidden=gunzipSync(archive);hidden[hidden.length-1]=1;assert.throws(()=>inspectGenerationArchive(gzipSync(hidden)),/trailing bytes/);
});
