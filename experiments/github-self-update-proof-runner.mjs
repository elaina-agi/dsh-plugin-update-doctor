import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname, basename, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const [mode, pnpm] = process.argv.slice(2);
assert(['update-good', 'bad-rollback'].includes(mode), 'Choose an isolated GitHub self-update proof mode');
const anchor = process.env.DSH_INSTALL_DIR;
assert(anchor?.includes('app.asar') && process.versions.electron, 'Installed ASAR Electron runtime is required');
const require = createRequire(join(anchor, 'package.json'));
const imported = name => import(pathToFileURL(require.resolve(name)).href);
const app = await imported('@deepseek-ai/dsh-app-boot');
const { provideCmdline } = await imported('@deepseek-ai/dsh-cmdline');
const temp = await fs.realpath(tmpdir());
const root = await fs.mkdtemp(join(temp, 'dsh-github-self-proof-'));
const originalCwd = process.cwd(), workspace = resolve(originalCwd);
process.env.DSH_HOME = root; process.env.DSH_TELEMETRY_DISABLED = '1'; process.chdir(root);
for (const key of Object.keys(process.env)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)/i.test(key)) delete process.env[key];
const name = 'dsh-plugin-update-doctor', repository = 'elaina-agi/dsh-plugin-update-doctor', from = '0.4.1', to = '0.5.0';
const publicApi = `https://api.github.com/repos/${repository}`, publicRaw = `https://raw.githubusercontent.com/${repository}/`;
const evidence = { schemaVersion: 1, mode, runtimeVersion: app.getDshRuntimeVersion(), electron: process.versions.electron, node: process.versions.node, pid: process.pid, root, startedAt: new Date().toISOString(), results: [], lifecycle: [], passed: false, limitations: [
    'Actual installed rc.5 AppBoot/Cordis/Loader/HMR/PluginManager and copied current production updater index, coordinator, GitHub preflight, receipt store, DoctorService and TaskGate run in owned fixture packages.',
    'Only an owned temporary DSH home/profile, Git repository, package store/cache and loopback Git/registry server are used; the live profile, WSL and user tasks are not touched.',
    'The old fixture version 0.4.1 already contains the current production GitHub feature so it can initiate this proof. This is not proof that a real unmodified 0.4.1 can initiate GitHub self-update.',
    'GitHub API/ref/commit/tree/raw responses are explicit fixtures made from real generated Git objects of the same copied files installed by pnpm, not public GitHub release or authentication evidence.',
    'A receiver-preserving public installBundle adapter translates only the fixed logical GitHub repository spec to owned loopback Git transport and maps that exact transport target identity back in pre-activation failure results; raw results remain in local evidence. listBundles maps the saved owned source back to the logical public identity.',
    'The public updateBundle implementation and all package commands, lifecycle, failure outcomes and automatic old-source restoration are not replaced or forced successful. Its Git reachability check follows fixture-owned Git URL configuration.',
    'The production HTTP handler receives an in-memory panel-shaped request, not a real Connection-authenticated browser click. Browser, listener/module delivery, models and telemetry are disabled; there are zero Agent tasks.',
    'TaskGate release at old-plugin unload is verified; full replacement-time task freezing, real task cancellation and browser rendering are not proven.',
    'Raw results include owned temporary paths and remain Git/package ignored. Prepared trees are evidence, not an atomic replacement/CAS contract with the official Host.'
] };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const logicalSpec = commit => `github:${repository}#${commit}`;
let ctx, server, latest, requestJob, origin;
const realFetch = globalThis.fetch, captures = [], commits = new Map();
const gitConfig = join(root, 'fixture-git-config'), hooks = join(root, 'empty-git-hooks');
const gitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_CONFIG|^SSH_|TOKEN|SECRET|PASSWORD|API_KEY/i.test(key)));
Object.assign(gitEnvironment, { GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', SSH_ASKPASS_REQUIRE: 'never', LC_ALL: 'C' });
function git(cwd, args) {
    const run = spawnSync('git', ['-c', `core.hooksPath=${hooks}`, '-c', 'core.autocrlf=false', '-c', 'core.attributesFile=', '-c', 'core.excludesFile=', ...args], { cwd, env: gitEnvironment, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    if (run.error || run.status !== 0) throw Error(`Owned fixture Git failed (${run.status}): ${run.error ?? run.stderr}`);
    return run.stdout.trim();
}
async function step(label, fn) {
    const start = Date.now();
    try { const value = await fn(); evidence.results.push({ name: label, ok: true, elapsedMs: Date.now() - start, value }); console.log('GITHUB_SELF_UPDATE_PROOF_STEP', label); return value; }
    catch (error) { evidence.results.push({ name: label, ok: false, elapsedMs: Date.now() - start, error: String(error.stack || error) }); throw error; }
}
async function deadline(promise, ms = 90000) {
    let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Owned GitHub self-update proof deadline; outcome unknown')), ms); })]); }
    finally { clearTimeout(timer); }
}
async function boundedDownload(response, maximum) {
    assert.equal(response.status, 200); const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length <= maximum); return bytes;
}
async function fixtureFiles() {
    const files = new Map();
    for (const path of ['client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'pnpm-lock.yaml', 'native/LockProbe.cs', 'native/build.ps1', 'native/win-x64/lock-probe.exe']) files.set(path, await fs.readFile(join(workspace, path)));
    for (const directory of ['lib', 'locale', 'docs']) for (const entry of await fs.readdir(join(workspace, directory), { withFileTypes: true })) {
        if (!entry.isFile() || directory === 'lib' && !entry.name.endsWith('.js') || directory === 'locale' && !entry.name.endsWith('.json') || directory === 'docs' && !entry.name.endsWith('.md')) continue;
        files.set(directory + '/' + entry.name, await fs.readFile(join(workspace, directory, entry.name)));
    }
    return files;
}
async function saveTree(repoDir, files) {
    for (const [path, bytes] of files) { await fs.mkdir(dirname(join(repoDir, path)), { recursive: true }); await fs.writeFile(join(repoDir, path), bytes); }
}
function treeRecord(repoDir, commit, files) {
    const tree = git(repoDir, ['rev-parse', `${commit}^{tree}`]);
    const rows = git(repoDir, ['ls-tree', '-r', '-t', '-z', commit]).split('\0').filter(Boolean).map(line => {
        const match = /^(\d{6}) (blob|tree) ([0-9a-f]{40})\t(.+)$/.exec(line); assert(match, line);
        const [, mode, type, sha, path] = match;
        return { path, mode, type, sha, ...(type === 'blob' ? { size: files.get(path).length } : {}) };
    });
    return { commit, tree, rows, files };
}

try {
    await fs.mkdir(hooks); await fs.writeFile(gitConfig, '');
    const originalManifest = JSON.parse(await fs.readFile(join(workspace, 'package.json'), 'utf8'));
    const originalIndex = await fs.readFile(join(workspace, 'index.js'), 'utf8'), files = await fixtureFiles();
    assert(originalIndex.includes('githubPreflight') && files.has('lib/self-update-github.js'), 'Production GitHub self-update integration is required');
    evidence.productionSourceVersion = originalManifest.version;
    evidence.productionFilesSha256 = Object.fromEntries([...files].map(([path, bytes]) => [path, sha256(bytes)]));
    evidence.productionFilesSha256['index.js'] = sha256(Buffer.from(originalIndex));
    evidence.productionFilesSha256['package.json'] = sha256(await fs.readFile(join(workspace, 'package.json')));
    const repoDir = join(root, 'source-repository'), bareDir = join(root, 'doctor.git');
    await fs.mkdir(repoDir); git(repoDir, ['init', '-b', 'main']);
    for (const version of [from, to]) {
        const manifest = { ...originalManifest, version, dependencies: { yaml: '2.9.1' } };
        let index = originalIndex.replace('service.selfUpdate = selfUpdate;', `service.selfUpdate = selfUpdate;\n    await globalThis.__githubSelfUpdateProofOnService({service,selfUpdate,ctx,version:${JSON.stringify(version)}});\n    ctx.provide('githubSelfUpdateProofCode',{read:()=>${JSON.stringify('production-code-' + version)}});`);
        if (mode === 'bad-rollback' && version === to) index = index.replace('export async function apply(ctx) {', "export async function apply(ctx) { throw Error('OWNED_GITHUB_SELF_UPDATE_BAD_ACTIVATION');");
        const copied = new Map(files); copied.set('index.js', Buffer.from(index)); copied.set('package.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
        await saveTree(repoDir, copied); git(repoDir, ['add', '--', '.']);
        git(repoDir, ['-c', 'user.name=Owned fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Owned fixture ' + version]);
        const commit = git(repoDir, ['rev-parse', 'HEAD']); commits.set(version, treeRecord(repoDir, commit, copied));
    }
    git(root, ['clone', '--bare', '--no-hardlinks', '--', repoDir, bareDir]); git(bareDir, ['update-server-info']);
    const previous = commits.get(from), target = commits.get(to);
    evidence.fromCommit = previous.commit; evidence.toCommit = target.commit;
    const yamlMeta = await realFetch('https://registry.npmjs.org/yaml/2.9.1', { signal: AbortSignal.timeout(30000), redirect: 'error' }).then(async response => JSON.parse((await boundedDownload(response, 512 * 1024)).toString('utf8')));
    assert.equal(yamlMeta.name, 'yaml'); assert.equal(yamlMeta.version, '2.9.1'); assert.equal(new URL(yamlMeta.dist.tarball).origin, 'https://registry.npmjs.org');
    const yamlBytes = await boundedDownload(await realFetch(yamlMeta.dist.tarball, { signal: AbortSignal.timeout(30000), redirect: 'error' }), 4 * 1024 * 1024);
    assert.equal(integrity(yamlBytes), yamlMeta.dist.integrity); evidence.yamlOriginalIntegrityVerified = true;
    server = createServer(async (request, response) => {
        try {
            const url = new URL(request.url, 'http://fixture.internal'), path = decodeURIComponent(url.pathname);
            if (request.method !== 'GET') { response.writeHead(405); response.end(); return; }
            if (path.startsWith('/git/doctor.git/')) {
                const relative = path.slice('/git/doctor.git/'.length); assert(relative && !relative.split('/').some(part => part === '..' || part === '.' || part.includes('\\')));
                const disk = resolve(bareDir, relative); assert(disk.startsWith(bareDir + sep));
                const bytes = await fs.readFile(disk); response.writeHead(200, { 'content-type': 'text/plain', 'content-length': bytes.length }); response.end(bytes); return;
            }
            const metadata = { ...yamlMeta, dist: { ...yamlMeta.dist, tarball: `${origin}/yaml/-/yaml-2.9.1.tgz` } };
            if (path === '/yaml') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ name: 'yaml', 'dist-tags': { latest: '2.9.1' }, versions: { '2.9.1': metadata }, time: { '2.9.1': '2026-11-01T00:00:00.000Z' } })); return; }
            if (path === '/yaml/2.9.1') { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(metadata)); return; }
            if (path === '/yaml/-/yaml-2.9.1.tgz') { response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.end(yamlBytes); return; }
            response.writeHead(404); response.end('Owned fixture path not found');
        } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end('Owned fixture read failed'); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
    const actualSpec = commit => `git+${origin}/git/doctor.git#${commit}`;
    await fs.writeFile(gitConfig, `[url "${origin}/git/doctor.git"]\n\tinsteadOf = https://github.com/${repository}.git\n\tinsteadOf = https://github.com/${repository}\n`);
    globalThis.fetch = async (input, options) => {
        const url = String(input);
        if (url === publicApi) return Response.json({ full_name: repository, private: false, default_branch: 'main' });
        if (url === publicApi + '/git/ref/heads/main') return Response.json({ ref: 'refs/heads/main', object: { type: 'commit', sha: target.commit } });
        for (const record of commits.values()) {
            if (url === publicApi + '/git/commits/' + record.commit) return Response.json({ sha: record.commit, tree: { sha: record.tree } });
            if (url === publicApi + '/git/trees/' + record.tree + '?recursive=1') return Response.json({ sha: record.tree, truncated: false, tree: record.rows });
            const rawPrefix = publicRaw + record.commit + '/';
            if (url.startsWith(rawPrefix)) { const bytes = record.files.get(url.slice(rawPrefix.length)); return bytes ? new Response(bytes) : new Response('Not found', { status: 404 }); }
        }
        if (url.startsWith(publicApi) || url.startsWith(publicRaw)) return new Response('Owned fixture lookup not found', { status: 404 });
        return realFetch(input, options);
    };
    globalThis.__githubSelfUpdateProofOnService = async capture => {
        captures.push(capture); latest = capture; evidence.lifecycle.push({ kind: 'production-apply', version: capture.version, generation: captures.length, pid: process.pid });
        const originalDispose = capture.selfUpdate.dispose.bind(capture.selfUpdate);
        capture.selfUpdate.dispose = async () => { const start = Date.now(); evidence.lifecycle.push({ kind: 'self-dispose-start', version: capture.version, dispatched: !!capture.selfUpdate.job?.dispatched }); await originalDispose(); evidence.lifecycle.push({ kind: 'self-dispose-end', version: capture.version, durationMs: Date.now() - start, gateActive: capture.selfUpdate.taskGate.active }); };
        const doctorDispose = capture.service.dispose.bind(capture.service);
        capture.service.dispose = async () => { const start = Date.now(); await doctorDispose(); evidence.lifecycle.push({ kind: 'doctor-dispose-end', version: capture.version, durationMs: Date.now() - start }); };
    };
    const profileDir = join(root, 'profiles', 'proof'); await fs.mkdir(profileDir, { recursive: true });
    const composition = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
    const context = { name: 'proof', dir: profileDir, patchPath: join(profileDir, 'cordis.patch.yml'), installAnchor: join(anchor, 'package.json'), cwd: root, home: root, startedBundles: composition, overlays: [], telemetryDisabledEnv: '1', packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { ELECTRON_RUN_AS_NODE: '1', CI: 'true', GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } } };
    await fs.writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'owned-github-self-update-proof', private: true, type: 'module', dependencies: {}, dsh: { profile: { bundles: composition } } }));
    await fs.writeFile(join(profileDir, 'pnpm-workspace.yaml'), `autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\nregistry: ${JSON.stringify(origin)}\nstoreDir: ${JSON.stringify(join(root, 'pnpm-store'))}\ncacheDir: ${JSON.stringify(join(root, 'pnpm-cache'))}\npackageImportMethod: copy\nminimumReleaseAge: 0\n`);
    const disabled = ['webserver', 'web-runtime', 'modules', 'harness-dev-context', 'open-in-app', 'directory-picker', 'client-hmr', 'session-title-llm', 'llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-telemetry-otel', 'desktop-product-telemetry', 'product-analytics'];
    await fs.writeFile(context.patchPath, JSON.stringify([...disabled.map(id => ({ id, disabled: true })), { id: 'agent-loop', config: { agents: [] } }, { id: 'plugin-manager', config: { registry: origin, fallbackRegistries: [], inspectTimeoutMs: 10000, githubConnectionTimeoutMs: 5000, gitTransportTimeoutMs: 5000, lockWaitMs: 5000, idleTimeoutMs: 30000 } }]));
    const config = join(profileDir, 'cordis.yml'); await fs.writeFile(config, '[]\n');
    const profile = app.loadProfileDirectory('github-self-update-proof', profileDir, context.installAnchor), resolution = await app.createRuntimeResolution({ installAnchor: context.installAnchor, profile, home: root });
    let ready = false; const readyListeners = new Set();
    ctx = await app.boot('github-self-update-proof', config, app.readProfilePatches('github-self-update-proof', context, profile), async rootCtx => {
        rootCtx.provide('profileContext', context); await rootCtx.plugin(app.PluginPackages, { resolution });
        provideCmdline(rootCtx, { args: ['--no-open', '--port', '0'], exit: code => { throw Error('Unexpected test exit ' + code); }, ready: { onReady(callback) { if (ready) callback(); else readyListeners.add(callback); return () => readyListeners.delete(callback); } } });
    }, pathToFileURL(join(profileDir, 'package.json')).href);
    ready = true; for (const callback of [...readyListeners]) callback(); readyListeners.clear();
    const manager = ctx.get('pluginManager'); assert(manager);
    await step('actual-manager-installs-old-production-Git-commit', async () => {
        const result = await manager.installBundle(actualSpec(previous.commit), { registry: origin, enabled: true, expected: { name, version: from } });
        assert.equal(result.application, 'applied', JSON.stringify(result)); assert.equal(ctx.get('githubSelfUpdateProofCode').read(), 'production-code-' + from); assert.equal(captures.length, 1);
        return { result, actualSavedSource: JSON.parse(await fs.readFile(join(profileDir, 'package.json'), 'utf8')).dependencies[name], copiedPackage: true };
    });
    const old = latest, realInstall = manager.installBundle, realListBundles = manager.listBundles;
    evidence.rawInstallationResults = [];
    manager.installBundle = async function(spec, options) {
        const translated = spec.startsWith(`github:${repository}#`);
        const commit = translated ? spec.slice(spec.lastIndexOf('#') + 1) : null;
        if (translated) {
            assert([...commits.values()].some(record => record.commit === commit));
            evidence.lifecycle.push({ kind: 'actual-host-installs-Git-spec', commit, requestId: options?.requestId ?? null });
        }
        const transportSpec = translated ? actualSpec(commit) : spec;
        try {
            const result = await realInstall.call(this, transportSpec, options);
            // Preserve actual fixture diagnostics locally; only the exact transport identity is mapped below.
            evidence.rawInstallationResults.push({ spec, transportSpec, requestId: options?.requestId ?? null, result });
            // Keep the transport seam identity consistent for a pre-activation failure result too.
            // Only the exact spec translated at this boundary is mapped back; diagnostics/application stay unchanged.
            return translated && result.target === transportSpec ? { ...result, target: spec } : result;
        } catch (error) {
            evidence.rawInstallationResults.push({ spec, transportSpec, requestId: options?.requestId ?? null, error: String(error.stack || error) });
            throw error;
        }
    };
    manager.listBundles = async function() {
        const bundles = await realListBundles.call(this);
        return bundles.map(bundle => {
            if (bundle.name !== name || !bundle.source?.includes(`${origin}/git/doctor.git#`)) return bundle;
            const commit = bundle.source.slice(bundle.source.lastIndexOf('#') + 1); assert(/^[0-9a-f]{40}$/.test(commit)); return { ...bundle, source: logicalSpec(commit) };
        });
    };
    const managementEntry = [...ctx.get('loader').entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-plugin-manager'); assert(managementEntry?.fiber?.uid != null); const managerFiberUid = managementEntry.fiber.uid;
    const directory = await fs.realpath(app.resolveBundleDir('github-self-update-proof', name, context.installAnchor, profileDir)); assert.equal((await fs.lstat(directory)).isSymbolicLink(), false);
    const installedRequire = createRequire(join(directory, 'package.json')); assert.equal(JSON.parse(await fs.readFile(installedRequire.resolve('yaml/package.json'), 'utf8')).version, '2.9.1');
    const modules = require('yaml').parse(await fs.readFile(join(profileDir, 'node_modules', '.modules.yaml'), 'utf8')); assert.equal(resolve(modules.storeDir), join(root, 'pnpm-store', 'v11')); evidence.ownedStoreVerified = true;
    const { createHandler, PANEL_HEADER, PANEL_MARKER } = await import(pathToFileURL(join(directory, 'lib/http.js')).href);
    const handler = createHandler(old.service), headers = { 'content-type': 'application/json', [PANEL_HEADER]: PANEL_MARKER }, request = body => new Request('http://dsh.internal/api/plugin-update-doctor', { method: 'POST', headers, body: JSON.stringify(body) });
    const plan = await step('production-http-prepares-exact-GitHub-self-confirmation', async () => {
        const response = await handler(request({ action: 'prepare-self-update', version: to, commit: target.commit })); const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); assert.equal(value.operation, 'host-self-update'); assert.equal(value.items.length, 1); assert.equal(value.items[0].to, to); return value;
    });
    await step('production-http-commits-independent-official-Git-self-update', async () => {
        const response = await handler(request({ action: 'commit', ticket: plan.ticket })); const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); assert.equal(value.operation, 'host-self-update'); const job = old.selfUpdate.job; assert(job); requestJob = job; await deadline(job.work); return { response: value, oldDispatched: job.dispatched, oldClosed: old.selfUpdate.closed, gateActive: old.selfUpdate.taskGate.active, final: await old.selfUpdate.state(job.id) };
    });
    await step('new-or-restored-production-instance-verifies-Git-pin-and-Host', async () => {
        assert(latest !== old); const currentManagerEntry = [...ctx.get('loader').entries()].find(entry => entry.options.name === '@deepseek-ai/dsh-plugin-manager'); assert.equal(currentManagerEntry?.fiber?.uid, managerFiberUid);
        const state = await latest.selfUpdate.state(requestJob.id); assert.equal(state.phase, 'finished', JSON.stringify(state)); assert(state.result);
        const expectedVersion = mode === 'update-good' ? to : from, expectedCommit = mode === 'update-good' ? target.commit : previous.commit;
        const bundle = (await manager.listBundles()).find(bundle => bundle.name === name), rows = (await manager.listPlugins()).filter(row => row.moduleName === name);
        assert.equal(bundle.version, expectedVersion); assert.equal(bundle.source, logicalSpec(expectedCommit)); assert.equal(bundle.enabled, true); assert.equal(rows.length, 1); assert(rows.every(row => row.enabled && row.fiberPhase === 'active')); assert.equal(ctx.get('githubSelfUpdateProofCode').read(), 'production-code-' + expectedVersion);
        const rawSource = JSON.parse(await fs.readFile(join(profileDir, 'package.json'), 'utf8')).dependencies[name]; assert(rawSource.endsWith('#' + expectedCommit)); assert(rawSource.includes(origin));
        if (mode === 'update-good') { assert.equal(state.result.result.application, 'applied'); assert.equal(state.verification.package.status, 'verified'); assert.equal(state.verification.host.status, 'active'); assert.equal(state.verification.source.status, 'verified'); assert.equal(state.verifiedApplied, true); }
        else { assert.equal(state.result.result.application, 'failed'); assert.equal(state.result.result.packageResult.exitCode, 0); assert.match(state.result.result.error.diagnostic, /OWNED_GITHUB_SELF_UPDATE_BAD_ACTIVATION/); assert.equal(state.result.restore.application, 'applied'); assert.equal(state.restoreVerification.package.status, 'verified'); assert.equal(state.restoreVerification.host.status, 'active'); assert.equal(state.restoreVerification.source.status, 'verified'); assert.equal(state.verifiedApplied, false); }
        evidence.application = state.result.result.application; evidence.restoreApplication = state.result.restore?.application;
        return { state, rawSource, logicalSource: bundle.source, exactVersion: expectedVersion, rows, code: ctx.get('githubSelfUpdateProofCode').read(), sameManager: true, samePid: true };
    });
    await step('old-production-disposal-releases-only-its-gate-without-awaiting-Host', async () => {
        const ending = evidence.lifecycle.find(event => event.version === from && event.kind === 'self-dispose-end'); assert(ending && ending.durationMs < 4500); assert.equal(ending.gateActive, false); assert.equal(old.selfUpdate.closed, true); assert.equal(old.selfUpdate.taskGate.active, false); return { selfDisposeMs: ending.durationMs, oldGateReleased: true };
    });
    assert.equal(ctx.get('agents').list().length, 0); evidence.noAgentTasks = true; evidence.samePid = true; evidence.passed = true;
} catch (error) { evidence.fatal = String(error.stack || error); process.exitCode = 1; }
finally {
    if (ctx) { try { await ctx.fiber.dispose(); } catch (error) { evidence.hostCleanupError = String(error.stack || error); process.exitCode = 1; } }
    globalThis.fetch = realFetch; delete globalThis.__githubSelfUpdateProofOnService;
    if (server) { server.closeAllConnections(); await new Promise(resolveClosed => server.close(resolveClosed)); }
    process.chdir(originalCwd); const actual = await fs.realpath(root), info = await fs.lstat(root);
    assert.equal(actual, resolve(root)); assert.equal(dirname(actual), temp); assert(basename(actual).startsWith('dsh-github-self-proof-')); assert(info.isDirectory() && !info.isSymbolicLink());
    console.log('GITHUB_SELF_UPDATE_PROOF_CLEANUP_VERIFIED');
    try { await fs.rm(actual, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); evidence.cleaned = true; } catch (error) { evidence.cleanupError = String(error); process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); console.log('GITHUB_SELF_UPDATE_PROOF_RESULT ' + JSON.stringify(evidence)); if (evidence.fatal) console.error(evidence.fatal);
}
