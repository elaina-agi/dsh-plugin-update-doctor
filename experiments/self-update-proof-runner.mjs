import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const [mode, pnpm] = process.argv.slice(2);
assert(['update-good', 'bad-rollback'].includes(mode), 'Choose an isolated self-update proof mode');
const anchor = process.env.DSH_INSTALL_DIR;
assert(anchor?.includes('app.asar') && process.versions.electron, 'Installed ASAR Electron runtime is required');
const require = createRequire(join(anchor, 'package.json'));
const imported = name => import(pathToFileURL(require.resolve(name)).href);
const app = await imported('@deepseek-ai/dsh-app-boot');
const { provideCmdline } = await imported('@deepseek-ai/dsh-cmdline');
const temp = await fs.realpath(tmpdir());
const root = await fs.mkdtemp(join(temp, 'dsh-self-update-proof-'));
const originalCwd = process.cwd();
const workspace = resolve(originalCwd);
process.env.DSH_HOME = root; process.env.DSH_TELEMETRY_DISABLED = '1'; process.chdir(root);
for (const key of Object.keys(process.env)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)/i.test(key)) delete process.env[key];
const name = 'dsh-plugin-update-doctor', from = '0.3.0', to = mode === 'update-good' ? '0.3.1' : '0.3.2';
const evidence = { schemaVersion: 1, mode, runtimeVersion: app.getDshRuntimeVersion(), electron: process.versions.electron, node: process.versions.node, pid: process.pid, root, startedAt: new Date().toISOString(), results: [], lifecycle: [], passed: false, limitations: [
    'Actual installed AppBoot/Cordis/Loader/HMR/PluginManager and production updater index, DoctorService, SelfUpdateCoordinator, SelfUpdatePreflight, SelfUpdateStore and TaskGate in generated copied fixture packages.',
    'Only an owned temporary profile, package store, cache and loopback registry are used; no user profile, WSL, model request, active user task or replacement GUI is accessed.',
    'Generated fixtures use the real updater package name and unique archive bytes under logical public npm URLs. A fetch adapter and query/registry adapters declare that fixture origin; this is not public npm publication evidence.',
    'The sole updateBundle boundary adapter translates its logical public registry to the owned loopback transport. Actual package commands, lifecycle, target outcomes and automatic Host rollback are not replaced or forced successful.',
    'The production HTTP handler receives an in-memory panel-shaped Request. This tests preparation and commit integration, not real Connection authentication or browser clicks.',
    'Fixture index adds only a test hook and code marker; bad mode adds an intentional activation throw. The full production service/coordinator lifecycle executes for old/new or restored packages.',
    'There are zero Agent tasks. Full base/web services are loaded, model/telemetry/browser runtime and listener module delivery are disabled; this does not prove real task cancellation or Client rendering.',
    'Original raw result contains local temporary paths and stays Git/package ignored. The documented task gate release at old-plugin unload is tested, not full replacement-time task freezing.'
] };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
let ctx, server, latest, requestJob;
const realFetch = globalThis.fetch;
const packages = new Map(), captures = [];
async function step(label, fn) {
    const start = Date.now();
    try { const value = await fn(); evidence.results.push({ name: label, ok: true, elapsedMs: Date.now() - start, value }); console.log('SELF_UPDATE_PROOF_STEP', label); return value; }
    catch (error) { evidence.results.push({ name: label, ok: false, elapsedMs: Date.now() - start, error: String(error.stack || error) }); throw error; }
}
function tar(files) {
    const parts = [];
    for (const [path, bytes] of files) {
        const header = Buffer.alloc(512); assert(Buffer.byteLength(path) <= 100, 'Fixture tar path too long');
        header.write(path, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
        header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136); header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257); header.write('00', 263);
        header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
        parts.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
    }
    return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}
