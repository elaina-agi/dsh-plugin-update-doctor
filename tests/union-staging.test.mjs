import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath, stat, symlink } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { UNION_LIMITS, UNION_RELEASE_HASHES, unionHash, unionDigest, inspectUnionArchive,
    packUnionArchive, safeWinArchivePath, unionRangeMatches, unionDependencySnapshot,
    verifyUnionPublicSnapshot, unionSnapshotEvidence, validateUnionEvidence,
    buildUnionGeneration, unionManifest, verifyUnionInstalledEntries, assertUnionDependencyPolicy } from '../lib/union-generation.js';
import { UnionGenerationStager, validateUnionReference } from '../lib/union-staging.js';
import { RegistryStager } from '../lib/staging.js';
import { canInspectIsolatedPair, needsDependencyIsolation, inspectIsolatedRoot, requireIsolatedTransition } from '../lib/dependency-generation-policy.js';
import { PUBLIC_REGISTRY } from '../lib/source.js';

const bytes=value=>Buffer.from(typeof value==='string'?value:JSON.stringify(value));
const file=(name,value)=>({name:'package/'+name,bytes:bytes(value),mode:'644'});
const rootManifest=(version='0.10.24',dependencies={})=>({name:'dsh-union-search',version,type:'module',main:'lib/index.js',
    exports:{'.':'./lib/index.js','./client':'./client.js','./locale/*.json':'./locale/*.json','./icon':'./icon.svg','./package.json':'./package.json'},
    dependencies,dsh:{bundle:{patch:'./cordis.patch.yml'}}});
const source=(version='0.10.24',dependencies={})=>packUnionArchive([file('package.json',rootManifest(version,dependencies)),
    file('lib/index.js','export const fixture = true;\n'),file('client.js','export const fixtureClient = true;\n'),
    file('cordis.patch.yml','- id: fixture-union\n  name: dsh-union-search\n'),file('icon.svg','<svg/>'),file('locale/en.json',{})]);
const sri=value=>'sha512-'+createHash('sha512').update(value).digest('base64');
const emptySnapshot=()=>({manifest:rootManifest(),packages:[],unique:[],top:[],edges:[],portableFiles:[],layout:[],
    layoutDigest:unionDigest({top:[],layout:[],files:[]}),fileCount:0,totalBytes:0,externalShared:['@deepseek-ai/schemastery']});
async function fixture(t) {
    const temp=await realpath(tmpdir()),root=await mkdtemp(join(temp,'dsh-union-staging-unit-'));
    t.after(async()=> {const actual=await realpath(root);assert.equal(actual,resolve(root));assert.equal(dirname(actual),temp);
        assert(actual.split(/[\\/]/).at(-1).startsWith('dsh-union-staging-unit-'));await rm(actual,{recursive:true,force:true});});
    return root;
}
async function installEntries(entries,directory) {
    await mkdir(directory,{recursive:true});for(const entry of entries) {const path=join(directory,...entry.name.slice(8).split('/'));
        await mkdir(dirname(path),{recursive:true});await writeFile(path,entry.bytes);}
}
async function installPackage(base,name,manifest,files={}) {
    const directory=join(base,'node_modules',...name.split('/'));await mkdir(directory,{recursive:true});
    const entries=[file('package.json',{name,...manifest}),...Object.entries(files).map(([name,value])=>file(name,value))];
    await installEntries(entries,directory);return {directory,entries,archive:packUnionArchive(entries)};
}
function mockedPublic(records,mutate=()=>{}) {
    const calls=[];const fetcher=async(url,options)=> {
        const target=new URL(url);assert.equal(target.origin,PUBLIC_REGISTRY);assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
        options.signal.throwIfAborted();calls.push(target.href);
        for(const record of records) {
            const name=record.name,version=record.version,archiveURL=PUBLIC_REGISTRY+'/'+name+'/-/'+name.split('/').at(-1)+'-'+version+'.tgz';
            if(target.href===PUBLIC_REGISTRY+'/'+encodeURIComponent(name)+'/'+version) {
                const metadata={name,version,dist:{tarball:archiveURL,integrity:sri(record.archive)}};mutate(metadata,record);
                return new Response(JSON.stringify(metadata));
            }
            if(target.href===archiveURL)return new Response(record.archive);
        }
        throw Error('unexpected-owned-public-fixture-request');
    };return {fetcher,calls};
}
function rawTar(name,{type=48,size=0,contents=Buffer.alloc(size),prefix='',checksum=true,ending=1024,padding=true}={}) {
    const h=Buffer.alloc(512);h.write(name,0,100);h.write('0000644\0',100);h.write(size.toString(8).padStart(11,'0')+'\0',124);
    h.fill(32,148,156);h[156]=type;h.write('ustar\0',257);h.write('00',263);h.write(prefix,345,155);
    h.write([...h].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);
    if(!checksum)h[0]^=1;
    return gzipSync(Buffer.concat([h,contents,Buffer.alloc(padding?(512-size%512)%512:0),Buffer.alloc(ending)]));
}
function validReference() {
    const stageKey='11111111-1111-4111-8111-111111111111',sha='a'.repeat(64);
    return {name:'dsh-union-search',version:'0.10.24',origin:PUBLIC_REGISTRY,originalRegistry:PUBLIC_REGISTRY,installMode:'union-generation',
        archiveKey:stageKey+'/package.tgz',sha256:sha,originalSha256:UNION_RELEASE_HASHES['0.10.24'],integrity:sri(bytes('owned-ref-fixture')),
        manifest:rootManifest(),rows:[{id:'fixture-union',name:'dsh-union-search'}],overrides:[],
        runtimeGeneration:{kind:'union-dependency',source:'derived-local-generation-not-npm',generation:'g/'+'1'.repeat(32),moduleAliases:[],
            originalRuntimeBytesPreserved:true,legacyRootResourcesPreserved:true,stageKey,evidenceKey:stageKey+'/union-evidence.json',evidenceSha256:sha,
            rootOriginalVersion:'0.10.24',rootOriginalSha256:UNION_RELEASE_HASHES['0.10.24'],retained:[],inventoryDigest:sha,layoutDigest:sha,
            dependencyEvidence:{digest:sha,publicProofDigest:sha,topDigest:sha,layoutDigest:sha,packageCount:0,fileCount:0}}};
}

