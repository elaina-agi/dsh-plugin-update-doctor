/**
 * Owned-environment check of the ordinary update channel against real, published
 * community plugins from the public npm registry.
 *
 * Nothing here touches the user's profile: a fresh temporary DSH_HOME, a fresh
 * profile, an owned pnpm store, and the pinned older version of each plugin are
 * created from scratch. The exact same DoctorService code that the installed
 * plugin runs is instantiated against the real public Host plugin manager.
 */
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const [out, pnpm] = process.argv.slice(2);
const anchor = process.env.DSH_INSTALL_DIR;
assert(anchor?.includes('app.asar') && process.versions.electron, 'Run under the installed Electron runtime');
const require = createRequire(join(anchor, 'package.json'));
const imported = name => import(pathToFileURL(require.resolve(name)).href);
const app = await imported('@deepseek-ai/dsh-app-boot');
const ops = await imported('@deepseek-ai/dsh-plugin-manager/operations');
const { provideCmdline } = await imported('@deepseek-ai/dsh-cmdline');

const { DoctorService } = await import(new URL('../lib/service.js', import.meta.url).href);
const { probeLocks } = await import(new URL('../lib/locks.js', import.meta.url).href);
const { TaskGate } = await import(new URL('../lib/task-gate.js', import.meta.url).href);
const { RegistryStager } = await import(new URL('../lib/staging.js', import.meta.url).href);
const { UnionGenerationStager } = await import(new URL('../lib/union-staging.js', import.meta.url).href);
const { createRunningGenerationVerifier } = await import(new URL('../lib/running-generation.js', import.meta.url).href);

/** Real, independently published plugins. `from` is an older published version. */
const TARGETS = [
    { name: 'dsh-claude-style', from: '0.22.0' },
    { name: 'dsh-soul-md', from: '0.12.3' },
    { name: 'dsh-trust-check', from: '0.2.4' },
];

const temp = await fs.realpath(tmpdir());
const root = await fs.mkdtemp(join(temp, 'dsh-real-plugin-batch-'));
const originalCwd = process.cwd();
process.env.DSH_HOME = root;
process.env.DSH_TELEMETRY_DISABLED = '1';
process.chdir(root);
for (const key of Object.keys(process.env)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)/i.test(key)) delete process.env[key];

const profileName = 'proof';
const profileDir = join(root, 'profiles', profileName);
await fs.mkdir(profileDir, { recursive: true });
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...TARGETS.map(item => item.name)];
const context = {
    name: profileName, dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), installAnchor: join(anchor, 'package.json'),
    cwd: root, home: root, startedBundles: bundles, overlays: [], telemetryDisabledEnv: '1',
    packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { ELECTRON_RUN_AS_NODE: '1', CI: 'true' } },
};
const disabled = ['web-runtime', 'harness-dev-context', 'client-hmr', 'session-title-llm', 'llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics'];
await fs.writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'owned-real-plugin-batch', private: true, type: 'module',
    dependencies: Object.fromEntries(TARGETS.map(item => [item.name, item.from])),
    dsh: { profile: { bundles } },
}));
await fs.writeFile(join(profileDir, 'pnpm-workspace.yaml'), `autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\nstoreDir: ${JSON.stringify(join(root, 'pnpm-store'))}\ncacheDir: ${JSON.stringify(join(root, 'pnpm-cache'))}\npackageImportMethod: copy\n`);
await fs.writeFile(context.patchPath, JSON.stringify([
    ...disabled.map(id => ({ id, disabled: true })),
    { id: 'agent-loop', config: { agents: [] } },
    { id: 'webserver', config: { host: '127.0.0.1', port: 0, compression: 'none' } },
    { id: 'plugin-manager', config: { registry: 'https://registry.npmjs.org', fallbackRegistries: [], inspectTimeoutMs: 120000, lockWaitMs: 60000, idleTimeoutMs: 240000 } },
]));
const config = join(profileDir, 'cordis.yml');
await fs.writeFile(config, '[]\n');

const evidence = {
    schemaVersion: 1, kind: 'real-published-plugin-batch-update', runtimeVersion: app.getDshRuntimeVersion(), doctorVersion: (await import(new URL('../package.json', import.meta.url), { with: { type: 'json' } })).default.version,
    node: process.versions.node, electron: process.versions.electron, startedAt: new Date().toISOString(), targets: TARGETS, steps: [], results: [], passed: false,
    limitations: [
        'Owned temporary DSH_HOME and profile; the user profile, WSL, Union and running tasks are untouched.',
        'Real published npm archives at an exact pinned older version; the installed Host plugin manager performs the registry handoff.',
        'No browser rendering: client panel behaviour and visual layout are not observed here.',
        'Only public npm is used; private registries, mirrors and GitHub sources are out of scope.',
    ],
};
let ctx, service, ready = false;
const listeners = new Set();
const step = (name, detail) => { evidence.steps.push({ name, at: new Date().toISOString(), ...(detail ? { detail } : {}) }); console.log('STEP', name, detail ? JSON.stringify(detail) : ''); };
const sleep = ms => new Promise(done => setTimeout(done, ms));
async function waitFinished(id, deadlineMs) {
    const begin = Date.now();
    for (;;) {
        const state = service.operation(id);
        if (state.phase === 'finished') return state;
        if (Date.now() - begin > deadlineMs) throw new Error('operation-deadline:' + id);
        await sleep(400);
    }
}

