/**
 * Owned-environment check of the "install a published plugin, then update it" flow.
 *
 * Phase 1 uses the same public profile operation the panel uses to add a plugin
 * (`pluginManager.installBundle('<name>@<exact older version>')`) into a fresh
 * temporary profile. Phase 2 runs the ordinary DoctorService update channel on the
 * packages that were just installed, so the read-only preflight sees exactly what a
 * user sees right after installing something.
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

/** Real published plugins installed at an older version through the public operation. */
const TARGETS = process.env.DSH_TEST_TARGETS
    ? JSON.parse(process.env.DSH_TEST_TARGETS)
    : [
        { name: 'dsh-cost-meter', from: '1.9.90' },
        { name: 'deep-view', from: '0.1.0' },
        { name: 'dsh-meme', from: '0.1.84' },
    ];

const temp = await fs.realpath(tmpdir());
const root = await fs.mkdtemp(join(temp, 'dsh-install-update-'));
const originalCwd = process.cwd();
process.env.DSH_HOME = root;
process.env.DSH_TELEMETRY_DISABLED = '1';
process.chdir(root);
for (const key of Object.keys(process.env)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)/i.test(key)) delete process.env[key];

const profileName = 'proof';
const profileDir = join(root, 'profiles', profileName);
await fs.mkdir(profileDir, { recursive: true });
const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
const context = {
    name: profileName, dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), installAnchor: join(anchor, 'package.json'),
    cwd: root, home: root, startedBundles: bundles, overlays: [], telemetryDisabledEnv: '1',
    packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { ELECTRON_RUN_AS_NODE: '1', CI: 'true' } },
};
const disabled = ['web-runtime', 'harness-dev-context', 'client-hmr', 'session-title-llm', 'llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics'];
await fs.writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'owned-install-update', private: true, type: 'module', dependencies: {}, dsh: { profile: { bundles } } }));
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
    schemaVersion: 1, kind: 'real-plugin-install-then-update', runtimeVersion: app.getDshRuntimeVersion(),
    doctorVersion: (await import(new URL('../package.json', import.meta.url), { with: { type: 'json' } })).default.version,
    node: process.versions.node, electron: process.versions.electron, startedAt: new Date().toISOString(), targets: TARGETS,
    installed: [], results: [], passed: false,
    limitations: [
        'Owned temporary DSH_HOME and profile; the user profile, WSL, Union and running tasks are untouched.',
        'Installation uses the public profile operation (pluginManager.installBundle with an exact npm spec), not a hand-edited profile.',
        'No browser rendering: the panel UI, its confirmation dialog and client layout are not observed here.',
        'Only public npm is used; private registries, mirrors and GitHub sources are out of scope.',
    ],
};
let ctx, service, ready = false;
const listeners = new Set();
const step = (name, detail) => { evidence.steps ??= []; evidence.steps.push({ name, at: new Date().toISOString(), ...(detail ? { detail } : {}) }); console.log('STEP', name, detail ? JSON.stringify(detail) : ''); };
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
    const prepared = await ops.runProfilePnpm({ profile: profileName, ...context }, ['install', '--registry=https://registry.npmjs.org', '--ignore-scripts'], { ...context.packageManager, execution: 'service', outputBytes: 40000, lockWaitMs: 60000, idleTimeoutMs: 240000 });
    assert.equal(prepared.exitCode, 0, prepared.output);

    const profile = app.loadProfileDirectory('install-update', profileDir, context.installAnchor);
    const resolution = await app.createRuntimeResolution({ installAnchor: context.installAnchor, profile, home: root });
    ctx = await app.boot('install-update', config, app.readProfilePatches('install-update', context, profile), async rootCtx => {
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
    service = new DoctorService({
        manager, profile, runtimeVersion: app.getDshRuntimeVersion(),
        resolvePackage: async packageName => app.resolveBundleDir('dsh', packageName, context.installAnchor, context.dir),
        probeLocks,
        statePath: join(root, 'cache', 'dsh-plugin-update-doctor', profileName, 'history.json'),
        taskGate: new TaskGate(ctx.get('agents')), stager, unionStager,
        verifyRunningGeneration: createRunningGenerationVerifier({ entries: () => ctx.loader.entries(), resolveShared: (name, from) => app.resolvePluginResource(name, from) }),
        hmrAvailable: !!ctx.get('hmr'),
    });
    await service.initialize();

    // Phase 1: install the exact older published version through the public operation.
    for (const target of TARGETS) {
        const record = { name: target.name, pinned: target.from };
        try {
            step('install', { name: target.name, version: target.from });
            // saveExact keeps the profile on the exact older version; a caret spec would let the
            // package manager resolve the newest 1.x on its own and make the run self-upgrade.
            const result = await manager.installBundle(`${target.name}@${target.from}`, { enabled: true, saveExact: true, expected: { name: target.name, version: target.from }, requestId: `install-${target.name}` });
            record.application = result?.application ?? null;
            record.stage = result?.stage ?? null;
            record.errorCode = result?.error?.code ?? null;
            record.diagnostic = result?.error?.diagnostic ?? null;
            record.stage = result?.stage ?? null;
            const live = (await manager.listBundles()).find(bundle => bundle.name === target.name);
            record.installed = { version: live?.version ?? null, source: live?.source ?? null, update: live?.update ?? null, enabled: live?.enabled ?? null };
            record.rows = (await manager.listPlugins()).filter(row => row.moduleName === target.name).map(row => ({ patchId: row.patchId, enabled: row.enabled, fiberPhase: row.fiberPhase }));
            record.ok = record.application === 'applied' && record.installed.version === target.from && record.rows.every(row => row.fiberPhase === 'active');
            record.snapshots = [];
            for (const delay of [0, 500, 1500, 3000]) { await sleep(delay); const live = (await manager.listBundles()).find(bundle => bundle.name === target.name);
                record.snapshots.push({ delay, version: live?.version ?? null, source: live?.source ?? null, enabled: live?.enabled ?? null, installed: live?.installed ?? null, availability: live?.availability ?? null, overrides: live?.overrides ?? null, rows: (live?.rows ?? []).map(row => [row.rowId, row.moduleName, row.entryId]), fingerprint: service.fingerprint(live) }); }
        } catch (error) {
            record.ok = false;
            record.errorCode = error?.code ?? 'thrown';
            record.message = service.redact(error?.message ?? String(error)).slice(0, 500);
        }
        evidence.installed.push(record);
        step('install-finished', { name: target.name, ok: record.ok, version: record.installed?.version ?? null });
    }

    // Host rows settle asynchronously right after an install; give them the same moment
    // a user would before opening the panel.
    await sleep(3000);

    // Phase 2: the same read-only scan and confirmed update a user runs right after installing.
    step('scan');
    const scan = await service.scan(AbortSignal.timeout(900000));
    step('scan-complete', { items: scan.items.map(item => ({ name: item.name, version: item.version, latest: item.latestVersion, canUpdate: item.canUpdate, status: item.updateStatus, reasons: item.reasons })) });

    for (const item of scan.items.filter(candidate => TARGETS.some(target => target.name === candidate.name)).sort((a, b) => TARGETS.findIndex(target => target.name === a.name) - TARGETS.findIndex(target => target.name === b.name))) {
        const record = {
            name: item.name, fromInstalled: item.version, latest: item.latestVersion, canUpdate: item.canUpdate, updateStatus: item.updateStatus,
            versionStatus: item.versionStatus, reasons: item.reasons, sourceKind: item.sourceKind,
            packagePreflight: item.packagePreflight ? { status: item.packagePreflight.status, code: item.packagePreflight.code ?? null, phase: item.packagePreflight.phase ?? null, detail: item.packagePreflight.detail ?? null, dependencyDeclaration: item.packagePreflight.dependencyDeclaration ?? null } : null,
        };
        evidence.results.push(record);
        if (!item.canUpdate || !item.latestVersion) { record.outcome = 'blocked-before-preparation'; continue; }
        for (let attempt = 1; ; attempt += 1) try {
            const plan = await service.prepareBatch([{ name: item.name, version: item.latestVersion }], AbortSignal.timeout(900000));
            record.installMode = plan.items?.[0]?.installMode;
            const committed = await service.commit(plan.ticket, { taskPolicy: 'wait-for-idle', confirmPublicMirror: true, confirmUnionGeneration: true });
            const finished = await waitFinished(committed.operationId, 420000);
            const entry = finished.record?.items?.[0] ?? {};
            record.attempts = attempt;
            record.outcome = finished.record?.outcome ?? 'unknown';
            record.itemStatus = entry.status ?? null;
            record.application = entry.result?.application ?? null;
            record.errorCode = entry.result?.error?.code ?? null;
            record.diagnostic = entry.result?.error?.diagnostic ?? null;
            record.verification = entry.verification ?? null;
            record.jobError = finished.record?.error ?? null;
            break;
        } catch (error) {
            const code = error?.code ?? 'thrown';
            const retryable = ['preflight-network-failed', 'version-query-failed', 'package-archive-fetch-failed'].includes(code);
            if (!retryable || attempt >= 3) { record.outcome = 'preparation-or-commit-failed'; record.errorCode = code; record.attempts = attempt; record.message = service.redact(error?.message ?? String(error)).slice(0, 500); break; }
            record.retries = [...(record.retries ?? []), code];
            await sleep(5000 * attempt);
        }
        const live = (await manager.listBundles()).find(bundle => bundle.name === item.name);
        record.installedAfter = { version: live?.version ?? null, source: live?.source ?? null, update: live?.update ?? null, installed: live?.installed ?? false };
        record.rowsAfter = (await manager.listPlugins()).filter(row => row.moduleName === item.name).map(row => ({ patchId: row.patchId, enabled: row.enabled, fiberPhase: row.fiberPhase }));
    }

    step('post-scan');
    const after = await service.scan(AbortSignal.timeout(900000));
    evidence.after = after.items.filter(item => TARGETS.some(target => target.name === item.name)).map(item => ({ name: item.name, version: item.version, latestVersion: item.latestVersion, canUpdate: item.canUpdate, updateStatus: item.updateStatus, state: item.state, reasons: item.reasons }));
    evidence.reportSample = await service.report().then(value => ({ ok: true, operations: value.operations?.length ?? 0, failures: value.failures?.length ?? 0 }), error => ({ ok: false, error: String(error?.code ?? error) }));
    evidence.passed = evidence.installed.every(record => record.ok) && evidence.results.every(record => record.outcome === 'applied');
} catch (error) {
    evidence.fatal = String(error?.stack ?? error);
    process.exitCode = 1;
} finally {
    try { if (service) await service.dispose(); } catch { /* recorded through evidence */ }
    try { if (ctx) await ctx.fiber.dispose(); } catch (error) { evidence.disposeError = String(error?.message ?? error); }
    process.chdir(originalCwd);
    evidence.finishedAt = new Date().toISOString();

    const actual = await fs.realpath(root), info = await fs.lstat(root);
    assert.equal(actual, resolve(root)); assert.equal(dirname(actual), temp); assert(basename(actual).startsWith('dsh-install-update-')); assert(info.isDirectory() && !info.isSymbolicLink());
    console.log('OWNED_TEMP_CLEANUP_VERIFIED');
    let cleanup = 'verified';
    try {
        await Promise.race([fs.rm(actual, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 }),
            new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('cleanup-timeout'), { code: 'cleanup-timeout' })), 30000))]);
    } catch (error) {
        cleanup = error?.code === 'cleanup-timeout' ? 'deferred:timeout' : 'deferred:' + String(error?.code ?? error).slice(0, 80);
        console.log('OWNED_TEMP_CLEANUP_DEFERRED', cleanup, actual);
    }
    evidence.cleanup = cleanup;
    if (out) await fs.writeFile(out, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify({
        passed: evidence.passed, fatal: evidence.fatal ? true : false,
        installed: evidence.installed.map(record => ({ name: record.name, application: record.application, version: record.installed?.version ?? null, ok: record.ok })),
        results: evidence.results.map(record => ({ name: record.name, from: record.fromInstalled, to: record.latest, outcome: record.outcome, errorCode: record.errorCode ?? null })),
    }));
}