test('independent reader accepts 2,249 files and ustar prefix beyond ordinary reader cap',()=> {
    const entries=Array.from({length:2249},(_,i)=>file('owned-fixture/'+i+'.txt','fixture '+i));
    entries.push(file('long/'.repeat(25)+'file.txt','long owned path'));
    const archive=packUnionArchive(entries),read=inspectUnionArchive(archive);
    assert.equal(read.length,2250);assert(read.every((entry,i)=>entry.bytes.equals(entries[i].bytes)));
});

test('Windows names, case collisions, file/directory prefixes and native payloads are rejected',()=> {
    for(const name of ['../outside','package/../outside','package/a\\b','package/NUL.txt','package/COM1.js','package/a.','package/a ',
        'package/a:b','package//a','package/./a','package/a\x00b','package/'+('a'.repeat(256))])
        assert.throws(()=>safeWinArchivePath(name),/union-unsafe-archive-path/);
    for(const entries of [[file('a','1'),file('A','2')],[file('a','1'),file('a/b','2')],[file('a/b','1'),file('a','2')]])
        assert.throws(()=>packUnionArchive(entries),/union-(duplicate-archive-path|prefix-collision)/);
    for(const name of ['a.node','a.dll','a.exe','a.so','a.dylib','binding.gyp'])assert.throws(()=>packUnionArchive([file(name,'x')]),/union-native-resource/);
});

test('reader checks checksum, terminator, padding, sizes, symlinks and extended headers',()=> {
    assert.throws(()=>inspectUnionArchive(rawTar('package/a',{checksum:false})),/union-invalid-tar-checksum/);
    assert.throws(()=>inspectUnionArchive(rawTar('package/a',{ending:512})),/union-invalid-tar-terminator/);
    assert.throws(()=>inspectUnionArchive(rawTar('package/a',{size:1,contents:bytes('x'),padding:false})),/union-archive-bound/);
    for(const type of [49,50,76,75,120,103])assert.throws(()=>inspectUnionArchive(rawTar('package/a',{type})),/union-archive-links-or-extensions/);
    assert.throws(()=>inspectUnionArchive(rawTar('package/a',{size:UNION_LIMITS.file+1,contents:Buffer.alloc(0),padding:false})),/union-invalid-tar-range/);
    assert.throws(()=>inspectUnionArchive(rawTar('a',{prefix:'package/..'})),/union-unsafe-archive-path/);
    const invalid=gunzipSync(rawTar('package/a',{size:1,contents:bytes('x')}));invalid[513]=1;
    assert.throws(()=>inspectUnionArchive(gzipSync(invalid)),/union-invalid-tar-padding/);
    assert.throws(()=>inspectUnionArchive(Buffer.alloc(UNION_LIMITS.compressed+1)),/union-compressed-bound/);
    assert.throws(()=>packUnionArchive(Array.from({length:UNION_LIMITS.files+1},()=>file('a','x'))),/union-archive-file-bound/);
});

test('range grammar admits reviewed stable ranges and refuses sources/unsupported syntax',()=> {
    for(const range of ['^1.2.3','~1.2.0','>=1.0.0 <2.0.0','1.2.*','1.2','*','^0.9.0 || ^1.2.0'])assert(unionRangeMatches('1.2.3',range),range);
    for(const range of ['^2.0.0','file:../a','https://example.org/x','npm:a@1','workspace:*','1.2.3-beta','^1','1.2.x','1.2.0 - 1.3.0','garbage'])
        assert.equal(unionRangeMatches('1.2.3',range),false,range);
    assert(unionRangeMatches('0.2.2','^0.2.0'));assert(!unionRangeMatches('0.3.0','^0.2.0'));
});

