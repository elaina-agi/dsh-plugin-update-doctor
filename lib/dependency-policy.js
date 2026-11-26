import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { lstat, realpath, readdir } from 'node:fs/promises';
import { join, relative, isAbsolute, sep, dirname } from 'node:path';
import { boundedFile } from './file-read.js';

const MAX_PACKAGES=64, MAX_FILES=6000, MAX_DIRS=4000, MAX_BYTES=64*1024*1024, MAX_FILE=8*1024*1024;
const NAME=/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const UNSAFE=/^(?:@deepseek-ai\/dsh-|dsh-plugin-update-doctor$|electron$|node-pty$|koffi$|ffi-napi$|better-sqlite3$)/;
const stable=value=>/^\d+\.\d+\.\d+$/.test(value??'');
/** Semver range check used for installed-tree evidence. Partial caret/tilde ranges such as
 * `^0.12` or `~1.2` are valid declarations and must not be reported as mismatches.
 */
export function rangeMatches(version,range) {
 if(typeof range!=='string')return false;
 const value=version.split('.').map(Number),compare=(a,b)=>{for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};
 return range.split('||').some(branch=>{
  const tokens=branch.trim().match(/(?:\^|~|>=|<=|>|<|=)?\s*(?:\d+(?:\.\d+|\.\*){0,2}|\*)/g);
  if(!tokens||tokens.join('').replace(/\s/g,'')!==branch.replace(/\s/g,''))return false;
  return tokens.every(token=>{const match=/^(\^|~|>=|<=|>|<|=)?\s*(\d+(?:\.\d+|\.\*){0,2}|\*)$/.exec(token);if(!match)return false;if(match[2]==='*')return !match[1];
   const nums=match[2].split('.'),minimum=nums.map(x=>x==='*'?0:Number(x)),op=match[1];
   if(op&&nums.includes('*'))return false;
   while(minimum.length<3)minimum.push(0);const c=compare(value,minimum);
   if(op==='>')return nums.length===1?compare(value,[minimum[0]+1,0,0])>=0:nums.length===2?compare(value,[minimum[0],minimum[1]+1,0])>=0:c>0;
   if(op==='<=')return nums.length===1?compare(value,[minimum[0]+1,0,0])<0:nums.length===2?compare(value,[minimum[0],minimum[1]+1,0])<0:c<=0;
   if(op==='>=')return c>=0;if(op==='<')return c<0;
   if(op==='^'||op==='~'){
    // node-semver upper bound: caret bumps the left-most non-zero digit, tilde bumps minor.
    let upper;
    if(op==='~')upper=nums.length===1?[minimum[0]+1,0,0]:[minimum[0],minimum[1]+1,0];
    else if(nums.length===1||minimum[0]!==0)upper=[minimum[0]+1,0,0];
    else if(nums.length===2||minimum[1]!==0)upper=[0,minimum[1]+1,0];
    else upper=[0,0,minimum[2]+1];
    return c>=0&&compare(value,upper)<0;
   }
   if(nums.length<3||nums.includes('*'))return nums.every((x,i)=>x==='*'||Number(x)===value[i]);return c===0;
  });
 });
}
const dependencies=manifest=>({...manifest.dependencies,...manifest.optionalDependencies});
const fail=code=>{throw Object.assign(Error(code),{code});};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export function dependencyDeclaration(manifest) { return JSON.stringify(canonical({dependencies:manifest.dependencies??{},optionalDependencies:manifest.optionalDependencies??{}})); }

/** Bounded installed graph evidence. No code runs, no dependency is installed or approved.
 * Optional dependencies that this platform does not install are recorded as unresolved instead of
 * failing the update; every resolved package is still range-checked and scanned for native bytes.
 * `tolerant` keeps that evidence usable when an older package declares browser-bundled dependencies
 * that were never installed into the Host runtime.
 */
