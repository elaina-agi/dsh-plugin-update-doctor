import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { lstat, realpath, opendir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { boundedFile } from './file-read.js';
import { PUBLIC_REGISTRY } from './source.js';

/** This reader deliberately does not use generation.archiveEntries (its 2,000-file
 * cap is too small). Nothing in this module extracts or executes archive code. */
export const UNION_LIMITS = Object.freeze({ compressed:64*1024*1024, archive:128*1024*1024,
    files:18000, file:8*1024*1024, packages:64, dependencyFiles:6000,
    directories:4000, dependencyBytes:64*1024*1024, edges:512, oldGenerations:5 });
// Legacy schema-3 originals only; never used to admit a new candidate.
export const UNION_RELEASE_HASHES = Object.freeze({
    '0.10.24':'b1e412d69fb79de5b96de50268df640de27d01d0f89f41886ef3a16029cd0f47',
    '0.10.25':'9de39d37a1594b10f3a074b7289232b29089d46fa18f674632f30ba1a24c2926',
});
export const unionHash = bytes => createHash('sha256').update(bytes).digest('hex');
export const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
export const unionDigest = value => unionHash(Buffer.from(JSON.stringify(canonical(value))));
const fail = code => { throw Object.assign(Error(code),{code}); };
const check = (condition,code) => { if (!condition) fail(code); };
const cmp = (a,b) => a<b ? -1 : a>b ? 1 : 0;
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const HOST_SHARED = '@deepseek-ai/schemastery';
const NATIVE = /(?:\.(?:node|dll|exe|so|dylib)|(?:^|\/)binding\.gyp)$/i;
export function unionDeadline(signal, milliseconds=120000) {
    return signal ? AbortSignal.any([signal,AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds);
}
export function safeWinArchivePath(name,{directory=false}={}) {
    check(typeof name==='string' && Buffer.byteLength(name)<=1024 && name.normalize('NFC')===name,'union-unsafe-archive-path');
    if (directory && name.endsWith('/')) name=name.slice(0,-1);
    const parts=name.split('/');
    check(parts[0]==='package' && (directory || parts.length>1) && parts.length<128,'union-unsafe-archive-path');
    for (const part of parts) check(part && part!=='.' && part!=='..' && Buffer.byteLength(part)<=255
        && !/[<>:"\\|?*\x00-\x1f\x7f]/.test(part) && !/[. ]$/.test(part)
        && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),'union-unsafe-archive-path');
    return name.toLowerCase();
}
function pathSet() {
    const files=new Set(), directories=new Set(), explicit=new Set();
    return (name,directory=false) => {
        const key=safeWinArchivePath(name,{directory});
        check(!explicit.has(key),'union-duplicate-archive-path'); explicit.add(key);
        if (directory) check(!files.has(key),'union-prefix-collision');
        else check(!files.has(key) && !directories.has(key),'union-prefix-collision');
        const parts=key.split('/');
        for(let i=1;i<parts.length;i++) {
            const parent=parts.slice(0,i).join('/'); check(!files.has(parent),'union-prefix-collision'); directories.add(parent);
        }
        (directory?directories:files).add(key);
    };
}
function field(header,start,length) {
    const value=header.subarray(start,start+length), zero=value.indexOf(0);
    if(zero>=0) check(value.subarray(zero).every(b=>b===0),'union-invalid-tar-field');
    try { return new TextDecoder('utf-8',{fatal:true}).decode(zero<0?value:value.subarray(0,zero)); }
    catch { fail('union-invalid-tar-field'); }
}
function octal(header,start,length) {
    const value=header.subarray(start,start+length).toString('ascii');
    check(/^[ 0-7]+[\0 ]*$/.test(value),'union-invalid-tar-number');
    const result=parseInt(value.replace(/\0/g,'').trim(),8);
    check(Number.isSafeInteger(result) && result>=0,'union-invalid-tar-number'); return result;
}
export function inspectUnionArchive(compressed) {
    check(Buffer.isBuffer(compressed) && compressed.length>0 && compressed.length<=UNION_LIMITS.compressed,'union-compressed-bound');
    let data; try { data=gunzipSync(compressed,{maxOutputLength:UNION_LIMITS.archive}); } catch { fail('union-invalid-or-unbounded-gzip'); }
    check(data.length<=UNION_LIMITS.archive && data.length%512===0,'union-archive-bound');
    const entries=[],addPath=pathSet(); let offset=0,count=0,directoryCount=0;
    while(offset+512<=data.length) {
        const h=data.subarray(offset,offset+512); if(h.every(b=>b===0)) break;
        const sum=[...h].reduce((s,b,i)=>s+(i>=148&&i<156?32:b),0);
        check(octal(h,148,8)===sum,'union-invalid-tar-checksum');
        const leaf=field(h,0,100),prefix=field(h,345,155),name=prefix?prefix+'/'+leaf:leaf;
        const size=octal(h,124,12),mode=octal(h,100,8),type=h[156];
        check([0,48,53].includes(type),'union-archive-links-or-extensions');
        check(mode<=0o777 && size<=UNION_LIMITS.file && offset+512+size<=data.length,'union-invalid-tar-range');
        check(++count<=UNION_LIMITS.files+UNION_LIMITS.directories,'union-archive-entry-bound');
        check(!NATIVE.test(name),'union-native-resource'); addPath(name,type===53);
        if(type===53) check(size===0 && ++directoryCount<=UNION_LIMITS.directories,'union-directory-content-or-bound');
        else { check(entries.length<UNION_LIMITS.files,'union-archive-file-bound');
            entries.push({name,bytes:Buffer.from(data.subarray(offset+512,offset+512+size)),mode:mode.toString(8)}); }
        const next=offset+512+Math.ceil(size/512)*512;
        check(next<=data.length && data.subarray(offset+512+size,next).every(b=>b===0),'union-invalid-tar-padding'); offset=next;
    }
    check(offset+1024<=data.length && data.subarray(offset).every(b=>b===0),'union-invalid-tar-terminator');
    return entries;
}
export function packUnionArchive(entries) {
    check(Array.isArray(entries) && entries.length<=UNION_LIMITS.files,'union-archive-file-bound');
    const parts=[],addPath=pathSet(); let total=1024;
    for(const entry of entries) {
        addPath(entry.name); check(Buffer.isBuffer(entry.bytes) && entry.bytes.length<=UNION_LIMITS.file,'union-file-bound');
        check(!NATIVE.test(entry.name),'union-native-resource');
        total+=512+Math.ceil(entry.bytes.length/512)*512; check(total<=UNION_LIMITS.archive,'union-archive-bound');
        const h=Buffer.alloc(512); let name=entry.name,prefix='';
        if(Buffer.byteLength(name)>100) {
            let cut=name.lastIndexOf('/');
            while(cut>0 && (Buffer.byteLength(name.slice(cut+1))>100 || Buffer.byteLength(name.slice(0,cut))>155)) cut=name.lastIndexOf('/',cut-1);
            check(cut>0,'union-tar-path-bound'); prefix=name.slice(0,cut);name=name.slice(cut+1);
        }
        const mode=entry.mode??'644'; check(/^[0-7]{1,3}$/.test(mode),'union-invalid-mode');
        h.write(name,0,100);h.write(mode.padStart(7,'0')+'\0',100,8);h.write('0000000\0',108,8);h.write('0000000\0',116,8);
        h.write(entry.bytes.length.toString(8).padStart(11,'0')+'\0',124,12);h.fill(32,148,156);h[156]=48;
        h.write('ustar\0',257,6);h.write('00',263,2);if(prefix)h.write(prefix,345,155);
        h.write([...h].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148,8);
        parts.push(h,entry.bytes,Buffer.alloc((512-entry.bytes.length%512)%512));
    }
    const bytes=gzipSync(Buffer.concat([...parts,Buffer.alloc(1024)]));
    check(bytes.length<=UNION_LIMITS.compressed,'union-compressed-bound'); return bytes;
}
export function unionManifest(entries) {
    const item=entries.find(e=>e.name==='package/package.json'); check(item && item.bytes.length<=512*1024,'union-manifest-missing-or-bound');
    let manifest;try { manifest=JSON.parse(item.bytes.toString('utf8')); } catch { fail('union-manifest-invalid'); }
    check(manifest && typeof manifest==='object' && !Array.isArray(manifest),'union-manifest-invalid'); return manifest;
}
export function unionInventory(entries) {
    return entries.map(e=>[e.name,unionHash(e.bytes),e.bytes.length]).sort((a,b)=>cmp(a[0],b[0]));
}
export function unionRangeMatches(version,range) {
    if(!VERSION.test(version??'') || typeof range!=='string' || range.length>256) return false;
    const value=version.split('.').map(Number),compare=(a,b)=>{for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};
    if(!value.every(Number.isSafeInteger)) return false;
    return range.split('||').some(branch=> {
        const tokens=branch.trim().match(/(?:\^|~|>=|<=|>|<|=)?\s*(?:\d+(?:\.\d+|\.\*){0,2}|\*)/g);
        if(!tokens || tokens.join('').replace(/\s/g,'')!==branch.replace(/\s/g,''))return false;
        return tokens.every(token=> {
            const m=/^(\^|~|>=|<=|>|<|=)?\s*(\d+(?:\.\d+|\.\*){0,2}|\*)$/.exec(token);if(!m)return false;
            if(m[2]==='*')return !m[1]; const nums=m[2].split('.'),min=nums.map(x=>x==='*'?0:Number(x));
            if(!min.every(Number.isSafeInteger) || m[1]&&(nums.length!==3||nums.includes('*')))return false;
            while(min.length<3)min.push(0);const c=compare(value,min),op=m[1];
            if(op==='>=')return c>=0;if(op==='>')return c>0;if(op==='<=')return c<=0;if(op==='<')return c<0;
            if(op==='^'||op==='~') { const upper=[...min];if(op==='~'){upper[1]++;upper[2]=0;}
                else if(upper[0]){upper[0]++;upper[1]=upper[2]=0;}else if(upper[1]){upper[1]++;upper[2]=0;}else upper[2]++;
                return c>=0&&compare(value,upper)<0; }
            return nums.length<3||nums.includes('*')?nums.every((x,i)=>x==='*'||Number(x)===value[i]):c===0;
        });
    });
}
export function assertUnionDependencyPolicy(manifest,{root=false}={}) {
    check(NAME.test(manifest.name??'') && VERSION.test(manifest.version??''),'union-dependency-identity');
    for(const key of ['optionalDependencies','bundledDependencies','bundleDependencies','overrides','resolutions'])
        check(!manifest[key] || typeof manifest[key]==='object' && Object.keys(manifest[key]).length===0,'union-dependency-source');
    check(!manifest.gypfile,'union-native-resource');
    for(const key of ['preinstall','install','postinstall',...(root?['prepare']:[])])
        check(!manifest.scripts?.[key],'union-lifecycle-script');
    const deps=manifest.dependencies??{};check(deps && typeof deps==='object' && !Array.isArray(deps) && Object.keys(deps).length<=64,'union-dependency-source');
    for(const [name,range] of Object.entries(deps)) check(NAME.test(name) && !name.split('/').some(x=>x==='.'||x==='..')
        && (name===HOST_SHARED || !name.startsWith('@deepseek-ai/') && !['react','electron','node-pty','koffi','ffi-napi','better-sqlite3'].includes(name))
        && typeof range==='string' && range.length<=256 && /^\s*[~^<>=*\d][\d\s.~^<>=*|]*$/.test(range),'union-dependency-source');
}
/** Reject directory junctions/symlinks as well as leaf links before realpath. */
export async function unionPlainDirectory(directory) {
    const absolute=resolve(directory); let cursor=absolute;
    while(true) {
        const info=await lstat(cursor);check(info.isDirectory()&&!info.isSymbolicLink(),'union-directory-untrusted');
        const parent=dirname(cursor);if(parent===cursor)break;cursor=parent;
    }
    check(await realpath(absolute)===absolute,'union-directory-untrusted');return absolute;
}
async function locateDependency(owner,name,signal) {
    let cursor=owner;
    while(true) {
        signal.throwIfAborted();const candidate=join(cursor,'node_modules',...name.split('/'));
        let info;try { info=await lstat(candidate); } catch(error) { if(!['ENOENT','ENOTDIR'].includes(error.code))throw error; }
        if(info) { check(info.isDirectory()&&!info.isSymbolicLink(),'union-dependency-link');return unionPlainDirectory(candidate); }
        const parent=dirname(cursor);if(parent===cursor)fail('union-dependency-unresolved');cursor=parent;
    }
}
async function packageContents(directory,state,signal) {
    const files=[],dirs=[directory],addPath=pathSet();
    while(dirs.length) {
        signal.throwIfAborted();check(++state.directories<=UNION_LIMITS.directories,'union-dependency-directory-bound');
        const dir=dirs.pop();
        for await(const item of await opendir(dir)) {
            signal.throwIfAborted();const path=join(dir,item.name),info=await lstat(path);
            check(!info.isSymbolicLink(),'union-dependency-link');
            const rel=relative(directory,path).split(sep).join('/');
            // A dependency's own installed dependencies are resolved independently.
            if(item.name==='node_modules') { check(info.isDirectory(),'union-dependency-link');continue; }
            check(item.name!=='.git','union-dependency-inventory');
            addPath('package/'+rel,info.isDirectory());
            if(info.isDirectory()) {check(state.directories+dirs.length<UNION_LIMITS.directories,'union-dependency-directory-bound');dirs.push(path);continue;}
            check(info.isFile()&&!NATIVE.test(rel),'union-native-resource');
            const bytes=await boundedFile(path,UNION_LIMITS.file);signal.throwIfAborted();state.bytes+=bytes.length;
            check(++state.files<=UNION_LIMITS.dependencyFiles && state.bytes<=UNION_LIMITS.dependencyBytes,'union-dependency-file-bound');
            files.push({name:rel,bytes});
        }
    }
    return files.sort((a,b)=>cmp(a.name,b.name));
}
/** Complete physical dependency snapshots, each owner independently resolved. Local
 * paths and buffers are ephemeral and are never included in the persisted evidence. */
export async function unionDependencySnapshot(packageDirectory,manifest,{signal}={}) {
    signal=unionDeadline(signal,60000);assertUnionDependencyPolicy(manifest,{root:true});
    const root=await unionPlainDirectory(packageDirectory),seen=new Map(),packages=[],pending=[],state={files:0,bytes:0,directories:0};
    const top=[],allEdges=[];
    async function visit(owner,ownerManifest,edges,ownerKey) {
        for(const [name,range] of Object.entries(ownerManifest.dependencies??{}).sort(([a],[b])=>cmp(a,b))) {
            signal.throwIfAborted();check(allEdges.length<UNION_LIMITS.edges,'union-dependency-edge-bound');
            if(name===HOST_SHARED) {const e={name,range,external:true};edges.push(e);allEdges.push({owner:ownerKey,...e});continue;}
            const directory=await locateDependency(owner,name,signal);
            const current=unionManifest([{name:'package/package.json',bytes:await boundedFile(join(directory,'package.json'),512*1024)}]);
            assertUnionDependencyPolicy(current);check(current.name===name && unionRangeMatches(current.version,range),'union-dependency-range');
            const key=name+'@'+current.version,e={name,range,target:key};edges.push(e);allEdges.push({owner:ownerKey,...e});
            if(seen.has(directory)) {check(seen.get(directory).key===key,'union-dependency-changed');continue;}
            check(packages.length<UNION_LIMITS.packages,'union-dependency-package-bound');
            const record={name,version:current.version,key,manifest:current,directory,files:await packageContents(directory,state,signal),edges:[]};
            seen.set(directory,record);packages.push(record);pending.push(record);
        }
    }
    await visit(root,manifest,top,'root:'+manifest.name+'@'+manifest.version);
    while(pending.length) {const pkg=pending.shift();await visit(pkg.directory,pkg.manifest,pkg.edges,pkg.key);}
    const identities=new Map(),unique=[];
    for(const pkg of packages) {
        const identity=unionDigest({files:unionInventory(pkg.files),edges:pkg.edges});
        if(identities.has(pkg.key)) check(identities.get(pkg.key)===identity,'union-same-version-bytes-or-edges');
        else {identities.set(pkg.key,identity);unique.push(pkg);}pkg.identity=identity;
    }
    // Validate each physical copy against public npm, including same-version copies.
    const snapshot={manifest,packages,unique,top,edges:allEdges,fileCount:state.files,totalBytes:state.bytes,
        externalShared:[HOST_SHARED]};
    const layout=unionPortableLayout(snapshot);Object.assign(snapshot,layout);
    snapshot.digest=unionDigest(unionSnapshotGraph(snapshot));return snapshot;
}
export function unionSnapshotGraph(snapshot) {
    const packages=(snapshot.unique??snapshot.packages).map(p=>({name:p.name,version:p.version,
        files:unionInventory(p.files),edges:p.edges})).sort((a,b)=>cmp(a.name+'@'+a.version,b.name+'@'+b.version));
    return {declaration:snapshot.manifest.dependencies??{},top:snapshot.top,packages,layout:snapshot.layout};
}
export function unionPortableLayout(snapshot) {
    const unique=[...(snapshot.unique??snapshot.packages)].sort((a,b)=>cmp(a.name+'@'+a.version,b.name+'@'+b.version)),byKey=new Map(unique.map(p=>[p.key??p.name+'@'+p.version,p]));
    const baseline=new Map();for(const edge of snapshot.top)if(!edge.external)baseline.set(edge.name,edge.target);
    for(const pkg of unique)if(!baseline.has(pkg.name))baseline.set(pkg.name,pkg.key??pkg.name+'@'+pkg.version);
    const portableFiles=[],layout=[];let bytes=0;
    function copy(key,prefix,visible=new Map(baseline),ancestors=[]) {
        check(!ancestors.includes(key),'union-dependency-cycle');const pkg=byKey.get(key);check(pkg,'union-layout-target');
        layout.push({path:prefix,key,edges:pkg.edges});
        for(const file of pkg.files) {bytes+=file.bytes.length;check(portableFiles.length<16000 && bytes<=96*1024*1024,'union-layout-bound');
            portableFiles.push({name:prefix+'/'+file.name,bytes:file.bytes});}
        const corrections=pkg.edges.filter(e=>!e.external && visible.get(e.name)!==e.target),next=new Map(visible);
        for(const edge of corrections)next.set(edge.name,edge.target);
        for(const edge of corrections)copy(edge.target,prefix+'/node_modules/'+edge.name,next,[...ancestors,key]);
    }
    for(const [name,key] of baseline)copy(key,'node_modules/'+name);
    layout.sort((a,b)=>cmp(a.path,b.path));const layoutDigest=unionDigest({top:snapshot.top,layout,files:unionInventory(portableFiles)});
    return {portableFiles,layout,layoutDigest};
}
async function boundedBody(response,max,signal) {
    check(response.ok && response.body,'union-public-download');const reader=response.body.getReader(),parts=[];let size=0;
    try {while(true) {signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;size+=value.length;
        check(size<=max,'union-public-download-bound');parts.push(Buffer.from(value));}}
    finally {await reader.cancel().catch(()=>{});reader.releaseLock();}return Buffer.concat(parts);
}
export function verifyUnionSRI(bytes,integrity) {
    check(typeof integrity==='string' && integrity.length<=256 && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity),'union-public-integrity');
    check('sha512-'+createHash('sha512').update(bytes).digest('base64')===integrity,'union-public-integrity');
}
export async function verifyUnionPublicSnapshot(snapshot,{fetcher=fetch,signal,cache=null}={}) {
    signal=unionDeadline(signal);const proofs=[],publicArchives=new Map();let archiveBytes=0;const fetched=new Map(),now=Date.now();
    for(const pkg of snapshot.packages) {
        signal.throwIfAborted();const key=pkg.name+'@'+pkg.version;
        const cached=cache?.get?.(key);
        let publicRecord=cached&&now-cached.at<=10*60_000?{entries:inspectUnionArchive(cached.archive),proof:cached.proof}:fetched.get(key);
        if(!publicRecord) {
            const url=PUBLIC_REGISTRY+'/'+encodeURIComponent(pkg.name)+'/'+pkg.version;
            const metadata=JSON.parse((await boundedBody(await fetcher(url,{signal,redirect:'error',credentials:'omit'}),2*1024*1024,signal)).toString('utf8'));
            check(metadata.name===pkg.name && metadata.version===pkg.version,'union-public-identity');
            let archive;try {archive=new URL(metadata.dist?.tarball);}catch {fail('union-public-source');}
            check(archive.origin===PUBLIC_REGISTRY && !archive.username && !archive.password && !archive.search && !archive.hash
                && archive.pathname==='/'+pkg.name+'/-/'+pkg.name.split('/').at(-1)+'-'+pkg.version+'.tgz','union-public-source');
            const bytes=await boundedBody(await fetcher(archive,{signal,redirect:'error',credentials:'omit'}),16*1024*1024,signal);
            verifyUnionSRI(bytes,metadata.dist.integrity);const entries=inspectUnionArchive(bytes);
            const manifest=unionManifest(entries);assertUnionDependencyPolicy(manifest);
            check(manifest.name===pkg.name && manifest.version===pkg.version,'union-public-identity');
            check(!entries.some(e=>e.name.split('/').includes('node_modules')),'union-public-vendored');
            publicRecord={entries,proof:{name:pkg.name,version:pkg.version,sha256:unionHash(bytes),integrity:metadata.dist.integrity,
                files:entries.length,inventoryDigest:unionDigest(unionInventory(entries.map(e=>({...e,name:e.name.slice(8)})))),installedOriginalBytes:true}};
            fetched.set(key,publicRecord);proofs.push(publicRecord.proof);
            archiveBytes+=bytes.length;check(archiveBytes<=UNION_LIMITS.dependencyBytes,'union-public-archive-total-bound');
            publicArchives.set(publicRecord.proof.sha256,bytes);
            if(cache?.set){cache.set(key,{proof:publicRecord.proof,archive:bytes,at:Date.now()});if(cache.size>96)cache.delete(cache.keys().next().value);}
            continue;
        }
        if(!proofs.some(proof=>proof.name===pkg.name&&proof.version===pkg.version))proofs.push(publicRecord.proof);
        publicArchives.set(publicRecord.proof.sha256,publicArchives.get(publicRecord.proof.sha256)??cache?.get?.(key)?.archive??null);
    }
    // Cached records still have to match the installed bytes exactly.
    for(const pkg of snapshot.packages) {
        const key=pkg.name+'@'+pkg.version,record=fetched.get(key)??(cache?.get?.(key));
        if(!record) continue;
        const entries=record.entries??inspectUnionArchive(record.archive);
        const publicFiles=new Map(entries.map(e=>[e.name.slice(8),e.bytes]));
        check(unionDigest(unionInventory(pkg.files))===record.proof.inventoryDigest,'union-public-exact-inventory');
        check(pkg.files.length===publicFiles.size && pkg.files.every(f=>publicFiles.get(f.name)?.equals(f.bytes)),'union-public-original-bytes');
    }
    proofs.sort((a,b)=>cmp(a.name+'@'+a.version,b.name+'@'+b.version));
    snapshot.publicArchives=publicArchives;
    return {canonical:true,registry:PUBLIC_REGISTRY,packages:proofs,graphDigest:snapshot.digest,layoutDigest:snapshot.layoutDigest,
        digest:unionDigest({root:snapshot.manifest.dependencies??{},top:snapshot.top,graph:snapshot.digest,layout:snapshot.layoutDigest,proofs})};
}
export function unionSnapshotEvidence(snapshot,proof) {
    check(proof?.canonical===true && proof.graphDigest===snapshot.digest && proof.layoutDigest===snapshot.layoutDigest,'union-public-proof-binding');
    const graph=unionSnapshotGraph(snapshot);
    for(const pkg of graph.packages) {
        const publicProof=proof.packages.find(p=>p.name===pkg.name&&p.version===pkg.version);
        check(publicProof && publicProof.inventoryDigest===unionDigest(pkg.files),'union-public-proof-binding');
    }
    return {schemaVersion:1,graph,graphDigest:snapshot.digest,layoutDigest:snapshot.layoutDigest,
        portableInventory:unionInventory(snapshot.portableFiles),proof,fileCount:snapshot.fileCount,totalBytes:snapshot.totalBytes,
        externalShared:snapshot.externalShared};
}
export function validateUnionEvidence(evidence) {
    check(evidence?.schemaVersion===1 && evidence.graph && evidence.proof?.canonical===true,'union-evidence-invalid');
    const graph=evidence.graph,proof=evidence.proof;
    check(Array.isArray(graph.packages) && graph.packages.length<=UNION_LIMITS.packages && Array.isArray(graph.top)
        && Array.isArray(graph.layout) && graph.layout.length<=UNION_LIMITS.files && Array.isArray(evidence.portableInventory)
        && evidence.portableInventory.length<=16000 && Array.isArray(proof.packages) && proof.packages.length===graph.packages.length,'union-evidence-bound');
    check(unionDigest(graph)===evidence.graphDigest && proof.graphDigest===evidence.graphDigest
        && proof.layoutDigest===evidence.layoutDigest && proof.registry===PUBLIC_REGISTRY,'union-evidence-binding');
    check(unionDigest({top:graph.top,layout:graph.layout,files:evidence.portableInventory})===evidence.layoutDigest,'union-layout-binding');
    check(proof.digest===unionDigest({root:graph.declaration,top:graph.top,graph:evidence.graphDigest,layout:evidence.layoutDigest,proofs:proof.packages}),'union-public-proof-binding');
    let fileCount=0;const names=new Set();
    for(const pkg of graph.packages) {
        const key=pkg.name+'@'+pkg.version;check(NAME.test(pkg.name)&&VERSION.test(pkg.version)&&!names.has(key),'union-evidence-package');names.add(key);
        check(Array.isArray(pkg.files)&&Array.isArray(pkg.edges)&&pkg.edges.length<=64,'union-evidence-package');fileCount+=pkg.files.length;
        const publicProof=proof.packages.find(p=>p.name===pkg.name&&p.version===pkg.version);
        check(publicProof && publicProof.files===pkg.files.length && publicProof.inventoryDigest===unionDigest(pkg.files)
            && /^[a-f0-9]{64}$/.test(publicProof.sha256) && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(publicProof.integrity),'union-public-proof-binding');
    }
    check(fileCount<=UNION_LIMITS.dependencyFiles,'union-evidence-bound');return evidence;
}
export function unionRoutedManifest(manifest,generation,{isolated=false}={}) {
    check(/^g\/[a-f0-9]{32}$/.test(generation),'union-generation-token');
    const rewrite=value=>typeof value==='string' ? (check(value.startsWith('./'),'union-export-route'), './'+generation+'/'+value.slice(2))
        : Array.isArray(value)?value.map(rewrite):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewrite(v)])):value;
    check(manifest.exports && typeof manifest.exports==='object' && !Array.isArray(manifest.exports) && typeof manifest.main==='string','union-manifest-route');
    const exports=Object.fromEntries(Object.entries(manifest.exports).map(([key,value])=>[key,
        (isolated ? key === './package.json' : /locale|package\.json|icon/.test(key)) ? value : rewrite(value)]));
    const main=manifest.main.replace(/^\.\//,'');safeWinArchivePath('package/'+main);
    return {...manifest,exports,main:generation+'/'+main};
}
/** Pure builder. Admission to production occurs ONLY in UnionGenerationStager,
 * never through a caller-supplied hash/policy override in these safety functions. */
