import { parseDocument } from 'yaml';
import { createHash } from 'node:crypto';

export const WSL_NAME = 'dsh-plugin-wsl-env';
export const WSL_GENERATION_KIND = 'wsl-structural-v1';
export const WSL_LEGACY_ORIGINALS = Object.freeze({
    '0.24.0':'1d03208d3e58596d155b052c8a0e9eab7a539ac45def89ad53052fa1746104b7',
    '0.26.2':'0761e085453faa1b32ef8b44e8099bc938b62662b11b74e23f7946f4ef75fe98',
    '0.28.0':'c137376aba2b3973690ecef93baed9e4de79a22825ab5a50e92ae9ad2881e694',
});
// Legacy whole-patch digest of 0.29.0. Kept for earlier schema-1 records only.
export const WSL_PATCH_CONTRACT = '5aa75e4ace76675fefbd26fb59aedf076cd06957e615685057afd9a1815fc183';
export const wslCanonical = value => Array.isArray(value) ? value.map(wslCanonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,wslCanonical(value[key])])) : value;
export const wslHash = bytes => createHash('sha256').update(bytes).digest('hex');
// Row and override order is presentation, not structure: record the sets by id as evidence.
const structureOf = declarations => wslCanonical(declarations.map(entry => entry.insert
    ? { insert: entry.insert.map(row => ({ id: row.id, name: row.name })).sort((a, b) => a.id.localeCompare(b.id)) }
    : { override: { id: entry.id, disabled: entry.disabled === true } })
    .sort((a, b) => (a.insert ? a.insert[0].id : a.override.id).localeCompare(b.insert ? b.insert[0].id : b.override.id)));