try {
    step('profile-pnpm-install');
    const installed = await ops.runProfilePnpm({ profile: profileName, ...context }, ['install', '--registry=https://registry.npmjs.org', '--ignore-scripts'], { ...context.packageManager, execution: 'service', outputBytes: 40000, lockWaitMs: 60000, idleTimeoutMs: 240000 });
    assert.equal(installed.exitCode, 0, installed.output);
    const modules = require('yaml').parse(await fs.readFile(join(profileDir, 'node_modules', '.modules.yaml'), 'utf8'));
    assert.equal(resolve(modules.storeDir), join(root, 'pnpm-store', 'v11'));
    evidence.ownedStoreVerified = true;

    const profile = app.loadProfileDirectory('real-plugin-batch', profileDir, context.installAnchor);
    const resolution = await app.createRuntimeResolution({ installAnchor: context.installAnchor, profile, home: root });
    ctx = await app.boot('real-plugin-batch', config, app.readProfilePatches('real-plugin-batch', context, profile), async rootCtx => {
        rootCtx.provide('profileContext', context);
        await rootCtx.plugin(app.PluginPackages, { resolution });
        provideCmdline(rootCtx, { args: ['--no-open', '--port', '0'], exit: code => { throw Error('Unexpected exit ' + code); }, ready: { onReady(callback) { if (ready) callback(); else listeners.add(callback); return () => listeners.delete(callback); } } });
    }, pathToFileURL(join(profileDir, 'package.json')).href);
    ready = true; for (const callback of [...listeners]) callback(); listeners.clear();
    step('host-ready');

    const manager = ctx.get('pluginManager');
    const stagerRoot = join(root, 'cache', 'dsh-plugin-update-doctor', profileName, 'staged');
    const stager = new RegistryStager(stagerRoot, { compatibility: manifest => app.evaluatePluginCompatibility(manifest, {}) });
    const unionStager = new UnionGenerationStager(join(root, 'cache', 'dsh-plugin-update-doctor', profileName, 'union-staged'), { registryStager: stager });
    const agents = ctx.get('agents');
    service = new DoctorService({
        manager, profile, runtimeVersion: app.getDshRuntimeVersion(),
        resolvePackage: async packageName => app.resolveBundleDir('dsh', packageName, context.installAnchor, context.dir),
        probeLocks,
        statePath: join(root, 'cache', 'dsh-plugin-update-doctor', profileName, 'history.json'),
        taskGate: new TaskGate(agents), stager, unionStager,
        verifyRunningGeneration: createRunningGenerationVerifier({ entries: () => ctx.loader.entries(), resolveShared: (name, from) => app.resolvePluginResource(name, from) }),
        hmrAvailable: !!ctx.get('hmr'),
    });
    await service.initialize();
    evidence.hmrAvailable = !!ctx.get('hmr');
    evidence.manifests = Object.fromEntries(await Promise.all(TARGETS.map(async item => [item.name, JSON.parse(await fs.readFile(join(await service.resolvePackage(item.name), 'package.json'), 'utf8'))])));

    step('now-start-scan');
    const begin = Date.now();
    const scan = await service.scan(AbortSignal.timeout(900000));
    step('scan-complete', { elapsedMs: Date.now() - begin, items: scan.items.map(item => ({ name: item.name, version: item.version, latest: item.latestVersion, canUpdate: item.canUpdate, status: item.updateStatus, reasons: item.reasons })) });

    const selected = scan.items.filter(candidate => TARGETS.some(target => target.name === candidate.name) && candidate.canUpdate && candidate.latestVersion);
    evidence.selection = selected.map(candidate => ({ name: candidate.name, from: candidate.version, to: candidate.latestVersion }));
    let batch = null, batchError = null;
    for (let attempt = 1; selected.length && attempt <= 3; attempt += 1) try {
        step('prepare-batch-all', { count: selected.length, attempt });
        const plan = await service.prepareBatch(selected.map(candidate => ({ name: candidate.name, version: candidate.latestVersion })), AbortSignal.timeout(900000));
        evidence.planItems = plan.items.map(item => ({ name: item.name, from: item.from, to: item.to, installMode: item.installMode, registry: item.registry }));
        const committed = await service.commit(plan.ticket, { taskPolicy: 'wait-for-idle', confirmPublicMirror: true, confirmUnionGeneration: true });
        step('commit-batch', { operationId: committed.operationId, items: plan.items.length });
        const finished = await waitFinished(committed.operationId, 900000);
        batch = finished.record; evidence.batchAttempts = attempt;
        break;
    } catch (error) {
        const code = error?.code ?? 'thrown';
        const retryable = ['preflight-network-failed', 'version-query-failed', 'package-archive-fetch-failed'].includes(code);
        if (!retryable || attempt >= 3) { batchError = { code, message: service.redact(error?.message ?? String(error)).slice(0, 500), attempts: attempt }; break; }
        evidence.batchRetries = [...(evidence.batchRetries ?? []), code];
        await sleep(5000 * attempt);
    }
    evidence.batch = batch ? { outcome: batch.outcome, phase: batch.phase, error: batch.error ?? null, taskPolicy: batch.taskPolicy,
        items: (batch.items ?? []).map(item => ({ name: item.name, from: item.from, to: item.to, status: item.status, application: item.result?.application ?? null,
            errorCode: item.result?.error?.code ?? null, diagnostic: item.result?.error?.diagnostic ?? null, verification: item.verification ?? null })) } : null;
    evidence.batchError = batchError;
    for (const item of scan.items.filter(candidate => TARGETS.some(target => target.name === candidate.name))) {
        const record = {
            name: item.name, fromInstalled: item.version, latest: item.latestVersion, canUpdate: item.canUpdate, updateStatus: item.updateStatus,
            versionStatus: item.versionStatus, reasons: item.reasons, sourceKind: item.sourceKind,
            packagePreflight: item.packagePreflight ? { status: item.packagePreflight.status, code: item.packagePreflight.code ?? null, dependencyDeclaration: item.packagePreflight.dependencyDeclaration ?? null } : null,
        };
        const batchItem = batch?.items?.find(value => value.name === item.name);
        record.outcome = batchItem ? (batchItem.status === 'updated' ? 'applied' : batchItem.status) : (evidence.batch ? 'skipped' : 'batch-not-confirmed');
        record.itemStatus = batchItem?.status ?? null;
        record.application = batchItem?.result?.application ?? null;
        record.errorCode = batchItem?.result?.error?.code ?? null;
        record.diagnostic = batchItem?.result?.error?.diagnostic ?? null;
        record.verification = batchItem?.verification ?? null;
        const live = (await manager.listBundles()).find(bundle => bundle.name === item.name);
        record.installedAfter = { version: live?.version ?? null, source: live?.source ?? null, update: live?.update ?? null, installed: live?.installed ?? false };
        record.rowsAfter = (await manager.listPlugins()).filter(row => row.moduleName === item.name).map(row => ({ patchId: row.patchId, enabled: row.enabled, fiberPhase: row.fiberPhase }));
        evidence.results.push(record);
        step('batch-target', { name: item.name, outcome: record.outcome, version: record.installedAfter.version });
    }

    step('post-scan');
    const after = await service.scan(AbortSignal.timeout(900000));
    evidence.after = after.items.filter(item => TARGETS.some(target => target.name === item.name)).map(item => ({ name: item.name, version: item.version, latestVersion: item.latestVersion, canUpdate: item.canUpdate, updateStatus: item.updateStatus, versionStatus: item.versionStatus, state: item.state, reasons: item.reasons }));
    evidence.failures = (await fs.readFile(join(root, 'cache', 'dsh-plugin-update-doctor', profileName, 'failures.json'), 'utf8').then(JSON.parse, () => null));
    evidence.reportSample = await service.report().then(value => ({ ok: true, operations: value.operations?.length ?? 0, failures: value.failures?.length ?? 0 }), error => ({ ok: false, error: String(error?.code ?? error) }));
    evidence.passed = evidence.results.every(record => record.outcome === 'applied');
} catch (error) {
    evidence.fatal = String(error?.stack ?? error);
    process.exitCode = 1;
} finally {
    try { if (service) await service.dispose(); } catch { /* dispose failure is reported through evidence */ }
    try { if (ctx) await ctx.fiber.dispose(); } catch (error) { evidence.disposeError = String(error?.message ?? error); }
    process.chdir(originalCwd);
    evidence.finishedAt = new Date().toISOString();
    if (out) await fs.writeFile(out, JSON.stringify(evidence, null, 2));
    const actual = await fs.realpath(root), info = await fs.lstat(root);
    assert.equal(actual, resolve(root)); assert.equal(dirname(actual), temp); assert(basename(actual).startsWith('dsh-real-plugin-batch-')); assert(info.isDirectory() && !info.isSymbolicLink());
    console.log('OWNED_TEMP_CLEANUP_VERIFIED');
    try {
        await Promise.race([fs.rm(actual, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 }),
            new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('cleanup-timeout'), { code: 'cleanup-timeout' })), 30000))]);
    } catch (error) {
        console.log('OWNED_TEMP_CLEANUP_DEFERRED', String(error?.code ?? error), actual);
    }
    console.log(JSON.stringify({
        passed: evidence.passed, fatal: evidence.fatal ? true : false,
        results: evidence.results.map(record => ({ name: record.name, from: record.fromInstalled, to: record.latest, outcome: record.outcome, errorCode: record.errorCode ?? null, installed: record.installedAfter?.version ?? null })),
    }));
}