export function buildUnionGeneration(sourceBytes,snapshot,{rootBytes=sourceBytes,retained=[],generation='g/'+randomUUID().replaceAll('-',''),isolated=false}={}) {
    check(Array.isArray(retained)&&retained.length<=UNION_LIMITS.oldGenerations,'union-retention-limit');
    const source=inspectUnionArchive(sourceBytes),root=inspectUnionArchive(rootBytes),manifest=unionManifest(source),routed=unionRoutedManifest(manifest,generation,{isolated});
    check((isolated ? NAME.test(manifest.name ?? '') : manifest.name==='dsh-union-search') && unionManifest(root).name===manifest.name,'union-generation-package');
    check(!source.some(e=>e.name.split('/')[1]==='g'||e.name.split('/').includes('node_modules')),'union-source-layout');
    const entries=[...root.map(e=>e.name==='package/package.json'?{...e,bytes:Buffer.from(JSON.stringify(routed,null,2))}:e),
        ...source.map(e=>({...e,name:'package/'+generation+'/'+e.name.slice(8)})),
        ...snapshot.portableFiles.map(f=>({name:'package/'+generation+'/'+f.name,bytes:f.bytes}))];
    const generations=new Set([generation]);
    for(const old of retained) {
        check(/^g\/[a-f0-9]{32}$/.test(old.generation)&&!generations.has(old.generation),'union-retained-token');generations.add(old.generation);
        check(Array.isArray(old.entries) && old.entries.length>0 && old.entries.every(e=>e.name.startsWith('package/'+old.generation+'/')),'union-retained-scope');
        entries.push(...old.entries);
    }
    const bytes=packUnionArchive(entries);return {bytes,generation,manifest:routed,originalSha256:unionHash(sourceBytes),
        sha256:unionHash(bytes),files:entries.length,inventoryDigest:unionDigest(unionInventory(entries)),originalJsUnchanged:true};
}
/** Full installed inventory; only the top-level Host-managed node_modules tree is
 * outside this archive. Every generation subtree is inventoried and hashed. */
