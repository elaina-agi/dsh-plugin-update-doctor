import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { DoctorService } from '../lib/service.js';
import { RegistryStager } from '../lib/staging.js';
import { TaskGate } from '../lib/task-gate.js';
import { createHandler } from '../lib/http.js';

const [evidenceDirectory, resultPath, pnpm] = process.argv.slice(2);
const anchor = process.env.DSH_INSTALL_DIR;
assert(anchor?.includes('app.asar') && process.versions.electron);
const require = createRequire(join(anchor, 'package.json'));
const imported = name => import(pathToFileURL(require.resolve(name)).href);
const app = await imported('@deepseek-ai/dsh-app-boot');
const { provideCmdline } = await imported('@deepseek-ai/dsh-cmdline');
const temporary = await fs.realpath(tmpdir()), root = await fs.mkdtemp(join(temporary, 'dsh-sidebar-proof-'));
const originalCwd = process.cwd(); process.chdir(root); process.env.DSH_HOME = root; process.env.DSH_TELEMETRY_DISABLED = '1';
const watchdog = setTimeout(() => { console.error('Owned sidebar proof timed out; no success inferred. Root: ' + root); process.exit(2); }, 600000); watchdog.unref();
const name = 'dsh-better-sidebar', from = '0.32.1', to = '0.33.0', packages = new Map();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const evidence = { runtimeVersion: app.getDshRuntimeVersion(), pid: process.pid, passed: false, root,
    limitations: ['Actual public sidebar archives, unmodified installed DSH rc.5, owned temporary profile/store/cache.',
        'Registry metadata and package transport for the root target are explicitly adapted through loopback; logical mirror redirect preflight is a fixture. Separate real-network mirror inspection is recorded independently.',
        'No user profile, browser clicks, models, user tasks, WSL or global registry changes. Activation and resource availability do not prove browser rendering.',
        'Recovery experiment deliberately rejects the exact target at the install API boundary once, before its package command; this is not a real activation-failure test.'] };