test('dependency policy rejects lifecycle/native/alternate sources and Host copies',()=> {
    const base={name:'owned-dep',version:'1.0.0'};
    for(const patch of [{scripts:{install:'x'}},{scripts:{preinstall:'x'}},{scripts:{postinstall:'x'}},{gypfile:true},
        {optionalDependencies:{a:'1.0.0'}},{dependencies:{a:'file:../a'}},{dependencies:{'@deepseek-ai/dsh-core':'1.0.0'}},
        {dependencies:{react:'1.0.0'}},{bundledDependencies:['a']}])assert.throws(()=>assertUnionDependencyPolicy({...base,...patch}),/union-/);
    assert.doesNotThrow(()=>assertUnionDependencyPolicy({...base,scripts:{prepare:'build-publication-only'}}));
    assert.throws(()=>assertUnionDependencyPolicy({...base,scripts:{prepare:'x'}},{root:true}),/union-lifecycle-script/);
});

test('public exact closure proofs include every physical copy, bind root/top/layout, and preserve JS bytes',async t=> {
    const root=await fixture(t),manifest=rootManifest('0.10.24',{'owned-a':'^1.0.0','@deepseek-ai/schemastery':'^1.0.0'});
    await installEntries(inspectUnionArchive(source('0.10.24',manifest.dependencies)),root);
    const a=await installPackage(root,'owned-a',{version:'1.0.0',dependencies:{'owned-b':'1.0.0'}},{'index.js':'module.exports="a";'});
    const b=await installPackage(root,'owned-b',{version:'1.0.0'},{'index.js':'module.exports="b";','resource.txt':'complete resource'});
    const snapshot=await unionDependencySnapshot(root,manifest),mock=mockedPublic([{name:'owned-a',version:'1.0.0',...a},{name:'owned-b',version:'1.0.0',...b}]);
    assert.equal(snapshot.packages.length,2);assert.equal(snapshot.fileCount,5);assert.equal(snapshot.top[1].external,undefined);
    assert(snapshot.top.some(e=>e.name==='@deepseek-ai/schemastery'&&e.external));
    const proof=await verifyUnionPublicSnapshot(snapshot,{fetcher:mock.fetcher});assert.equal(mock.calls.length,4);
    const evidence=unionSnapshotEvidence(snapshot,proof);validateUnionEvidence(evidence);
    assert(!JSON.stringify(evidence).includes(root));assert(!JSON.stringify(evidence).includes('module.exports'));
    for(const mutate of [e=>e.graph.top[1].target='owned-b@1.0.0',e=>e.graph.packages[0].files.pop(),e=>e.graph.layout[0].path+='-changed',
        e=>e.proof.packages[0].integrity=sri(bytes('changed')),e=>e.portableInventory.pop()]) {
        const changed=structuredClone(evidence);mutate(changed);assert.throws(()=>validateUnionEvidence(changed),/union-/);
    }
    const oldArchive=source('0.10.24',manifest.dependencies),targetArchive=source('0.10.25',manifest.dependencies);
    const next=buildUnionGeneration(targetArchive,snapshot,{rootBytes:oldArchive,generation:'g/'+'a'.repeat(32)});
    const nextEntries=inspectUnionArchive(next.bytes);assert(nextEntries.some(e=>e.name==='package/'+next.generation+'/node_modules/owned-b/resource.txt'));
    const original=inspectUnionArchive(targetArchive);
    for(const entry of original)assert(nextEntries.find(e=>e.name==='package/'+next.generation+'/'+entry.name.slice(8)).bytes.equals(entry.bytes));
    assert(nextEntries.find(e=>e.name==='package/lib/index.js').bytes.equals(original.find(e=>e.name==='package/lib/index.js').bytes));
    const recovery=buildUnionGeneration(oldArchive,snapshot,{rootBytes:oldArchive,generation:'g/'+'b'.repeat(32),
        retained:[{generation:next.generation,entries:nextEntries.filter(e=>e.name.startsWith('package/'+next.generation+'/'))}]});
    assert.notEqual(recovery.generation,next.generation);
    const recovered=inspectUnionArchive(recovery.bytes);assert(recovered.some(e=>e.name==='package/'+next.generation+'/node_modules/owned-b/resource.txt'));
    const routed=unionManifest(recovered);assert.equal(routed.exports['.'],'./'+recovery.generation+'/lib/index.js');
    assert.equal(routed.exports['./icon'],'./icon.svg');assert.equal(routed.main,recovery.generation+'/lib/index.js');
    assert(!recovered.some(e=>e.name.includes('node_modules/@deepseek-ai/schemastery')));
});

test('public metadata, SRI and complete installed/public inventory cannot be bypassed',async t=> {
    const root=await fixture(t),manifest=rootManifest('0.10.24',{'owned-a':'1.0.0'});await writeFile(join(root,'package.json'),bytes(manifest));
    const a=await installPackage(root,'owned-a',{version:'1.0.0'},{'index.js':'original'}),snapshot=await unionDependencySnapshot(root,manifest);
    for(const mutate of [m=>m.dist.tarball='https://private.example/a.tgz',m=>m.dist.integrity=sri(bytes('changed')),m=>m.version='2.0.0']) {
        const mock=mockedPublic([{name:'owned-a',version:'1.0.0',...a}],mutate);
        await assert.rejects(verifyUnionPublicSnapshot(snapshot,{fetcher:mock.fetcher}),/union-public-/);
    }
    const extraArchive=packUnionArchive([...a.entries,file('missing-locally.txt','public extra')]);
    await assert.rejects(verifyUnionPublicSnapshot(snapshot,{fetcher:mockedPublic([{name:'owned-a',version:'1.0.0',archive:extraArchive}]).fetcher}),/union-public-exact-inventory/);
    await writeFile(join(a.directory,'index.js'),'tampered');const altered=await unionDependencySnapshot(root,manifest);
    await assert.rejects(verifyUnionPublicSnapshot(altered,{fetcher:mockedPublic([{name:'owned-a',version:'1.0.0',...a}]).fetcher}),/union-public-exact-inventory/);
});

