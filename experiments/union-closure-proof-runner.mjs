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
import { inspectUnionArchive, packUnionArchive } from '../lib/union-generation.js';

const [pnpm, outputArg] = process.argv.slice(2);
const anchor = process.env.DSH_INSTALL_DIR;
assert(anchor?.includes('app.asar') && process.versions.electron);
assert(pnpm && outputArg);
assert(!process.env.DSH_OWNED_NODE_CORE_PATCH_PROOF && !process.env.NODE_OPTIONS, 'The closure proof must run stock');
const name = 'dsh-union-search', from = '0.11.0', to = '0.11.1', origin = 'https://registry.npmjs.org';
const workspace = process.cwd(), output = resolve(outputArg);
assert.equal(dirname(output), join(workspace, 'artifacts', 'union-closure-0.6.0'));
assert.equal(basename(output), 'host-result.json');
const temp = await fs.realpath(tmpdir());
const root = await fs.mkdtemp(join(temp, 'dsh-union-closure-proof-'));
console.log('OWNED_ROOT=' + root);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sri = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const inside = (base, path) => { const rel = relative(base, path); return !!rel && !isAbsolute(rel) && rel.split(/[\\/]/)[0] !== '..'; };
const result = { schema: 1, pid: process.pid, runtimeVersion: null, electron: process.versions.electron, node: process.versions.node,
    root, startedAt: new Date().toISOString(), steps: [], archives: {}, verdict: 'unmeasured', limitations: [
        'Unmodified installed Electron, Loader, HMR and PluginManager; production DoctorService, registry stager, isolated-generation stager and running-namespace verifier.',
        `The installed ${from} archive and every dependency are the exact public npm bytes. The ${to} candidate is a synthetic manifest edit of the same public ${from} archive (version bump plus one real public dependency, is-number@^7.0.0) served only to the updater, because no such release exists on npm.`,
        'Dependency closure archives are the real public npm tarballs, verified against their published SHA-512 integrity; the generation embeds them and the official profile package manager also resolves the same declarations.',
        'Owned temporary profile/store/cache/home. No live user profile, sessions, browser DOM or model request.',
        'The one target-install rejection is injected at the manager boundary before any package command and is not a public defect. A tampered dependency archive is served only to prove a refused prepare, never installed.',
        'Successful replacement is reported only when the official manager applies it, original bytes match, Host rows are active and the exact fresh Loader namespace is running.'
    ] };
let ctx, service, html, injectedFailures = 0, targetArchive = null, tamper = false;
let candidate = null; // { manifest, bytes, integrity }
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

/** Public-registry fetcher: real npm for the installed release and the complete dependency
 * closure, one synthetic candidate archive for the target version. */