let ctx, server, service, origin, rejections = 0;
const metadata = (pkg, base) => ({ ...pkg.manifest, dist: { tarball: `${base}/${name}/-/${name}-${pkg.manifest.version}.tgz`, integrity: integrity(pkg.bytes), shasum: createHash('sha1').update(pkg.bytes).digest('hex') } });
try {
    for (const version of [from, to]) {
        const bytes = await fs.readFile(join(evidenceDirectory, version, `${name}-${version}.tgz`));
        const manifest = JSON.parse(await fs.readFile(join(evidenceDirectory, version, 'package.json'), 'utf8'));
        packages.set(version, { bytes, manifest });
    }
    const delegated = new Map();
    server = createServer(async (request, response) => {
        try {
            const path = decodeURIComponent(new URL(request.url, 'http://fixture.invalid').pathname);
            if (path === `/${name}`) {
                response.setHeader('content-type', 'application/json');
                response.end(JSON.stringify({ name, 'dist-tags': { latest: to }, versions: Object.fromEntries([...packages].map(([v, p]) => [v, metadata(p, origin)])), time: { [from]: '2026-11-01T00:00:00Z', [to]: '2026-11-02T00:00:00Z' } })); return;
            }
            for (const [version, pkg] of packages) {
                if (path === `/${name}/${version}`) { response.setHeader('content-type','application/json'); response.end(JSON.stringify(metadata(pkg, origin))); return; }
                if (path === `/${name}/-/${name}-${version}.tgz`) {
                    response.setHeader('content-type', 'application/octet-stream'); response.end(pkg.bytes); return;
                }
            }
            if (!/^\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(path)) { response.statusCode = 404; response.end('Unknown fixture resource'); return; }
            if (!delegated.has(path)) delegated.set(path, (async () => {
                const result = await fetch('https://registry.npmjs.org' + path, { redirect:'error', credentials:'omit', signal:AbortSignal.timeout(45000), headers:{accept:'application/vnd.npm.install-v1+json'} });
                if (!result.ok) throw Error('Dependency metadata HTTP ' + result.status);
                return await result.text();
            })());
            response.setHeader('content-type','application/json'); response.end(await delegated.get(path));
        } catch (error) { response.statusCode=502; response.end('Owned metadata forwarding failed'); console.error(error.message); }
    });
    server.listen(0, '127.0.0.1'); await once(server,'listening'); origin = `http://127.0.0.1:${server.address().port}`;
    const dir = join(root,'profiles','proof'); await fs.mkdir(dir,{recursive:true});
    const composition = ['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app'];
    const context = {name:'proof',dir,patchPath:join(dir,'cordis.patch.yml'),installAnchor:join(anchor,'package.json'),cwd:root,home:root,startedBundles:composition,overlays:[],telemetryDisabledEnv:'1',
        packageManager:{command:process.execPath,args:['--expose-internals',pnpm],env:{ELECTRON_RUN_AS_NODE:'1',CI:'true'}}};
    await fs.writeFile(join(dir,'package.json'),JSON.stringify({name:'owned-sidebar-proof',private:true,type:'module',dependencies:{},dsh:{profile:{bundles:composition}}}));
    await fs.writeFile(join(dir,'pnpm-workspace.yaml'),`autoInstallPeers: false\nstrictPeerDependencies: false\nignoreScripts: true\nnodeLinker: hoisted\nregistry: ${JSON.stringify(origin)}\nnetworkConcurrency: 1\nfetchRetries: 0\nstoreDir: ${JSON.stringify(join(root,'pnpm-store'))}\ncacheDir: ${JSON.stringify(join(root,'pnpm-cache'))}\npackageImportMethod: copy\nminimumReleaseAge: 0\n`);
    const disabled=['web-runtime','harness-dev-context','open-in-app','directory-picker','client-hmr','session-title-llm','llm-deepseek','llm-deepseek-account','llm-pi-ai','session-telemetry-otel','desktop-product-telemetry','product-analytics'];
    await fs.writeFile(context.patchPath, JSON.stringify([...disabled.map(id=>({id,disabled:true})),
        {id:'credentials',config:{path:join(root,'owned-empty-store.yaml'),dshHome:root,watch:false}},
        {id:'agent-loop',config:{agents:[]}}, {id:'plugin-manager',config:{registry:origin,fallbackRegistries:[],inspectTimeoutMs:45000,lockWaitMs:5000,idleTimeoutMs:90000}}]));
    const config=join(dir,'cordis.yml'); await fs.writeFile(config,'[]\n');
    const profile=app.loadProfileDirectory('sidebar-proof',dir,context.installAnchor), resolution=await app.createRuntimeResolution({installAnchor:context.installAnchor,profile,home:root});
    let ready=false; const listeners=new Set();
    ctx=await app.boot('sidebar-proof',config,app.readProfilePatches('sidebar-proof',context,profile),async c=>{
        c.provide('profileContext',context); await c.plugin(app.PluginPackages,{resolution});
        provideCmdline(c,{args:['--no-open','--port','0'],exit:code=>{throw Error('Unexpected fixture exit '+code)},ready:{onReady(cb){if(ready)cb();else listeners.add(cb);return()=>listeners.delete(cb);}}});
    },pathToFileURL(join(dir,'package.json')).href);
    ready=true; for(const cb of [...listeners])cb(); listeners.clear();
    const manager=ctx.get('pluginManager'); assert(manager); console.log('SIDEBAR_PROOF initial-install');
    const initial=await manager.installBundle(`${name}@${from}`,{registry:origin,enabled:true,expected:{name,version:from}});
    assert.equal(initial.application,'applied',JSON.stringify(initial));
    const realVersions=manager.listVersions.bind(manager), realUpdate=manager.updateBundle.bind(manager), realInstall=manager.installBundle.bind(manager);
    const originalRegistries=manager.registries.bind(manager);
    manager.listVersions=async(n,options,signal)=>{const answer=await realVersions(n,{registry:origin},signal);return {...answer,registry:'https://registry.npmmirror.com'};};
    manager.registries=async()=>({registry:'https://registry.npmmirror.com',resolved:'https://registry.npmmirror.com',fallbackRegistries:[]});
    let handoffs=0;
    manager.updateBundle=async(n,v,options)=>{assert.equal(n,name);assert.equal(v,to);assert.equal(options.registry,'https://registry.npmmirror.com');handoffs++; return realUpdate(n,v,{...options,registry:origin});};
    const realPackage = n=>app.resolveBundleDir('sidebar-proof',n,context.installAnchor,dir);
    let cdnReads=0;
    const stager=new RegistryStager(join(root,'doctor','staged'),{compatibility:manifest=>app.evaluatePluginCompatibility(manifest,{}),fetcher:async(url,options)=>{
        const parsed=new URL(url), version=parsed.pathname.includes(from)?from:to, pkg=packages.get(version);
        if(parsed.origin==='https://cdn.npmmirror.com'){cdnReads++;return new Response(pkg.bytes);}
        if(parsed.pathname.endsWith('.tgz')) return parsed.origin==='https://registry.npmmirror.com'
            ? new Response('',{status:302,headers:{location:`https://cdn.npmmirror.com/packages/${name}/${version}/${name}-${version}.tgz`}}) : new Response(pkg.bytes);
        return Response.json(metadata(pkg,parsed.origin));
    }});
    service=new DoctorService({manager,profile:context,runtimeVersion:app.getDshRuntimeVersion(),resolvePackage:realPackage,probeLocks:async()=>({status:'checked',files:[]}),
        statePath:join(root,'doctor','history.json'),taskGate:new TaskGate({list:()=>[]}),stager}); await service.initialize();
    const handler=createHandler(service), headers={'content-type':'application/json','x-dsh-plugin-update-doctor':'panel-v1'};
    const call=async body=>{const result=await handler(new Request('http://dsh.internal/api/plugin-update-doctor',{method:'POST',headers,body:JSON.stringify(body)}));const value=await result.json();assert.equal(result.status,200,JSON.stringify(value));return value;};
    const perform=async()=>{const scan=await service.scan();const item=scan.items.find(i=>i.name===name);assert.equal(item.canUpdate,true,JSON.stringify(item));
        const plan=await call({action:'prepare-batch',items:[{name,version:to}]}); assert.equal(plan.items[0].installMode,'registry-spec');
        const start=await call({action:'commit',ticket:plan.ticket,confirmPublicMirror:true}); await service.jobs.get(start.operationId).work;return service.operation(start.operationId).record;};
    // Refuse the target after Host removal, then let the original manager reinstall the saved old spec.
    const installGuard=manager.installBundle;
    manager.installBundle=async(spec,options)=>{
        if(spec===`${name}@${to}`) { rejections++;return {changed:false,application:'failed',stage:'install',target:name,error:{code:'owned-target-rejected',diagnostic:'Explicit owned target rejection before package command'}}; }
        return realInstall(spec,options);
    };
    console.log('SIDEBAR_PROOF failed-target-recovery');
    const failed=await perform();
    assert.equal(failed.items[0].result.application,'failed',JSON.stringify(failed));
    assert.equal(failed.items[0].restore?.application,'applied',JSON.stringify(failed));
    assert.equal(failed.items[0].restoreVerification?.package.status,'verified');
    evidence.recovery=failed; manager.installBundle=installGuard;
    console.log('SIDEBAR_PROOF successful-update');
    const updated=await perform();
    assert.equal(updated.items[0].status,'updated',JSON.stringify(updated));
    const bundle=(await manager.listBundles()).find(item=>item.name===name),rows=(await manager.listPlugins()).filter(item=>item.moduleName===name);
    assert.equal(bundle.version,to);assert.equal(bundle.source,`${name}@${to}`);assert.equal(bundle.update,'registry');assert(rows.length===1&&rows.every(row=>row.fiberPhase==='active'));
    assert.equal(updated.items[0].verification.package.status,'verified');
    const versions=await realVersions(name,{registry:origin});assert.equal(versions.status,'listed');
    evidence.passed=true;evidence.handoffs=handoffs;evidence.cdnReads=cdnReads;evidence.rejections=rejections;evidence.updated=updated;evidence.final={version:bundle.version,source:bundle.source,update:bundle.update,activeRows:rows.length,versionsStatus:versions.status};
    manager.registries=originalRegistries;
} catch(error) {evidence.fatal=String(error.stack??error);process.exitCode=1;}
finally {
    if(service)await service.dispose();if(ctx)await ctx.fiber.dispose();
    if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}
    process.chdir(originalCwd);
    const actual=await fs.realpath(root);assert.equal(actual,resolve(root));assert.equal(dirname(actual),temporary);assert(basename(actual).startsWith('dsh-sidebar-proof-'));assert(!(await fs.lstat(actual)).isSymbolicLink());
    await fs.rm(actual,{recursive:true,force:true,maxRetries:3,retryDelay:100});evidence.cleaned=true;
    await fs.writeFile(resultPath,JSON.stringify(evidence,null,2)+'\n');clearTimeout(watchdog);
    console.log('SIDEBAR_PROOF_RESULT',JSON.stringify({passed:evidence.passed,cleaned:evidence.cleaned,final:evidence.final,fatal:evidence.fatal}));
}
