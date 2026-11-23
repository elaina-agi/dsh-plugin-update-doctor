import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {dependencySnapshot,unionGenerationArchive,inspectGenerationArchive} from '../experiments/union-generation-archive.mjs';
import {tar} from './helpers/service-fixture.mjs';

async function fixture(t){const root=await mkdtemp(join(tmpdir(),'dsh-owned-generation-layout-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
async function pkg(directory,name,version,dependencies={}){await mkdir(directory,{recursive:true});const manifest={name,version,type:'commonjs',main:'index.js',dependencies};await writeFile(join(directory,'package.json'),JSON.stringify(manifest));await writeFile(join(directory,'index.js'),'module.exports='+JSON.stringify(name+'@'+version));return manifest;}
async function materialize(root,files){for(const file of files){const target=join(root,file.name);await mkdir(dirname(target),{recursive:true});await writeFile(target,file.bytes);}}

test('generation dependency layout preserves deeper requests back to baseline under a shadowing ancestor',async t=>{
 const root=await fixture(t),manifest=await pkg(root,'owned-root','1.0.0',{a:'1.0.0',x:'1.0.0',y:'1.0.0'}),nm=join(root,'node_modules');
 await pkg(join(nm,'a'),'a','1.0.0',{x:'2.0.0'});await pkg(join(nm,'x'),'x','1.0.0');await pkg(join(nm,'y'),'y','1.0.0');await pkg(join(nm,'a','node_modules','x'),'x','2.0.0',{y:'2.0.0'});await pkg(join(nm,'a','node_modules','x','node_modules','y'),'y','2.0.0',{x:'1.0.0'});
 await pkg(join(nm,'a','node_modules','x','node_modules','y','node_modules','x'),'x','1.0.0');
 const snapshot=await dependencySnapshot(root,manifest),copy=join(root,'copied');await materialize(copy,snapshot.portableFiles);
 const deep=join(copy,'node_modules','a','node_modules','x','node_modules','y');const req=createRequire(join(deep,'package.json'));assert.equal(req('x'),'x@1.0.0');
 assert(snapshot.portableFiles.some(f=>f.name==='node_modules/a/node_modules/x/node_modules/y/node_modules/x/package.json'));
});

test('generation archive keeps original source bytes and all previously retained fresh paths',async t=>{
 const root=await fixture(t),manifest=await pkg(root,'owned-root','1.0.0',{sample:'1.0.0'});await pkg(join(root,'node_modules','sample'),'sample','1.0.0');const deps=await dependencySnapshot(root,manifest);
 const make=version=>tar([['package/package.json',JSON.stringify({name:'dsh-union-search',version,type:'module',main:'lib/index.js',exports:{'.':'./lib/index.js','./client':'./lib/client.js','./package.json':'./package.json'},dependencies:{sample:'1.0.0'},dsh:{bundle:{patch:'cordis.patch.yml'}}})],['package/lib/index.js','export function apply(){}'],['package/lib/client.js','/* client */'],['package/cordis.patch.yml','- insert:\n    - id: web-search-free\n      name: dsh-union-search\n']]);
 const original=make('0.10.24'),first=unionGenerationArchive(original,deps),next=unionGenerationArchive(make('0.10.25'),deps,{legacyBytes:original,retained:[first]});assert.notEqual(first.generation,next.generation);
 const one=inspectGenerationArchive(first.bytes),two=new Map(inspectGenerationArchive(next.bytes).map(e=>[e.name,e.bytes]));for(const entry of one.filter(e=>e.name.startsWith('package/'+first.generation+'/')))assert(two.get(entry.name)?.equals(entry.bytes));
 assert.equal(two.get('package/lib/index.js').toString(),'export function apply(){}');assert.equal(two.get('package/'+next.generation+'/lib/index.js').toString(),'export function apply(){}');
 const routed=JSON.parse(two.get('package/package.json'));assert.equal(routed.exports['.'],'./'+next.generation+'/lib/index.js');assert.equal(routed.name,'dsh-union-search');assert.equal(next.source,'derived-local-generation-not-npm');
});

test('Host singleton dependency is not copied into the generation',async t=>{
 const root=await fixture(t),manifest=await pkg(root,'owned-root','1.0.0',{'@deepseek-ai/schemastery':'^3.18.4'});const snapshot=await dependencySnapshot(root,manifest);assert.equal(snapshot.packages.length,0);assert.deepEqual(snapshot.externalShared,['@deepseek-ai/schemastery']);assert.equal(snapshot.portableFiles.length,0);
});
