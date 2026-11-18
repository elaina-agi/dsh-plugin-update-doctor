import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';

const anchor=process.env.DSH_INSTALL_DIR;
if(!anchor || !anchor.includes('app.asar')) throw Error('Expected current packaged ASAR installation');
const require=createRequire(join(anchor,'package.json'));
const imported=async name=>import(pathToFileURL(require.resolve(name)).href);
const app=await imported('@deepseek-ai/dsh-app-boot');
const ops=await imported('@deepseek-ai/dsh-plugin-manager/operations');
const root=await fs.mkdtemp(join(tmpdir(),'dsh-online-proof-'));
process.env.DSH_HOME=root;
const profileDir=join(root,'profiles','proof');
await fs.mkdir(profileDir,{recursive:true});
const out=process.argv[2];
const evidence={schemaVersion:1,runtimeVersion:app.getDshRuntimeVersion(),pid:process.pid,root,startedAt:new Date().toISOString(),results:[],events:[],limits:['Isolated fake plugin packages, actual installed Cordis/Loader/HMR/PluginManager.','No real Desktop/WSL package or active user task is touched.','Readiness test seam only; package operations and lifecycle implementation are real.']};
const pnpm=process.argv[3];
let ctx;
function tar(files){const parts=[];for(const [name,text]of Object.entries(files)){const b=Buffer.from(text),h=Buffer.alloc(512);h.write(name,0,100);h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);h.write(b.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h[156]=48;h.write('ustar\0',257);h.write('00',263);let sum=0;for(const x of h)sum+=x;h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);parts.push(h,b,Buffer.alloc((512-b.length%512)%512));}parts.push(Buffer.alloc(1024));return gzipSync(Buffer.concat(parts));}
async function packageVersion(version,bad=false){
 const dir=join(root,'source-'+version);await fs.mkdir(dir,{recursive:true});
 const files={
  'package/package.json':JSON.stringify({name:'online-proof-plugin',version,type:'module',exports:{'.':'./index.js','./package.json':'./package.json'},dsh:{bundle:{patch:'cordis.patch.yml'}}}),
  'package/cordis.patch.yml':'- insert:\n    - id: online-proof-target\n      name: online-proof-plugin\n',
  'package/index.js':`export function apply(ctx){ const recorder=globalThis.__onlineProof; recorder.push({kind:'start',version:'${version}',pid:process.pid,time:Date.now()}); ${bad?"throw new Error('PROOF_BAD_ACTIVATION: fixture v3 deliberately fails');":''} const active=new Set();ctx.provide('onlineProofRevision', {version:'${version}', read:()=> 'real-code-${version}', startWork:()=>{const task=(async()=>{recorder.push({kind:'work-start',version:'${version}',time:Date.now()});await globalThis.__onlineProofControl.workGate;recorder.push({kind:'work-end',version:'${version}',time:Date.now()});return 'work-completed-${version}';})();active.add(task);task.finally(()=>active.delete(task));return task;}}); ctx.effect(()=>async()=>{recorder.push({kind:'dispose-start',version:'${version}',time:Date.now()});globalThis.__onlineProofControl?.disposalStarted?.();await Promise.allSettled([...active]);await new Promise(r=>setTimeout(r,120));recorder.push({kind:'dispose-end',version:'${version}',time:Date.now()});}); }`,
 };
 const file=join(dir,'online-proof-plugin-'+version+'.tgz');await fs.writeFile(file,tar(files));return file;
}
const v1=await packageVersion('1.0.0'),v2=await packageVersion('1.1.0'),bad=await packageVersion('1.2.0',true);
const unrelated=join(root,'unrelated.mjs');await fs.writeFile(unrelated,"export function apply(ctx){ctx.provide('onlineProofUnrelated',{read:()=> 'unrelated-alive'});ctx.effect(()=>()=>globalThis.__onlineProof.push({kind:'unrelated-disposed',time:Date.now()}));}");
const manifest={name:'online-proof-profile',private:true,dependencies:{'online-proof-plugin':'file:'+v1},dsh:{profile:{bundles:['online-proof-plugin']}}};
await fs.writeFile(join(profileDir,'package.json'),JSON.stringify(manifest,null,2));
await fs.writeFile(join(profileDir,'pnpm-workspace.yaml'),'autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\n');
const patch=[{insert:[{id:'timer',name:'@deepseek-ai/cordis-plugin-timer'},{id:'hmr',name:'@deepseek-ai/dsh-hmr',config:{root:[],debounce:20,ignored:[],awaitWriteFinish:false}},{id:'plugin-manager',name:'@deepseek-ai/dsh-plugin-manager',config:{inspectTimeoutMs:3000,githubConnectionTimeoutMs:1000,gitTransportTimeoutMs:1000,lockWaitMs:3000,idleTimeoutMs:10000}},{id:'online-proof-unrelated',name:pathToFileURL(unrelated).href}]}];
await fs.writeFile(join(profileDir,'cordis.patch.yml'),JSON.stringify(patch));
const config=join(profileDir,'cordis.yml');await fs.writeFile(config,'[]\n');
const context={name:'proof',dir:profileDir,patchPath:join(profileDir,'cordis.patch.yml'),installAnchor:join(anchor,'package.json'),cwd:root,home:root,startedBundles:['online-proof-plugin'],overlays:[],telemetryDisabledEnv:'1',packageManager:{command:process.execPath,args:['--expose-internals',pnpm],env:{ELECTRON_RUN_AS_NODE:'1',CI:'true'}}};
globalThis.__onlineProof=evidence.events;
async function record(name,fn){const begin=Date.now();try{const value=await fn();evidence.results.push({name,ok:true,elapsed:Date.now()-begin,value});console.log('PROOF',name,JSON.stringify(value));return value;}catch(error){evidence.results.push({name,ok:false,elapsed:Date.now()-begin,error:String(error.stack||error)});console.error('PROOF_FAILED',name,String(error.stack||error));throw error;}}
try{
 await record('initial-package-install',async()=>{const r=await ops.runProfilePnpm({profile:'proof',...context},['install','--offline'],{...context.packageManager,execution:'service',outputBytes:20000,lockWaitMs:3000,idleTimeoutMs:10000});assert.equal(r.exitCode,0,r.output);return r;});
 const profile=app.loadProfileDirectory('online-proof',profileDir,context.installAnchor);
 const resolution=await app.createRuntimeResolution({installAnchor:context.installAnchor,profile,home:root});
 ctx=await app.boot('online-proof',config,app.readProfilePatches('online-proof',context,profile),async rootCtx=>{
  rootCtx.provide('profileContext',context);
  rootCtx.provide('appReady',{onReady(callback){queueMicrotask(callback);return()=>{};}});
  await rootCtx.plugin(app.PluginPackages,{resolution});
 },pathToFileURL(join(profileDir,'package.json')).href);
 await record('cold-v1-active',async()=>{const revision=ctx.get('onlineProofRevision');assert.equal(revision?.read(),'real-code-1.0.0');assert(ctx.get('hmr'));assert(ctx.get('pluginManager'));return {revision:revision.read(),rows:await ctx.get('pluginManager').listPlugins(),pid:process.pid};});
 const manager=ctx.get('pluginManager');
 const workGate=Promise.withResolvers(), disposalGate=Promise.withResolvers();
 globalThis.__onlineProofControl={workGate:workGate.promise,disposalStarted:()=>disposalGate.resolve()};
 const heldWork=ctx.get('onlineProofRevision').startWork();
 let removalFinished=false;
 const pendingRemoval=manager.removeBundle('online-proof-plugin').then(result=>{removalFinished=true;return result});
 await disposalGate.promise;
 await record('active-work-quiescence-barrier',async()=>{assert.equal(removalFinished,false);assert.equal(ctx.get('onlineProofUnrelated').read(),'unrelated-alive');assert.equal(evidence.events.some(e=>e.kind==='dispose-end'&&e.version==='1.0.0'),false);workGate.resolve();assert.equal(await heldWork,'work-completed-1.0.0');return{removalWaitedForWork:true,unrelated:'unrelated-alive',workCompletedWithoutCancellation:true,pid:process.pid};});
 const remove=await record('remove-v1-real-manager',()=>pendingRemoval);
 assert.notEqual(remove.application,'failed',JSON.stringify(remove));
 assert.equal(ctx.get('onlineProofRevision'),undefined);
 const install=await record('install-v2-real-manager',()=>manager.installBundle(v2,{enabled:true,expected:{name:'online-proof-plugin',version:'1.1.0'}}));
 assert.notEqual(install.application,'failed',JSON.stringify(install));
 await record('hot-v2-code-and-unrelated',async()=>{assert.equal(ctx.get('onlineProofRevision')?.read(),'real-code-1.1.0');assert.equal(ctx.get('onlineProofUnrelated')?.read(),'unrelated-alive');const oldEnd=evidence.events.findIndex(e=>e.kind==='dispose-end'&&e.version==='1.0.0'),nextStart=evidence.events.findIndex(e=>e.kind==='start'&&e.version==='1.1.0');assert(oldEnd>=0&&nextStart>oldEnd);return {revision:ctx.get('onlineProofRevision').read(),unrelated:ctx.get('onlineProofUnrelated').read(),oldEnd,nextStart,pid:process.pid};});
 await record('remove-v2',()=>manager.removeBundle('online-proof-plugin'));
 const failure=await record('bad-v3-real-activation',()=>manager.installBundle(bad,{enabled:true,expected:{name:'online-proof-plugin',version:'1.2.0'}}));
 assert.equal(failure.application,'failed');assert.equal(failure.stage,'enable');
 await record('remove-bad-v3',()=>manager.removeBundle('online-proof-plugin'));
 const restored=await record('restore-v1-real-manager',()=>manager.installBundle(v1,{enabled:true,expected:{name:'online-proof-plugin',version:'1.0.0'}}));
 assert.notEqual(restored.application,'failed',JSON.stringify(restored));
 await record('restored-code-is-really-v1',async()=>{assert.equal(ctx.get('onlineProofRevision')?.read(),'real-code-1.0.0');return{revision:ctx.get('onlineProofRevision').read(),pid:process.pid};});
 evidence.passed=true;
}catch(error){evidence.passed=false;evidence.fatal=String(error.stack||error);process.exitCode=1;}
finally{if(ctx)await ctx.fiber.dispose();evidence.finishedAt=new Date().toISOString();if(out)await fs.writeFile(out,JSON.stringify(evidence,null,2));await fs.rm(root,{recursive:true,force:true});console.log('PROOF_EVIDENCE',out,'passed',evidence.passed);}