test('same name/version different physical bytes and different resolved edges are both refused',async t=> {
    const root=await fixture(t),manifest=rootManifest('0.10.24',{'owned-a':'1.0.0','owned-b':'1.0.0'});await writeFile(join(root,'package.json'),bytes(manifest));
    const a=await installPackage(root,'owned-a',{version:'1.0.0',dependencies:{'owned-c':'1.0.0'}},{'index.js':'a'});
    const b=await installPackage(root,'owned-b',{version:'1.0.0',dependencies:{'owned-c':'1.0.0'}},{'index.js':'b'});
    await installPackage(a.directory,'owned-c',{version:'1.0.0'},{'index.js':'first'});
    const c=await installPackage(b.directory,'owned-c',{version:'1.0.0'},{'index.js':'different'});
    await assert.rejects(unionDependencySnapshot(root,manifest),/union-same-version-bytes-or-edges/);
    await writeFile(join(c.directory,'index.js'),'first');assert.equal((await unionDependencySnapshot(root,manifest)).unique.length,3);
    // Keep both c package bytes identical, but resolve their identical dependency
    // declarations to genuinely different physical versions.
    const cManifest={name:'owned-c',version:'1.0.0',dependencies:{'owned-d':'^1.0.0'}};
    await writeFile(join(a.directory,'node_modules','owned-c','package.json'),bytes(cManifest));
    await writeFile(join(c.directory,'package.json'),bytes(cManifest));
    await installPackage(join(a.directory,'node_modules','owned-c'),'owned-d',{version:'1.0.0'},{'index.js':'one'});
    await installPackage(c.directory,'owned-d',{version:'1.1.0'},{'index.js':'one-one'});
    await assert.rejects(unionDependencySnapshot(root,manifest),/union-same-version-bytes-or-edges/);
});

test('nested physical versions produce owner-local corrections without root JS rewrites',async t=> {
    const root=await fixture(t),manifest=rootManifest('0.10.24',{'owned-a':'1.0.0','owned-b':'1.0.0'});await writeFile(join(root,'package.json'),bytes(manifest));
    const a=await installPackage(root,'owned-a',{version:'1.0.0',dependencies:{'owned-c':'1.0.0'}},{'index.js':'a'});
    const b=await installPackage(root,'owned-b',{version:'1.0.0',dependencies:{'owned-c':'2.0.0'}},{'index.js':'b'});
    await installPackage(a.directory,'owned-c',{version:'1.0.0'},{'index.js':'one'});
    await installPackage(b.directory,'owned-c',{version:'2.0.0'},{'index.js':'two'});
    const snapshot=await unionDependencySnapshot(root,manifest);
    assert(snapshot.layout.some(row=>row.path==='node_modules/owned-b/node_modules/owned-c'&&row.key==='owned-c@2.0.0'));
});

test('snapshot rejects symlink, native files and cancellation',async t=> {
    const root=await fixture(t),manifest=rootManifest('0.10.24',{'owned-a':'1.0.0'});await writeFile(join(root,'package.json'),bytes(manifest));
    const a=await installPackage(root,'owned-a',{version:'1.0.0'},{'index.js':'original'});
    await writeFile(join(a.directory,'native.node'),'native');await assert.rejects(unionDependencySnapshot(root,manifest),/union-native-resource/);
    await rm(join(a.directory,'native.node'));
    const controller=new AbortController();controller.abort();await assert.rejects(unionDependencySnapshot(root,manifest,{signal:controller.signal}));
    const target=join(root,'owned-link-target');await mkdir(target);await symlink(target,join(a.directory,'linked'),process.platform==='win32'?'junction':'dir');
    await assert.rejects(unionDependencySnapshot(root,manifest),/union-dependency-link/);
});

test('installed full inventory rejects extra files, directories, tampering and symlinks',async t=> {
    const root=await fixture(t),entries=inspectUnionArchive(source());await installEntries(entries,root);
    assert.equal((await verifyUnionInstalledEntries(entries,root)).verified,true);
    await mkdir(join(root,'node_modules'));await writeFile(join(root,'node_modules','host-owned'),'outside archive');
    assert.equal((await verifyUnionInstalledEntries(entries,root)).verified,true);
    await writeFile(join(root,'extra'),'tamper');await assert.rejects(verifyUnionInstalledEntries(entries,root),/union-installed-extra-file/);await rm(join(root,'extra'));
    await mkdir(join(root,'extra'));await assert.rejects(verifyUnionInstalledEntries(entries,root),/union-installed-extra-directory/);await rm(join(root,'extra'),{recursive:true});
    await writeFile(join(root,'client.js'),'tamper');await assert.rejects(verifyUnionInstalledEntries(entries,root),/union-installed-bytes/);
});

