import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname, relative, isAbsolute, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { DoctorService } from '../lib/service.js';
import { RegistryStager } from '../lib/staging.js';
import { TaskGate } from '../lib/task-gate.js';
import { probeLocks } from '../lib/locks.js';

// Run each method in a fresh process/profile. All management targets below are
// generated fixtures; this runner never reads or mutates the Desktop profile.
const mode = process.argv[2];
const pnpm = process.argv[3];
if (!['official', 'generic', 'cold-v2'].includes(mode)) throw Error('Expected official, generic or cold-v2 proof mode');
const anchor = process.env.DSH_INSTALL_DIR;
if (!anchor?.includes('app.asar') || !process.versions.electron) throw Error('Installed ASAR Electron runtime required');
const require = createRequire(join(anchor, 'package.json'));
const imported = async name => import(pathToFileURL(require.resolve(name)).href);
const app = await imported('@deepseek-ai/dsh-app-boot');
const ops = await imported('@deepseek-ai/dsh-plugin-manager/operations');
const tempParent = await fs.realpath(tmpdir());
const root = await fs.mkdtemp(join(tempParent, 'dsh-module-cache-proof-'));
const originalCwd = process.cwd();
process.env.DSH_HOME = root;
process.env.DSH_TELEMETRY_DISABLED = '1';
for (const key of Object.keys(process.env)) if (/API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD/i.test(key)) delete process.env[key];
const profileDir = join(root, 'profiles', 'proof');
await fs.mkdir(profileDir, { recursive: true });
const packageName = 'module-cache-proof-plugin';
const record = { schemaVersion: 1, method: mode, runtimeVersion: app.getDshRuntimeVersion(), pid: process.pid, root, steps: [], events: [], startedAt: new Date().toISOString(), limitations: [
  'Unique temporary profile and generated npm-registry fixtures; no user profile or current GUI is accessed.',
  'Actual installed AppBoot, Cordis, Loader, HMR and PluginManager perform activation and package replacement.',
  'Fixture 1.0.0 helper lacks newValue; fixture 1.1.0 adds that export and its entry imports/calls it.',
  'Generic path directly drives production DoctorService.runBatch only for owned fixture targets; no real-user confirmation ticket is created.',
  'The staging transport adapter maps an HTTPS logical fixture registry onto an owned loopback HTTP server; integrity, TAR, patch admission and installed code execution are real.',
  'No Agents or model requests exist in this minimal Host. TaskGate has an empty fixture registry; task continuity and browser synchronization are not tested.',
] };
const identity = process.pid + '-' + randomUUID();
globalThis.__moduleCacheProof = { events: record.events, identity };
function tar(files) {
  const parts = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text), header = Buffer.alloc(512);
    header.write(name, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136);
    header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257); header.write('00', 263);
    header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    parts.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  parts.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(parts));
}
function makePackage(version, bad = false) {
  const manifest = { name: packageName, version, type: 'module', exports: { '.': './index.js', './package.json': './package.json' }, dsh: { bundle: { patch: 'cordis.patch.yml' } } };
  const modern = version !== '1.0.0';
  const helper = modern ? `export function legacyValue(){return 'helper-v1';}\nexport function newValue(){return 'new-export-${version}';}\n` : `export function legacyValue(){return 'helper-v1';}\n`;
  const source = `import { ${modern ? 'newValue' : 'legacyValue'} } from './helper.js';\nexport function apply(ctx){\n const proof=globalThis.__moduleCacheProof;proof.events.push({kind:'start',version:'${version}',pid:process.pid,identity:proof.identity});\n ${bad ? "throw Error('OWNED_BAD_ACTIVATION: intentional recovery fixture');" : ''}\n ctx.provide('moduleCacheProofRevision',{version:'${version}',read:()=>${modern ? 'newValue' : 'legacyValue'}(),identity:proof.identity,pid:process.pid});\n ctx.effect(()=>async()=>{proof.events.push({kind:'dispose-start',version:'${version}',pid:process.pid});await new Promise(r=>setTimeout(r,30));proof.events.push({kind:'dispose-end',version:'${version}',pid:process.pid});});\n}\n`;
  const bytes = tar({ 'package/package.json': JSON.stringify(manifest), 'package/cordis.patch.yml': `- insert:\n    - id: module-cache-proof-target\n      name: ${packageName}\n`, 'package/index.js': source, 'package/helper.js': helper });
  return { manifest, bytes, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
}
const packages = new Map([['1.0.0', makePackage('1.0.0')], ['1.1.0', makePackage('1.1.0')], ['1.2.0', makePackage('1.2.0', true)]]);
let registry;
function packument(version, origin) {
  const pkg = packages.get(version);
  return { ...pkg.manifest, _id: packageName + '@' + version, dist: { tarball: `${origin}/${packageName}/-/${packageName}-${version}.tgz`, integrity: pkg.integrity, shasum: createHash('sha1').update(pkg.bytes).digest('hex') } };
}
const server = createServer((req, res) => {
  const url = new URL(req.url, registry || 'http://127.0.0.1');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  const name = decodeURIComponent(url.pathname.slice(1));
  const archive = /^module-cache-proof-plugin\/-\/module-cache-proof-plugin-(\d+\.\d+\.\d+)\.tgz$/.exec(name);
  if (archive && packages.has(archive[1])) { res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(packages.get(archive[1]).bytes); return; }
  if (name === packageName) {
    const versions = Object.fromEntries([...packages.keys()].map(v => [v, packument(v, registry)]));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ name: packageName, 'dist-tags': { latest: '1.1.0' }, versions, time: { created: '2026-01-01T00:00:00Z', modified: '2026-01-03T00:00:00Z', '1.0.0': '2026-01-01T00:00:00Z', '1.1.0': '2026-01-02T00:00:00Z', '1.2.0': '2026-01-03T00:00:00Z' } })); return;
  }
  const version = name.startsWith(packageName + '/') ? name.slice(packageName.length + 1) : undefined;
  if (packages.has(version)) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(packument(version, registry))); return; }
  res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'owned fixture package not found' }));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