const fetchPublic = (url, options) => {
    const target = new URL(url);
    const metadataURL = `${origin}/${name}/${to}`, archiveURL = `${origin}/${name}/-/${name}-${to}.tgz`;
    if (target.href === metadataURL && candidate) return Promise.resolve(Response.json({ ...candidate.manifest,
        dist: { tarball: archiveURL, integrity: candidate.integrity } }));
    if (target.href === archiveURL && candidate) return Promise.resolve(new Response(candidate.bytes));
    if (tamper && target.href === `${origin}/is-number/-/is-number-7.0.0.tgz`) return Promise.resolve(new Response(Buffer.from('tampered closure archive')));
    return fetch(url, options);
};

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
    await step('read-public-root-and-build-synthetic-candidate', async () => {
        const info = JSON.parse(await publicBytes(`${name}/${from}`, 2 * 1024 * 1024));
        assert.equal(info.name, name); assert.equal(info.version, from);
        const path = `${name}/-/${name}-${from}.tgz`;
        assert.equal(info.dist.tarball, `${origin}/${path}`);
        const installedBytes = await publicBytes(path, 16 * 1024 * 1024);
        assert.equal(sri(installedBytes), info.dist.integrity);
        const entries = archiveEntries(installedBytes);
        const manifestEntry = entries.find(entry => entry.name === 'package/package.json');
        const manifest = JSON.parse(manifestEntry.bytes.toString('utf8'));
        assert.equal(manifest.name, name); assert.equal(manifest.version, from);
        assert.deepEqual(manifest.dependencies, { '@deepseek-ai/schemastery': '^3.18.4', cheerio: '^1.2.0', turndown: '^7.2.4', '@joplin/turndown-plugin-gfm': '^1.0.68' });
        const nextManifest = { ...manifest, version: to, dependencies: { ...manifest.dependencies, 'is-number': '^7.0.0' } };
        const nextBytes = packUnionArchive(entries.map(entry => entry.name === 'package/package.json'
            ? { name: entry.name, bytes: Buffer.from(JSON.stringify(nextManifest, null, 2)) }
            : { name: entry.name, bytes: entry.bytes }));
        candidate = { manifest: nextManifest, bytes: nextBytes, integrity: sri(nextBytes) };
        result.archives.installed = { version: from, sha256: sha(installedBytes), integrity: info.dist.integrity,
            files: entries.length, dependencies: manifest.dependencies };
        result.archives.candidate = { version: to, sha256: sha(nextBytes), integrity: candidate.integrity,
            files: inspectUnionArchive(nextBytes).length, dependencies: nextManifest.dependencies,
            published: false, derivation: 'public ' + from + ' archive with a version bump and one added real dependency declaration' };
    });

    const profileDir = join(root, 'profiles', 'proof');
    await fs.mkdir(profileDir, { recursive: true });
    const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
    const profileContext = { name: 'proof', dir: profileDir, home: root, patchPath: join(profileDir, 'cordis.patch.yml'),
        installAnchor: join(anchor, 'package.json'), cwd: root, startedBundles: bundles, overlays: [], telemetryDisabledEnv: '1',
        packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { ELECTRON_RUN_AS_NODE: '1', CI: 'true', ...npmEnvironment } } };
    await fs.writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'owned-union-closure-profile', private: true,
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
    const profile = app.loadProfileDirectory('union-closure-proof', profileDir, profileContext.installAnchor);
    const resolution = await app.createRuntimeResolution({ installAnchor: profileContext.installAnchor, profile, home: root });
    let ready = false; const listeners = new Set();
    await step('boot-stock-host', async () => {
        ctx = await app.boot('union-closure-proof', config, app.readProfilePatches('union-closure-proof', profileContext, profile), async c => {
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
    const stager = new RegistryStager(join(root, 'doctor', 'staged'), { fetcher: fetchPublic,
        compatibility: manifest => app.evaluatePluginCompatibility(manifest, {}) });
    const unionStager = new UnionGenerationStager(join(root, 'doctor', 'union-staged'), { registryStager: stager, fetcher: fetchPublic });
    const verifyRunningGeneration = createRunningGenerationVerifier({
        entries: () => ctx.loader.entries(),
        resolveShared: (spec, fromUrl) => app.resolvePluginResource(spec, fromUrl) });
    const locate = () => app.resolveBundleDir('union-closure-proof', name, profileContext.installAnchor, profileDir);
    service = new DoctorService({ manager, profile: profileContext, runtimeVersion: app.getDshRuntimeVersion(),
        resolvePackage: async () => locate(), probeLocks: async () => ({ status: 'checked', evidence: 'checked', files: [] }),
        statePath: join(root, 'doctor', 'history.json'), taskGate: new TaskGate({ list: () => [] }),
        stager, unionStager, verifyRunningGeneration, hmrAvailable: true });
    await service.initialize();

    const baseline = await step('official-public-install-' + from, () => manager.installBundle(`${name}@${from}`,
        { registry: origin, saveExact: true, enabled: true, expected: { name, version: from } }));
    assert.equal(baseline.application, 'applied', JSON.stringify(baseline));
    result.baseline = { operation: baseline.application, state: (await manager.listBundles()).find(item => item.name === name)?.version };

    const scanItem = async () => {
        const scan = await service.scan();
        return scan.items.find(candidateItem => candidateItem.name === name);
    };
    const prepare = async () => {
        const item = await scanItem();
        result.scan = { unionGeneration: item?.unionGeneration, canUpdate: item?.canUpdate, versionStatus: item?.versionStatus,
            updateStatus: item?.updateStatus, reasons: item?.reasons, preflight: item?.generationPreflight ? {
                status: item.generationPreflight.status, closurePackages: item.generationPreflight.closurePackages,
                closureDigest: item.generationPreflight.closureDigest, previousSha256: item.generationPreflight.previousSha256,
                nextSha256: item.generationPreflight.nextSha256 } : null };
        assert.equal(item?.unionGeneration, true, 'the isolated route is selected by installed structure');
        assert.equal(item?.canUpdate, true, JSON.stringify(item?.reasons));
        assert.equal(item.generationPreflight.status, 'download-required',
            'the installed closure does not satisfy the added dependency declaration');
        assert(item.generationPreflight.closurePackages >= 1);
        const plan = await service.prepareBatch([{ name, version: to }]);
        assert.equal(plan.items[0].installMode, 'union-generation');
        assert(plan.items[0].dependencyClosure?.packages >= 1, 'the plan records the downloaded closure');
        assert(plan.items[0].dependencyClosure.bytes > 0);
        result.plan ??= { closure: plan.items[0].dependencyClosure, dependencyPolicy: plan.items[0].dependencyPolicy };
        return plan;
    };
    const run = async (plan, policy) => {
        const start = await service.commit(plan.ticket, { confirmUnionGeneration: true, ...policy });
        await service.jobs.get(start.operationId).work;
        return service.operation(start.operationId).record.items[0];
    };

    // A tampered closure archive must be refused during prepare, before any mutation.
    tamper = true;
    await step('refuse-tampered-closure-before-mutation', async () => {
        const item = await scanItem();
        result.tamperScan = item && { canUpdate: item.canUpdate, reasons: item.reasons,
            preflight: item.generationPreflight ? { status: item.generationPreflight.status, closurePackages: item.generationPreflight.closurePackages } : null };
        assert.equal(item.generationPreflight?.status, 'download-required', JSON.stringify(result.tamperScan));
        await assert.rejects(() => service.prepareBatch([{ name, version: to }]), error => error.code === 'dependency-closure-integrity');
        const bundle = (await manager.listBundles()).find(value => value.name === name);
        assert.equal(bundle.version, from, 'the profile is untouched by the refused prepare');
        result.tamperRefusal = { code: 'dependency-closure-integrity', installedVersion: bundle.version };
    });
    tamper = false;

    // Target rejection: recovery must restore the previous generation, which carries the installed closure.
    const failedPlan = await step('prepare-closure-update', () => prepare());
    targetArchive = join(unionStager.root, ...planPath(failedPlan));
    result.recovery = observe(await step('commit-with-one-injected-target-rejection', () => run(failedPlan, { taskPolicy: 'wait-for-idle' })));
    assert.equal(injectedFailures, 1, 'exactly one Host-level rejection was injected');
    assert.equal(result.recovery.result, 'failed', JSON.stringify(result.recovery));
    assert.equal(result.recovery.restore, 'applied', JSON.stringify(result.recovery));
    assert.equal(result.recovery.restoreVerification?.package, 'verified');
    assert.equal(result.recovery.restoreVerification?.runtime, 'verified', 'the restored old generation must actually run');
    targetArchive = null;

    const plan = await step('prepare-closure-update-again', () => prepare());
    result.update = observe(await step('commit-closure-update', () => run(plan, { taskPolicy: 'wait-for-idle' })));
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

    // Functional check against a loopback fixture only, using the real Union tool from the new generation.
    html = createServer((_request, response) => { response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end('<!doctype html><html><body><article><h1>Closure Union proof</h1><a class="proof" href="https://example.org/proof">Verified link</a></article></body></html>'); });
    html.listen(0, '127.0.0.1'); await once(html, 'listening');
    const url = `http://127.0.0.1:${html.address().port}/proof`;
    const call = async args => {
        const reply = await ctx.tools.execute({ calls: [{ type: 'tool-call', id: 'owned-' + randomUUID(),
            name: 'advance_fetch', arguments: JSON.stringify({ url, ...args }) }], signal: AbortSignal.timeout(15000) });
        const response = reply.results[0]?.result; assert.equal(response?.isError, false, JSON.stringify(response)); return response.value;
    };
    await step('running-generation-functional-check', async () => {
        const fields = await call({ fields: 'title=article h1;link=article a.proof|href' });
        assert.equal(fields.extracted?.[0]?.value, 'Closure Union proof');
        assert.equal(fields.extracted?.[1]?.value, 'https://example.org/proof');
        const markdown = await call({ selector: 'article', mode: 'markdown' });
        assert(markdown.markdown?.includes('[Verified link](https://example.org/proof)'));
        const embedded = (await manager.listBundles()).find(value => value.name === name);
        assert(embedded.version === to);
        result.functional = { fieldExtraction: true, markdown: true, transport: 'owned-loopback' };
        result.verdict = 'closure-download-and-recovery-verified';
    });
    assert((await fs.readFile(profileContext.patchPath)).equals(patch), 'the fixture patch must stay exact');
} catch (error) {
    result.fatal = String(error?.stack ?? error).slice(0, 16000);
    process.exitCode = 1;
} finally {
    result.finishedAt = new Date().toISOString();
    await fs.mkdir(dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    if (html) { html.close(); html.closeAllConnections(); }
    if (service) try { await service.dispose(); } catch (error) { console.error(String(error)); process.exitCode = 1; }
    if (ctx) { let timeout; try { await Promise.race([ctx.fiber.dispose(), new Promise((_d, reject) => { timeout = setTimeout(() => reject(Error('Host disposal deadline')), 12000); })]); }
        catch (error) { console.error(String(error)); process.exitCode = 1; } finally { clearTimeout(timeout); } }
    const summary = JSON.stringify({ verdict: result.verdict, tamperRefusal: result.tamperRefusal, recovery: result.recovery, update: result.update, final: result.final, fatal: result.fatal });
    await new Promise(done => process.stdout.write(summary + '\n', done));
    process.exit(process.exitCode ?? 0);
}

function planPath(plan) {
    const key = plan.items[0].nextReference.archiveKey;
    assert.equal(typeof key, 'string');
    return key.split('/');
}
