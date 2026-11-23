import { join } from 'node:path';
import { realpath, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { SelfUpdateCoordinator } from './lib/self-update.js';
import { SelfUpdatePreflight } from './lib/self-update-policy.js';
import { GithubSelfUpdatePreflight } from './lib/self-update-github.js';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { getDshRuntimeVersion, resolveBundleDir, evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';
import { DoctorService } from './lib/service.js';
import { probeLocks } from './lib/locks.js';
import { createHandler, ROUTE } from './lib/http.js';
import { TaskGate } from './lib/task-gate.js';
import { RegistryStager } from './lib/staging.js';

export const name = 'plugin-update-doctor';
export const inject = ['pluginManager', 'profileContext', 'agents'];

export async function apply(ctx) {
    const profile = ctx.profileContext;
    const taskGate = new TaskGate(ctx.agents);
    const stager = new RegistryStager(join(profile.home, 'cache', 'dsh-plugin-update-doctor', profile.name, 'staged'), {
        compatibility: manifest => evaluatePluginCompatibility(manifest, {}),
    });
    // Use the public manager Service. Its updateBundle implementation owns package operations
    // on the manager's providing context; teardown independence is verified by an isolated Host proof.
    const manager = ctx.get('pluginManager');
    const service = new DoctorService({
        manager, profile, runtimeVersion: getDshRuntimeVersion(),
        resolvePackage: async packageName => resolveBundleDir('dsh', packageName, profile.installAnchor, profile.dir),
        probeLocks, statePath: join(profile.home, 'cache', 'dsh-plugin-update-doctor', profile.name, 'history.json'), taskGate, stager, hmrAvailable:!!ctx.get('hmr'),
    });
    await service.initialize();
    const selfUpdate = new SelfUpdateCoordinator({ manager, profile, taskGate,
        preflight: new SelfUpdatePreflight({ compatibility: manifest => evaluatePluginCompatibility(manifest, {}) }),
        githubPreflight: new GithubSelfUpdatePreflight({ compatibility: manifest => evaluatePluginCompatibility(manifest, {}) }),
        resolvePackage: async packageName => realpath(resolveBundleDir('dsh', packageName, profile.installAnchor, profile.dir)),
        resolveYamlVersion: async () => {
            const directory = await realpath(resolveBundleDir('dsh', 'dsh-plugin-update-doctor', profile.installAnchor, profile.dir));
            const require = createRequire(join(directory, 'package.json'));
            return JSON.parse(await readFile(require.resolve('yaml/package.json'), 'utf8')).version;
        },
        fingerprint: bundle => service.fingerprint(bundle), redact: service.redact,
        storeRoot: join(profile.home, 'cache', 'dsh-plugin-update-doctor', profile.name, 'self-updates'),
        unavailable: () => service.closed || !!service.busy || service.external.size > 0,
    });
    service.selfUpdate = selfUpdate;
    ctx.on('agent/status', payload => taskGate.observeStatus(payload));
    ctx.on('agent/pre-step', async (payload, next) => { await taskGate.beforeStep(payload); return next(); });
    ctx.on('plugin-manager/operation', value => service.observe(value));
    ctx.on('plugin-manager/update-state', value => service.onUpdateState(value));
    ctx.on('plugin-manager/install-state', value => service.onInstallProgress(value));
    ctx.on('plugin-manager/install-log', value => service.onInstallLog(value));
    ctx.effect(() => async () => { taskGate.dispose(); await selfUpdate.dispose(); await service.dispose(); }, 'plugin-update-doctor: history, self handoff and operations');
    ctx.inject(['connection'], scope => {
        scope.effect(() => scope.connection.fetch.register({
            path: ROUTE, methods: ['GET', 'POST'], requestBody: 'buffered', fetch: createHandler(service),
        }), 'plugin-update-doctor: authenticated panel API');
    });
    // Diagnostics are available to agents; confirming an update remains a user-only UI action.
    ctx.inject(['tools'], scope => {
        scope.tools.register(defineTool({
            name: 'plugin_update_doctor',
            description: 'Diagnose plugin update failures, inspect current Host activation, check read-only Windows file-use evidence, or prepare an update plan. It never installs, restores, kills processes or confirms updates; actual changes require the user in the Plugin update doctor panel.',
            parameters: {
                action: { type: 'string', required: true, enum: ['list', 'scan', 'diagnose', 'versions', 'locks', 'history', 'plan'] },
                name: { type: 'string', description: 'Exact profile-installed package name; required except list/history.' },
                version: { type: 'string', description: 'Exact offered semantic version for plan.' },
                operation: { type: 'string', enum: ['update', 'restore'], description: 'Plan only; restore requires a recorded failed update.' },
            },
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
            async execute(args, exec) {
                exec.signal.throwIfAborted();
                let answer;
                switch (args.action) {
                    case 'list': answer = await service.list(); break;
                    case 'scan': answer = await service.scan(exec.signal); break;
                    case 'diagnose': answer = await service.diagnose(args.name); break;
                    case 'versions': answer = await service.versions(args.name, exec.signal); break;
                    case 'locks': answer = await service.locks(args.name, exec.signal); break;
                    case 'history': answer = { records: service.store.list(args.name).slice(0, 20) }; break;
                    case 'plan': answer = await service.prepare({ name: args.name, version: args.version, operation: args.operation ?? 'update' }, { issueTicket: false, signal: exec.signal }); break;
                    default: throw new Error('Unknown diagnostic action.');
                }
                return JSON.stringify(service.redact(answer));
            },
            presentCall: args => ({ card: 'generic', title: 'Diagnose plugin update', kind: 'read', rawInput: args }),
        }));
    });
}
