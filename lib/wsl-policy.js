import { parseDocument } from 'yaml';

export function isGenerationSupported(manifest) {
    return manifest?.name === 'dsh-plugin-wsl-env' && ['0.24.0','0.26.2'].includes(manifest.version);
}
/** Parse WSL's known declarative footprint without executing !!js configuration expressions. */
export function inspectWslPatches(texts, manifest) {
    if (!isGenerationSupported(manifest)) throw new Error('wsl-version-not-yet-verified');
    const rows=[]; const overrides=[]; const ids=new Set();
    const required = new Map([['subprocess',true],['directory-picker',true],['fs-sandbox',true],['tool-working-directory',true]]);
    for(const text of texts){
        if(typeof text!=='string'||Buffer.byteLength(text)>256_000)throw new Error('wsl-patch-size-limit');
        const doc=parseDocument(text,{uniqueKeys:true,maxAliasCount:0,customTags:[{tag:'tag:yaml.org,2002:js',resolve:value=>({__declarativeJs:value})}]});
        if(doc.errors.length || doc.warnings.length)throw new Error('wsl-patch-parse-failed');
        const entries=doc.toJS({maxAliasCount:0});if(!Array.isArray(entries))throw new Error('invalid-wsl-patch');
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
    if(required.size||rows.length<10||rows.length>24)throw new Error('incomplete-wsl-footprint');
    return {rows,overrides};
}
