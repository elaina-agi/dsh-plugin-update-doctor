import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tar } from '../tests/helpers/service-fixture.mjs';
import { RegistryStager } from '../lib/staging.js';
import { DoctorService } from '../lib/service.js';
import { TaskGate } from '../lib/task-gate.js';
import { probeLocks } from '../lib/locks.js';
import { createHandler, PANEL_HEADER, PANEL_MARKER } from '../lib/http.js';

const [out, pnpm] = process.argv.slice(2), anchor = process.env.DSH_INSTALL_DIR;
assert(anchor?.includes('app.asar') && process.versions.electron);
const require = createRequire(join(anchor, 'package.json'));
const imported = name => import(pathToFileURL(require.resolve(name)).href);
const app = await imported('@deepseek-ai/dsh-app-boot'), ops = await imported('@deepseek-ai/dsh-plugin-manager/operations');
const root = await fs.mkdtemp(join(tmpdir(), 'dsh-v3-recovery-proof-'));
process.env.DSH_HOME = root; process.env.DSH_TELEMETRY_DISABLED = '1';
const profileDir = join(root, 'profiles', 'proof'); await fs.mkdir(profileDir, {recursive:true});
const name = 'owned-recovery-proof-plugin';
const evidence = { runtimeVersion: app.getDshRuntimeVersion(), pid: process.pid, root, results: [], limitations: [
    'Actual installed AppBoot/Cordis/Loader/HMR/PluginManager package operations and real production DoctorService/RegistryStager/TaskGate/HTTP handler; only owned temporary profile and fixture package.',
    'Registry fetch adapter supplies owned fixture bytes under logical public npm URLs. Installed-source query adapter reports that fixture origin; not public npm publication evidence.',
    'The handler receives an in-memory authenticated-panel-shaped Request; real Connection authentication was tested separately, not simulated as evidence here.',
    'No browser, model, Agent task, user profile or WSL is touched. Explicit recovery failure is injected once at the package-operation boundary, not claimed as a real npm/activation defect.'
] };
const packages = new Map();
for (const version of ['1.0.0','1.1.0']) {
    const manifest = {name,version,type:'module',exports:{'.':'./index.js','./package.json':'./package.json'},dsh:{bundle:{patch:'cordis.patch.yml'}}};
    const bytes = tar([['package/package.json',JSON.stringify(manifest)],['package/cordis.patch.yml',`- insert:\n    - id: owned-recovery-proof\n      name: ${name}\n`],['package/index.js',`export function apply(ctx){${version==='1.1.0'?"throw Error('OWNED_V3_BAD_ACTIVATION');":"ctx.provide('ownedRecoveryCode',{read:()=> 'original-code-1.0.0'});"}}`]]);
    packages.set(version,{manifest,bytes});
}
const stager = new RegistryStager(join(root,'cache','dsh-plugin-update-doctor','proof','staged'), { fetcher: async url => {
    const path = new URL(url).pathname, version = path.endsWith('.tgz') ? /-(\d+\.\d+\.\d+)\.tgz$/.exec(path)[1] : path.split('/').at(-1), pkg = packages.get(version);
    assert(pkg);return path.endsWith('.tgz')?new Response(pkg.bytes):Response.json({...pkg.manifest,dist:{tarball:`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,integrity:'sha512-'+createHash('sha512').update(pkg.bytes).digest('base64')}});
}});
const old = await stager.stage(name,'1.0.0');
const context = {name:'proof',home:root,dir:profileDir,patchPath:join(profileDir,'cordis.patch.yml'),installAnchor:join(anchor,'package.json'),cwd:root,startedBundles:[name],overlays:[],telemetryDisabledEnv:'1',packageManager:{command:process.execPath,args:['--expose-internals',pnpm],env:{ELECTRON_RUN_AS_NODE:'1',CI:'true'}}};
await fs.writeFile(join(profileDir,'package.json'),JSON.stringify({name:'owned-recovery-profile',private:true,type:'module',dependencies:{[name]:'file:'+old.archivePath},dsh:{profile:{bundles:[name]}}}));
await fs.writeFile(join(profileDir,'pnpm-workspace.yaml'),`autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\nstoreDir: ${JSON.stringify(join(root,'pnpm-store'))}\npackageImportMethod: copy\n`);
await fs.writeFile(context.patchPath,JSON.stringify([{insert:[{id:'timer',name:'@deepseek-ai/cordis-plugin-timer'},{id:'hmr',name:'@deepseek-ai/dsh-hmr',config:{root:[],ignored:[],debounce:20,awaitWriteFinish:false}},{id:'plugin-manager',name:'@deepseek-ai/dsh-plugin-manager',config:{inspectTimeoutMs:10000,lockWaitMs:5000,idleTimeoutMs:20000,registry:'https://registry.npmjs.org',fallbackRegistries:[]}}]}]));
const config = join(profileDir,'cordis.yml');await fs.writeFile(config,'[]\n');
let ctx,service;
async function step(label,fn){const value=await fn();evidence.results.push({name:label,value});console.log('V3_RECOVERY',label,JSON.stringify(value));return value;}
try {
    const initial = await ops.runProfilePnpm({profile:'proof',...context},['install','--offline'],{...context.packageManager,execution:'service',outputBytes:30000,lockWaitMs:5000,idleTimeoutMs:20000});assert.equal(initial.exitCode,0,initial.output);
    const profile=app.loadProfileDirectory('owned-v3-proof',profileDir,context.installAnchor),resolution=await app.createRuntimeResolution({installAnchor:context.installAnchor,profile,home:root});
    ctx=await app.boot('owned-v3-proof',config,app.readProfilePatches('owned-v3-proof',context,profile),async c=>{c.provide('profileContext',context);c.provide('appReady',{onReady(cb){queueMicrotask(cb);return()=>{};}});await c.plugin(app.PluginPackages,{resolution});},pathToFileURL(join(profileDir,'package.json')).href);
    const manager=ctx.get('pluginManager');assert.equal(ctx.get('ownedRecoveryCode').read(),'original-code-1.0.0');
    service=new DoctorService({manager,profile:context,runtimeVersion:app.getDshRuntimeVersion(),resolvePackage:async n=>app.resolveBundleDir('proof',n,context.installAnchor,profileDir),probeLocks,statePath:join(root,'cache','dsh-plugin-update-doctor','proof','history.json'),taskGate:new TaskGate({list:()=>[]}),stager});
    await service.initialize();await service.identities.remember(stager.reference(old));
    let injected=false;const realInstall=manager.installBundle.bind(manager);
    manager.installBundle=async(path,options)=>{if(options.expected.version==='1.0.0'&&!injected){injected=true;return{application:'failed',stage:'install',error:{code:'owned-injected-failure',diagnostic:'Owned one-time recovery rejection; no package command executed'}};}return realInstall(path,options);};
    ctx.on('plugin-manager/install-state',value=>service.onInstallProgress(value));ctx.on('plugin-manager/install-log',value=>service.onInstallLog(value));
    const next=await stager.stage(name,'1.1.0'),baseline=(await manager.listBundles()).find(b=>b.name===name),id='owned-failure-batch',steps=[];
    const job={id,package:name,phase:'waiting',controller:new AbortController(),steps,record:{id,operation:'batch-update',origin:'doctor',phase:'waiting',taskPolicy:'wait-for-idle',items:[{name,from:'1.0.0',to:'1.1.0',enabled:true,registry:'https://registry.npmjs.org',fingerprint:service.fingerprint(baseline),nextReference:stager.reference(next),previousReference:stager.reference(old),status:'waiting'}],steps}};
    service.busy=job;service.jobs.set(id,job);await step('real-target-failure-and-injected-automatic-restore-failure',async()=>{await service.runBatch(job);service.busy=null;return job.record;});
    assert.equal(job.record.items[0].result.application,'failed');assert.equal(job.record.items[0].restore.application,'failed');assert.equal((await service.list()).bundles.find(b=>b.name===name).canRestore,true);
    for(let i=0;i<90;i++)await service.store.put({id:'other-event-'+i,package:'other',phase:'settled',event:{application:'applied'}});
    assert.equal(service.store.list(name).length,0);assert(service.recoveryFor(name));
    const handler=createHandler(service),headers={'content-type':'application/json',[PANEL_HEADER]:PANEL_MARKER};
    const prepared=await handler(new Request('http://dsh.internal/api/plugin-update-doctor',{method:'POST',headers,body:JSON.stringify({action:'prepare-restore',name})}));assert.equal(prepared.status,200);const plan=await prepared.json();assert.equal(plan.operation,'batch-restore');
    const committed=await handler(new Request('http://dsh.internal/api/plugin-update-doctor',{method:'POST',headers,body:JSON.stringify({action:'commit',ticket:plan.ticket})}));assert.equal(committed.status,200);const start=await committed.json();await service.jobs.get(start.operationId).work;
    const result=await step('name-only-confirmed-exact-recovery',async()=>service.operation(start.operationId));
    assert.equal(result.record.items[0].status,'restored');assert.equal(ctx.get('ownedRecoveryCode').read(),'original-code-1.0.0');assert.equal(service.recoveryFor(name),undefined);
    await step('restored-real-code-and-host',async()=>({code:ctx.get('ownedRecoveryCode').read(),bundle:(await manager.listBundles()).find(b=>b.name===name),rows:(await manager.listPlugins()).filter(row=>row.moduleName===name),pid:process.pid}));
    evidence.passed=true;
}catch(error){evidence.passed=false;evidence.fatal=String(error.stack||error);process.exitCode=1;}
finally{
    if(service)await service.dispose();if(ctx)await ctx.fiber.dispose();
    const checked=resolve(root);assert.equal(dirname(checked),resolve(tmpdir()));assert(basename(checked).startsWith('dsh-v3-recovery-proof-'));assert.equal(await fs.realpath(checked),checked);assert.equal((await fs.lstat(checked)).isSymbolicLink(),false);console.log('V3_RECOVERY_CLEANUP_TARGET',checked);await fs.rm(checked,{recursive:true,force:true,maxRetries:3,retryDelay:100});evidence.cleaned=true;await fs.writeFile(out,JSON.stringify(evidence,null,2));
}
