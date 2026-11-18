import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { archiveEntries, generationArchive } from '../lib/generation.js';

function tar(version, runtime){
 const manifest={name:'dsh-plugin-wsl-env',version,exports:{'.':'./lib/root.js','./index':'./lib/index.js','./package.json':'./package.json'},dsh:{bundle:{patch:'x.yml'}}};
 const entries=[['package/package.json',JSON.stringify(manifest)],['package/x.yml','- insert:\n    - id: wsl-root\n      name: dsh-plugin-wsl-env\n'],['package/lib/index.js',runtime],['package/lib/root.js','export function apply(){}'],['package/agent/resource',runtime]];
 const parts=[];for(const[name,body]of entries){const b=Buffer.from(body),h=Buffer.alloc(512);h.write(name,0,100);h.write('0000644\0',100,8);h.write(b.length.toString(8).padStart(11,'0')+'\0',124,12);h.fill(32,148,156);h[156]=48;h.write('ustar\0',257,6);h.write([...h].reduce((a,x)=>a+x,0).toString(8).padStart(6,'0')+'\0 ',148,8);parts.push(h,b,Buffer.alloc((512-b.length%512)%512));}parts.push(Buffer.alloc(1024));return gzipSync(Buffer.concat(parts));
}
test('rolling generation preserves old root resource bytes and retained export aliases',()=>{
 const old=tar('0.24.0','old-resource'),next=tar('0.26.2','new-resource');
 const rolling=generationArchive(next,{legacyOriginal:old,retainedOriginal:[old]});
 const entries=archiveEntries(rolling.bytes);const find=name=>entries.find(x=>x.name===name).bytes.toString();
 assert.equal(find('package/lib/index.js'),'old-resource');
 assert.equal(find('package/'+rolling.generation+'/lib/index.js'),'new-resource');
 assert.equal(find('package/agent/resource'),'old-resource');
 const oldId=createHash('sha256').update(old).digest('hex').slice(0,12);
 assert(rolling.manifest.exports['./_g/'+oldId+'/index']);
 const rollback=generationArchive(old,{legacyOriginal:old,retainedOriginal:[next]});
 const newId=createHash('sha256').update(next).digest('hex').slice(0,12);
 assert(rollback.manifest.exports['./_g/'+newId+'/index']);
 assert.equal(archiveEntries(rollback.bytes).find(x=>x.name==='package/g/'+newId+'/agent/resource').bytes.toString(),'new-resource');
});