test('owned complete HTML-size closure validates 26 packages and 2,249 files',async t=> {
    const root=await fixture(t),dependencies=Object.fromEntries(Array.from({length:26},(_,i)=>['owned-html-'+String(i).padStart(2,'0'),'1.0.0']));
    const manifest=rootManifest('0.10.24',dependencies);await writeFile(join(root,'package.json'),bytes(manifest));
    const records=[];let total=0;
    for(const [name] of Object.entries(dependencies)) {
        const count=records.length===0?99:86,files=Object.fromEntries(Array.from({length:count-1},(_,i)=>['resources/'+i+'.txt','owned public resource '+i]));
        const record=await installPackage(root,name,{version:'1.0.0'},files);records.push({name,version:'1.0.0',...record});total+=count;
    }
    assert.equal(total,2249);const snapshot=await unionDependencySnapshot(root,manifest);
    assert.equal(snapshot.packages.length,26);assert.equal(snapshot.fileCount,2249);
    const proof=await verifyUnionPublicSnapshot(snapshot,{fetcher:mockedPublic(records).fetcher}),evidence=unionSnapshotEvidence(snapshot,proof);
    validateUnionEvidence(evidence);assert.equal(snapshot.publicArchives.size,26);assert.equal(evidence.proof.packages.length,26);
    const candidate=buildUnionGeneration(source('0.10.25',dependencies),snapshot,{rootBytes:source('0.10.24',dependencies)});
    assert.equal(inspectUnionArchive(candidate.bytes).filter(e=>e.name.startsWith('package/'+candidate.generation+'/node_modules/')).length,2249);
});

test('dependency package bound fails before an unbounded snapshot',async t=> {
    const root=await fixture(t),deps=Object.fromEntries(Array.from({length:64},(_,i)=>['owned-limit-'+i,'1.0.0']));
    const manifest=rootManifest('0.10.24',deps);await writeFile(join(root,'package.json'),bytes(manifest));
    for(const [name] of Object.entries(deps))await installPackage(root,name,{version:'1.0.0',...(name==='owned-limit-0'?{dependencies:{'owned-extra':'1.0.0'}}:{})});
    await installPackage(root,'owned-extra',{version:'1.0.0'});
    await assert.rejects(unionDependencySnapshot(root,manifest),/union-dependency-package-bound/);
});

test('retention refuses a sixth old generation and never drops an existing token',()=> {
    const archive=source(),snapshot=emptySnapshot(),retained=Array.from({length:6},(_,i)=>({generation:'g/'+String(i+1).repeat(32),
        entries:[{name:'package/g/'+String(i+1).repeat(32)+'/owned.txt',bytes:bytes('owned')}]}));
    assert.throws(()=>buildUnionGeneration(archive,snapshot,{retained}),/union-retention-limit/);
    const built=buildUnionGeneration(archive,snapshot,{retained:retained.slice(0,5),generation:'g/'+'a'.repeat(32)});
    const entries=inspectUnionArchive(built.bytes);for(const old of retained.slice(0,5))assert(entries.some(e=>e.name===old.entries[0].name));
    assert.throws(()=>buildUnionGeneration(archive,snapshot,{retained:[retained[0],retained[0]]}),/union-retained-token/);
});

test('production gate is structural and identity rejects path/proof/generation spoofing',()=> {
    assert(canInspectIsolatedPair('dsh-union-search','0.11.0','0.11.1'),'a later stable version needs no new allowlist entry');
    assert(canInspectIsolatedPair('dsh-union-search','0.24.9','0.25.0'));
    assert(!canInspectIsolatedPair('dsh-union-search','0.11.0','0.11.0'),'same version is not a newer target');
    assert(!canInspectIsolatedPair('dsh-union-search','0.11.0','0.10.9'),'downgrades are refused');
    assert(!canInspectIsolatedPair('dsh-union-search','0.11.0','0.12.0-beta.1'),'prerelease targets are refused');
    assert(canInspectIsolatedPair('owned-fixture','1.0.0','1.0.1'),'the pair predicate only validates shape; the route is decided by installed structure');
    assert(needsDependencyIsolation('dsh-union-search'),'the known Host reload failure always needs isolation');
    assert(!needsDependencyIsolation('owned-plugin',{name:'owned-plugin',dependencies:{yaml:'2.9.1'}}));
    assert(needsDependencyIsolation('owned-plugin',{name:'owned-plugin',dependencies:{cheerio:'^1.2.0',turndown:'^7.2.4','@joplin/turndown-plugin-gfm':'^1.0.68'}}));
    const ref=validReference();validateUnionReference(ref);
    for(const mutate of [r=>r.archiveKey='../escape/package.tgz',r=>r.runtimeGeneration.evidenceKey='../escape.json',
        r=>r.originalSha256='b'.repeat(64),r=>r.origin='file:/somewhere',r=>r.runtimeGeneration.moduleAliases=['rewrite'],
        r=>r.runtimeGeneration.retained=Array(6).fill({}),r=>r.runtimeGeneration.kind='wsl',r=>r.originalRegistry='https://private.example']) {
        const changed=structuredClone(ref);mutate(changed);assert.throws(()=>validateUnionReference(changed),/union-/);
    }
    // A structural reference without the policy/contract pair is not silently read as legacy.
    const structural=structuredClone(ref);structural.runtimeGeneration.policy='isolated-js-v1';
    assert.throws(()=>validateUnionReference(structural),/union-reference-identity/);
});

