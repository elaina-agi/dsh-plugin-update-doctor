import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const anchor=process.env.DSH_INSTALL_DIR;
const require=createRequire(join(anchor,'package.json'));
const imported=async name=>import(pathToFileURL(require.resolve(name)).href);
const app=await imported('@deepseek-ai/dsh-app-boot');
const ops=await imported('@deepseek-ai/dsh-plugin-manager/operations');
const root=await fs.mkdtemp(join(tmpdir(),'dsh-wsl-online-proof-'));
process.env.DSH_HOME=root;
const profileDir=join(root,'profiles','proof');await fs.mkdir(profileDir,{recursive:true});
const pnpm=process.argv[3],out=process.argv[2];
const evidence={schemaVersion:1,runtimeVersion:app.getDshRuntimeVersion(),pid:process.pid,root,results:[],limitations:['Actual WSL packages and Host modules in a unique isolated profile; not the user desktop composition.','No WSL commands or real user task intentionally executed.','Minimal Host composition lacks browser/agent/workspace optional services, so pending states do not reproduce the user whole Desktop.']};
const context={name:'proof',dir:profileDir,patchPath:join(profileDir,'cordis.patch.yml'),installAnchor:join(anchor,'package.json'),cwd:root,home:root,startedBundles:['dsh-plugin-wsl-env'],overlays:[],telemetryDisabledEnv:'1',packageManager:{command:process.execPath,args:['--expose-internals',pnpm],env:{ELECTRON_RUN_AS_NODE:'1',CI:'true'}}};
const patch=[{insert:[{id:'timer',name:'@deepseek-ai/cordis-plugin-timer'},{id:'hmr',name:'@deepseek-ai/dsh-hmr',config:{root:[],debounce:20,ignored:[],awaitWriteFinish:false}},{id:'plugin-manager',name:'@deepseek-ai/dsh-plugin-manager',config:{inspectTimeoutMs:10000,githubConnectionTimeoutMs:1000,gitTransportTimeoutMs:1000,lockWaitMs:5000,idleTimeoutMs:30000}}]}];
await fs.writeFile(join(profileDir,'package.json'),JSON.stringify({name:'wsl-online-proof',private:true,type:'module',dependencies:{'dsh-plugin-wsl-env':'0.24.0'},dsh:{profile:{bundles:['dsh-plugin-wsl-env']}}},null,2));
await fs.writeFile(join(profileDir,'pnpm-workspace.yaml'),'autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\n');
await fs.writeFile(context.patchPath,JSON.stringify(patch));const config=join(profileDir,'cordis.yml');await fs.writeFile(config,'[]\n');
let ctx;
async function record(name,fn){try{const value=await fn();evidence.results.push({name,value});console.log('WSL_PROOF',name,JSON.stringify(value));return value;}catch(error){const diagnostic=String(error.stack||error);evidence.results.push({name,error:diagnostic});console.error('WSL_PROOF_ERROR',name,diagnostic);throw error;}}
try{
 const installed=await record('install-real-wsl-0.24.0',()=>ops.runProfilePnpm({profile:'proof',...context},['install','--registry=https://registry.npmjs.org'],{...context.packageManager,execution:'service',outputBytes:20000,lockWaitMs:5000,idleTimeoutMs:30000}));if(installed.exitCode!==0)throw Error(installed.output);
 const profile=app.loadProfileDirectory('wsl-proof',profileDir,context.installAnchor);const resolution=await app.createRuntimeResolution({installAnchor:context.installAnchor,profile,home:root});
 ctx=await app.boot('wsl-proof',config,app.readProfilePatches('wsl-proof',context,profile),async rootCtx=>{rootCtx.provide('profileContext',context);rootCtx.provide('appReady',{onReady(callback){queueMicrotask(callback);return()=>{};}});await rootCtx.plugin(app.PluginPackages,{resolution});},pathToFileURL(join(profileDir,'package.json')).href);
 const manager=ctx.get('pluginManager');if(!manager)throw Error('Manager unavailable');
 await record('cold-real-wsl-0.24.0-rows',()=>manager.listPlugins());
 const result=await record('real-wsl-updateBundle-0.26.1',()=>manager.updateBundle('dsh-plugin-wsl-env','0.26.1',{registry:'https://registry.npmjs.org'}));
 await record('after-real-wsl-update-rows',()=>manager.listPlugins());
 await record('after-real-wsl-disk-state',()=>manager.listBundles());
 evidence.completed=true;evidence.updateApplication=result.result?.application;
}catch(error){evidence.completed=false;evidence.fatal=String(error.stack||error);process.exitCode=1;}
finally{if(ctx)await ctx.fiber.dispose();if(out)await fs.writeFile(out,JSON.stringify(evidence,null,2));await fs.rm(root,{recursive:true,force:true});console.log('WSL_PROOF_EVIDENCE',out,'completed',evidence.completed);}