registry = `http://127.0.0.1:${server.address().port}`;
const context = { name: 'proof', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), installAnchor: join(anchor, 'package.json'), cwd: root, home: root, startedBundles: [packageName], overlays: [], telemetryDisabledEnv: '1', packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { ELECTRON_RUN_AS_NODE: '1', CI: 'true' } } };
const initialVersion = mode === 'cold-v2' ? '1.1.0' : '1.0.0';
await fs.writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'owned-module-cache-profile', private: true, type: 'module', dependencies: { [packageName]: initialVersion }, dsh: { profile: { bundles: [packageName] } } }, null, 2));
await fs.writeFile(join(profileDir, 'pnpm-workspace.yaml'), 'autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\nminimumReleaseAge: 0\n' + `storeDir: ${JSON.stringify(join(root,'pnpm-store'))}\ncacheDir: ${JSON.stringify(join(root,'pnpm-cache'))}\npackageImportMethod: copy\n`);
await fs.writeFile(join(profileDir, '.npmrc'), `registry=${registry}/\naudit=false\nstore-dir=${join(root, 'pnpm-store').replaceAll('\\','/')}\ncache-dir=${join(root, 'pnpm-cache').replaceAll('\\','/')}\n`);
const unrelated = join(root, 'unrelated.mjs');
await fs.writeFile(unrelated, "export function apply(ctx){ctx.provide('moduleCacheProofUnrelated',{read:()=> 'unrelated-alive',pid:process.pid});}");
const patches = [{ insert: [
  { id: 'timer', name: '@deepseek-ai/cordis-plugin-timer' },
  { id: 'hmr', name: '@deepseek-ai/dsh-hmr', config: { root: [], debounce: 20, ignored: [], awaitWriteFinish: false } },
  { id: 'plugin-manager', name: '@deepseek-ai/dsh-plugin-manager', config: { registry, fallbackRegistries: [], inspectTimeoutMs: 10000, githubConnectionTimeoutMs: 1000, gitTransportTimeoutMs: 1000, lockWaitMs: 5000, idleTimeoutMs: 15000 } },
  { id: 'module-cache-unrelated', name: pathToFileURL(unrelated).href },
] }];
await fs.writeFile(context.patchPath, JSON.stringify(patches));
const config = join(profileDir, 'cordis.yml'); await fs.writeFile(config, '[]\n');
let ctx, service, gate;
async function step(name, fn) {
  const started = Date.now();
  try { const value = await fn(); record.steps.push({ name, observed: true, elapsedMs: Date.now() - started, value }); return value; }
  catch (error) { record.steps.push({ name, observed: false, elapsedMs: Date.now() - started, error: String(error.stack || error) }); throw error; }
}
async function actualState(manager) {
  const bundle = (await manager.listBundles()).find(item => item.name === packageName);
  const rows = (await manager.listPlugins()).filter(row => row.moduleName === packageName || row.moduleName.startsWith(packageName + '/'));
  const implementation = ctx.get('moduleCacheProofRevision');
  return { diskVersion: bundle?.version, source: bundle?.source, enabled: bundle?.enabled, rows: rows.map(row => ({ id: row.entryId, enabled: row.enabled, phase: row.fiberPhase })), runtimeVersion: implementation?.version, codeResult: implementation?.read(), pid: process.pid, sameProcessIdentity: implementation?.identity === identity, unrelated: ctx.get('moduleCacheProofUnrelated')?.read() };
}
async function recoverV1(manager) {
  const present = (await manager.listBundles()).find(item => item.name === packageName);
  const results = [];
  if (present?.installed) { const removed = await manager.removeBundle(packageName); results.push({ step: 'remove', result: removed }); if (removed.application !== 'applied') return results; }
  const archive = join(root, 'restore-v1.tgz'); await fs.writeFile(archive, packages.get('1.0.0').bytes);
  results.push({ step: 'install', result: await manager.installBundle(archive, { enabled: true, expected: { name: packageName, version: '1.0.0' } }) });
  results.push({ step: 'actual-restored-state', result: await actualState(manager) }); return results;
}
try {
  const initial = await step('initial-version-real-pnpm', () => ops.runProfilePnpm({ profile: 'proof', ...context }, ['install', '--registry=' + registry], { ...context.packageManager, execution: 'service', outputBytes: 30000, lockWaitMs: 5000, idleTimeoutMs: 15000 }));
  assert.equal(initial.exitCode, 0, initial.output);
  const modulesYaml=await fs.readFile(join(profileDir,'node_modules','.modules.yaml'),'utf8');
  const modulesMetadata=require('yaml').parse(modulesYaml);
  assert.equal(resolve(modulesMetadata.storeDir),join(root,'pnpm-store','v11'),'Installed virtual store must use the owned pnpm store');
  assert(initial.output.includes(join(root,'pnpm-store')),'Actual package-manager log must name owned store');
  record.ownedPnpmStoreVerified=true; record.actualStorePath=modulesMetadata.storeDir;
  const profile = app.loadProfileDirectory('module-cache-proof', profileDir, context.installAnchor);
  const resolution = await app.createRuntimeResolution({ installAnchor: context.installAnchor, profile, home: root });
  ctx = await app.boot('module-cache-proof', config, app.readProfilePatches('module-cache-proof', context, profile), async rootCtx => {
    rootCtx.provide('profileContext', context); rootCtx.provide('appReady', { onReady(callback) { queueMicrotask(callback); return () => {}; } });
    await rootCtx.plugin(app.PluginPackages, { resolution });
  }, pathToFileURL(join(profileDir, 'package.json')).href);
  const manager = ctx.get('pluginManager'); assert(manager);
  const before = await step('cold-initial-code', () => actualState(manager));
  assert.equal(before.codeResult, initialVersion === '1.0.0' ? 'helper-v1' : 'new-export-1.1.0'); assert.equal(before.runtimeVersion, initialVersion); assert(before.rows.every(row => row.phase === 'active')); assert(before.sameProcessIdentity);
  if (mode === 'cold-v2') {
    record.coldV2Verified = true; record.after = before; record.managementOutcome = 'cold-applied'; record.completed = true;
  } else {
  record.managerCalls = [];
  for (const method of ['removeBundle','installBundle']) { const real = manager[method].bind(manager); manager[method] = async (...args) => { const started=Date.now();const result=await real(...args);record.managerCalls.push({ method, target:args[0], elapsedMs:Date.now()-started, result });return result; }; }
  await step('official-version-listing', () => manager.listVersions(packageName, { registry }));
  if (mode === 'official') {
    const updated = await step('official-updateBundle-v1-to-v2', () => manager.updateBundle(packageName, '1.1.0', { registry }));
    record.managementOutcome = updated.result?.application;
    record.originalFailure = updated.result?.error ?? null; record.managerRestore = updated.restore ?? null;
    record.after = await step('actual-after-official-update', () => actualState(manager));
    if (updated.result?.application !== 'applied' || record.after.codeResult !== 'new-export-1.1.0') record.explicitRecovery = await step('explicit-v1-recovery', () => recoverV1(manager));
  } else {
    const logical = 'https://owned-module-cache-fixture.invalid';
    const stager = new RegistryStager(join(root, 'staged'), { registry: logical, compatibility: manifest => app.evaluatePluginCompatibility(manifest, {}), fetcher: async (input, init) => {
      const url = new URL(input); assert.equal(url.origin, logical);
      const response = await fetch(registry + url.pathname + url.search, init);
      if (url.pathname.endsWith('.tgz') || !response.ok) return response;
      const data = await response.json(); if (data.dist?.tarball) data.dist.tarball = data.dist.tarball.replace(registry, logical);
      return Response.json(data);
    } });
    gate = new TaskGate({ list: () => [] }, { timeoutMs: 10000 });
    service = new DoctorService({ manager, profile: context, runtimeVersion: app.getDshRuntimeVersion(), resolvePackage: async name => app.resolveBundleDir('proof', name, context.installAnchor, profileDir), probeLocks, statePath: join(root, 'doctor-history.json'), taskGate: gate, stager });
    await service.initialize();
    const raw = (await manager.listBundles()).find(item => item.name === packageName);
    const id = randomUUID();
    const sharedSteps=[];
    const batch = { id, package: packageName, phase: 'waiting', controller: new AbortController(), steps: sharedSteps, record: { id, operation: 'batch-update', origin: 'doctor-owned-fixture', phase: 'waiting', taskPolicy: 'wait-for-idle', items: [{ name: packageName, from: '1.0.0', to: '1.1.0', version: '1.1.0', enabled: true, fingerprint: service.fingerprint(raw), status: 'waiting' }], steps: sharedSteps } };
    await step('production-DoctorService-runBatch-generic', async () => { await service.runBatch(batch); return batch.record; });
    record.managementOutcome = batch.record.outcome;
    record.originalFailure = batch.record.items[0].result?.error ?? null; record.managerRestore = batch.record.items[0].restore ?? null;
    record.after = await step('actual-after-generic-batch', () => actualState(manager));
    if (batch.record.outcome !== 'applied' || record.after.codeResult !== 'new-export-1.1.0') record.explicitRecovery = await step('explicit-v1-recovery', () => recoverV1(manager));
  }
  record.codeActuallyUpdated = record.after.codeResult === 'new-export-1.1.0' && record.after.runtimeVersion === '1.1.0' && record.after.sameProcessIdentity;
  record.allTargetRowsActive = record.after.rows.length > 0 && record.after.rows.every(row => row.enabled && row.phase === 'active');
  record.unrelatedStayedAlive = record.after.unrelated === 'unrelated-alive';
  const disposeIndex=record.events.findIndex(event=>event.kind==='dispose-end'&&event.version==='1.0.0'),startIndex=record.events.findIndex(event=>event.kind==='start'&&event.version==='1.1.0');
  record.oldDisposeBeforeNewStart = disposeIndex>=0 && startIndex>=0 && disposeIndex<startIndex;
  record.updateVerified=record.managementOutcome==='applied' && record.codeActuallyUpdated && record.allTargetRowsActive;
  record.completed = true;
  // A successful update is reported as such, never relabeled into a cache failure.
  // Exercise an explicitly broken activation separately, not as evidence of ESM caching.
  const present = (await manager.listBundles()).find(item => item.name === packageName);
  if (present?.installed) await step('remove-current-before-bad-fixture', () => manager.removeBundle(packageName));
  const badPath = join(root, 'bad-activation.tgz'); await fs.writeFile(badPath, packages.get('1.2.0').bytes);
  const badResult = await step('intentional-bad-activation-not-cache-proof', () => manager.installBundle(badPath, { enabled: true, expected: { name: packageName, version: '1.2.0' } }));
  record.intentionalActivationFailure = badResult;
  record.badFixtureRecovery = await step('recover-after-intentional-bad-activation', () => recoverV1(manager));
  record.recoveryVerified = record.badFixtureRecovery.at(-1)?.result?.codeResult === 'helper-v1';
  assert(record.unrelatedStayedAlive); assert(record.recoveryVerified);
  }
} catch (error) {
  record.completed = false; record.fatal = String(error.stack || error); process.exitCode = 1;
} finally {
  if (service) await service.dispose().catch(error => { record.serviceCleanupError = String(error); });
  gate?.dispose(); if (ctx) await ctx.fiber.dispose().catch(error => { record.hostCleanupError = String(error); });
  server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose));
  process.chdir(originalCwd);
  try {
    const info=await fs.lstat(root);const absolute = await fs.realpath(root); const rel = relative(tempParent, absolute);
    record.cleanupVerifiedAbsoluteRoot=absolute;
    if (!info.isDirectory() || info.isSymbolicLink() || absolute !== resolve(root) || dirname(absolute) !== tempParent || !basenameSafe(absolute) || isAbsolute(rel) || rel.split(sep).includes('..')) throw Error('Refusing cleanup: owned root boundary changed');
    await fs.rm(absolute, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    record.cleanedOwnedRoot = true;
  } catch(error) { record.cleanedOwnedRoot=false;record.cleanupError=String(error.stack||error);process.exitCode=1; }
  record.finishedAt = new Date().toISOString();
  console.log('MODULE_CACHE_PROOF_RESULT ' + JSON.stringify(record));
}
function basenameSafe(path) { return path.slice(path.lastIndexOf(sep) + 1).startsWith('dsh-module-cache-proof-'); }
