import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { generationArchive, archiveEntries } from '../lib/generation.js';
import { isGenerationSupported } from '../lib/wsl-policy.js';

function tar(entries) {
 const parts=[];for(const[name,body]of entries){const bytes=Buffer.from(body),h=Buffer.alloc(512);h.write(name,0,100);h.write('0000644\0',100,8);h.write(bytes.length.toString(8).padStart(11,'0')+'\0',124,12);h.fill(32,148,156);h[156]=48;h.write('ustar\0',257,6);h.write([...h].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148,8);parts.push(h,bytes,Buffer.alloc((512-bytes.length%512)%512));}parts.push(Buffer.alloc(1024));return gzipSync(Buffer.concat(parts));
}
test('generational repack preserves runtime bytes and bare browser anchor',()=>{
 const manifest={name:'dsh-plugin-wsl-env',version:'0.26.2',main:'./lib/client-host.js',exports:{'.':'./lib/client-host.js','./status':'./lib/status.js','./client':'./client.js','./package.json':'./package.json'},dsh:{bundle:{patch:'cordis.patch.yml'}}};
 const original=tar([['package/package.json',JSON.stringify(manifest)],['package/cordis.patch.yml',"- insert:\n    - id: wsl-env-client-host\n      name: dsh-plugin-wsl-env\n    - id: wsl-status\n      name: dsh-plugin-wsl-env/status\n"],['package/lib/status.js','export const name="status";'],['package/lib/client-host.js','export function apply(){}'],['package/client.js','// browser code']]);
 const result=generationArchive(original);assert.equal(result.preservedOriginalRuntimeBytes,true);assert(!result.moduleAliases.some(([name])=>name==='dsh-plugin-wsl-env'));
 const entries=archiveEntries(result.bytes);const patch=entries.find(x=>x.name==='package/cordis.patch.yml').bytes.toString();
 assert(patch.includes('name: dsh-plugin-wsl-env\n'));assert(patch.includes('dsh-plugin-wsl-env/_g/'));
 assert.equal(entries.find(x=>x.name==='package/lib/status.js').bytes.toString(),'export const name="status";');
 assert.equal(entries.find(x=>x.name==='package/'+result.generation+'/lib/status.js').bytes.toString(),'export const name="status";');
 assert.equal(isGenerationSupported(manifest),true);assert.equal(isGenerationSupported({...manifest,version:'99.0.0'}),false);
});