async function archiveFiles() {
    const files = new Map();
    for (const path of ['client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'native/LockProbe.cs', 'native/build.ps1', 'native/win-x64/lock-probe.exe']) files.set(path, await fs.readFile(join(workspace, path)));
    for (const directory of ['lib', 'locale', 'docs']) for (const entry of await fs.readdir(join(workspace, directory), { withFileTypes: true })) {
        if (!entry.isFile() || directory === 'lib' && !entry.name.endsWith('.js') || directory === 'locale' && !entry.name.endsWith('.json') || directory === 'docs' && !entry.name.endsWith('.md')) continue;
        files.set(directory + '/' + entry.name, await fs.readFile(join(workspace, directory, entry.name)));
    }
    return files;
}
function metadata(pkg, origin) { return { ...pkg.manifest, dist: { tarball: `${origin}/${pkg.manifest.name}/-/${pkg.manifest.name}-${pkg.manifest.version}.tgz`, integrity: integrity(pkg.bytes), shasum: createHash('sha1').update(pkg.bytes).digest('hex') } }; }
async function boundedDownload(response, maximum) {
    assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length <= maximum); return bytes;
}
async function deadline(promise, ms = 90000) {
    let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned self-update proof deadline; outcome unknown')), ms); })]); }
    finally { clearTimeout(timer); }
}

try {
    const originalManifest = JSON.parse(await fs.readFile(join(workspace, 'package.json'), 'utf8'));
    const originalIndex = await fs.readFile(join(workspace, 'index.js'), 'utf8'), files = await archiveFiles();
    assert(originalIndex.includes('service.selfUpdate = selfUpdate;'), 'Production self-update integration is required');
    evidence.productionFilesSha256 = Object.fromEntries([...files].map(([path, bytes]) => [path, sha(bytes)]));
    evidence.productionFilesSha256['index.js'] = sha(Buffer.from(originalIndex));
    evidence.productionFilesSha256['package.json'] = sha(await fs.readFile(join(workspace, 'package.json')));
    evidence.productionSourceVersion = originalManifest.version;
    for (const version of [from, to]) {
        const manifest = { ...originalManifest, version, dependencies: { yaml: version === from ? '^2.9.0' : '2.9.1' } };
        let index = originalIndex.replace('service.selfUpdate = selfUpdate;', `service.selfUpdate = selfUpdate;\n    await globalThis.__selfUpdateProofOnService({service,selfUpdate,ctx,version:${JSON.stringify(version)}});\n    ctx.provide('selfUpdateProofCode',{read:()=>${JSON.stringify('production-code-' + version)}});`);
        if (mode === 'bad-rollback' && version === to) index = index.replace('export async function apply(ctx) {', "export async function apply(ctx) { throw Error('OWNED_SELF_UPDATE_BAD_ACTIVATION');");
        const packed = new Map(files); packed.set('index.js', Buffer.from(index)); packed.set('package.json', Buffer.from(JSON.stringify(manifest, null, 2)));
        const bytes = tar([...packed].map(([path, value]) => ['package/' + path, value])); packages.set(version, { manifest, bytes });
    }
    const yamlMeta = await realFetch('https://registry.npmjs.org/yaml/2.9.1', { signal: AbortSignal.timeout(30000), redirect: 'error' }).then(async response => JSON.parse((await boundedDownload(response, 512 * 1024)).toString('utf8')));
    assert.equal(yamlMeta.name, 'yaml'); assert.equal(yamlMeta.version, '2.9.1');
    const yamlURL = new URL(yamlMeta.dist.tarball); assert.equal(yamlURL.origin, 'https://registry.npmjs.org');
    const yamlBytes = await boundedDownload(await realFetch(yamlURL, { signal: AbortSignal.timeout(30000), redirect: 'error' }), 4 * 1024 * 1024);
    assert.equal(integrity(yamlBytes), yamlMeta.dist.integrity);
    const yamlPkg = { manifest: yamlMeta, bytes: yamlBytes };
    evidence.yamlOriginalIntegrityVerified = true; evidence.yamlSha256 = sha(yamlBytes);
    server = createServer((request, response) => {
        const url = new URL(request.url, 'http://fixture.internal'), path = decodeURIComponent(url.pathname);
        const npmHeaders = { 'content-type': 'application/json' };
        const all = path.startsWith('/yaml') ? new Map([['2.9.1', yamlPkg]]) : packages;
        const packageName = path.startsWith('/yaml') ? 'yaml' : name;
        if (path === '/' + packageName) {
            const versions = Object.fromEntries([...all].map(([version, pkg]) => [version, metadata(pkg, origin)]));
            response.writeHead(200, npmHeaders); response.end(JSON.stringify({ name: packageName, 'dist-tags': { latest: packageName === name ? to : '2.9.1' }, versions, time: Object.fromEntries([...all.keys()].map(version => [version, '2026-11-01T00:00:00.000Z'])) })); return;
        }
        const version = path.split('/').at(-1), exact = all.get(version);
        if (exact && path === '/' + packageName + '/' + version) { response.writeHead(200, npmHeaders); response.end(JSON.stringify(metadata(exact, origin))); return; }
        const archive = [...all].find(([version]) => path === `/${packageName}/-/${packageName}-${version}.tgz`);
        if (archive) { response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.end(archive[1].bytes); return; }
        response.writeHead(404, npmHeaders); response.end(JSON.stringify({ error: 'Owned fixture path not found' }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    evidence.registry = origin;
    globalThis.fetch = async (url, options) => {
        const logical = new URL(String(url));
        if (logical.origin === 'https://registry.npmjs.org' && logical.pathname.startsWith('/' + name + '/')) {
            const version = logical.pathname.split('/').at(-1), exact = packages.get(version);
            if (exact) return Response.json(metadata(exact, 'https://registry.npmjs.org'));
            const archive = [...packages].find(([version]) => logical.pathname === `/${name}/-/${name}-${version}.tgz`);
            if (archive) return new Response(archive[1].bytes);
            return new Response('Not found', { status: 404 });
        }
        return realFetch(url, options);
    };
    globalThis.__selfUpdateProofOnService = async capture => {
        captures.push(capture); latest = capture;
        evidence.lifecycle.push({ kind: 'production-apply', version: capture.version, generation: captures.length, pid: process.pid });
        const originalDispose = capture.selfUpdate.dispose.bind(capture.selfUpdate);
        capture.selfUpdate.dispose = async () => {
            const start = Date.now(); evidence.lifecycle.push({ kind: 'self-dispose-start', version: capture.version, dispatched: !!capture.selfUpdate.job?.dispatched });
            await originalDispose();
            evidence.lifecycle.push({ kind: 'self-dispose-end', version: capture.version, durationMs: Date.now() - start, gateActive: capture.selfUpdate.taskGate.active });
        };
        const doctorDispose = capture.service.dispose.bind(capture.service);
        capture.service.dispose = async () => { const start = Date.now(); await doctorDispose(); evidence.lifecycle.push({ kind: 'doctor-dispose-end', version: capture.version, durationMs: Date.now() - start }); };
    };
    const profileDir = join(root, 'profiles', 'proof'); await fs.mkdir(profileDir, { recursive: true });
    const composition = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
    const context = { name: 'proof', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), installAnchor: join(anchor, 'package.json'), cwd: root, home: root, startedBundles: composition, overlays: [], telemetryDisabledEnv: '1', packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { ELECTRON_RUN_AS_NODE: '1', CI: 'true' } } };
    await fs.writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'owned-self-update-proof', private: true, type: 'module', dependencies: {}, dsh: { profile: { bundles: composition } } }));
    await fs.writeFile(join(profileDir, 'pnpm-workspace.yaml'), `autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\nregistry: ${JSON.stringify(origin)}\nstoreDir: ${JSON.stringify(join(root, 'pnpm-store'))}\ncacheDir: ${JSON.stringify(join(root, 'pnpm-cache'))}\npackageImportMethod: copy\nminimumReleaseAge: 0\n`);
    const disabled = ['webserver', 'web-runtime', 'modules', 'harness-dev-context', 'open-in-app', 'directory-picker', 'client-hmr', 'session-title-llm', 'llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics'];
    await fs.writeFile(context.patchPath, JSON.stringify([...disabled.map(id => ({ id, disabled: true })), { id: 'agent-loop', config: { agents: [] } }, { id: 'plugin-manager', config: { registry: origin, fallbackRegistries: [], inspectTimeoutMs: 10000, githubConnectionTimeoutMs: 1000, gitTransportTimeoutMs: 1000, lockWaitMs: 5000, idleTimeoutMs: 30000 } }]));
    const config = join(profileDir, 'cordis.yml'); await fs.writeFile(config, '[]\n');
    const profile = app.loadProfileDirectory('self-update-proof', profileDir, context.installAnchor), resolution = await app.createRuntimeResolution({ installAnchor: context.installAnchor, profile, home: root });
    let ready = false; const readyListeners = new Set();
    ctx = await app.boot('self-update-proof', config, app.readProfilePatches('self-update-proof', context, profile), async rootCtx => {
        rootCtx.provide('profileContext', context); await rootCtx.plugin(app.PluginPackages, { resolution });
        provideCmdline(rootCtx, { args: ['--no-open', '--port', '0'], exit: code => { throw Error('Unexpected test exit ' + code); }, ready: { onReady(callback) { if (ready) callback(); else readyListeners.add(callback); return () => readyListeners.delete(callback); } } });
    }, pathToFileURL(join(profileDir, 'package.json')).href);
    ready = true; for (const callback of [...readyListeners]) callback(); readyListeners.clear();
    const manager = ctx.get('pluginManager'); assert(manager);
    await step('actual-manager-installs-old-production-package', async () => {
        const result = await manager.installBundle(name + '@' + from, { registry: origin, enabled: true, expected: { name, version: from } });
        assert.equal(result.application, 'applied', JSON.stringify(result)); assert.equal(ctx.get('selfUpdateProofCode').read(), 'production-code-' + from); assert.equal(captures.length, 1);
        return { result, code: ctx.get('selfUpdateProofCode').read(), copiedPackage: true };
    });
    const old = latest, realUpdate = manager.updateBundle;
    const managementEntry = [...ctx.get('loader').entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-plugin-manager');
    assert(managementEntry?.fiber?.uid != null); const managerFiberUid = managementEntry.fiber.uid;
    manager.registries = async () => ({ registry: 'https://registry.npmjs.org/', resolved: 'https://registry.npmjs.org/', fallbackRegistries: [] });
    manager.listVersions = async candidate => {
        assert.equal(candidate, name); const installed = (await manager.listBundles()).find(bundle => bundle.name === name).version;
        return { status: 'listed', installed, registry: 'https://registry.npmjs.org/', attempts: [{ registry: 'https://registry.npmjs.org/' }], versions: installed === from ? [{ version: to, bundle: true, prerelease: false, distTags: ['latest'] }] : [], omitted: 0 };
    };
    manager.updateBundle = function(candidate, version, options) { assert.equal(candidate, name); assert.equal(version, to); assert.equal(options.registry, 'https://registry.npmjs.org'); evidence.independentHostHandoff = true; return realUpdate.call(this, candidate, version, { ...options, registry: origin }); };
    const installedDirectory = await fs.realpath(app.resolveBundleDir('self-update-proof', name, context.installAnchor, profileDir));
    assert.equal((await fs.lstat(installedDirectory)).isSymbolicLink(), false);
    const installedRequire = createRequire(join(installedDirectory, 'package.json'));
    const yamlVersion = JSON.parse(await fs.readFile(installedRequire.resolve('yaml/package.json'), 'utf8')).version;
    assert.equal(yamlVersion, '2.9.1');
    const modules = require('yaml').parse(await fs.readFile(join(profileDir, 'node_modules', '.modules.yaml'), 'utf8'));
    assert.equal(resolve(modules.storeDir), join(root, 'pnpm-store', 'v11')); evidence.ownedStoreVerified = true;
    const { createHandler, PANEL_HEADER, PANEL_MARKER } = await import(pathToFileURL(join(installedDirectory, 'lib/http.js')).href);
    const handler = createHandler(old.service), headers = { 'content-type': 'application/json', [PANEL_HEADER]: PANEL_MARKER };
    const request = body => new Request('http://dsh.internal/api/plugin-update-doctor', { method: 'POST', headers, body: JSON.stringify(body) });
    const plan = await step('production-http-prepares-exact-self-confirmation', async () => {
        const response = await handler(request({ action: 'prepare-self-update', version: to })); const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); assert.equal(value.operation, 'host-self-update'); assert.equal(value.items.length, 1); assert.equal(value.items[0].to, to); return value;
    });
    await step('production-http-commits-default-wait-and-independent-host-handoff', async () => {
        const response = await handler(request({ action: 'commit', ticket: plan.ticket })); const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); assert.equal(value.operation, 'host-self-update');
        const job = old.selfUpdate.job; assert(job); requestJob = job;
        await deadline(job.work);
        const final = await old.selfUpdate.state(job.id);
        return { response: value, oldDispatched: job.dispatched, oldClosed: old.selfUpdate.closed, gateActive: old.selfUpdate.taskGate.active, final };
    });
    const state = await step('new-or-restored-production-instance-reads-final-record', async () => {
        assert(latest !== old);
        const currentManagerEntry = [...ctx.get('loader').entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-plugin-manager');
        assert.equal(currentManagerEntry?.fiber?.uid, managerFiberUid);
        const state = await latest.selfUpdate.state(requestJob.id);
        assert.equal(state.phase, 'finished', JSON.stringify(state)); assert(state.result);
        const bundle = (await manager.listBundles()).find(bundle => bundle.name === name), rows = (await manager.listPlugins()).filter(row => row.moduleName === name);
        const expected = mode === 'update-good' ? to : from;
        assert.equal(bundle.version, expected); assert.equal(bundle.enabled, true); assert.equal(rows.length, 1); assert(rows.every(row => row.enabled && row.fiberPhase === 'active'));
        assert.equal(ctx.get('selfUpdateProofCode').read(), 'production-code-' + expected);
        const directory = await fs.realpath(app.resolveBundleDir('self-update-proof', name, context.installAnchor, profileDir)), packageRequire = createRequire(join(directory, 'package.json'));
        assert.equal(JSON.parse(await fs.readFile(packageRequire.resolve('yaml/package.json'), 'utf8')).version, '2.9.1');
        if (mode === 'update-good') { assert.equal(state.result.result.application, 'applied'); assert.equal(state.verification.package.status, 'verified'); assert.equal(state.verification.host.status, 'active'); assert.equal(state.verifiedApplied, true); }
        else { assert.equal(state.result.result.application, 'failed'); assert.equal(state.result.result.packageResult.exitCode, 0); assert.match(state.result.result.error.diagnostic, /OWNED_SELF_UPDATE_BAD_ACTIVATION/); assert.equal(state.result.restore.application, 'applied'); assert.equal(state.verification.package.status, 'unknown'); assert.equal(state.restoreVerification.package.status, 'verified'); assert.equal(state.restoreVerification.host.status, 'active'); assert.equal(state.verifiedApplied, false); }
        return { state, exactVersion: expected, rows, code: ctx.get('selfUpdateProofCode').read(), yamlVersion: '2.9.1', sameManager: true, samePid: true };
    });
    if (mode === 'update-good') await step('same-version-owned-file-tamper-is-not-reported-as-verified-success', async () => {
        const directory = await fs.realpath(app.resolveBundleDir('self-update-proof', name, context.installAnchor, profileDir)), target = join(directory, 'lib/self-update.js');
        const original = await fs.readFile(target);
        try {
            await fs.writeFile(target, Buffer.concat([original, Buffer.from('\n// owned verification-only tamper\n')]));
            const checked = await latest.selfUpdate.state(requestJob.id);
            assert.equal(checked.result.result.application, 'applied'); assert.equal(checked.verification.package.status, 'failed'); assert.equal(checked.verifiedApplied, false);
            return { recordedOutcomePreserved: true, independentPackageStatus: checked.verification.package.status, verifiedApplied: checked.verifiedApplied, sameVersion: checked.verification.package.version };
        } finally { await fs.writeFile(target, original); }
    });
    await step('old-production-disposal-does-not-await-host-replacement', async () => {
        const endings = evidence.lifecycle.filter(event => event.version === from && event.kind === 'self-dispose-end'); assert(endings.length >= 1); assert(endings[0].durationMs < 4500); assert.equal(endings[0].gateActive, false);
        const doctor = evidence.lifecycle.find(event => event.version === from && event.kind === 'doctor-dispose-end'); assert(doctor && doctor.durationMs < 4500);
        assert.equal(old.selfUpdate.taskGate.active, false); assert.equal(old.selfUpdate.closed, true);
        return { selfDisposeMs: endings[0].durationMs, doctorDisposeMs: doctor.durationMs, noFiveSecondCycle: true, oldGateReleased: true };
    });
    assert.equal(ctx.get('agents').list().length, 0);
    evidence.application = state.state.result.result.application; evidence.restoreApplication = state.state.result.restore?.application; evidence.noAgentTasks = true; evidence.samePid = true; evidence.passed = true;
} catch (error) { evidence.fatal = String(error.stack || error); process.exitCode = 1; }
finally {
    if (ctx) { try { await ctx.fiber.dispose(); } catch (error) { evidence.hostCleanupError = String(error.stack || error); process.exitCode = 1; } }
    globalThis.fetch = realFetch; delete globalThis.__selfUpdateProofOnService;
    if (server) { server.closeAllConnections(); await new Promise(resolveClosed => server.close(resolveClosed)); }
    process.chdir(originalCwd);
    const actual = await fs.realpath(root), info = await fs.lstat(root);
    assert.equal(actual, resolve(root)); assert.equal(dirname(actual), temp); assert(basename(actual).startsWith('dsh-self-update-proof-')); assert(info.isDirectory() && !info.isSymbolicLink());
    console.log('SELF_UPDATE_PROOF_CLEANUP_VERIFIED');
    try { await fs.rm(actual, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); evidence.cleaned = true; } catch (error) { evidence.cleanupError = String(error); process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString();
    console.log('SELF_UPDATE_PROOF_RESULT ' + JSON.stringify(evidence));
    if (evidence.fatal) console.error(evidence.fatal);
}