export async function inspectDependencyGraph(packageDirectory, manifest, signal, {tolerant=false}={}) {
    signal=signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
    const root=await realpath(packageDirectory),rootOwner='root:'+manifest.name,pending=[{directory:root,names:Object.keys(dependencies(manifest)),optional:new Set(Object.keys(manifest.optionalDependencies??{})),manifest,ownerKey:rootOwner}],seen=new Map(),records=[],edges=[];
    let count=0,total=0,directoryCount=0;
    const unresolved=[];const nativeFiles=[];
    const readManifest=async dir=>JSON.parse((await boundedFile(join(dir,'package.json'),512*1024)).toString('utf8'));
    while(pending.length){
        signal?.throwIfAborted();const owner=pending.shift(),require=createRequire(join(owner.directory,'package.json'));
        for(const name of owner.names){
            if(!NAME.test(name))fail('dependency-source-unsupported');
            let entry;try{entry=require.resolve(name+'/package.json');}catch{try{entry=require.resolve(name);}catch{
                if(owner.optional.has(name)||tolerant){unresolved.push({owner:owner.ownerKey??owner.manifest.name+'@'+owner.manifest.version,name});continue;}
                fail('dependency-not-resolved');
            }}
            if(!entry){if(owner.optional.has(name)||tolerant){unresolved.push({owner:owner.ownerKey??owner.manifest.name+'@'+owner.manifest.version,name});continue;}fail('dependency-not-resolved');}
            let directory=dirname(entry);
            while(true){try{const value=await readManifest(directory);if(value.name===name)break;}catch{}
                const parent=dirname(directory);if(parent===directory){if(owner.optional.has(name)||tolerant){directory=null;break;}fail('dependency-not-resolved');}directory=parent;}
            if(!directory)continue;
            directory=await realpath(directory);const value=await readManifest(directory);
            if(!stable(value.version)||value.name!==name)fail('dependency-graph-update-requires-separate-review');
            if(!rangeMatches(value.version,dependencies(owner.manifest)[name]))fail('dependency-version-range-mismatch');
            const key=name+'@'+value.version;edges.push({owner:owner.ownerKey??owner.manifest.name+'@'+owner.manifest.version,name,resolved:key});
            if(edges.length>256)fail('dependency-graph-limit');
            if(seen.has(directory))continue;seen.set(directory,key);
            if(seen.size>MAX_PACKAGES)fail('dependency-graph-limit');
            const files=[],dirs=[directory];
            while(dirs.length){signal.throwIfAborted();if(++directoryCount>MAX_DIRS)fail('dependency-graph-limit');const dir=dirs.pop();for(const item of await readdir(dir,{withFileTypes:true})){
                if(item.name==='node_modules'||item.name==='.git')continue;
                signal.throwIfAborted();
                const path=join(dir,item.name),rel=relative(directory,path).split(sep).join('/');
                if(isAbsolute(rel)||rel.split('/').includes('..')||/[<>:"\\|?*\x00-\x1f]/.test(rel))fail('dependency-path-unsupported');
                const info=await lstat(path);if(info.isSymbolicLink())fail('dependency-path-unsupported');
                if(info.isDirectory()){dirs.push(path);continue;}if(!info.isFile())fail('dependency-path-unsupported');
                // Native payloads are recorded, not a failure: the package bytes are verified and
                // a replacement that cannot load is rolled back by the Host checks.
                if((/\.(?:node|dll|exe|so|dylib)$/i).test(item.name)||item.name==='binding.gyp')nativeFiles.push(name+'/'+rel);
                if(++count>MAX_FILES)fail('dependency-graph-limit');const bytes=await boundedFile(path,MAX_FILE);total+=bytes.length;if(total>MAX_BYTES)fail('dependency-graph-limit');
                files.push([rel,createHash('sha256').update(bytes).digest('hex')]);
            }}
            files.sort((a,b)=>a[0].localeCompare(b[0]));records.push({name,version:value.version,digest:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files:files.length});
            pending.push({directory,names:Object.keys(dependencies(value)),optional:new Set(Object.keys(value.optionalDependencies??{})),manifest:value});
        }
    }
    records.sort((a,b)=>(a.name+'@'+a.version).localeCompare(b.name+'@'+b.version));
    edges.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
    unresolved.sort((a,b)=>(a.owner+a.name).localeCompare(b.owner+b.name));
    return {schemaVersion:1,declaration:dependencyDeclaration(manifest),packages:records,edges,unresolved,native:nativeFiles.slice(0,64),provenance:'installed file evidence, not public registry provenance',digest:createHash('sha256').update(JSON.stringify({records,edges,unresolved})).digest('hex'),packageCount:records.length,fileCount:count,totalBytes:total};
}
export function assertSameDependencyGraph(previous,next) {
    if(previous?.declaration!==next?.declaration||previous?.digest!==next?.digest)fail('dependency-graph-changed');
}