test('production does not accept caller-supplied test hashes or arbitrary sources',async t=> {
    const root=await fixture(t);let calls=0;
    const registryStager={stage:async()=>{calls++;return {name:'dsh-union-search',version:'0.10.24',origin:PUBLIC_REGISTRY,
        runtimeGeneration:null,originalSha256:unionHash(source()),sha256:unionHash(source())};},reference:()=>{},reopen:()=>{},verify:async()=>{}};
    const stager=new UnionGenerationStager(join(root,'stage'),{registryStager,releaseHashes:{'0.10.24':unionHash(source())},policy:()=>true});
    await assert.rejects(stager.stagePair({name:'dsh-union-search',from:'0.10.24',to:'0.10.25',packageDirectory:root}),/union-canonical-source-required/);
    assert.equal(calls,2);
    await assert.rejects(stager.stagePair({name:'owned',from:'0.10.24',to:'0.10.25',packageDirectory:root}),/union-canonical-source-required/);
    assert.equal(calls,4);
    await assert.rejects(stager.reopen({...validReference(),archiveKey:'../escape/package.tgz'}),/union-reference-stage-key/);
    await assert.rejects(stager.prepareRecovery(validReference(),{}),/union-recovery-current-reference-required/);
});

test('isolated archive contract refuses an unrelated package and a host-declaration change',()=>{
    const patch='- insert:\n    - id: owned-isolated\n      name: owned-isolated\n';
    const manifestOf = (extra={}) => ({name:'owned-isolated',version:'1.0.0',type:'module',main:'lib/index.js',
        exports:{'.':'./lib/index.js'},dependencies:extra.dependencies??{cheerio:'^1.2.0',turndown:'^7.2.4','@joplin/turndown-plugin-gfm':'^1.0.68'},
        dsh:{bundle:{patch:'./cordis.patch.yml'}}});
    const entriesOf = manifest => [file('package.json',manifest),file('lib/index.js','export const owned = true;\n'),
        file('client.js','export const ownedClient = true;\n'),file('cordis.patch.yml',patch)];
    const accepted=inspectIsolatedRoot(manifestOf(),entriesOf(manifestOf()),[patch]);
    assert.match(accepted.contractDigest,/^[a-f0-9]{64}$/);
    // A package without the reviewed pure-JS stack never enters the isolated route.
    const unrelated={...manifestOf(),name:'owned-unrelated',dependencies:{yaml:'2.9.1'}};
    assert.throws(()=>inspectIsolatedRoot(unrelated,entriesOf(unrelated),[patch]),/union-package-contract/);
    // A client block without its matching export is a declared-contract change, not an update.
    const clientOnly={...manifestOf(),dsh:{bundle:{patch:'./cordis.patch.yml'},client:{platform:'web',inject:['@deepseek-ai/dsh-client-ui-slots']}}};
    assert.throws(()=>inspectIsolatedRoot(clientOnly,entriesOf(clientOnly),[patch]),/union-client-contract/);
    const changed={...manifestOf(),exports:{'.':'./lib/index.js','./client':'./client.js'},
        dsh:{bundle:{patch:'./cordis.patch.yml'},client:{platform:'web',inject:['@deepseek-ai/dsh-client-ui-slots']}}};
    assert.equal(accepted.contractDigest===inspectIsolatedRoot(changed,entriesOf(changed),[patch]).contractDigest,false);
    assert.doesNotThrow(()=>requireIsolatedTransition({manifest:manifestOf(),contractDigest:accepted.contractDigest},
        {manifest:changed,contractDigest:inspectIsolatedRoot(changed,entriesOf(changed),[patch]).contractDigest}),'a structurally valid declaration change is packaged from its own source, not from a reviewed allowlist');
    assert.throws(()=>requireIsolatedTransition({manifest:manifestOf(),contractDigest:accepted.contractDigest},
        {manifest:{...manifestOf(),dependencies:{cheerio:'^2.0.0',turndown:'^7.2.4','@joplin/turndown-plugin-gfm':'^1.0.68'}},contractDigest:accepted.contractDigest}),/dependency-closure-requires-download/);
// A range move the already verified closure satisfies keeps the installed copies.
const snapshot={packages:[{name:'cheerio',version:'1.3.1'},{name:'turndown',version:'7.2.5'},{name:'@joplin/turndown-plugin-gfm',version:'1.0.68'}]};
assert.doesNotThrow(()=>requireIsolatedTransition({manifest:manifestOf(),contractDigest:accepted.contractDigest},
 {manifest:{...manifestOf(),dependencies:{cheerio:'^1.3.0',turndown:'^7.2.4','@joplin/turndown-plugin-gfm':'^1.0.68'}},contractDigest:accepted.contractDigest},{snapshot}));
assert.throws(()=>requireIsolatedTransition({manifest:manifestOf(),contractDigest:accepted.contractDigest},
 {manifest:{...manifestOf(),dependencies:{cheerio:'^1.3.0',turndown:'^7.2.4','@joplin/turndown-plugin-gfm':'^1.0.68'}},contractDigest:accepted.contractDigest},{snapshot:{packages:[{name:'cheerio',version:'1.2.0'}]}}),/dependency-closure-requires-download/);
    // A dynamic host expression stays outside the reviewed single static row.
    assert.throws(()=>inspectIsolatedRoot(manifestOf(),entriesOf(manifestOf()),['- insert:\n    - id: owned-isolated\n      name: owned-isolated\n      disabled: !!js "true"\n']),/dynamic-or-included/i);
});