export async function verifyUnionInstalledEntries(entries,packageDirectory,{signal}={}) {
    signal=unionDeadline(signal,60000);const root=await unionPlainDirectory(packageDirectory),expected=new Map(entries.map(e=>[e.name.slice(8),e]));
    const dirs=[root],actual=[],state={directories:0,bytes:0},addPath=pathSet();
    while(dirs.length) {
        signal.throwIfAborted();check(++state.directories<=UNION_LIMITS.files,'union-installed-directory-bound');const dir=dirs.pop();
        for await(const item of await opendir(dir)) {
            signal.throwIfAborted();const path=join(dir,item.name),rel=relative(root,path).split(sep).join('/'),info=await lstat(path);
            check(!info.isSymbolicLink(),'union-installed-link');
            if(rel==='node_modules') {check(info.isDirectory(),'union-installed-link');continue;}
            addPath('package/'+rel,info.isDirectory());
            if(info.isDirectory()) {check([...expected.keys()].some(key=>key.startsWith(rel+'/')),'union-installed-extra-directory');
                check(state.directories+dirs.length<UNION_LIMITS.files,'union-installed-directory-bound');dirs.push(path);continue;}
            check(info.isFile()&&expected.has(rel),'union-installed-extra-file');
            const bytes=await boundedFile(path,UNION_LIMITS.file);state.bytes+=bytes.length;
            check(actual.length<UNION_LIMITS.files && state.bytes<=UNION_LIMITS.archive,'union-installed-bound');
            check(bytes.equals(expected.get(rel).bytes),'union-installed-bytes');actual.push(rel);
        }
    }
    check(actual.length===expected.size,'union-installed-inventory');
    return {verified:true,files:actual.length,inventoryDigest:unionDigest(unionInventory(entries))};
}
