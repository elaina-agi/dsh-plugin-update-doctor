import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RegistryStager, readPackedContents } from '../lib/staging.js';
import { archiveEntries } from '../lib/generation.js';

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
test('staging records existing-row overrides for the caller and still rejects corrupted bytes',async t=>{
    const dir=await mkdtemp(join(tmpdir(),'dsh-staging-bad-'));t.after(()=>rm(dir,{recursive:true,force:true}));
    const manifest={name:'sample',version:'1.1.0',dsh:{bundle:{patch:'cordis.patch.yml'}}};
    const bytes=tar([['package/package.json',JSON.stringify(manifest)],['package/cordis.patch.yml','- insert:\n    - id: sample-feature\n      name: sample\n- id: agent-loop\n  disabled: true\n']]);
    const dist={tarball:'https://registry.npmjs.org/sample/-/sample-1.1.0.tgz',integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')};
    const stager=new RegistryStager(dir,{fetcher:async url=>String(url).endsWith('.tgz')?new Response(bytes):Response.json({...manifest,dist})});
    // Staging only records the override; admitting a core rewire is the Doctor's comparison,
    // so this test must not read as a staging-level security decision.
    const staged=await stager.stage('sample','1.1.0');
    assert.deepEqual(staged.rows,[{id:'sample-feature',name:'sample'}]);
    assert.deepEqual(staged.overrides,[{id:'agent-loop',disabled:true}]);
    assert.deepEqual(stager.reference(staged).overrides,[{id:'agent-loop',disabled:true}]);
    const data=gzipSync(Buffer.from('not-tar'));assert.throws(()=>readPackedContents(data),/manifest/);
});

test('read-only inspections of immutable public archives are reused for later checks', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-staging-cache-')); t.after(() => rm(dir, { recursive: true, force: true }));
    const manifest = { name: 'sample', version: '1.1.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } };
    const bytes = tar([['package/package.json', JSON.stringify(manifest)], ['package/cordis.patch.yml', '- insert:\n    - id: sample-feature\n      name: sample\n']]);
    const dist = { tarball: 'https://registry.npmjs.org/sample/-/sample-1.1.0.tgz', integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
    let requests = 0;
    const stager = new RegistryStager(dir, { fetcher: async url => { requests++; return String(url).endsWith('.tgz') ? new Response(bytes) : Response.json({ ...manifest, dist }); } });
    const first = await stager.inspectPackage('sample', '1.1.0');
    const calls = requests;
    const second = await stager.inspectPackage('sample', '1.1.0');
    assert.equal(requests, calls + 1, 'a repeated read-only check revalidates metadata without downloading the archive again');
    assert.equal(second.originalSha256, first.originalSha256);
});

function tarWithType(entries) {
    const parts = [];
    for (const { name, body = '', type = '0' } of entries) {
        const content = Buffer.from(body), header = Buffer.alloc(512);
        header.write(name, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
        header.write(content.length.toString(8).padStart(11, '0') + '\0', 124); header.fill(32, 148, 156); header[156] = type.charCodeAt(0);
        header.write('ustar\0', 257); header.write('00', 263);
        header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
        parts.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
    }
    parts.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(parts));
}

test('PAX headers are skipped without weakening archive path and link safety', () => {
    const manifest = JSON.stringify({ name: 'sample', version: '1.1.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } });
    const safe = tarWithType([
        { name: 'PaxHeaders/sample/package.json', type: 'x', body: '30 mtime=1700000000.000000000\n' },
        { name: 'package/package.json', body: manifest },
        { name: 'package/cordis.patch.yml', body: '- insert:\n    - id: sample-feature\n      name: sample\n' },
    ]);
    const packed = readPackedContents(safe);
    assert.equal(packed.manifest.name, 'sample');
    assert(packed.files.has('package/cordis.patch.yml'));
    assert.deepEqual(archiveEntries(safe).map(entry => entry.name), ['package/package.json', 'package/cordis.patch.yml']);
    // The metadata skip must not admit traversal or links.
    const traversal = tarWithType([{ name: 'PaxHeaders/x', type: 'x', body: '30 path=../escape\n' }, { name: 'package/../escape.js', body: 'x' }]);
    assert.throws(() => archiveEntries(traversal), /unsafe-or-duplicate-archive-path/);
    const symlink = tarWithType([{ name: 'package/package.json', body: manifest }, { name: 'package/link', type: '2', body: 'target' }]);
    assert.throws(() => archiveEntries(symlink), /archive-links-or-extensions-unsupported/);
    assert.throws(() => readPackedContents(symlink), /archive-links-unsupported/);
});
