import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {generationArchive as experimentGeneration} from './generation-tar.mjs';
import {generationArchive as productionGeneration} from '../lib/generation.js';
const generationArchive=process.env.WSL_GENERATION_PRODUCTION==='1'?productionGeneration:experimentGeneration;

const anchor=process.env.DSH_INSTALL_DIR;
if(!anchor?.includes('app.asar'))throw Error('Current ASAR runtime required');
const require=createRequire(join(anchor,'package.json'));
const imported=async name=>import(pathToFileURL(require.resolve(name)).href);
const app=await imported('@deepseek-ai/dsh-app-boot');
const ops=await imported('@deepseek-ai/dsh-plugin-manager/operations');
const {provideCmdline}=await imported('@deepseek-ai/dsh-cmdline');
const originalCwd=process.cwd();
const root=await fs.mkdtemp(join(tmpdir(),'dsh-wsl-full-proof-'));
process.env.DSH_HOME=root;process.env.DSH_TELEMETRY_DISABLED='1';process.chdir(root);
// Do not launch a user's distro during shell-env's optional startup facts probe.
// Removing only Windows system directories from this child PATH makes wsl.exe unavailable;
// its documented failed-probe fallback leaves the actual Host row active with absent facts.
const systemRoot = process.env.SystemRoot;
assert(systemRoot, 'Windows SystemRoot is required for isolated WSL fact-probe suppression');
const normalizedSystemRoot = systemRoot.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
process.env.PATH=(process.env.PATH??'').split(';').filter(value=>{
 const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
 return normalized !== normalizedSystemRoot && !['system32','syswow64'].some(dir => normalized === normalizedSystemRoot+'/'+dir || normalized.startsWith(normalizedSystemRoot+'/'+dir+'/'));
}).join(';');
const mode=process.env.WSL_FULL_PROOF_MODE??'official';
const targetVersion=process.env.WSL_FULL_TARGET??'0.26.1';
const initialVersion=mode==='cold26'?targetVersion:'0.24.0';
// No inherited provider credentials may be accidentally used in this isolation.
for(const key of Object.keys(process.env))if(/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)/i.test(key))delete process.env[key];
const pnpm=process.argv[3],out=process.argv[2];
const profileDir=join(root,'profiles','proof');await fs.mkdir(profileDir,{recursive:true});
const evidence={schemaVersion:2,runtimeVersion:app.getDshRuntimeVersion(),pid:process.pid,root,startedAt:new Date().toISOString(),composition:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-plugin-wsl-env'],results:[],limitations:['Actual current ASAR public AppBoot/Cordis/Loader/HMR/PluginManager and complete official base/web layers, with no user profile copied.','The listener, browser asset delivery and browser opening are disabled; actual Host connection, commands, Agent, preset, filesystem and sandbox services remain.','No agent/model request, WSL distro launch, doctor run or user task is performed. AppReady is a test readiness latch.','This proves package/Host activation only; not browser synchronization or real active WSL task continuity.']};
const context={name:'proof',dir:profileDir,patchPath:join(profileDir,'cordis.patch.yml'),installAnchor:join(anchor,'package.json'),cwd:root,home:root,startedBundles:evidence.composition,overlays:[],telemetryDisabledEnv:'1',packageManager:{command:process.execPath,args:['--expose-internals',pnpm],env:{ELECTRON_RUN_AS_NODE:'1',CI:'true'}}};
const patches=[...['webserver','web-runtime','modules','client-hmr','session-title-llm','llm-deepseek','llm-deepseek-account','llm-pi-ai','session-telemetry-otel','desktop-product-telemetry','product-analytics'].map(id=>({id,disabled:true})),{id:'agent-loop',config:{agents:[]}},{id:'wsl-preflight',config:{sandbox:false,startup:false}},{id:'plugin-manager',config:{inspectTimeoutMs:15000,githubConnectionTimeoutMs:1000,gitTransportTimeoutMs:1000,lockWaitMs:10000,idleTimeoutMs:30000,registry:'https://registry.npmjs.org',fallbackRegistries:[]}}];
await fs.writeFile(join(profileDir,'package.json'),JSON.stringify({name:'full-wsl-online-proof',private:true,type:'module',dependencies:{'dsh-plugin-wsl-env':initialVersion},dsh:{profile:{bundles:evidence.composition}}},null,2));
await fs.writeFile(join(profileDir,'pnpm-workspace.yaml'),'autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\n');
await fs.writeFile(context.patchPath,JSON.stringify(patches));const config=join(profileDir,'cordis.yml');await fs.writeFile(config,'[]\n');
let ctx,blankHandle;
async function record(name,fn){const begin=Date.now();try{const value=await fn();evidence.results.push({name,ok:true,elapsed:Date.now()-begin,value});console.log('FULL_WSL_PROOF',name,JSON.stringify(value));return value;}catch(error){const diagnostic=String(error.stack||error);evidence.results.push({name,ok:false,elapsed:Date.now()-begin,error:diagnostic});console.error('FULL_WSL_PROOF_ERROR',name,diagnostic);throw error;}}
async function active(manager,label){const bundles=await manager.listBundles(),plugins=await manager.listPlugins();const bundle=bundles.find(b=>b.name==='dsh-plugin-wsl-env');assert(bundle?.installed);const byId=new Map(plugins.map(p=>[p.entryId,p]));const rows=bundle.rows.map(row=>({id:row.rowId,...byId.get(row.entryId)}));const enabled=rows.filter(row=>row.enabled);const failed=enabled.filter(row=>row.fiberPhase!=='active');const result={version:bundle.version,enabled:bundle.enabled,rowCount:rows.length,enabledCount:enabled.length,activeCount:enabled.filter(row=>row.fiberPhase==='active').length,rows,otherInactive:plugins.filter(p=>p.enabled&&p.fiberPhase!=='active').map(p=>({id:p.entryId,name:p.moduleName,phase:p.fiberPhase})),pid:process.pid};assert.equal(bundle.enabled,true);assert(enabled.length>=14,'Incomplete WSL row inventory');assert.equal(failed.length,0,'Cold/current WSL rows are not fully active: '+JSON.stringify(failed.map(r=>({id:r.id,phase:r.fiberPhase}))));return result;}
async function download(version){const meta=await fetch('https://registry.npmjs.org/dsh-plugin-wsl-env/'+version,{signal:AbortSignal.timeout(20000)}).then(r=>{if(!r.ok)throw Error('Metadata HTTP '+r.status);return r.json()});const bytes=Buffer.from(await fetch(meta.dist.tarball,{signal:AbortSignal.timeout(30000)}).then(r=>{if(!r.ok)throw Error('Tarball HTTP '+r.status);return r.arrayBuffer()}));assert(bytes.length<64*1024*1024);assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),meta.dist.integrity);const file=join(root,'dsh-plugin-wsl-env-'+version+'.tgz');await fs.writeFile(file,bytes);return{path:file,version,size:bytes.length,integrity:meta.dist.integrity};}
try{
 const installed=await record('install-real-wsl-'+initialVersion,()=>ops.runProfilePnpm({profile:'proof',...context},['install','--registry=https://registry.npmjs.org'],{...context.packageManager,execution:'service',outputBytes:30000,lockWaitMs:10000,idleTimeoutMs:30000}));assert.equal(installed.exitCode,0,installed.output);
 const profile=app.loadProfileDirectory('full-wsl-proof',profileDir,context.installAnchor);const resolution=await app.createRuntimeResolution({installAnchor:context.installAnchor,profile,home:root});
 let ready=false;const readyListeners=new Set();
 ctx=await app.boot('full-wsl-proof',config,app.readProfilePatches('full-wsl-proof',context,profile),async rootCtx=>{rootCtx.provide('profileContext',context);await rootCtx.plugin(app.PluginPackages,{resolution});provideCmdline(rootCtx,{args:['--no-open','--port','0'],exit:code=>{throw Error('Unexpected app exit request '+code)},ready:{onReady(callback){if(ready)callback();else readyListeners.add(callback);return()=>readyListeners.delete(callback)}}});},pathToFileURL(join(profileDir,'package.json')).href);
 ready=true;for(const cb of [...readyListeners])cb();readyListeners.clear();
 const manager=ctx.get('pluginManager');assert(manager,'Manager unavailable');
 await record('cold-full-wsl-'+initialVersion+'-all-active',()=>active(manager,'cold'));
 if(mode==='cold26'){evidence.completed=true;evidence.coldAllActive=true;evidence.samePid=true;}
 else{
 const services=['commands','agents','tools','sandboxPolicy','workingDirectory','connection','agentPresets','shellEnv'];await record('real-host-required-services',async()=>Object.fromEntries(services.map(name=>[name,!!ctx.get(name)])));
 if(mode==='inplace'){
  const v1=await record('stage-verified-0.24.0',()=>download('0.24.0'));let v2=await record('stage-verified-0.26.1',()=>download(targetVersion));
  if(process.env.WSL_GENERATION==='1'){const original=await fs.readFile(v2.path),legacy=await fs.readFile(v1.path),generation=generationArchive(original,process.env.WSL_ROLLING==='1'?{legacyOriginal:legacy,retainedOriginal:[original]}:{});const path=join(root,'wsl-generation-'+targetVersion+'.tgz');await fs.writeFile(path,generation.bytes);if(process.env.WSL_ROLLING==='1'){const rollback=generationArchive(legacy,{legacyOriginal:legacy,retainedOriginal:[original]});const rollbackPath=join(root,'wsl-rolling-rollback-0.24.0.tgz');await fs.writeFile(rollbackPath,rollback.bytes);v1.path=rollbackPath;}v2={...v2,path};await record('versioned-runtime-generation-transform',async()=>({generation:generation.generation,originalSha256:generation.originalSha256,originalFiles:generation.originalFiles,copiedFiles:generation.copiedFiles,changedPatchFiles:generation.changedPatchFiles,moduleAliases:generation.moduleAliases,preservedOriginalRuntimeBytes:generation.preservedOriginalRuntimeBytes,exports:generation.manifest.exports}));}
  const result=await record('inplace-staged-install-0.26.1',()=>manager.installBundle(v2.path,{enabled:true,expected:{name:'dsh-plugin-wsl-env',version:targetVersion}}));
  await record('inplace-after-state',async()=>({bundle:(await manager.listBundles()).find(b=>b.name==='dsh-plugin-wsl-env'),wslRows:(await manager.listPlugins()).filter(p=>p.moduleName.startsWith('dsh-plugin-wsl-env/')),baseRows:(await manager.listPlugins()).filter(p=>['include:subprocess','include:fs-sandbox'].includes(p.entryId))}));
  if(result.application==='applied')await record('inplace-full-wsl-0.26.1-all-active',()=>active(manager,'inplace-v2'));
  else{
   const retry=await record('public-reapply-0.26.1',()=>manager.setBundleEnabled('dsh-plugin-wsl-env',true));
   await record('public-reapply-after-state',async()=>({bundle:(await manager.listBundles()).find(b=>b.name==='dsh-plugin-wsl-env'),wslRows:(await manager.listPlugins()).filter(p=>p.moduleName.startsWith('dsh-plugin-wsl-env/'))}));
   if(retry.application==='applied')await record('public-reapply-0.26.1-all-active',()=>active(manager,'reapply-v2'));
   else{
    const toggles=[];for(const id of ['include:wsl-status','include:wsl-doctor-command']){toggles.push(await manager.setPluginEnabled(id,false));toggles.push(await manager.setPluginEnabled(id,true));}
    await record('public-failed-row-off-on',async()=>toggles);
    const packageDir=app.resolveBundleDir('full-wsl-proof','dsh-plugin-wsl-env',context.installAnchor,profileDir);
    const stamped=[];async function freshen(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=join(dir,entry.name);const stat=await fs.lstat(p);if(stat.isSymbolicLink())continue;if(stat.isDirectory()){if(entry.name!=='.git'&&entry.name!=='node_modules')await freshen(p);}else if(stat.isFile()&&entry.name.endsWith('.js')){const bytes=await fs.readFile(p),sha=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(p+'.proof-fresh',bytes);await fs.rename(p+'.proof-fresh',p);const after=await fs.readFile(p);assert.equal(createHash('sha256').update(after).digest('hex'),sha);stamped.push({path:p.slice(packageDir.length+1),sha256:sha});}}}
    await freshen(packageDir);await record('copy-on-write-identical-js-files',async()=>({count:stamped.length,files:stamped,contentChanged:false}));
    const fresh=await record('public-reapply-after-copy-on-write',()=>manager.setBundleEnabled('dsh-plugin-wsl-env',true));
    if(fresh.application==='applied')await record('copy-on-write-0.26.1-all-active',()=>active(manager,'fresh-v2'));
   }
  }
  if(process.env.WSL_GENERATION_PRODUCTION==='1')await record('production-bare-anchor-and-host-services',async()=>{const list=await manager.listPlugins(),rootRow=list.find(p=>p.entryId==='include:wsl-env-client-host');assert.equal(rootRow.moduleName,'dsh-plugin-wsl-env');assert.equal(rootRow.fiberPhase,'active');const filesystem=ctx.get('fs');assert(filesystem);const target=await filesystem.resolve(root);const cwd=filesystem.processPath(target);assert(typeof cwd==='string');const subprocess=ctx.get('subprocess');assert(subprocess);return{bareAnchorPreserved:true,anchorActive:true,filesystemReadable:true,subprocessPresent:true,pid:process.pid,cwd};});
  if(process.env.WSL_ROLLING==='1')await record('rolling-legacy-and-next-resource-bytes',async()=>{const packageDir=app.resolveBundleDir('full-wsl-proof','dsh-plugin-wsl-env',context.installAnchor,profileDir);const {archiveEntries}=await import('../lib/generation.js');const prior=archiveEntries(await fs.readFile(join(root,'dsh-plugin-wsl-env-0.24.0.tgz'))),next=archiveEntries(await fs.readFile(join(root,'dsh-plugin-wsl-env-'+targetVersion+'.tgz')));const legacyScript=prior.find(e=>e.name==='package/agent/wsl-agent.sh');const nextScript=next.find(e=>e.name==='package/agent/wsl-agent.sh');assert(legacyScript&&nextScript);const id=createHash('sha256').update(await fs.readFile(join(root,'dsh-plugin-wsl-env-'+targetVersion+'.tgz'))).digest('hex').slice(0,12);const installedLegacy=await fs.readFile(join(packageDir,'agent','wsl-agent.sh')),installedNext=await fs.readFile(join(packageDir,'g',id,'agent','wsl-agent.sh'));assert(installedLegacy.equals(legacyScript.bytes));assert(installedNext.equals(nextScript.bytes));return{legacyRootPreserved:true,nextGenerationPreserved:true,legacySha256:createHash('sha256').update(installedLegacy).digest('hex'),nextSha256:createHash('sha256').update(installedNext).digest('hex'),pid:process.pid};});
  const restored=await record('inplace-staged-restore-0.24.0',()=>manager.installBundle(v1.path,{enabled:true,expected:{name:'dsh-plugin-wsl-env',version:'0.24.0'}}));
  if(restored.application==='applied')await record('inplace-restored-0.24.0-all-active',()=>active(manager,'inplace-v1'));
  else if(restored.application==='restart-required'){const reapply=await record('restore-public-reapply-0.24.0',()=>manager.setBundleEnabled('dsh-plugin-wsl-env',true));if(reapply.application==='applied')await record('restore-public-reapply-0.24.0-all-active',()=>active(manager,'restored-reapply-v1'));}
  evidence.completed=true;evidence.coldAllActive=true;evidence.inplaceApplication=result.application;evidence.restoreApplication=restored.application;evidence.samePid=true;
 }else{
 const official=await record('official-updateBundle-0.26.1',()=>manager.updateBundle('dsh-plugin-wsl-env',targetVersion,{registry:'https://registry.npmjs.org'}));
 await record('official-after-state',async()=>({bundles:await manager.listBundles(),plugins:await manager.listPlugins()}));
 // Restore an actually all-active .24 baseline before the staged comparison.
 const current=(await manager.listBundles()).find(b=>b.name==='dsh-plugin-wsl-env');
 if(current?.version!=='0.24.0'){
  const removed=await record('reset-remove-target',()=>manager.removeBundle('dsh-plugin-wsl-env'));assert.equal(removed.application,'applied',JSON.stringify(removed));
  const restored=await record('reset-install-0.24.0',()=>manager.installBundle('dsh-plugin-wsl-env@0.24.0',{enabled:true,saveExact:true,expected:{name:'dsh-plugin-wsl-env',version:'0.24.0'},registry:'https://registry.npmjs.org'}));assert.equal(restored.application,'applied',JSON.stringify(restored));
 }
 await record('pre-staged-full-wsl-0.24.0-all-active',()=>active(manager,'pre-stage'));
 const v1=await record('stage-verified-0.24.0',()=>download('0.24.0')),v2=await record('stage-verified-0.26.1',()=>download(targetVersion));
 const removal=await record('staged-remove-0.24.0',()=>manager.removeBundle('dsh-plugin-wsl-env'));
 if(removal.application==='applied'){
  const result=await record('staged-install-0.26.1',()=>manager.installBundle(v2.path,{enabled:true,expected:{name:'dsh-plugin-wsl-env',version:targetVersion}}));
  await record('staged-after-state',async()=>({bundles:await manager.listBundles(),plugins:await manager.listPlugins()}));
  if(result.application==='applied')await record('staged-full-wsl-0.26.1-all-active',()=>active(manager,'staged-v2'));
  else{
   const after=(await manager.listBundles()).find(b=>b.name==='dsh-plugin-wsl-env');let cleanup;
   if(after?.installed)cleanup=await record('staged-failed-cleanup',()=>manager.removeBundle('dsh-plugin-wsl-env'));
   if(!cleanup||cleanup.application==='applied'){await record('staged-restore-0.24.0',()=>manager.installBundle(v1.path,{enabled:true,expected:{name:'dsh-plugin-wsl-env',version:'0.24.0'}}));await record('staged-restored-0.24.0-all-active',()=>active(manager,'restore'));}
  }
 }
 evidence.completed=true;evidence.coldAllActive=true;evidence.officialApplication=official.result?.application;evidence.samePid=true;
 }
 }
}catch(error){evidence.completed=false;evidence.fatal=String(error.stack||error);process.exitCode=1;}
finally{if(ctx)await ctx.fiber.dispose().catch(error=>{evidence.cleanupError=String(error.stack||error)});evidence.finishedAt=new Date().toISOString();if(out)await fs.writeFile(out,JSON.stringify(evidence,null,2));process.chdir(originalCwd);await fs.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});console.log('FULL_WSL_PROOF_EVIDENCE',out,'completed',evidence.completed);}
