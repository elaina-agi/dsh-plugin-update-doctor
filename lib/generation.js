import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

const MAX_CONTENT = 128 * 1024 * 1024;
/** Strict ordinary-file TAR reader; never extracts or executes files. */
export function archiveEntries(compressed) {
    const data = gunzipSync(compressed, { maxOutputLength: MAX_CONTENT });
    const entries = []; const seen = new Set(); let offset = 0;
    while (offset + 512 <= data.length) {
        const header=data.subarray(offset,offset+512); if(header.every(byte=>byte===0))break;
        const checksumText=header.subarray(148,156).toString('ascii').replace(/\0/g,'').trim();
        const checksum=[...header].reduce((sum,byte,i)=>sum+(i>=148&&i<156?32:byte),0);
        if(!/^[0-7]+$/.test(checksumText)||parseInt(checksumText,8)!==checksum)throw Error('invalid-tar-checksum');
        const leaf=header.subarray(0,100).toString('utf8').split('\0')[0];
        const prefix=header.subarray(345,500).toString('utf8').split('\0')[0];
        const name=prefix?prefix+'/'+leaf:leaf;
        const sizeText=header.subarray(124,136).toString('ascii').replace(/\0/g,'').trim();
        if(!/^[0-7]+$/.test(sizeText))throw Error('invalid-tar-size');
        const size=parseInt(sizeText,8),type=header[156];
        // PAX / GNU long-name headers describe the next entry; skip their bodies.
        if([120,103,76,75].includes(type)){offset+=512+Math.ceil(size/512)*512;continue;}
        if(!name.startsWith('package/')||name.includes('\\')||name.startsWith('/')||name.split('/').some(part=>part==='..'||part==='.'||(!part&&part!==name.split('/').at(-1)))||seen.has(name))throw Error('unsafe-or-duplicate-archive-path');
        if(offset+512+size>data.length||size>MAX_CONTENT)throw Error('invalid-tar-range');
        if(![0,48,53].includes(type))throw Error('archive-links-or-extensions-unsupported');
        seen.add(name);
        if(type!==53)entries.push({name,bytes:Buffer.from(data.subarray(offset+512,offset+512+size)),mode:header.subarray(100,108).toString('ascii').replace(/\0/g,'').trim()||'644'});
        offset+=512+Math.ceil(size/512)*512;
        if(entries.length>2000)throw Error('archive-entry-limit');
    }
    return entries;
}
function pack(entries) {
    const parts=[];
    for(const entry of entries){
        const header=Buffer.alloc(512);let name=entry.name,prefix='';
        if(Buffer.byteLength(name)>100){let split=name.lastIndexOf('/');while(split>0&&(Buffer.byteLength(name.slice(split+1))>100||Buffer.byteLength(name.slice(0,split))>155))split=name.lastIndexOf('/',split-1);if(split<=0)throw Error('generation-path-too-long');prefix=name.slice(0,split);name=name.slice(split+1);}
        header.write(name,0,100);header.write(entry.mode.padStart(7,'0')+'\0',100,8);header.write('0000000\0',108,8);header.write('0000000\0',116,8);header.write(entry.bytes.length.toString(8).padStart(11,'0')+'\0',124,12);header.fill(32,148,156);header[156]=48;header.write('ustar\0',257,6);header.write('00',263,2);if(prefix)header.write(prefix,345,155);const checksum=[...header].reduce((a,b)=>a+b,0);header.write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8);parts.push(header,entry.bytes,Buffer.alloc((512-entry.bytes.length%512)%512));
    }
    parts.push(Buffer.alloc(1024));return gzipSync(Buffer.concat(parts));
}

