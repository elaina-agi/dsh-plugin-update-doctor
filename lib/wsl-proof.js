import {mkdir,writeFile,lstat,realpath} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {archiveEntries,generationArchive} from './generation.js';
import {boundedFile} from './file-read.js';
import {archivePath,PUBLIC_REGISTRY} from './source.js';
import {WSL_NAME,WSL_GENERATION_KIND,WSL_LEGACY_ORIGINALS,isGenerationSupported,inspectWslPatches,inspectWslArchivePolicy,wslCanonical,wslHash} from './wsl-policy.js';

const SHA=/^[a-f0-9]{64}$/,SRI=/^sha512-[A-Za-z0-9+/]{86}==$/;
export const WSL_MAX_ORIGINALS=8;
const MAX_ARCHIVE=64*1024*1024;
const canonical=value=>JSON.stringify(wslCanonical(value));
const integrity=bytes=>'sha512-'+createHash('sha512').update(bytes).digest('base64');
export const structuralWsl=reference=>reference?.name===WSL_NAME&&reference.runtimeGeneration?.kind===WSL_GENERATION_KIND;
function original(bytes,expected={}){
    const entries=archiveEntries(bytes),metadata=entries.find(value=>value.name==='package/package.json');if(!metadata)throw Error('packed-manifest-missing');
    const manifest=JSON.parse(metadata.bytes),sha256=wslHash(bytes),sri=integrity(bytes);
    if(!isGenerationSupported(manifest)||expected.version&&manifest.version!==expected.version||expected.sha256&&sha256!==expected.sha256||expected.integrity&&sri!==expected.integrity)throw Error('wsl-original-identity-mismatch');
    if(WSL_LEGACY_ORIGINALS[manifest.version]&&WSL_LEGACY_ORIGINALS[manifest.version]!==sha256)throw Error('wsl-legacy-original-changed');
    inspectWslArchivePolicy(manifest,entries);
    const patches=typeof manifest.dsh?.bundle?.patch==='string'?[manifest.dsh.bundle.patch]:manifest.dsh?.bundle?.patch;
    if(!Array.isArray(patches)||!patches.length||patches.length>8)throw Error('invalid-bundle-patch-list');
    const texts=patches.map(file=>{if(typeof file!=='string'||!/^\.?\/?[A-Za-z0-9._/-]+$/.test(file)||file.startsWith('/')||file.split('/').some(part=>part==='..'))throw Error('unsafe-bundle-patch-path');const value=entries.find(entry=>entry.name==='package/'+file.replace(/^\.\//,''));if(!value)throw Error('bundle-patch-missing');return value.bytes.toString('utf8');});
    const footprint=inspectWslPatches(texts,manifest);
    return {version:manifest.version,sha256,integrity:sri,bytes,manifest,entries,footprint};
}
export function validateWslReference(reference){
    const runtime=reference?.runtimeGeneration;
    if(reference?.name!==WSL_NAME||reference.origin!==PUBLIC_REGISTRY||!isGenerationSupported(reference.manifest)||reference.version!==reference.manifest.version||!SHA.test(reference.sha256??'')||!SHA.test(reference.originalSha256??'')||!SRI.test(reference.integrity??'')||!/^[A-Za-z0-9-]+\/package\.tgz$/.test(reference.archiveKey??''))throw Error('identity-wsl-generation-invalid');
    if(runtime?.kind!==WSL_GENERATION_KIND||runtime.generation!=='g/'+reference.originalSha256.slice(0,12)||runtime.originalRuntimeBytesPreserved!==true||!SHA.test(runtime.rootOriginalSha256??'')||!SHA.test(runtime.originalProofSha256??''))throw Error('identity-wsl-generation-invalid');
    if(!Array.isArray(runtime.originals)||!runtime.originals.length||runtime.originals.length>WSL_MAX_ORIGINALS||!Array.isArray(runtime.retainedOriginalSha256)||!Array.isArray(runtime.moduleAliases)||runtime.moduleAliases.length>128||!Array.isArray(reference.rows)||reference.rows.length>24)throw Error('identity-wsl-generation-invalid');
    const hashes=new Set(),versions=new Set(),ids=new Set();
    for(const value of runtime.originals){if(!isGenerationSupported({name:WSL_NAME,version:value?.version})||!SHA.test(value.sha256??'')||!SRI.test(value.integrity??'')||hashes.has(value.sha256)||versions.has(value.version)||ids.has(value.sha256.slice(0,12)))throw Error('identity-wsl-originals-invalid');hashes.add(value.sha256);versions.add(value.version);ids.add(value.sha256.slice(0,12));}
    if(!runtime.originals.some(value=>value.version===reference.version&&value.sha256===reference.originalSha256&&value.integrity===reference.integrity)||!hashes.has(runtime.rootOriginalSha256)||canonical([...hashes].sort())!==canonical(runtime.retainedOriginalSha256))throw Error('identity-wsl-originals-invalid');
    for(const alias of runtime.moduleAliases)if(!Array.isArray(alias)||alias.length!==2||!alias[0]?.startsWith(WSL_NAME+'/')||!alias[1]?.startsWith(WSL_NAME+'/_g/'+reference.originalSha256.slice(0,12)+'/'))throw Error('identity-wsl-generation-invalid');
}
async function ordinaryDirectory(directory){const info=await lstat(directory);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(directory)!==resolve(directory))throw Error('wsl-original-directory-untrusted');}
function proofFor(staged,records,rootSha){return {schemaVersion:1,kind:WSL_GENERATION_KIND,sourceSha256:staged.originalSha256,rootOriginalSha256:rootSha,originals:records.map(({version,sha256,integrity})=>({version,sha256,integrity})).sort((a,b)=>a.sha256.localeCompare(b.sha256))};}
async function save(stager,staged,records,rootSha){
    if(!records.length||records.length>WSL_MAX_ORIGINALS)throw Error('wsl-retained-generation-limit');
    const directory=dirname(staged.archivePath);await ordinaryDirectory(directory);const originalsDir=join(directory,'wsl-originals');await mkdir(originalsDir,{recursive:true,mode:0o700});await ordinaryDirectory(originalsDir);
    const distinct=new Set(),versions=new Set(),ids=new Set();
    for(const record of records){if(distinct.has(record.sha256)||versions.has(record.version)||ids.has(record.sha256.slice(0,12)))throw Error('wsl-original-identity-conflict');distinct.add(record.sha256);versions.add(record.version);ids.add(record.sha256.slice(0,12));await writeFile(join(originalsDir,record.sha256+'.tgz'),record.bytes,{mode:0o600});}
    if(!distinct.has(rootSha)||!distinct.has(staged.originalSha256))throw Error('wsl-original-identity-mismatch');
    const proof=proofFor(staged,records,rootSha),proofBytes=Buffer.from(JSON.stringify(proof));await writeFile(join(directory,'wsl-originals.json'),proofBytes,{mode:0o600});
    const own=records.find(value=>value.sha256===staged.originalSha256),root=records.find(value=>value.sha256===rootSha);
    const transformed=generationArchive(own.bytes,{legacyOriginal:root.bytes,retainedOriginal:records.map(value=>value.bytes)});
    archiveEntries(transformed.bytes); // Retention/resource exhaustion refuses before any Host operation.
    await writeFile(staged.archivePath,transformed.bytes,{mode:0o600});staged.sha256=wslHash(transformed.bytes);staged.size=transformed.bytes.length;
    staged.runtimeGeneration={kind:WSL_GENERATION_KIND,generation:transformed.generation,moduleAliases:transformed.moduleAliases,originalRuntimeBytesPreserved:true,legacyRootResourcesPreserved:rootSha!==staged.originalSha256,rootOriginalSha256:rootSha,retainedOriginalSha256:[...distinct].sort(),originals:proof.originals,originalProofSha256:wslHash(proofBytes)};
    staged.integrity=own.integrity;
}
export async function annotateWslStage(stager,staged){const own=original(await boundedFile(staged.sourceArchivePath,MAX_ARCHIVE),{version:staged.version,sha256:staged.originalSha256});await save(stager,staged,[own],own.sha256);stager.verifiedWslOriginals.set(own.sha256,Buffer.from(own.bytes));}
export async function loadWslOriginals(stager,reference){
    validateWslReference(reference);const directory=dirname(archivePath(stager.root,reference.archiveKey));await ordinaryDirectory(directory);const originalsDir=join(directory,'wsl-originals');await ordinaryDirectory(originalsDir);
    const proofBytes=await boundedFile(join(directory,'wsl-originals.json'),64000);if(wslHash(proofBytes)!==reference.runtimeGeneration.originalProofSha256)throw Error('wsl-original-proof-changed');
    const proof=JSON.parse(proofBytes);if(canonical(proof)!==canonical({schemaVersion:1,kind:WSL_GENERATION_KIND,sourceSha256:reference.originalSha256,rootOriginalSha256:reference.runtimeGeneration.rootOriginalSha256,originals:reference.runtimeGeneration.originals}))throw Error('wsl-original-proof-changed');
    const records=[];for(const identity of reference.runtimeGeneration.originals){const bytes=await boundedFile(join(originalsDir,identity.sha256+'.tgz'),MAX_ARCHIVE);const record=original(bytes,identity);if(stager.compatibility(record.manifest))throw Error('staged-version-incompatible');records.push(record);}
    return records;
}
export async function verifyWslProofInventory(stager,sourcePath,reference,installed){
    const records=await loadWslOriginals(stager,reference),source=await boundedFile(sourcePath,MAX_ARCHIVE),own=records.find(value=>value.sha256===reference.originalSha256),root=records.find(value=>value.sha256===reference.runtimeGeneration.rootOriginalSha256);
    if(!own.bytes.equals(source))throw Error('verified-source-archive-changed');
    const transformed=generationArchive(source,{legacyOriginal:root.bytes,retainedOriginal:records.map(value=>value.bytes)}),expected=archiveEntries(transformed.bytes),deployed=new Map(archiveEntries(installed).map(value=>[value.name,value.bytes]));
    if(expected.length!==deployed.size||expected.some(value=>{const actual=deployed.get(value.name);return !actual||(value.name==='package/package.json'?canonical(JSON.parse(actual))!==canonical(JSON.parse(value.bytes)):!actual.equals(value.bytes));}))throw Error('retained-wsl-inventory-changed');
    if(canonical(transformed.moduleAliases)!==canonical(reference.runtimeGeneration.moduleAliases)||transformed.generation!==reference.runtimeGeneration.generation)throw Error('identity-generation-changed');
    return {rootOriginalSha256:root.sha256,retainedOriginalSha256:records.map(value=>value.sha256).sort()};
}
export async function preserveWslProofPair(stager,next,previous,deployedReference){
    const latest=original(await boundedFile(next.sourceArchivePath,MAX_ARCHIVE),{version:next.version,sha256:next.originalSha256}),old=original(await boundedFile(previous.sourceArchivePath,MAX_ARCHIVE),{version:previous.version,sha256:previous.originalSha256});
    const records=new Map([[latest.sha256,latest],[old.sha256,old]]);let root=old;
    if(deployedReference){
        const deployed=await stager.reopen(deployedReference),installed=await boundedFile(deployed.archivePath,128*1024*1024),entries=new Map(archiveEntries(installed).map(value=>[value.name,value.bytes]));
        if(structuralWsl(deployedReference)){for(const value of await loadWslOriginals(stager,deployedReference))records.set(value.sha256,value);root=records.get(deployedReference.runtimeGeneration.rootOriginalSha256);}
        else{
            const ids=new Set([...entries.keys()].filter(file=>file.startsWith('package/g/')).map(file=>file.split('/')[2]));
            for(const [version,digest]of Object.entries(WSL_LEGACY_ORIGINALS))if(ids.has(digest.slice(0,12))||version==='0.24.0'){if(!records.has(digest))records.set(digest,original(await stager.reviewedWslOriginal(version,digest),{version,sha256:digest}));}
            const manifest=JSON.parse(entries.get('package/package.json')),patches=new Set((Array.isArray(manifest.dsh.bundle.patch)?manifest.dsh.bundle.patch:[manifest.dsh.bundle.patch]).map(file=>'package/'+file.replace(/^\.\//,'')));
            root=[...records.values()].find(value=>value.entries.filter(entry=>entry.name!=='package/package.json'&&!patches.has(entry.name)).every(entry=>entries.get(entry.name)?.equals(entry.bytes)));
            if(!root)throw Error('wsl-root-generation-unverified');
        }
    }
    if(!root)throw Error('wsl-root-generation-unverified');
    for(const staged of [next,previous])await save(stager,staged,[...records.values()],root.sha256);
}