/** A route candidate, not installation permission. Original archive/contract checks remain mandatory. */
export function isGenerationSupported(manifest) {
    return manifest?.name === WSL_NAME && /^\d+\.\d+\.\d+$/.test(manifest.version??'')
        && manifest.version.split('.').map(Number).every(Number.isSafeInteger);
}
export function isLegacyWsl(manifest) { return manifest?.name===WSL_NAME && Object.hasOwn(WSL_LEGACY_ORIGINALS,manifest.version??''); }
const WSL_MODULE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/;
const WSL_RANGE = /^[\d\s.~^<>=*|+a-zA-Z-]+$/;
const WSL_NATIVE_ASSET = /^agent\/native\/[^/]+\/dsh-wsl-agent$/;
/** Validate a modern published archive without executing plugin, YAML expressions or native assets. */
export function inspectWslArchivePolicy(manifest, entries) {
    if(!isGenerationSupported(manifest))throw Error('wsl-version-format-unsupported');
    if(isLegacyWsl(manifest))return {kind:'legacy-reviewed-original'};
    if(manifest.type!=='module'||Object.keys(manifest.dependencies??{}).length||Object.keys(manifest.optionalDependencies??{}).length)throw Error('wsl-runtime-dependency-contract-changed');
    for(const key of ['bin','gypfile','imports','workspaces','overrides','resolutions','pnpm','bundledDependencies','bundleDependencies'])if(manifest[key]!=null&&manifest[key]!==false)throw Error('wsl-package-resolution-contract-changed');
    for(const key of ['preinstall','install','postinstall','prepare','prepack','postpack'])if(manifest.scripts?.[key])throw Error('package-install-scripts-require-separate-review');
    const client=manifest.dsh?.client;
    if(!client||client.platform!=='web'||typeof client.immediately!=='boolean'||!Array.isArray(client.inject)||!client.inject.length||client.inject.length>64
        ||client.inject.some(value=>typeof value!=='string'||value.length>128||!WSL_MODULE.test(value)))throw Error('wsl-client-contract-changed');
    const peers=manifest.peerDependencies??{};
    if(typeof peers!=='object'||Array.isArray(peers)||Object.keys(peers).length>64)throw Error('wsl-peer-contract-changed');
    for(const [key,value] of Object.entries(peers))if(!WSL_MODULE.test(key)||typeof value!=='string'||value.length>128||!WSL_RANGE.test(value))throw Error('wsl-peer-contract-changed');
    const files=new Map(),directoryCases=new Map();
    for(const entry of entries){
        const file=entry.name.slice(8),parts=file.split('/');
        if(!entry.name.startsWith('package/')||parts.some(part=>!part||part==='.'||part==='..'||/[<>:"\\|?*\x00-\x1f]/.test(part)||/[. ]$/.test(part)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw Error('wsl-archive-path-unsupported');
        const lower=file.toLowerCase();if(files.has(lower))throw Error('wsl-archive-case-collision');files.set(lower,entry);
        for(let depth=1;depth<parts.length;depth++){const dir=parts.slice(0,depth).join('/'),key=dir.toLowerCase();if(directoryCases.has(key)&&directoryCases.get(key)!==dir)throw Error('wsl-archive-case-collision');directoryCases.set(key,dir);}
        const native=/\.(?:node|dll|exe|so|dylib)$/i.test(file)||file.includes('/native/')||entry.bytes.subarray(0,4).equals(Buffer.from([127,69,76,70]))||entry.bytes.subarray(0,2).toString('ascii')==='MZ';
        if(native&&!WSL_NATIVE_ASSET.test(file))throw Error('wsl-native-resource-contract-changed');
    }
    for(const file of files.keys()){const parts=file.split('/');for(let depth=1;depth<parts.length;depth++)if(files.has(parts.slice(0,depth).join('/')))throw Error('wsl-archive-prefix-collision');}
    const exported=manifest.exports;if(!exported||typeof exported!=='object'||Array.isArray(exported)||Object.keys(exported).length>128)throw Error('wsl-export-contract-changed');
    const target=(value,depth=0)=>{if(depth>4)throw Error('wsl-export-contract-changed');if(typeof value==='string'){if(!value.startsWith('./')||value.includes('\\')||value.slice(2).split('/').some(part=>!part||part==='.'||part==='..')||!files.has(value.slice(2).toLowerCase()))throw Error('wsl-export-contract-changed');return;}if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['default','types'].includes(key)))throw Error('wsl-export-contract-changed');for(const item of Object.values(value))target(item,depth+1);};
    for(const [key,value]of Object.entries(exported)){if(key!=='.'&&(!key.startsWith('./')||key.includes('*')||key.startsWith('./_g/')||key.startsWith('./g/')))throw Error('wsl-export-contract-changed');target(value);}
    return {kind:'published-structure-contract',patchContract:WSL_PATCH_CONTRACT};
}
/** Parse WSL's declarative footprint without executing !!js configuration expressions.
 * Inserted rows, the resulting structure digest and declared `!!js` values are recorded as evidence.
 * Base-provider suppressions and the terminal override stay protected because dropping them makes
 * the Host register duplicate services; everything else is verified after installation.
 */
export function inspectWslPatches(texts, manifest) {
    if (!isGenerationSupported(manifest)) throw new Error('wsl-version-format-unsupported');
    const rows=[]; const overrides=[]; const ids=new Set(); const declarations=[];
    const required = new Map([['subprocess',true],['directory-picker',true],['fs-sandbox',true],['tool-working-directory',true]]);
    for(const text of texts){
        if(typeof text!=='string'||Buffer.byteLength(text)>256_000)throw new Error('wsl-patch-size-limit');
        const doc=parseDocument(text,{uniqueKeys:true,maxAliasCount:0,customTags:[{tag:'tag:yaml.org,2002:js',resolve:value=>({__declarativeJs:value})}]});
        if(doc.errors.length || doc.warnings.length)throw new Error('wsl-patch-parse-failed');
        const entries=doc.toJS({maxAliasCount:0});if(!Array.isArray(entries))throw new Error('invalid-wsl-patch');declarations.push(...entries);
        for(const entry of entries){
            if(entry.insert){
                if(Object.keys(entry).some(key=>key!=='insert')||!Array.isArray(entry.insert))throw new Error('wsl-nested-patch-unsupported');
                for(const row of entry.insert){
                    if(typeof row.id!=='string'||ids.has(row.id)||typeof row.name!=='string')throw new Error('invalid-wsl-row');
                    if(row.name!=='dsh-plugin-wsl-env' && !row.name.startsWith('dsh-plugin-wsl-env/') && !['@deepseek-ai/dsh-agent-preset','@deepseek-ai/dsh-client-ui-directory-picker-browse'].includes(row.name))throw new Error('foreign-wsl-row');
                    if(['hmr','plugin-manager','plugin-update-doctor','agent-loop','session','storage'].includes(row.id))throw new Error('protected-wsl-row');
                    ids.add(row.id);rows.push({id:row.id,name:row.name});
                }
            }else{
                if(required.has(entry.id)){
                    if(entry.disabled!==true||Object.keys(entry).some(key=>!['id','disabled'].includes(key)))throw new Error('changed-wsl-provider-suppression');
                    required.delete(entry.id);
                }else if(entry.id==='terminal-controller'){
                    if(entry.name!=='@deepseek-ai/dsh-api-terminal-controller'||entry.config?.shell?.path!=='wsl.exe')throw new Error('changed-wsl-terminal-footprint');
                }else throw new Error('unexpected-wsl-core-override');
                overrides.push(entry.id);
            }
        }
    }
    if(required.size||!rows.length||rows.length>64)throw new Error('incomplete-wsl-footprint');
    return {rows,overrides,contractDigest:wslHash(JSON.stringify(structureOf(declarations)))};
}
