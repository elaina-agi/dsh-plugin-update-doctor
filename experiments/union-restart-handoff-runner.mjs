// Restart-handoff proof: reproduce the real-profile unplug refusal in an owned Host and
// complete the update across a fresh process.
//
//   phase=prepare  boot, install dsh-union-search@0.10.25 through the official manager, exit
//   phase=update   boot again (the row now comes from the profile patch, like a user profile),
//                  run the Doctor batch, expect `restart-required` with the target on disk
//   phase=resume   boot again, run the Doctor's pending-handoff verification/rollback
//
// Every phase reuses one owned root; the wrapper passes it. No user profile, session,
// browser or search engine is touched.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { DoctorService } from '../lib/service.js';
import { RegistryStager } from '../lib/staging.js';
import { UnionGenerationStager } from '../lib/union-staging.js';
import { TaskGate } from '../lib/task-gate.js';
import { createRunningGenerationVerifier } from '../lib/running-generation.js';
import { readPendingRestart, readRestartResult } from '../lib/restart-lane.js';

const [pnpm, rootArg, phase, outputArg] = process.argv.slice(2);
const anchor = process.env.DSH_INSTALL_DIR;
assert(anchor?.includes('app.asar') && process.versions.electron, 'installed Electron runtime required');
assert(pnpm && rootArg && ['prepare', 'update', 'resume'].includes(phase) && outputArg, 'usage: <pnpm> <root> <phase> <output>');
assert(!process.env.NODE_OPTIONS, 'the proof must run stock');
const name = 'dsh-union-search', from = '0.10.25', to = '0.11.0';
const root = resolve(rootArg), output = resolve(outputArg);
assert(root.startsWith(await fs.realpath(tmpdir())), 'owned root only');
const result = { phase, pid: process.pid, runtimeVersion: null, electron: process.versions.electron, node: process.versions.node,
    root, startedAt: new Date().toISOString(), steps: [], verdict: 'unmeasured', limitations: [
        'Unmodified installed Electron, Loader, HMR and PluginManager; production DoctorService, stagers and running-namespace verifier.',
        'Owned temporary profile, store, cache and home. The row comes from the profile patch so the unplug classification matches a persisted profile.',
        'No user profile, sessions, browser DOM, real search engine or model request is used.',
        'A handoff is reported successful only when the next fresh process verifies installed bytes, expected Host rows and the exact running namespace, or rolls back.',
    ] };