/** Use a fresh module path without editing any original JS or asset byte. */
export function generationArchive(original, { legacyOriginal, retainedOriginal = [] } = {}) {
    const entries=archiveEntries(original), identity=createHash('sha256').update(original).digest('hex');
    const generation='g/'+identity.slice(0,12), metadata=entries.find(entry=>entry.name==='package/package.json');
    if(!metadata)throw Error('packed-manifest-missing');
    const manifest=JSON.parse(metadata.bytes.toString('utf8'));
    if(manifest.name!=='dsh-plugin-wsl-env')throw Error('generation-package-not-admitted');
    const rewrite=value=>typeof value==='string'&&value.startsWith('./')?'./'+generation+'/'+value.slice(2):Array.isArray(value)?value.map(rewrite):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewrite(item)])):value;
    const exports=Object.fromEntries(Object.entries(manifest.exports??{}).map(([key,value])=>[key,/locale|icon|package\.json/.test(key)?value:rewrite(value)]));
    const aliases=new Map();
    for(const[key,value]of Object.entries(manifest.exports??{})){
        if(/locale|icon|package\.json/.test(key))continue;
        const alias='./_g/'+identity.slice(0,12)+'/'+(key==='.'?'root':key.slice(2));exports[alias]=rewrite(value);
        if(key!=='.') aliases.set(manifest.name+key.slice(1),manifest.name+alias.slice(1));
        // Preserve the bare no-op Host anchor so DSH discovers the package's Client bundle.
    }
    const patchFiles=typeof manifest.dsh?.bundle?.patch==='string'?[manifest.dsh.bundle.patch]:manifest.dsh?.bundle?.patch;
    if(!Array.isArray(patchFiles)||patchFiles.length>8)throw Error('invalid-generation-patches');
    const changedPatches=new Map();
    for(const file of patchFiles){
        if(typeof file!=='string'||file.split('/').includes('..'))throw Error('unsafe-generation-patch');
        const entry=entries.find(item=>item.name==='package/'+file.replace(/^\.\//,''));if(!entry)throw Error('bundle-patch-missing');
        const text=entry.bytes.toString('utf8').replace(/(\bname:\s*)(['"]?)([^\s'"#]+)\2/g,(whole,before,quote,value)=>aliases.has(value)?before+quote+aliases.get(value)+quote:whole);
        changedPatches.set(entry.name,Buffer.from(text));
    }
    for(const retained of retainedOriginal){
        const retainedEntries=archiveEntries(retained);
        const retainedManifest=JSON.parse(retainedEntries.find(entry=>entry.name==='package/package.json').bytes.toString('utf8'));
        if(retainedManifest.name!==manifest.name)throw Error('foreign-retained-generation');
        const retainedId=createHash('sha256').update(retained).digest('hex').slice(0,12);
        const retainedRewrite=value=>typeof value==='string'&&value.startsWith('./')?'./g/'+retainedId+'/'+value.slice(2):Array.isArray(value)?value.map(retainedRewrite):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,retainedRewrite(item)])):value;
        for(const[key,value]of Object.entries(retainedManifest.exports??{}))if(!/locale|icon|package\.json/.test(key)){
            const alias='./_g/'+retainedId+'/'+(key==='.'?'root':key.slice(2));
            if(!Object.hasOwn(exports,alias))exports[alias]=retainedRewrite(value);
        }
    }
    const next={...manifest,exports,main:rewrite(manifest.main),types:rewrite(manifest.types)};
    const copied=entries.map(entry=>({...entry,name:'package/'+generation+'/'+entry.name.slice(8)}));
    const legacy=legacyOriginal ? archiveEntries(legacyOriginal) : entries;
    const legacyMap=new Map(legacy.map(entry=>[entry.name,entry]));
    const output=entries.map(entry=>entry.name==='package/package.json'?{...entry,bytes:Buffer.from(JSON.stringify(next,null,2))}:changedPatches.has(entry.name)?{...entry,bytes:changedPatches.get(entry.name)}:legacyMap.get(entry.name)??entry).concat(copied);
    // Preserve root paths used by already-cached old modules and immutable resources
    // from earlier generations. Metadata/patch describe the new declaration only.
    const outputNames=new Set(output.map(entry=>entry.name));
    for(const entry of legacy) if(!outputNames.has(entry.name)){output.push(entry);outputNames.add(entry.name);}
    for(const retained of retainedOriginal){
        const retainedId=createHash('sha256').update(retained).digest('hex').slice(0,12);
        for(const entry of archiveEntries(retained)){
            const name='package/g/'+retainedId+'/'+entry.name.slice(8);
            if(!outputNames.has(name)){output.push({...entry,name});outputNames.add(name);}
        }
    }
    const preserved=entries.filter(entry=>entry.name!=='package/package.json'&&!changedPatches.has(entry.name)).every(entry=>copied.find(item=>item.name==='package/'+generation+'/'+entry.name.slice(8))?.bytes.equals(entry.bytes));
    if(!preserved)throw Error('generation-runtime-content-changed');
    return {bytes:pack(output),manifest:next,generation,originalSha256:identity,moduleAliases:[...aliases.entries()],changedPatchFiles:[...changedPatches.keys()],preservedOriginalRuntimeBytes:preserved,legacyRootResourcesPreserved:!!legacyOriginal};
}
