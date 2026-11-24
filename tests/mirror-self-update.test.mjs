import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp,mkdir,writeFile,rm,realpath,lstat } from 'node:fs/promises';
import { dirname,basename,join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SelfUpdatePreflight,inspectSelfArchive,SELF_UPDATE_PACKAGE as SELF } from '../lib/self-update-policy.js';
import { PUBLIC_REGISTRY as PUBLIC,PUBLIC_MIRROR as MIRROR } from '../lib/source.js';

const helper=Buffer.from('owned mirror helper fixture; never executed'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const integrity=bytes=>'sha512-'+createHash('sha512').update(bytes).digest('base64');
const helperSha256=hash(helper),compatibility=()=>undefined;
function manifest(version){return{name:SELF,version,type:'module',exports:{'.':'./index.js','./client':'./client.js','./locale/*.json':'./locale/*.json','./icon':'./icon.svg','./package.json':'./package.json'},engines:{node:'>=24.0.0',dsh:'>=0.2.2-rc.3 <0.3.0'},dependencies:{yaml:'2.9.1'},peerDependencies:{'@deepseek-ai/dsh-tools':'>=0.2.2-rc.3 <0.3.0','@deepseek-ai/dsh-app-boot':'>=0.2.2-rc.3 <0.3.0'},dsh:{bundle:{patch:'./cordis.patch.yml',platforms:['win32']},client:{platform:'web',immediately:true,inject:['@deepseek-ai/dsh-client-ui-slots','@deepseek-ai/dsh-client-modules']}}};}
function archive(value,extra=''){
 const files=[['package/package.json',JSON.stringify(value)],['package/cordis.patch.yml',`- insert:\n    - id: plugin-update-doctor\n      name: ${SELF}\n`],['package/index.js',`// ${value.version}${extra}`],['package/client.js','// client'],['package/icon.svg','<svg/>'],['package/locale/en.json','{}'],['package/locale/zh.json','{}'],['package/native/win-x64/lock-probe.exe',helper]];
 const parts=[];for(const[name,value]of files){const bytes=Buffer.from(value),header=Buffer.alloc(512);header.write(name,0,100);header.write('0000644\0',100);header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header.fill(32,148,156);header[156]=48;header.write('ustar\0',257);header.write([...header].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);parts.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));}return gzipSync(Buffer.concat([...parts,Buffer.alloc(1024)]));
}
async function fixture(t){
 const temp=await realpath(tmpdir()),root=await mkdtemp(join(temp,'dsh-mirror-self-test-'));t.after(async()=>{const checked=await realpath(root);assert.equal(checked,resolve(root));assert.equal(dirname(checked),temp);assert(basename(checked).startsWith('dsh-mirror-self-test-'));assert(!(await lstat(checked)).isSymbolicLink());await rm(checked,{recursive:true,force:true});});
 const previous=manifest('0.5.0'),next=manifest('0.5.1'),packages=new Map([[previous.version,{manifest:previous,bytes:archive(previous)}],[next.version,{manifest:next,bytes:archive(next)}]]),state={requests:[],mirrorBytes:null,mirrorTarball:null,mirrorMetadata:null,mirrorUnavailable:false,redirectURL:null};
 const old=inspectSelfArchive(packages.get('0.5.0').bytes,{version:'0.5.0',role:'previous',resolvedYamlVersion:'2.9.1',helperSha256,compatibility});for(const[path,bytes]of old.files){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);}
 const fetcher=async(url,options)=>{
  const parsed=new URL(url);state.requests.push(parsed.href);assert.equal(options.redirect,parsed.origin===MIRROR&&parsed.pathname.endsWith('.tgz')?'manual':'error');assert.equal(options.credentials,'omit');options.signal.throwIfAborted();
  assert([PUBLIC,MIRROR].includes(parsed.origin));const version=/0\.5\.1/.test(parsed.pathname)?'0.5.1':'0.5.0',pkg=packages.get(version);
  if(parsed.origin===MIRROR&&state.mirrorUnavailable)return new Response('not synchronized',{status:404});
  const bytes=parsed.origin===MIRROR&&state.mirrorBytes?state.mirrorBytes:pkg.bytes;
  let response;if(parsed.pathname.endsWith('.tgz'))response=new Response(bytes);else{let metadata={...pkg.manifest,dist:{tarball:state.mirrorTarball&&parsed.origin===MIRROR?state.mirrorTarball:`${parsed.origin}/${SELF}/-/${SELF}-${version}.tgz`,integrity:integrity(bytes)}};if(parsed.origin===MIRROR&&state.mirrorMetadata)metadata=state.mirrorMetadata(metadata);response=Response.json(metadata);}
  if(parsed.origin===MIRROR&&state.redirectURL)Object.defineProperty(response,'url',{value:state.redirectURL});return response;
 };
 const preflight=new SelfUpdatePreflight({fetcher,compatibility,helperSha256});const input={bundle:{name:SELF,version:'0.5.0',update:'registry',source:SELF+'@0.5.0',installed:true,enabled:true,removable:true,availability:'profile'},currentDirectory:root,targetVersion:'0.5.1',resolvedYamlVersion:'2.9.1',queryRegistry:MIRROR,registries:{registry:null,resolved:MIRROR,fallbackRegistries:[PUBLIC]}};
 return{root,state,packages,preflight,input};
}