let ctx = null, service = null;
try {
    process.chdir(root);
    for (const key of Object.keys(process.env)) if (/(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET|PASSWORD|^npm_config_|^PNPM_)/i.test(key)) delete process.env[key];
    Object.assign(process.env, { DSH_HOME: root, DSH_TELEMETRY_DISABLED: '1', HOME: root, USERPROFILE: root,
        APPDATA: join(root, 'AppData', 'Roaming'), LOCALAPPDATA: join(root, 'AppData', 'Local'), CI: 'true' });
    const emptyConfig = join(root, 'empty-npm-config');
    await fs.writeFile(emptyConfig, '# owned fixture; no credentials\n', { flag: 'wx' }).catch(() => {});
    const npmEnvironment = { NPM_CONFIG_USERCONFIG: emptyConfig, NPM_CONFIG_GLOBALCONFIG: emptyConfig };
    Object.assign(process.env, npmEnvironment);
    const require = createRequire(join(anchor, 'package.json'));
    const imported = spec => import(pathToFileURL(require.resolve(spec)).href);
    const app = await imported('@deepseek-ai/dsh-app-boot');
    const { provideCmdline } = await imported('@deepseek-ai/dsh-cmdline');
    result.runtimeVersion = app.getDshRuntimeVersion();

    const profileName = 'restart-handoff-proof';
    const profileDir = join(root, 'profiles', profileName);
    const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
    const profileContext = { name: profileName, dir: profileDir, home: root, patchPath: join(profileDir, 'cordis.patch.yml'),
        installAnchor: join(anchor, 'package.json'), cwd: root, startedBundles: bundles, overlays: [], telemetryDisabledEnv: '1',
        packageManager: { command: process.execPath, args: ['--expose-internals', pnpm], env: { ELECTRON_RUN_AS_NODE: '1', CI: 'true', ...npmEnvironment } } };
    if (phase === 'prepare') {
        await fs.mkdir(profileDir, { recursive: true });
        await fs.writeFile(join(profileDir, 'package.json'), JSON.stringify({ name: 'owned-restart-handoff-profile', private: true,
            type: 'module', dependencies: {}, dsh: { profile: { bundles } } }), { flag: 'wx' });
        await fs.writeFile(join(profileDir, 'pnpm-workspace.yaml'), `autoInstallPeers: false\nstrictPeerDependencies: false\nnodeLinker: hoisted\nignoreScripts: true\nregistry: https://registry.npmjs.org\nstoreDir: ${JSON.stringify(join(root, 'pnpm-store'))}\n`, { flag: 'wx' });
        // The plugin row lives in the profile patch, which is how a persisted user profile
        // reaches the "running outside a Loader entry" classification.
        await fs.writeFile(profileContext.patchPath, Buffer.from(JSON.stringify([
            ...['webserver', 'web-runtime', 'harness-dev-context', 'open-in-app', 'directory-picker', 'client-hmr',
                'session-title-llm', 'llm-deepseek', 'llm-deepseek-account', 'llm-pi-ai', 'session-telemetry-otel',
                'desktop-product-telemetry', 'product-analytics'].map(id => ({ id, disabled: true })),
            { id: 'credentials', config: { path: join(root, 'owned-empty-store.yaml'), dshHome: root, watch: false } },
            { id: 'agent-loop', config: { agents: [] } },
            { id: 'web', config: { searchProvider: 'ddg', fetchProvider: 'http' } },
            { id: 'web-search-free', name, config: { provider: 'bing', blockSystemSearch: true, legacyYamlMigrated: true,
                advanceFetchAllowPrivate: true, disabledEngines: [] } },
            { id: 'plugin-manager', config: { registry: 'https://registry.npmjs.org', fallbackRegistries: [], inspectTimeoutMs: 45000,
                lockWaitMs: 10000, idleTimeoutMs: 120000 } },
        ])), { flag: 'wx' });
        await fs.writeFile(join(profileDir, 'cordis.yml'), '[]\n', { flag: 'wx' });
    } else assert.equal(await fs.readFile(join(profileContext.patchPath), 'utf8').then(Boolean), true, 'prepared profile required');

    const profile = app.loadProfileDirectory(profileName, profileDir, profileContext.installAnchor);
    const resolution = await app.createRuntimeResolution({ installAnchor: profileContext.installAnchor, profile, home: root });
    let ready = false; const listeners = new Set();
    ctx = await app.boot(profileName, join(profileDir, 'cordis.yml'), app.readProfilePatches(profileName, profileContext, profile),
        async c => {
            c.provide('profileContext', profileContext);
            await c.plugin(app.PluginPackages, { resolution });
            provideCmdline(c, { args: ['--no-open', '--port', '0'], exit: code => { throw Error('Unexpected owned Host exit: ' + code); },
                ready: { onReady(callback) { if (ready) callback(); else listeners.add(callback); return () => listeners.delete(callback); } } });
        }, pathToFileURL(join(profileDir, 'package.json')).href);
    ready = true; for (const cb of listeners) cb(); listeners.clear();
    const manager = ctx.get('pluginManager');

    if (phase === 'prepare') {
        const installed = await manager.installBundle(`${name}@${from}`, { registry: 'https://registry.npmjs.org', saveExact: true, enabled: true, expected: { name, version: from } });
        result.install = { application: installed.application, changed: installed.changed, restartReason: installed.restartReason ?? null };
        assert.equal(installed.application, 'applied', JSON.stringify(installed));
        const listed = (await manager.listBundles()).find(item => item.name === name);
        result.installed = { version: listed?.version, source: listed?.source };
        assert.equal(listed.version, from);
        result.verdict = 'prepared';
    } else {
        const stager = new RegistryStager(join(root, 'doctor', 'staged'), { compatibility: manifest => app.evaluatePluginCompatibility(manifest, {}) });
        const unionStager = new UnionGenerationStager(join(root, 'doctor', 'union-staged'), { registryStager: stager });
        service = new DoctorService({ manager, profile: profileContext, runtimeVersion: app.getDshRuntimeVersion(),
            resolvePackage: async () => app.resolveBundleDir(profileName, name, profileContext.installAnchor, profileDir),
            probeLocks: async () => ({ status: 'checked', evidence: 'checked', files: [] }),
            statePath: join(root, 'doctor', 'history.json'), taskGate: new TaskGate({ list: () => [] }), stager, unionStager,
            verifyRunningGeneration: createRunningGenerationVerifier({ entries: () => ctx.loader.entries(),
                resolveShared: (spec, fromUrl) => app.resolvePluginResource(spec, fromUrl) }), hmrAvailable: true });
        await service.initialize();
        const started = (await manager.listBundles()).find(item => item.name === name);
        const rows = (await manager.listPlugins()).filter(row => row.moduleName === name);
        result.before = { version: started?.version, active: rows.filter(row => row.fiberPhase === 'active').length, rows: rows.length };

        const injectRefusal = process.env.DSH_HANDOFF_PROOF_INJECT === '1';
        if (injectRefusal) {
            const originalRemove = manager.removeBundle.bind(manager);
            manager.removeBundle = async target => {
                const actual = await originalRemove(target);
                if (target !== name) return actual;
                result.injectedRefusal = { actual: actual?.application ?? null, reported: 'restart-required' };
                return { ...actual, application: 'restart-required', changed: true, stage: 'remove', restartReason: 'unmanaged-plugin' };
            };
        }
        if (phase === 'update') {
            assert.equal(started.version, from);
            const scan = await service.scan();
            const item = scan.items.find(candidate => candidate.name === name);
            result.scan = { unionGeneration: item?.unionGeneration, canUpdate: item?.canUpdate, reasons: item?.reasons,
                preflight: item?.generationPreflight?.status, versionStatus: item?.versionStatus, updateStatus: item?.updateStatus };
            assert.equal(item?.canUpdate, true, JSON.stringify(item?.reasons));
            const plan = await service.prepareBatch([{ name, version: to }]);
            assert.equal(plan.items[0].installMode, 'union-generation');
            const start = await service.commit(plan.ticket, { confirmUnionGeneration: true, taskPolicy: 'wait-for-idle' });
            await service.jobs.get(start.operationId).work;
            const record = service.operation(start.operationId).record.items[0];
            result.outcome = { status: record.status, restartHandoff: record.restartHandoff === true,
                result: record.result?.application, restore: record.restore?.application ?? null,
                verification: record.verification ? { package: record.verification.package?.status, runtime: record.verification.runtime?.status } : null };
            const after = (await manager.listBundles()).find(item => item.name === name);
            result.disk = { version: after?.version ?? null, installed: after?.installed === true };
            result.pending = await readPendingRestart(join(root, 'doctor')).then(pending => pending ? { from: pending.from, to: pending.to, mode: pending.installMode, attempts: pending.attempts } : null);
            if (record.status === 'restart-required' && record.restartHandoff === true) {
                assert.equal(result.disk.version, to, 'the target is on disk for the next start');
                assert(result.pending, 'a bounded pending record was written');
                result.verdict = 'handoff-recorded';
            } else {
                // The same-profile reproduction did not reproduce the refusal: record it honestly.
                result.verdict = 'not-reproduced';
                result.note = 'The Host accepted the in-process unplug in this owned profile; the real-profile class was not reproduced.';
            }
        } else {
            if (process.env.DSH_HANDOFF_PROOF_CORRUPT === '1') {
                const directory = app.resolveBundleDir(profileName, name, profileContext.installAnchor, profileDir);
                await fs.appendFile(join(directory, 'lib', 'index.js'), '\nthis is not javascript <<<\n');
                result.corrupted = true;
            }
            const resumed = await service.resumePendingRestart();
            const after = (await manager.listBundles()).find(item => item.name === name);
            const activeRows = (await manager.listPlugins()).filter(row => row.moduleName === name);
            result.resume = resumed ? { outcome: resumed.outcome, reason: resumed.reason ?? null, target: resumed.target?.status ?? null,
                rollback: resumed.rollback?.application ?? null, bytesVerified: resumed.rollback?.bytesVerified ?? null } : null;
            result.disk = { version: after?.version ?? null, active: activeRows.filter(row => row.fiberPhase === 'active').length, rows: activeRows.length };
            result.stored = await readRestartResult(join(root, 'doctor'));
            if (!resumed) result.verdict = 'no-pending-handoff';
            else if (resumed.outcome === 'applied') { assert.equal(result.disk.version, to); result.verdict = 'handoff-verified-after-restart'; }
            else if (resumed.outcome === 'rolled-back') { assert.equal(result.disk.version, from); result.verdict = 'handoff-rolled-back-after-restart'; }
            else result.verdict = 'handoff-unknown';
        }
    }
    result.passed = true;
} catch (error) {
    result.fatal = String(error?.stack ?? error).slice(0, 16000);
    process.exitCode = 1;
} finally {
    result.finishedAt = new Date().toISOString();
    await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }).catch(error => { console.error(String(error)); process.exitCode = 1; });
    if (service) try { await service.dispose(); } catch (error) { console.error(String(error)); }
    if (ctx) { let timeout; try { await Promise.race([ctx.fiber.dispose(), new Promise((_d, reject) => { timeout = setTimeout(() => reject(Error('Host disposal deadline')), 12000); })]); }
        catch (error) { console.error(String(error)); } finally { clearTimeout(timeout); } }
    await new Promise(done => process.stdout.write(JSON.stringify({ phase, verdict: result.verdict, fatal: result.fatal ?? null, outcome: result.outcome ?? result.resume ?? null }) + '\n', done));
    process.exit(process.exitCode ?? 0);
}