const ISOLATED='owned-isolated';
const isolatedManifest=(version,aRange)=>({name:ISOLATED,version,type:'module',main:'lib/index.js',
    exports:{'.':'./lib/index.js','./client':'./client.js','./locale/*.json':'./locale/*.json','./package.json':'./package.json'},
    dependencies:{cheerio:'^1.2.0',turndown:'^7.2.4','@joplin/turndown-plugin-gfm':'^1.0.68','owned-a':aRange,'@deepseek-ai/schemastery':'^3.18.4'},
    dsh:{bundle:{patch:'./cordis.patch.yml'},client:{platform:'web',inject:['@deepseek-ai/dsh-client-ui-slots']}}});
const isolatedArchive=(version,aRange='^1.0.0')=>packUnionArchive([file('package.json',isolatedManifest(version,aRange)),
    file('lib/index.js',`export const version='${version}';\n`),file('client.js','export const client=true;\n'),
    file('locale/en.json',{}),file('cordis.patch.yml','- insert:\n    - id: owned-isolated\n      name: owned-isolated\n')]);
const dependencyArchive=(name,version)=>packUnionArchive([file('package.json',{name,version}),
    file('index.js',`module.exports=${JSON.stringify(name+'@'+version)};\n`)]);
async function closureFixture(t) {
    const root=await fixture(t),packageDir=join(root,'package');
    await mkdir(packageDir,{recursive:true});
    await installEntries(inspectUnionArchive(isolatedArchive('0.11.0')),packageDir);
    return {root,packageDir};
}
async function installDependency(base,name,version) {
    const archive=dependencyArchive(name,version);
    await installEntries(inspectUnionArchive(archive),join(base,'node_modules',...name.split('/')));
    return {name,version,archive};
}
function registryFetcher(records,{corrupt}={}) {
    const byKey=new Map(records.map(record=>[record.name+'@'+record.version,record]));
    const archives=new Map(records.map(record=>[`/${record.name}/-/${record.name.split('/').at(-1)}-${record.version}.tgz`,record]));
    const packuments=new Map();
    const metadata=record=>{const manifest=JSON.parse(inspectUnionArchive(record.archive).find(entry=>entry.name==='package/package.json').bytes.toString('utf8'));
        return {...manifest,dist:{tarball:`${PUBLIC_REGISTRY}/${record.name}/-/${record.name.split('/').at(-1)}-${record.version}.tgz`,integrity:sri(record.archive)}};};
    for(const record of records) {if(!packuments.has(record.name))packuments.set(record.name,[]);packuments.get(record.name).push(record);}
    return async url=> {
        const target=new URL(url);
        if(archives.has(target.pathname)) {const record=archives.get(target.pathname);return new Response(corrupt?.(record)??record.archive);}
        const parts=target.pathname.slice(1).split('/').map(decodeURIComponent);
        if(parts.length===2) {const record=byKey.get(parts[0]+'@'+parts[1]);
            if(record)return Response.json(metadata(record));
            throw Error('unexpected-owned-registry-version:'+target.href);}
        if(parts.length===1&&packuments.has(parts[0]))return Response.json({name:parts[0],versions:Object.fromEntries(packuments.get(parts[0]).map(record=>[record.version,metadata(record)]))});
        throw Error('unexpected-owned-registry-request:'+target.href);
    };
}
function closureStager(root,records,options={}) {
    const fetcher=registryFetcher(records,options);
    return new UnionGenerationStager(join(root,'union'),{registryStager:new RegistryStager(join(root,'staged'),{fetcher}),fetcher});
}

test('inspectPair admits a declaration move the installed closure already satisfies',async t=>{
    const {root,packageDir}=await closureFixture(t);
    const records=[await installDependency(packageDir,'cheerio','1.2.0'),await installDependency(packageDir,'turndown','7.2.4'),
        await installDependency(packageDir,'@joplin/turndown-plugin-gfm','1.0.68'),await installDependency(packageDir,'owned-a','1.0.0'),
        {name:ISOLATED,version:'0.11.0',archive:isolatedArchive('0.11.0')},
        {name:ISOLATED,version:'0.11.1',archive:isolatedArchive('0.11.1')}];
    const stager=closureStager(root,records);
    const admission=await stager.inspectPair({name:ISOLATED,from:'0.11.0',to:'0.11.1',packageDirectory:packageDir});
    assert.equal(admission.status,'passed');assert.match(admission.graphDigest,/^[a-f0-9]{64}$/);
    assert.equal(admission.closureDigest,undefined);
});

