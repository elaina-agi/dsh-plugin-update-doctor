import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DoctorService } from '../lib/service.js';
import { RegistryStager } from '../lib/staging.js';
import { UnionGenerationStager } from '../lib/union-staging.js';
import { TaskGate } from '../lib/task-gate.js';
import { createRunningGenerationVerifier } from '../lib/running-generation.js';
import { archiveEntries } from '../lib/generation.js';

const [pnpm, outputArg] = process.argv.slice(2);
const anchor = process.env.DSH_INSTALL_DIR;
assert(anchor?.includes('app.asar') && process.versions.electron);
assert(pnpm && outputArg);
assert(!process.env.DSH_OWNED_NODE_CORE_PATCH_PROOF && !process.env.NODE_OPTIONS, 'The structural proof must run stock');
const name = 'dsh-union-search', from = '0.10.25', to = '0.11.0', origin = 'https://registry.npmjs.org';
const workspace = process.cwd(), output = resolve(outputArg);
assert.equal(dirname(output), join(workspace, 'artifacts', 'union-structural-0.5.6'));
assert.equal(basename(output), 'host-result.json');
const temp = await fs.realpath(tmpdir());
const root = await fs.mkdtemp(join(temp, 'dsh-union-structural-proof-'));
console.log('OWNED_ROOT=' + root);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (base, path) => { const rel = relative(base, path); return !!rel && !isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..'; };
const result = { schema: 1, pid: process.pid, runtimeVersion: null, electron: process.versions.electron, node: process.versions.node,
    root, startedAt: new Date().toISOString(), steps: [], archives: {}, verdict: 'unmeasured', limitations: [
        'Unmodified installed Electron, Loader, HMR and PluginManager; production DoctorService, registry stager, isolated-generation stager and running-namespace verifier.',
        'Exact public npm archives for the root package and every dependency copy; install lifecycle scripts disabled, no approvals, no source override.',
        'Owned temporary profile/store/cache/home and a loopback HTML fixture. The one target-install rejection is injected at the manager boundary before any package command and is not a public defect.',
        'No live user profile, sessions, browser DOM, real search engine or model request. The functional check exercises only the loopback advance_fetch path.',
        'Successful replacement is reported only when the official manager applies it, original bytes match, Host rows are active and the exact fresh Loader namespace is running.'
    ] };
let ctx, service, html, injectedFailures = 0, targetArchive = null;
const step = async (label, work) => {
    console.log('START ' + label);
    const start = Date.now();
    try {
        const value = await work();
        result.steps.push({ label, status: 'complete', ms: Date.now() - start });
        console.log('DONE ' + label);
        return value;
    } catch (error) {
        result.steps.push({ label, status: 'error', ms: Date.now() - start, message: String(error?.stack ?? error).slice(0, 12000) });
        throw error;
    }
};
const observe = item => item ? { status: item.status, installMode: item.installMode, result: item.result?.application,
    restore: item.restore?.application, verification: item.verification ? {
        package: item.verification.package.status, source: item.verification.source.status,
        host: item.verification.host.status, runtime: item.verification.runtime.status } : undefined,
    restoreVerification: item.restoreVerification ? { package: item.restoreVerification.package.status, runtime: item.restoreVerification.runtime.status } : undefined } : null;

async function publicBytes(path, limit) {
    const response = await fetch(`${origin}/${path}`, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(45000) });
    assert(response.ok, `Public registry HTTP ${response.status}: ${path}`);
    const parts = []; let length = 0;
    for await (const chunk of response.body) {
        length += chunk.length; assert(length <= limit, 'Owned public download exceeded budget'); parts.push(Buffer.from(chunk));
    }
    return Buffer.concat(parts);
}

