import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { RegistryStager } from '../lib/staging.js';
import { archiveEntries } from '../lib/generation.js';
import { DoctorService } from '../lib/service.js';
import { TaskGate } from '../lib/task-gate.js';
import { probeLocks } from '../lib/locks.js';

const anchor = process.env.DSH_INSTALL_DIR;
if (!anchor?.includes('app.asar')) throw Error('Current installed ASAR runtime required');
const require = createRequire(join(anchor, 'package.json'));
const imported = async name => import(pathToFileURL(require.resolve(name)).href);
const app = await imported('@deepseek-ai/dsh-app-boot');
const ops = await imported('@deepseek-ai/dsh-plugin-manager/operations');
const { provideCmdline } = await imported('@deepseek-ai/dsh-cmdline');
const name = 'dsh-offwork-countdown', from = '1.2.0', to = '1.2.1';
const [out, pnpm, mode] = process.argv.slice(2);
assert(['official', 'doctor'].includes(mode));
assert(out && pnpm);
const originalCwd = process.cwd();
const root = await fs.mkdtemp(join(tmpdir(), 'dsh-countdown-proof-'));
process.env.DSH_HOME = root;
process.env.DSH_TELEMETRY_DISABLED = '1';
process.chdir(root);
// No inherited provider credentials, user profile, or settings enter the fixture.
for (const key of Object.keys(process.env)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)/i.test(key)) delete process.env[key];
const profileDir = join(root, 'profiles', 'proof');
await fs.mkdir(profileDir, { recursive: true });
const composition = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', name];
const evidence = {
    schemaVersion: 1, mode, runtimeVersion: app.getDshRuntimeVersion(), electron: process.versions.electron,
    node: process.versions.node, pid: process.pid, root, ownedPackageStore: join(root, 'pnpm-store'), startedAt: new Date().toISOString(), results: [],
    limitations: [
        'Actual installed AppBoot/Cordis/Loader/HMR/PluginManager and official base/web layers in a new temporary profile per mode; no user profile copied or mutated.',
        'Actual WebServer and ClientModules serve fixture HTTP settings and revisioned client bytes. The listener is an owned test carrier, not a replacement GUI; web-runtime/browser opening is disabled.',
        'No browser renders/executes the client, so served new CSS and Host functionality do not establish Electron drag behavior or browser graph synchronization.',
        'Doctor mode calls production DoctorService.runBatch internally only for this owned fixture; this does not test or bypass confirmation on the real panel.',
        'AppReady is a readiness test latch; no Agent/model request or task cancellation is performed.'
    ]
};
const context = {
    name: 'proof', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), installAnchor: join(anchor, 'package.json'),
    cwd: root, home: root, startedBundles: composition, overlays: [], telemetryDisabledEnv: '1',
    packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { ELECTRON_RUN_AS_NODE: '1', CI: 'true' } }
};
const patches = [
    ...['web-runtime', 'harness-dev-context', 'client-hmr', 'session-title-llm', 'llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics'].map(id => ({ id, disabled: true })),
    { id: 'agent-loop', config: { agents: [] } },
    { id: 'webserver', config: { host: '127.0.0.1', port: 0, compression: 'none' } },
    { id: 'plugin-manager', config: { inspectTimeoutMs: 15000, githubConnectionTimeoutMs: 1000, gitTransportTimeoutMs: 1000, lockWaitMs: 10000, idleTimeoutMs: 30000, registry: 'https://registry.npmjs.org', fallbackRegistries: [] } }
];
await fs.writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'countdown-isolated-proof', private: true, type: 'module', dependencies: { [name]: from }, dsh: { profile: { bundles: composition } } }, null, 2));
await fs.writeFile(join(profileDir, 'pnpm-workspace.yaml'), `autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\nstoreDir: ${JSON.stringify(join(root, 'pnpm-store').replace(/\\/g, '/'))}\ncacheDir: ${JSON.stringify(join(root, 'pnpm-cache').replace(/\\/g, '/'))}\npackageImportMethod: copy\n`);
await fs.writeFile(join(profileDir, '.npmrc'), `store-dir=${join(root, 'pnpm-store').replace(/\\/g, '/')}\npackage-import-method=copy\naudit=false\n`);
await fs.writeFile(context.patchPath, JSON.stringify(patches));
const config = join(profileDir, 'cordis.yml');
await fs.writeFile(config, '[]\n');
let ctx, service, taskGate;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function record(label, fn) {
    const begin = Date.now();
    try { const value = await fn(); evidence.results.push({ name: label, ok: true, elapsed: Date.now() - begin, value }); console.log('COUNTDOWN_PROOF', label, JSON.stringify(value)); return value; }
    catch (error) { const diagnostic = String(error.stack || error); evidence.results.push({ name: label, ok: false, elapsed: Date.now() - begin, error: diagnostic }); console.error('COUNTDOWN_PROOF_ERROR', label, diagnostic); throw error; }
}
async function installedState(manager, expectedVersion) {
    const bundles = await manager.listBundles(), plugins = await manager.listPlugins();
    const bundle = bundles.find(item => item.name === name);
    assert.equal(bundle?.version, expectedVersion);
    assert.equal(bundle.enabled, true);
    const rows = bundle.rows.map(row => plugins.find(plugin => plugin.entryId === row.entryId));
    assert.equal(rows.length, 1);
    assert(rows.every(row => row?.enabled === true && row.fiberPhase === 'active'), JSON.stringify(rows));
    const packageDir = app.resolveBundleDir('countdown-proof', name, context.installAnchor, profileDir);
    const otherInactive = plugins.filter(row => row.enabled && row.fiberPhase !== 'active');
    assert.equal(otherInactive.length, 0, 'Unexpected inactive fixture rows: ' + JSON.stringify(otherInactive));
    const result = { version: bundle.version, enabled: bundle.enabled, rows, otherInactive, packageDir, clientSha256: sha(await fs.readFile(join(packageDir, 'client.js'))), hostSha256: sha(await fs.readFile(join(packageDir, 'host.js'))), pid: process.pid };
    return result;
}
async function requestState(origin, patch) {
    const response = await fetch(origin + '/dsh-offwork-countdown/state', {
        ...(patch ? { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(patch) } : {}),
        signal: AbortSignal.timeout(10000)
    });
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json(); assert.equal(body.ok, true); return body.state;
}
async function clientSnapshot(registry) {
    const graph = registry.graph();
    const entry = graph.entries.find(entry => entry.id === name);
    assert(entry, 'Candidate absent from actual client graph');
    assert.equal(typeof entry.url, 'string', JSON.stringify(entry));
    const response = await registry.fetchBundle(new Request(new URL(entry.url, 'http://fixture.internal/')));
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    const cssMarker = '.dsh-offwork-pill,.dsh-offwork-panel{-webkit-app-region:no-drag;app-region:no-drag}';
    return { entry, servedSha256: sha(bytes), servedBytes: bytes.length, hasNewNoDragRule: bytes.toString('utf8').includes(cssMarker) };
}
try {
    const stager = new RegistryStager(join(root, 'cache', 'dsh-plugin-update-doctor', 'proof', 'staged'));
    const oldArchive = await record('stage-original-' + from, () => stager.stage(name, from));
    const newArchive = await record('stage-original-' + to, () => stager.stage(name, to));
    const sourceFiles = async staged => new Map(archiveEntries(await fs.readFile(staged.sourceArchivePath)).map(entry => [entry.name, entry.bytes]));
    const oldFiles = await sourceFiles(oldArchive), newFiles = await sourceFiles(newArchive);
    await record('exact-original-runtime-code-delta', async () => {
        assert.equal(sha(oldFiles.get('package/host.js')), sha(newFiles.get('package/host.js')));
        assert.notEqual(sha(oldFiles.get('package/client.js')), sha(newFiles.get('package/client.js')));
        return { oldClientSha256: sha(oldFiles.get('package/client.js')), newClientSha256: sha(newFiles.get('package/client.js')), hostIdentical: true, hostSha256: sha(oldFiles.get('package/host.js')), oldOriginalArchiveSha256: oldArchive.originalSha256, newOriginalArchiveSha256: newArchive.originalSha256, scriptsOrDependencies: false };
    });
    const installed = await record('install-original-npm-baseline', () => ops.runProfilePnpm({ profile: 'proof', ...context }, ['install', '--registry=https://registry.npmjs.org'], { ...context.packageManager, execution: 'service', outputBytes: 30000, lockWaitMs: 10000, idleTimeoutMs: 30000 }));
    assert.equal(installed.exitCode, 0, installed.output);
    assert(installed.output.replace(/\\/g, '/').includes(join(root, 'pnpm-store').replace(/\\/g, '/')), 'pnpm did not use the owned package store: ' + installed.output);
    const profile = app.loadProfileDirectory('countdown-proof', profileDir, context.installAnchor);
    const resolution = await app.createRuntimeResolution({ installAnchor: context.installAnchor, profile, home: root });
    let ready = false; const readyListeners = new Set();
    ctx = await app.boot('countdown-proof', config, app.readProfilePatches('countdown-proof', context, profile), async rootCtx => {
        rootCtx.provide('profileContext', context); await rootCtx.plugin(app.PluginPackages, { resolution });
        provideCmdline(rootCtx, { args: ['--no-open', '--port', '0'], exit: code => { throw Error('Unexpected fixture exit request ' + code); }, ready: { onReady(callback) { if (ready) callback(); else readyListeners.add(callback); return () => readyListeners.delete(callback); } } });
    }, pathToFileURL(join(profileDir, 'package.json')).href);
    ready = true; for (const callback of [...readyListeners]) callback(); readyListeners.clear();
    const manager = ctx.get('pluginManager'), webServer = ctx.get('webServer'), registry = ctx.get('clientModules');
    assert(manager && webServer && registry);
    const origin = webServer.getOrigin();
    const before = await record('cold-original-host-all-active', () => installedState(manager, from));
    assert.equal(before.clientSha256, sha(oldFiles.get('package/client.js')));
    const beforeClient = await record('cold-client-graph-and-served-bytes', () => clientSnapshot(registry));
    assert.equal(beforeClient.hasNewNoDragRule, false);
    const settingsPath = join(root, 'offwork-countdown', 'state.json');
    const customPatch = { startTime: '10:30', endTime: '19:45', leadMinutes: 20, workdays: [1, 3, 5], position: 'top-left', accentColor: '#3456ab', pulseSeconds: 3, remindWindowMinutes: 90, clockedInOn: '2026-11-17|10:30|19:45', spot: { x: 0.25, y: 0.5 } };
    const beforeSettings = await record('pre-update-real-settings-post-and-get', async () => { const saved = await requestState(origin, customPatch); assert.deepEqual(await requestState(origin), saved); return saved; });
    const beforeDisk = await fs.readFile(settingsPath);
    if (mode === 'official') {
        const updated = await record('official-updateBundle-exact-target', () => manager.updateBundle(name, to, { registry: 'https://registry.npmjs.org' }));
        evidence.application = updated.result?.application;
        assert.equal(updated.result?.application, 'applied', JSON.stringify(updated));
    } else {
        const agents = ctx.get('agents'); assert(agents?.list); assert.equal(agents.list().length, 0);
        taskGate = new TaskGate(agents);
        const locks = [];
        service = new DoctorService({ manager, profile: context, runtimeVersion: app.getDshRuntimeVersion(), resolvePackage: async packageName => app.resolveBundleDir('countdown-proof', packageName, context.installAnchor, profileDir), probeLocks: async (directory, options) => { const result = await probeLocks(directory, options); locks.push(result); return result; }, statePath: join(root, 'cache', 'dsh-plugin-update-doctor', 'proof', 'history.json'), taskGate, stager });
        await service.initialize();
        const scan = await record('production-scanner-result', () => service.scan());
        assert.equal(scan.items.find(item => item.name === name)?.canUpdate, true);
        const plan = await service.prepareBatch([{ name, version: to }]);
        const prepared = service.tickets.get(plan.ticket);
        const item = { ...prepared.plan.items[0], status: 'waiting' };
        const id = randomUUID(), steps = [], controller = new AbortController();
        const job = { id, package: '(owned-countdown-fixture)', phase: 'waiting', controller, steps, record: { id, origin: 'doctor', operation: 'batch-update', taskPolicy: 'wait-for-idle', confirmCancel: false, phase: 'waiting', startedAt: new Date().toISOString(), items: [item], steps } };
        await record('production-runBatch-owned-fixture', async () => { await service.runBatch(job); return job.record; });
        evidence.application = job.record.outcome;
        assert.equal(job.record.items[0].status, 'updated', JSON.stringify(job.record));
        assert.equal(job.record.outcome, 'applied');
        await record('actual-native-lock-samples-and-no-task-stops', async () => ({ locks, liveAgents: agents.list().length, taskCancellation: job.record.taskCancellation ?? null }));
        assert.equal(agents.list().length, 0);
        assert.equal(job.record.taskCancellation, undefined);
    }
    const after = await record('updated-original-host-all-active', () => installedState(manager, to));
    assert.equal(after.clientSha256, sha(newFiles.get('package/client.js')));
    assert.equal(after.hostSha256, before.hostSha256);
    const afterClient = await record('updated-client-graph-and-served-new-code', () => clientSnapshot(registry));
    assert.notEqual(afterClient.entry.rev, beforeClient.entry.rev);
    assert.equal(afterClient.hasNewNoDragRule, true);
    await record('settings-and-file-bytes-preserved', async () => {
        const state = await requestState(origin); assert.deepEqual(state, beforeSettings); assert((await fs.readFile(settingsPath)).equals(beforeDisk));
        return { state, fileBytesUnchanged: true, fileSha256: sha(beforeDisk) };
    });
    await record('updated-real-settings-still-writable', async () => { const state = await requestState(origin, { leadMinutes: 25 }); assert.equal(state.leadMinutes, 25); assert.equal(state.startTime, beforeSettings.startTime); assert.deepEqual(await requestState(origin), state); return state; });
    evidence.passed = true; evidence.samePid = before.pid === after.pid; evidence.functionalHostCheck = true; evidence.clientNewBytesServed = true;
} catch (error) { evidence.passed = false; evidence.fatal = String(error.stack || error); process.exitCode = 1; }
finally {
    if (service) await service.dispose().catch(error => { evidence.serviceCleanupError = String(error); });
    taskGate?.dispose();
    if (ctx) await ctx.fiber.dispose().catch(error => { evidence.hostCleanupError = String(error.stack || error); });
    process.chdir(originalCwd);
    // Only this exact mkdtemp-owned ordinary absolute root can be removed.
    const checked = resolve(root);
    assert.equal(dirname(checked), resolve(tmpdir()));
    assert(basename(checked).startsWith('dsh-countdown-proof-'));
    assert.equal(await fs.realpath(checked), checked);
    assert.equal((await fs.lstat(checked)).isSymbolicLink(), false);
    evidence.cleanup = { rootVerified: true, removed: false };
    console.log('COUNTDOWN_PROOF_CLEANUP_TARGET', checked);
    try { await fs.rm(checked, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); evidence.cleanup.removed = true; }
    catch (error) { evidence.cleanup.error = String(error); process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString();
    await fs.writeFile(out, JSON.stringify(evidence, null, 2));
    console.log('COUNTDOWN_PROOF_EVIDENCE', out, 'passed', evidence.passed);
}