test('official npm query with default public mirror fallback passes without changing configuration',async t=>{
 const f=await fixture(t);const registries={registry:null,resolved:PUBLIC,fallbackRegistries:[MIRROR]};
 const before=structuredClone(registries);
 const checked=await f.preflight.check({...f.input,queryRegistry:PUBLIC,registries});
 assert.equal(checked.registry,PUBLIC);assert.equal(checked.sourceMode,'public-fallback');assert.equal(checked.publicFallback,true);
 assert.equal(checked.publicMirror,undefined);assert.deepEqual(checked.hostRegistryPlan,{queryRegistry:PUBLIC,...registries});
 assert.deepEqual(registries,before);assert(f.state.requests.some(url=>url.startsWith(MIRROR+'/')));
 assert.equal(checked.next.sha256,hash(f.packages.get('0.5.1').bytes));
});

test('official query refuses differing or unavailable fallback archives rather than bypassing canonical checks',async t=>{
 const f=await fixture(t);const input={...f.input,queryRegistry:PUBLIC,registries:{registry:null,resolved:PUBLIC,fallbackRegistries:[MIRROR]}};
 f.state.mirrorBytes=archive(f.packages.get('0.5.0').manifest,'fallback tamper');
 await assert.rejects(()=>f.preflight.check(input),error=>error.code==='self-public-mirror-archive-mismatch');
 f.state.mirrorBytes=null;f.state.mirrorUnavailable=true;
 await assert.rejects(()=>f.preflight.check(input),error=>error.code==='self-registry-metadata-unavailable');
});

test('official query rejects private unknown and credential-bearing fallback plans before download',async t=>{
 const f=await fixture(t);
 for(const changes of [{fallbackRegistries:['https://private.invalid']},{resolved:null},{registry:'https://user:secret@registry.npmjs.org'},{resolved:'https://private.invalid'},{fallbackRegistries:Array(9).fill(MIRROR)}]) {
  const before=f.state.requests.length;
  await assert.rejects(()=>f.preflight.check({...f.input,queryRegistry:PUBLIC,registries:{registry:null,resolved:PUBLIC,fallbackRegistries:[MIRROR],...changes}}),error=>error.code==='self-host-registry-plan-unsupported');
  assert.equal(f.state.requests.length,before);
 }
});

test('official-only duplicate public fallbacks bind consent without inventing a mirror transport',async t=>{
 const f=await fixture(t);const checked=await f.preflight.check({...f.input,queryRegistry:PUBLIC,registries:{registry:PUBLIC,resolved:PUBLIC,fallbackRegistries:[PUBLIC]}});
 assert.equal(checked.sourceMode,'public-fallback');assert.equal(checked.publicFallback,true);
 assert.equal(f.state.requests.length,4);assert(f.state.requests.every(url=>url.startsWith(PUBLIC+'/')));
});