try {
    process.chdir(root);
    for (const key of Object.keys(process.env)) if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET|PASSWORD|^DSH_)|^npm_config_|^PNPM_/i.test(key)) delete process.env[key];
    Object.assign(process.env, { DSH_HOME: root, DSH_TELEMETRY_DISABLED: '1', HOME: root, USERPROFILE: root,
        APPDATA: join(root, 'AppData', 'Roaming'), LOCALAPPDATA: join(root, 'AppData', 'Local'), CI: 'true' });
    const emptyConfig = join(root, 'empty-npm-config');
    await fs.writeFile(emptyConfig, '# owned fixture; no credentials\n', { flag: 'wx' });
    const npmEnvironment = { NPM_CONFIG_USERCONFIG: emptyConfig, NPM_CONFIG_GLOBALCONFIG: emptyConfig };
    Object.assign(process.env, npmEnvironment);
    const require = createRequire(join(anchor, 'package.json'));
    const imported = spec => import(pathToFileURL(require.resolve(spec)).href);
    const app = await imported('@deepseek-ai/dsh-app-boot');
    const { provideCmdline } = await imported('@deepseek-ai/dsh-cmdline');
    result.runtimeVersion = app.getDshRuntimeVersion();
    assert.equal(result.runtimeVersion, '0.2.2-rc.5');
    await step('read-and-verify-official-archives', async () => {
        for (const version of [from, to]) {
            const info = JSON.parse(await publicBytes(`${name}/${version}`, 2 * 1024 * 1024));
            assert.equal(info.name, name); assert.equal(info.version, version);
            const path = `${name}/-/${name}-${version}.tgz`;
            assert.equal(info.dist.tarball, `${origin}/${path}`);
            const bytes = await publicBytes(path, 16 * 1024 * 1024);
            assert.equal('sha512-' + createHash('sha512').update(bytes).digest('base64'), info.dist.integrity);
            const manifest = JSON.parse(archiveEntries(bytes).find(entry => entry.name === 'package/package.json').bytes);
            assert.equal(manifest.name, name); assert.equal(manifest.version, version);
            result.archives[version] = { sha256: sha(bytes), integrity: info.dist.integrity, files: archiveEntries(bytes).length,
                dependencies: manifest.dependencies, hostFileSha256: sha(archiveEntries(bytes).find(e => e.name === 'package/lib/index.js').bytes) };
        }
        assert.equal(result.archives[from].hostFileSha256, result.archives[to].hostFileSha256, 'the two releases differ outside the Host entry');
    });

    const profileDir = join(root, 'profiles', 'proof');
    await fs.mkdir(profileDir, { recursive: true });
    const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
    const profileContext = { name: 'proof', dir: profileDir, home: root, patchPath: join(profileDir, 'cordis.patch.yml'),
        installAnchor: join(anchor, 'package.json'), cwd: root, startedBundles: bundles, overlays: [], telemetryDisabledEnv: '1',
        packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { ELECTRON_RUN_AS_NODE: '1', CI: 'true', ...npmEnvironment } } };
    await fs.writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'owned-union-structural-profile', private: true,
        type: 'module', dependencies: {}, dsh: { profile: { bundles } } }), { flag: 'wx' });
    await fs.writeFile(join(profileDir, 'pnpm-workspace.yaml'), `autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\nignoreScripts: true\nregistry: ${origin}\nstoreDir: ${JSON.stringify(join(root, 'pnpm-store'))}\ncacheDir: ${JSON.stringify(join(root, 'pnpm-cache'))}\npackageImportMethod: copy\nminimumReleaseAge: 0\n`, { flag: 'wx' });
    const disabled = ['webserver','web-runtime','harness-dev-context','open-in-app','directory-picker','client-hmr',
        'session-title-llm','llm-deepseek','llm-deepseek-account','llm-pi-ai','session-telemetry-otel','desktop-product-telemetry','product-analytics'];
    const patch = Buffer.from(JSON.stringify([
        ...disabled.map(id => ({ id, disabled: true })),
        { id: 'credentials', config: { path: join(root, 'owned-empty-store.yaml'), dshHome: root, watch: false } },
        { id: 'agent-loop', config: { agents: [] } },
        { id: 'web', config: { searchProvider: 'ddg', fetchProvider: 'http' } },
        { id: 'web-search-free', name, config: { provider: 'bing', blockSystemSearch: true, legacyYamlMigrated: true,
            advanceFetchAllowPrivate: true, disabledEngines: [] } },
        { id: 'plugin-manager', config: { registry: origin, fallbackRegistries: [], inspectTimeoutMs: 45000,
            lockWaitMs: 10000, idleTimeoutMs: 120000 } }
    ]));
    await fs.writeFile(profileContext.patchPath, patch, { flag: 'wx' });
    const config = join(profileDir, 'cordis.yml');
    await fs.writeFile(config, '[]\n', { flag: 'wx' });
    const profile = app.loadProfileDirectory('union-structural-proof', profileDir, profileContext.installAnchor);
    const resolution = await app.createRuntimeResolution({ installAnchor: profileContext.installAnchor, profile, home: root });
    let ready = false; const listeners = new Set();
    await step('boot-stock-host', async () => {
        ctx = await app.boot('union-structural-proof', config, app.readProfilePatches('union-structural-proof', profileContext, profile), async c => {
            c.provide('profileContext', profileContext);
            await c.plugin(app.PluginPackages, { resolution });
            provideCmdline(c, { args: ['--no-open','--port','0'], exit: code => { throw Error('Unexpected owned Host exit: ' + code); },
                ready: { onReady(callback) { if (ready) callback(); else listeners.add(callback); return () => listeners.delete(callback); } } });
        }, pathToFileURL(join(profileDir, 'package.json')).href);
        ready = true; for (const cb of listeners) cb(); listeners.clear();
        assert(ctx.get('hmr')); assert(ctx.get('clientModules')); assert.equal(ctx.agents.list().length, 0);
    });

    const manager = ctx.get('pluginManager');
    const originalInstall = manager.installBundle.bind(manager);
    manager.installBundle = async (spec, options) => {
        if (targetArchive && spec === targetArchive && options?.expected?.version === to) {
            injectedFailures++;
            return { changed: false, application: 'failed', stage: 'install', target: name,
                error: { code: 'owned-target-rejected', diagnostic: 'Owned one-time generation target rejection; no package command ran.' } };
        }
        return originalInstall(spec, options);
    };
    const stager = new RegistryStager(join(root, 'doctor', 'staged'), {
        compatibility: manifest => app.evaluatePluginCompatibility(manifest, {}) });
    const unionStager = new UnionGenerationStager(join(root, 'doctor', 'union-staged'), { registryStager: stager });
    const verifyRunningGeneration = createRunningGenerationVerifier({
        entries: () => ctx.loader.entries(),
        resolveShared: (spec, fromUrl) => app.resolvePluginResource(spec, fromUrl) });
    const locate = () => app.resolveBundleDir('union-structural-proof', name, profileContext.installAnchor, profileDir);
    service = new DoctorService({ manager, profile: profileContext, runtimeVersion: app.getDshRuntimeVersion(),
        resolvePackage: async () => locate(), probeLocks: async () => ({ status: 'checked', evidence: 'checked', files: [] }),
        statePath: join(root, 'doctor', 'history.json'), taskGate: new TaskGate({ list: () => [] }),
        stager, unionStager, verifyRunningGeneration, hmrAvailable: true });
    await service.initialize();

    const baseline = await step('official-public-install-' + from, () => manager.installBundle(`${name}@${from}`,
        { registry: origin, saveExact: true, enabled: true, expected: { name, version: from } }));
    assert.equal(baseline.application, 'applied', JSON.stringify(baseline));
    result.baseline = { operation: baseline.application, state: (await manager.listBundles()).find(item => item.name === name)?.version };

    async function prepare(version) {
        const scan = await service.scan();
        const item = scan.items.find(candidate => candidate.name === name);
        result.scans ??= [];
        result.scans.push({ version, unionGeneration: item?.unionGeneration, canUpdate: item?.canUpdate,
            versionStatus: item?.versionStatus, updateStatus: item?.updateStatus,
            reasons: item?.reasons, preflight: item?.generationPreflight ? {
                status: item.generationPreflight.status, contractDigest: item.generationPreflight.contractDigest,
                previousSha256: item.generationPreflight.previousSha256, nextSha256: item.generationPreflight.nextSha256 } : null });
        assert.equal(item?.unionGeneration, true, 'the isolated route is selected by installed structure');
        assert.equal(item?.canUpdate, true, JSON.stringify(item?.reasons));
        assert.equal(item.generationPreflight.status, 'passed');
        const plan = await service.prepareBatch([{ name, version }]);
        assert.equal(plan.items[0].installMode, 'union-generation');
        assert.equal(plan.items[0].dependencyPolicy, 'isolated-js-v1');
        return plan;
    }
    const run = async (plan, policy) => {
        const start = await service.commit(plan.ticket, { confirmUnionGeneration: true, ...policy });
        await service.jobs.get(start.operationId).work;
        return service.operation(start.operationId).record.items[0];
    };

    // Round 1: one injected Host-level rejection must be recovered by a fresh old generation.
    const failedPlan = await step('prepare-generation-update', () => prepare(to));
    targetArchive = join(unionStager.root, ...planPath(failedPlan));
    result.recovery = observe(await step('commit-with-one-injected-target-rejection', () => run(failedPlan, { taskPolicy: 'wait-for-idle' })));
    assert.equal(injectedFailures, 1, 'exactly one Host-level rejection was injected');
    assert.equal(result.recovery.result, 'failed', JSON.stringify(result.recovery));
    assert.equal(result.recovery.restore, 'applied', JSON.stringify(result.recovery));
    assert.equal(result.recovery.restoreVerification?.package, 'verified');
    assert.equal(result.recovery.restoreVerification?.runtime, 'verified', 'the restored old generation must actually run');
    targetArchive = null;
    const afterRecovery = (await manager.listBundles()).find(item => item.name === name);
    assert.equal(afterRecovery.version, from);
    result.afterRecovery = { version: afterRecovery.version, active: (await manager.listPlugins()).filter(row => row.moduleName === name).every(row => row.fiberPhase === 'active') };

    // Round 2: the same structural route must now complete the real update.
    const plan = await step('prepare-generation-update-again', () => prepare(to));
    result.update = observe(await step('commit-generation-update', () => run(plan, { taskPolicy: 'wait-for-idle' })));
    assert.equal(result.update.status, 'updated', JSON.stringify(result.update));
    assert.equal(result.update.verification?.source, 'verified');
    assert.equal(result.update.verification?.runtime, 'verified');
    const bundle = (await manager.listBundles()).find(item => item.name === name);
    const rows = (await manager.listPlugins()).filter(row => row.moduleName === name);
    result.final = { version: bundle.version, source: bundle.source, update: bundle.update,
        activeRows: rows.filter(row => row.fiberPhase === 'active').length, totalRows: rows.length };
    assert.equal(bundle.version, to);
    assert.equal(bundle.update, undefined, 'an isolated generation install is not reported as an npm install');
    assert(bundle.source.startsWith('file:') && inside(unionStager.root, resolve(bundle.source.replace(/^file:/, ''))));
    assert.equal(rows.length, 1); assert(rows.every(row => row.enabled && row.fiberPhase === 'active'));

    // Functional check against a loopback fixture only.
    html = createServer((_request, response) => { response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html><body><article><h1>Structural Union proof</h1><a class="proof" href="https://example.org/proof">Verified link</a></article></body></html>'); });
    html.listen(0, '127.0.0.1'); await once(html, 'listening');
    const url = `http://127.0.0.1:${html.address().port}/proof`;
    const call = async args => {
        const reply = await ctx.tools.execute({ calls: [{ type: 'tool-call', id: 'owned-' + randomUUID(),
            name: 'advance_fetch', arguments: JSON.stringify({ url, ...args }) }], signal: AbortSignal.timeout(15000) });
        const response = reply.results[0]?.result; assert.equal(response?.isError, false, JSON.stringify(response)); return response.value;
    };
    await step('running-generation-functional-check', async () => {
        const fields = await call({ fields: 'title=article h1;link=article a.proof|href' });
        assert.equal(fields.extracted?.[0]?.value, 'Structural Union proof');
        assert.equal(fields.extracted?.[1]?.value, 'https://example.org/proof');
        const markdown = await call({ selector: 'article', mode: 'markdown' });
        assert(markdown.markdown?.includes('[Verified link](https://example.org/proof)'));
        result.functional = { fieldExtraction: true, markdown: true, transport: 'owned-loopback' };
        result.verdict = 'structural-update-and-recovery-verified';
    });
    assert((await fs.readFile(profileContext.patchPath)).equals(patch), 'the fixture patch must stay exact');
} catch (error) {
    result.fatal = String(error?.stack ?? error).slice(0, 16000);
    process.exitCode = 1;
} finally {
    result.finishedAt = new Date().toISOString();
    await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    if (html) { html.close(); html.closeAllConnections(); }
    if (service) try { await service.dispose(); } catch (error) { console.error(String(error)); process.exitCode = 1; }
    if (ctx) { let timeout; try { await Promise.race([ctx.fiber.dispose(), new Promise((_d, reject) => { timeout = setTimeout(() => reject(Error('Host disposal deadline')), 12000); })]); }
        catch (error) { console.error(String(error)); process.exitCode = 1; } finally { clearTimeout(timeout); } }
    const summary = JSON.stringify({ verdict: result.verdict, recovery: result.recovery, update: result.update, final: result.final, fatal: result.fatal });
    await new Promise(done => process.stdout.write(summary + '\n', done));
    process.exit(process.exitCode ?? 0);
}

function planPath(plan) {
    const key = plan.items[0].nextReference.archiveKey;
    assert.equal(typeof key, 'string');
    return key.split('/');
}