test('a target that needs new dependencies plans a read-only download and stages a self-contained closure',async t=>{
    const {root,packageDir}=await closureFixture(t);
    const records=[await installDependency(packageDir,'cheerio','1.2.0'),await installDependency(packageDir,'turndown','7.2.4'),
        await installDependency(packageDir,'@joplin/turndown-plugin-gfm','1.0.68'),await installDependency(packageDir,'owned-a','1.0.0'),
        {name:ISOLATED,version:'0.11.0',archive:isolatedArchive('0.11.0')},
        {name:ISOLATED,version:'0.12.0',archive:isolatedArchive('0.12.0','^2.0.0')},
        {name:'owned-a',version:'2.0.0',archive:dependencyArchive('owned-a','2.0.0')}];
    const stager=closureStager(root,records);
    const admission=await stager.inspectPair({name:ISOLATED,from:'0.11.0',to:'0.12.0',packageDirectory:packageDir});
    assert.equal(admission.status,'download-required');assert.equal(admission.closurePackages,1);
    assert.match(admission.closureDigest,/^[a-f0-9]{64}$/);
    await assert.rejects(()=>stat(join(root,'union')),error=>error.code==='ENOENT','the read-only plan writes nothing');
    const pair=await stager.stagePair({name:ISOLATED,from:'0.11.0',to:'0.12.0',packageDirectory:packageDir,expected:admission});
    assert.equal(pair.closure.packages,1);assert(pair.closure.bytes>0);
    validateUnionReference(stager.reference(pair.next));validateUnionReference(stager.reference(pair.previous));
    assert.equal(pair.next.version,'0.12.0');assert.equal(pair.previous.version,'0.11.0');
    const reopened=await stager.reopen(stager.reference(pair.next));
    assert.equal(reopened.runtimeGeneration.policy,'isolated-js-v1');
    const nextEntries=inspectUnionArchive(await readFile(pair.next.archivePath));
    const prefix='package/'+pair.next.runtimeGeneration.generation+'/';
    const embedded=JSON.parse(nextEntries.find(entry=>entry.name===prefix+'node_modules/owned-a/package.json').bytes.toString('utf8'));
    assert.equal(embedded.version,'2.0.0');
    const previousEntries=inspectUnionArchive(await readFile(pair.previous.archivePath));
    const previousPrefix='package/'+pair.previous.runtimeGeneration.generation+'/';
    const retained=JSON.parse(previousEntries.find(entry=>entry.name===previousPrefix+'node_modules/owned-a/package.json').bytes.toString('utf8'));
    assert.equal(retained.version,'1.0.0');
    const leftovers=await readdir(join(root,'union'));
    assert(!leftovers.some(name=>name.startsWith('closure-')),'the materialised closure directory is removed');
});

test('a closure archive that fails its published integrity leaves no stage behind',async t=>{
    const {root,packageDir}=await closureFixture(t);
    const records=[await installDependency(packageDir,'cheerio','1.2.0'),await installDependency(packageDir,'turndown','7.2.4'),
        await installDependency(packageDir,'@joplin/turndown-plugin-gfm','1.0.68'),await installDependency(packageDir,'owned-a','1.0.0'),
        {name:ISOLATED,version:'0.11.0',archive:isolatedArchive('0.11.0')},
        {name:ISOLATED,version:'0.12.0',archive:isolatedArchive('0.12.0','^2.0.0')},
        {name:'owned-a',version:'2.0.0',archive:dependencyArchive('owned-a','2.0.0')}];
    const stager=closureStager(root,records,{corrupt:record=>record.name==='owned-a'&&record.version==='2.0.0'?Buffer.from('tampered-closure-archive'):null});
    await assert.rejects(()=>stager.stagePair({name:ISOLATED,from:'0.11.0',to:'0.12.0',packageDirectory:packageDir}),error=>error.code==='dependency-closure-integrity');
    const leftovers=await readdir(join(root,'union')).catch(error=>error.code==='ENOENT'?[]:Promise.reject(error));
    assert(!leftovers.some(name=>name.startsWith('closure-')));
});

test('verified public proofs are reused between scans without new requests', async t => {
    const root = await fixture(t), manifest = rootManifest('0.10.24', { 'owned-a': '^1.0.0' });
    await installEntries(inspectUnionArchive(source('0.10.24', manifest.dependencies)), root);
    const a = await installPackage(root, 'owned-a', { version: '1.0.0' }, { 'index.js': 'module.exports="a";' });
    const snapshot = await unionDependencySnapshot(root, manifest);
    const cache = new Map(), mock = mockedPublic([{ name: 'owned-a', version: '1.0.0', ...a }]);
    const first = await verifyUnionPublicSnapshot(snapshot, { fetcher: mock.fetcher, cache });
    const calls = mock.calls.length;
    assert(calls > 0);
    const second = await verifyUnionPublicSnapshot(snapshot, { fetcher: mock.fetcher, cache });
    assert.equal(mock.calls.length, calls, 'the second scan reuses the cached public proof');
    assert.deepEqual(second, first);
});