test('real mirror shape permits only one exact package-version CDN redirect with canonical comparison',async t=>{
 const f=await fixture(t),calls=[],cdn='https://cdn.npmmirror.com';
 const fetcher=async(url,options)=>{
  const parsed=new URL(url);calls.push(parsed.href);options.signal.throwIfAborted();assert.equal(options.credentials,'omit');
  const version=parsed.pathname.includes('0.5.1')?'0.5.1':'0.5.0',pkg=f.packages.get(version);
  if(parsed.pathname.endsWith('.tgz')) {
   if(parsed.origin===MIRROR){assert.equal(options.redirect,'manual');return new Response('',{status:302,headers:{location:`${cdn}/packages/${SELF}/${version}/${SELF}-${version}.tgz`}});}
   assert.equal(options.redirect,parsed.origin===cdn?'manual':'error');assert([PUBLIC,cdn].includes(parsed.origin));return new Response(pkg.bytes);
  }
  assert.equal(options.redirect,'error');assert([PUBLIC,MIRROR].includes(parsed.origin));
  return Response.json({...pkg.manifest,dist:{tarball:`${parsed.origin}/${SELF}/-/${SELF}-${version}.tgz`,integrity:integrity(pkg.bytes)}});
 };
 const checked=await new SelfUpdatePreflight({fetcher,compatibility,helperSha256}).check(f.input);
 assert.equal(checked.publicMirror,true);assert.equal(calls.filter(url=>url.startsWith(cdn)).length,2);
 assert.equal(checked.next.sha256,hash(f.packages.get('0.5.1').bytes));
});

test('mirror CDN redirect rejects alternate host credentials query path encoding further hops and mismatched bytes',async t=>{
 const f=await fixture(t),expected=`https://cdn.npmmirror.com/packages/${SELF}/0.5.0/${SELF}-0.5.0.tgz`;
 for(const location of [expected.replace('cdn.npmmirror.com','private.invalid'),expected+'?token=x',expected+'#fragment',expected.replace('https://','http://'),expected.replace('/0.5.0/','/0.5.1/'),expected.replace('cdn.npmmirror.com','user:secret@cdn.npmmirror.com'),expected.replace('packages','%70ackages'),null]) {
  let calls=0;const preflight=new SelfUpdatePreflight({fetcher:async()=>{calls++;return new Response('',{status:302,headers:location?{location}:{}});},compatibility,helperSha256});
  await assert.rejects(()=>preflight.downloadArchive(new URL(`${MIRROR}/${SELF}/-/${SELF}-0.5.0.tgz`),{signal:new AbortController().signal,redirect:'error',credentials:'omit'},'0.5.0'),error=>error.code==='self-tarball-origin-unsupported');assert.equal(calls,1);
 }
 let calls=0;const preflight=new SelfUpdatePreflight({fetcher:async()=>{calls++;return new Response('',{status:302,headers:{location:expected}});},compatibility,helperSha256});
 await assert.rejects(()=>preflight.downloadArchive(new URL(`${MIRROR}/${SELF}/-/${SELF}-0.5.0.tgz`),{signal:new AbortController().signal,redirect:'error',credentials:'omit'},'0.5.0'),error=>error.code==='self-tarball-origin-unsupported');assert.equal(calls,2);
 const fetcher=async(url,options)=>{
  const parsed=new URL(url);const version=parsed.pathname.includes('0.5.1')?'0.5.1':'0.5.0',pkg=f.packages.get(version);
  if(parsed.pathname.endsWith('.tgz')){if(parsed.origin===MIRROR)return new Response('',{status:302,headers:{location:`https://cdn.npmmirror.com/packages/${SELF}/${version}/${SELF}-${version}.tgz`}});return new Response(parsed.origin==='https://cdn.npmmirror.com'?Buffer.from('bad CDN archive'):pkg.bytes);}
  return Response.json({...pkg.manifest,dist:{tarball:`${parsed.origin}/${SELF}/-/${SELF}-${version}.tgz`,integrity:integrity(pkg.bytes)}});
 };
 await assert.rejects(()=>new SelfUpdatePreflight({fetcher,compatibility,helperSha256}).check(f.input),error=>error.code==='self-integrity-mismatch');
});

