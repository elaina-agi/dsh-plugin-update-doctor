import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RegistryStager, readPackedContents } from '../lib/staging.js';

function tar(entries) {
    const parts=[];
    for (const [name,body] of entries) {
        const content=Buffer.from(body), header=Buffer.alloc(512);
        header.write(name,0,100,'utf8'); header.write('0000644\0',100,8,'ascii');
        header.write('0000000\0',108,8,'ascii'); header.write('0000000\0',116,8,'ascii');
        header.write(content.length.toString(8).padStart(11,'0')+'\0',124,12,'ascii');
        header.fill(32,148,156);header[156]=48;header.write('ustar\0',257,6,'ascii');
        const sum=[...header].reduce((a,b)=>a+b,0);header.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
        parts.push(header,content,Buffer.alloc((512-content.length%512)%512));
    }
    parts.push(Buffer.alloc(1024));return gzipSync(Buffer.concat(parts));
}
test('stages verified archive bytes and its actual static patch before execution',async t=>{
    const dir=await mkdtemp(join(tmpdir(),'dsh-staging-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
    const manifest={name:'sample',version:'1.1.0',dsh:{bundle:{patch:'cordis.patch.yml'}}};
    const bytes=tar([['package/package.json',JSON.stringify(manifest)],['package/cordis.patch.yml','- insert:\n    - id: sample-feature\n      name: sample\n']]);
    const dist={tarball:'https://registry.npmjs.org/sample/-/sample-1.1.0.tgz',integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')};
    const stager=new RegistryStager(dir,{fetcher:async url=>String(url).endsWith('.tgz')?new Response(bytes):Response.json({...manifest,dist})});
    const staged=await stager.stage('sample','1.1.0');assert.equal(staged.rows[0].id,'sample-feature');await stager.verify(staged);
});
test('staging rejects corrupted bytes and core overrides before installed state changes',async t=>{
    const dir=await mkdtemp(join(tmpdir(),'dsh-staging-bad-'));t.after(()=>rm(dir,{recursive:true,force:true}));
    const manifest={name:'sample',version:'1.1.0',dsh:{bundle:{patch:'cordis.patch.yml'}}};
    const bytes=tar([['package/package.json',JSON.stringify(manifest)],['package/cordis.patch.yml','- id: agent-loop\n  disabled: true\n']]);
    const dist={tarball:'https://registry.npmjs.org/sample/-/sample-1.1.0.tgz',integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')};
    const stager=new RegistryStager(dir,{fetcher:async url=>String(url).endsWith('.tgz')?new Response(bytes):Response.json({...manifest,dist})});
    await assert.rejects(()=>stager.stage('sample','1.1.0'),/override/);
    const data=gzipSync(Buffer.from('not-tar'));assert.throws(()=>readPackedContents(data),/manifest/);
});
