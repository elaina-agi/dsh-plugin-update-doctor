import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { TaskGate } from '../lib/task-gate.js';

const [mode, pnpm] = process.argv.slice(2);
assert(['legacy-claim', 'fixed-gate'].includes(mode));
const anchor = process.env.DSH_INSTALL_DIR;
assert(anchor?.includes('app.asar') && process.versions.electron, 'Installed ASAR Electron runtime required');
const require = createRequire(join(anchor, 'package.json'));
const imported = async name => import(pathToFileURL(require.resolve(name)).href);
const app = await imported('@deepseek-ai/dsh-app-boot');
const ops = await imported('@deepseek-ai/dsh-plugin-manager/operations');
const temp = await fs.realpath(tmpdir());
const root = await fs.mkdtemp(join(temp, 'dsh-agent-disposal-proof-'));
const originalCwd = process.cwd();
process.env.DSH_HOME = root; process.env.DSH_TELEMETRY_DISABLED = '1'; process.chdir(root);
for (const key of Object.keys(process.env)) if (/(?:API_KEY|ACCESS_TOKEN|AUTH_TOKEN|SECRET|PASSWORD)/i.test(key)) delete process.env[key];
const profileDir = join(root, 'profiles', 'proof'); await fs.mkdir(profileDir, { recursive: true });
const evidence = { schemaVersion: 1, mode, runtimeVersion: app.getDshRuntimeVersion(), electron: process.versions.electron, node: process.versions.node, pid: process.pid, root, startedAt: new Date().toISOString(), steps: [], events: [], limitations: [
    'Actual installed AppBoot, Cordis, Loader, HMR, PluginManager, AgentRegistry, AgentLoop and Session services in an owned temporary profile.',
    'Generated local bundle owns a real Agent. No user profile, WSL package, model provider, model request, user task or GUI is accessed.',
    'Fixed mode uses production TaskGate.run with actual manager.removeBundle/installBundle, not a mock manager. It does not drive DoctorService.runBatch or the user confirmation panel.',
    'Legacy mode recreates only the previous maintenance callback on a real owned Agent; bounded observation then explicitly releases its own reservation for cleanup.',
    'The beforeStep assertion invokes the production barrier directly; no Agent driver is awakened. Tool resolution and prompt assembly precede the real pre-step hook, so this is not complete execution freezing.',
    'AppReady is a readiness latch. Package fixtures are local and installed offline into a verified owned pnpm 11 store; no replacement GUI/listener is started.'
] };
const controller = { evidence, serial: 0, disposing: Promise.withResolvers() };
globalThis.__agentDisposalProof = controller;
const target = 'agent-disposal-proof-plugin';
function tar(files) {
    const parts = [];
    for (const [name, text] of Object.entries(files)) {
        const bytes = Buffer.from(text), header = Buffer.alloc(512);
        header.write(name, 0, 100); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
        header.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136); header.fill(32, 148, 156);
        header[156] = 48; header.write('ustar\0', 257); header.write('00', 263);
        header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
        parts.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
    }
    parts.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(parts));
}
async function packageArchive(version) {
    const manifest = { name: target, version, type: 'module', exports: { '.': './index.js', './package.json': './package.json' }, dsh: { bundle: { patch: 'cordis.patch.yml' } } };
    const source = `export const inject=['agents','agentLoop'];\nexport async function apply(ctx){\n const p=globalThis.__agentDisposalProof;const serial=++p.serial;\n const handle=await ctx.agents.create({sessionId:'owned-disposal-'+serial,agentOptions:{},meta:{}});\n const cancel=handle.agent.cancel.bind(handle.agent);handle.agent.cancel=(cause,options)=>{p.evidence.events.push({kind:'owned-agent-cancel',cause:structuredClone(cause),version:'${version}',pid:process.pid});return cancel(cause,options);};\n ctx.provide('agentDisposalProofRevision',{version:'${version}',agent:handle.agent,read:()=> 'real-code-${version}'});\n p.evidence.events.push({kind:'bundle-start',version:'${version}',agentId:handle.agent.id,pid:process.pid});\n ctx.effect(()=>async()=>{p.evidence.events.push({kind:'bundle-dispose-start',version:'${version}',pid:process.pid});p.disposing.resolve();await handle.dispose();p.evidence.events.push({kind:'bundle-dispose-end',version:'${version}',pid:process.pid});});\n}\n`;
    const path = join(root, target + '-' + version + '.tgz');
    await fs.writeFile(path, tar({ 'package/package.json': JSON.stringify(manifest), 'package/cordis.patch.yml': `- insert:\n    - id: agent-disposal-proof-target\n      name: ${target}\n`, 'package/index.js': source }));
    return path;
}
const oldArchive = await packageArchive('1.0.0'), nextArchive = await packageArchive('1.1.0');
await fs.writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'owned-agent-disposal-profile', private: true, type: 'module', dependencies: { [target]: 'file:' + oldArchive }, dsh: { profile: { bundles: [target] } } }, null, 2));
await fs.writeFile(join(profileDir, 'pnpm-workspace.yaml'), `autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\nstoreDir: ${JSON.stringify(join(root, 'pnpm-store'))}\ncacheDir: ${JSON.stringify(join(root, 'pnpm-cache'))}\npackageImportMethod: copy\n`);
const services = ['@deepseek-ai/dsh-session', '@deepseek-ai/dsh-session-projection', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-system-prompt', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-tool-executor-native', '@deepseek-ai/dsh-agent-loop'];
const rows = [...services.map((name, i) => ({ id: 'disposal-service-' + i, name })), { id: 'timer', name: '@deepseek-ai/cordis-plugin-timer' }, { id: 'hmr', name: '@deepseek-ai/dsh-hmr', config: { root: [], debounce: 20, ignored: [], awaitWriteFinish: false } }, { id: 'plugin-manager', name: '@deepseek-ai/dsh-plugin-manager', config: { inspectTimeoutMs: 3000, lockWaitMs: 5000, idleTimeoutMs: 15000 } }];
const patchPath = join(profileDir, 'cordis.patch.yml'); await fs.writeFile(patchPath, JSON.stringify([{ insert: rows }]));
const config = join(profileDir, 'cordis.yml'); await fs.writeFile(config, '[]\n');
const context = { name: 'proof', dir: profileDir, patchPath, installAnchor: join(anchor, 'package.json'), cwd: root, home: root, startedBundles: [target], overlays: [], telemetryDisabledEnv: '1', packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { ELECTRON_RUN_AS_NODE: '1', CI: 'true' } } };
let ctx, gate, unrelatedHandle, update, legacyRelease;
async function step(name, fn) {
    const start = Date.now();
    try { const value = await fn(); evidence.steps.push({ name, ok: true, elapsedMs: Date.now() - start, value }); return value; }
    catch (error) { evidence.steps.push({ name, ok: false, elapsedMs: Date.now() - start, error: String(error.stack || error) }); throw error; }
}
async function deadline(promise, ms = 12000) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('owned disposal operation exceeded test deadline')), ms); })]); }
    finally { clearTimeout(timer); }
}
try {
    const installed = await step('initial-offline-package-install', () => ops.runProfilePnpm({ profile: 'proof', ...context }, ['install', '--offline'], { ...context.packageManager, execution: 'service', outputBytes: 30000, lockWaitMs: 5000, idleTimeoutMs: 15000 }));
    assert.equal(installed.exitCode, 0, installed.output);
    const modules = require('yaml').parse(await fs.readFile(join(profileDir, 'node_modules', '.modules.yaml'), 'utf8'));
    assert.equal(resolve(modules.storeDir), join(root, 'pnpm-store', 'v11'));
    assert(installed.output.includes(join(root, 'pnpm-store')));
    evidence.ownedPackageStoreVerified = true;
    const profile = app.loadProfileDirectory('agent-disposal-proof', profileDir, context.installAnchor);
    const resolution = await app.createRuntimeResolution({ installAnchor: context.installAnchor, profile, home: root });
    ctx = await app.boot('agent-disposal-proof', config, app.readProfilePatches('agent-disposal-proof', context, profile), async rootCtx => {
        rootCtx.provide('profileContext', context); rootCtx.provide('appReady', { onReady(callback) { queueMicrotask(callback); return () => {}; } });
        await rootCtx.plugin(app.PluginPackages, { resolution });
    }, pathToFileURL(join(profileDir, 'package.json')).href);
    const manager = ctx.get('pluginManager'), agents = ctx.get('agents'); assert(manager && agents);
    const revision = ctx.get('agentDisposalProofRevision'); assert.equal(revision.read(), 'real-code-1.0.0');
    const owned = revision.agent;
    unrelatedHandle = await agents.create({ sessionId: 'owned-unrelated-agent', agentOptions: {}, meta: {} });
    const unrelated = unrelatedHandle.agent;
    await step('cold-owned-agent-and-real-manager', async () => ({ ownedId: owned.id, unrelatedId: unrelated.id, agents: agents.list().length, code: revision.read(), pid: process.pid }));
    if (mode === 'legacy-claim') {
        legacyRelease = Promise.withResolvers();
        const claim = owned.runMaintenance(async () => legacyRelease.promise);
        const removal = manager.removeBundle(target);
        await deadline(controller.disposing.promise);
        const sentinel = Symbol('held'); let timer;
        const observed = await Promise.race([removal, new Promise(resolveHeld => { timer = setTimeout(() => resolveHeld(sentinel), 250); })]); clearTimeout(timer);
        await step('legacy-own-disposal-cancel-does-not-release-claim', async () => {
            assert.equal(observed, sentinel);
            assert(evidence.events.some(event => event.kind === 'owned-agent-cancel' && event.cause.kind === 'disposed'));
            assert.equal(evidence.events.some(event => event.kind === 'bundle-dispose-end'), false);
            return { managerRemovalStillWaiting: true, disposedCancelObserved: true, ownerDisposalUnfinished: true, observationMs: 250 };
        });
        legacyRelease.resolve();
        const removed = await deadline(removal); await claim;
        assert.equal(removed.application, 'applied', JSON.stringify(removed));
        await step('explicit-test-release-allows-real-removal', async () => ({ result: removed, ownerLeftRegistry: agents.get(owned.id) === undefined, noProcessTermination: true }));
    } else {
        gate = new TaskGate(agents, { timeoutMs: 20000 });
        const held = Promise.withResolvers(), finish = Promise.withResolvers();
        update = gate.run(async () => {
            const removed = await deadline(manager.removeBundle(target)); assert.equal(removed.application, 'applied', JSON.stringify(removed));
            await step('fixed-gate-owner-disposes-during-real-removal', async () => {
                assert.equal(agents.get(owned.id), undefined);
                assert(evidence.events.some(event => event.kind === 'bundle-dispose-end' && event.version === '1.0.0'));
                assert.equal(gate.active, true);
                assert.throws(() => unrelated.runMaintenance(async () => {}), /already has active work/);
                return { managerResult: removed, ownerLeftRegistry: true, disposalCompleted: true, otherAgentStillClaimed: true, globalBarrierStillActive: true, pid: process.pid };
            });
            const next = await deadline(manager.installBundle(nextArchive, { enabled: true, expected: { name: target, version: '1.1.0' } }));
            assert.equal(next.application, 'applied', JSON.stringify(next));
            assert.equal(ctx.get('agentDisposalProofRevision').read(), 'real-code-1.1.0');
            held.resolve(); await finish.promise;
            return next;
        });
        try {
            await deadline(held.promise);
            let passed = false; const barrier = gate.beforeStep({}).then(() => { passed = true; });
            await Promise.resolve();
            await step('global-beforeStep-remains-held-after-owner-disposal', async () => {
                assert.equal(passed, false); assert.equal(gate.active, true);
                return { beforeStepHeld: true, newOwnerCreatedWithoutBlockingCreated: true, code: ctx.get('agentDisposalProofRevision').read(), modelRequests: 0 };
            });
            finish.resolve(); const installedNext = await deadline(update); await barrier;
            const current = (await manager.listBundles()).find(bundle => bundle.name === target);
            const activeRows = (await manager.listPlugins()).filter(row => row.moduleName === target);
            await step('replacement-and-unrelated-agent-live-after-release', async () => {
                assert.equal(current.version, '1.1.0'); assert(activeRows.length === 1 && activeRows.every(row => row.enabled && row.fiberPhase === 'active'));
                assert.equal(gate.active, false); assert.equal(passed, true);
                assert.equal(await unrelated.runMaintenance(async () => 'still-usable'), 'still-usable');
                return { result: installedNext, exactVersion: current.version, activeRows: activeRows.map(row => ({ id: row.entryId, phase: row.fiberPhase })), unrelatedUsable: true, beforeStepReleased: true, samePid: true, pid: process.pid };
            });
        } finally { finish.resolve(); await gate.release(); await update.catch(() => {}); }
    }
    await step('no-driver-model-or-user-task-activity', async () => {
        const all = [...new Set([owned, unrelated, ...agents.list()])];
        const events = all.flatMap(agent => agent.session.snapshotEvents());
        const forbidden = events.filter(event => /^(?:turn\/start|step\/start|llm\/)/.test(event.type));
        assert.equal(forbidden.length, 0);
        return { modelRequests: 0, driverStepEvents: 0, activeUserTasks: 0, observedDisposalCauses: evidence.events.filter(event => event.kind === 'owned-agent-cancel').map(event => event.cause.kind) };
    });
    evidence.passed = true;
} catch (error) { evidence.passed = false; evidence.fatal = String(error.stack || error); process.exitCode = 1; }
finally {
    legacyRelease?.resolve(); gate?.dispose(); await gate?.release();
    if (update) await update.catch(() => {});
    await unrelatedHandle?.dispose().catch(error => { evidence.agentCleanupError = String(error); });
    if (ctx) await ctx.fiber.dispose().catch(error => { evidence.hostCleanupError = String(error.stack || error); });
    process.chdir(originalCwd);
    try {
        const actual = await fs.realpath(root), info = await fs.lstat(root);
        evidence.cleanupVerifiedAbsoluteRoot = actual;
        assert.equal(actual, resolve(root)); assert.equal(dirname(actual), temp); assert(basename(actual).startsWith('dsh-agent-disposal-proof-')); assert(info.isDirectory() && !info.isSymbolicLink());
        console.log('AGENT_DISPOSAL_CLEANUP_TARGET', actual);
        await fs.rm(actual, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); evidence.cleanedOwnedRoot = true;
    } catch (error) { evidence.cleanedOwnedRoot = false; evidence.cleanupError = String(error.stack || error); process.exitCode = 1; }
    evidence.finishedAt = new Date().toISOString(); console.log('AGENT_DISPOSAL_PROOF_RESULT ' + JSON.stringify(evidence));
}