test('mirror previous and next updater archives must match canonical npm bytes and keep fixed graph',async t=>{
 const f=await fixture(t),checked=await f.preflight.check(f.input);assert.equal(checked.registry,MIRROR);assert.equal(checked.sourceMode,'public-mirror');assert.equal(checked.publicMirror,true);
 assert.equal(checked.previous.sha256,hash(f.packages.get('0.5.0').bytes));assert.equal(checked.next.sha256,hash(f.packages.get('0.5.1').bytes));assert.equal(checked.next.manifest.dependencies.yaml,'2.9.1');
 assert.equal(f.state.requests.length,8);assert.deepEqual(checked.hostRegistryPlan.fallbackRegistries,[PUBLIC]);assert(!JSON.stringify(checked).includes(f.root));
 assert.deepEqual(await f.preflight.verifyPrepared(checked,f.input),checked);
});

test('mirror may reference official fixed tarball without source migration or redirects',async t=>{
 const f=await fixture(t);f.state.mirrorMetadata=value=>({...value,dist:{...value.dist,tarball:`${PUBLIC}/${SELF}/-/${SELF}-${value.version}.tgz`}});
 const checked=await f.preflight.check(f.input);assert.equal(checked.registry,MIRROR);assert.equal(checked.publicMirror,true);
});

test('mirror differing archive with valid own integrity cannot replace canonical updater',async t=>{
 const f=await fixture(t);f.state.mirrorBytes=archive(f.packages.get('0.5.0').manifest,'changed mirror');
 await assert.rejects(()=>f.preflight.check(f.input),error=>error.code==='self-public-mirror-archive-mismatch');
});

test('mirror metadata and tarball origin credentials query and redirect destinations are rejected',async t=>{
 const f=await fixture(t);
 for(const url of [`https://user:secret@registry.npmmirror.com/${SELF}/-/${SELF}-0.5.0.tgz`,`${MIRROR}/${SELF}/-/${SELF}-0.5.0.tgz?token=x`,`https://private.invalid/${SELF}/-/${SELF}-0.5.0.tgz`,`${MIRROR}:4430/${SELF}/-/${SELF}-0.5.0.tgz`]){f.state.mirrorTarball=url;await assert.rejects(()=>f.preflight.check(f.input),error=>error.code==='self-tarball-origin-unsupported');}
 f.state.mirrorTarball=null;f.state.redirectURL='https://private.invalid/redirect';await assert.rejects(()=>f.preflight.check(f.input),error=>error.code==='self-tarball-origin-unsupported');
});

test('mirror unavailable does not automatically fetch and hand off through official fallback',async t=>{
 const f=await fixture(t);f.state.mirrorUnavailable=true;await assert.rejects(()=>f.preflight.check(f.input),error=>error.code==='self-registry-metadata-unavailable');assert.equal(f.state.requests.length,1);
});

test('mirror refuses changed manifest helper YAML graph and private Host fallback before mutation',async t=>{
 const f=await fixture(t);f.state.mirrorMetadata=value=>({...value,dependencies:{yaml:'99.0.0'}});await assert.rejects(()=>f.preflight.check(f.input),error=>error.code==='self-registry-manifest-mismatch');
 f.state.mirrorMetadata=null;await assert.rejects(()=>f.preflight.check({...f.input,resolvedYamlVersion:'2.9.2'}),error=>error.code==='self-yaml-version-unverified');
 const before=f.state.requests.length;await assert.rejects(()=>f.preflight.check({...f.input,registries:{...f.input.registries,fallbackRegistries:['https://private.invalid']}}),error=>error.code==='self-host-registry-plan-unsupported');assert.equal(f.state.requests.length,before);
});
