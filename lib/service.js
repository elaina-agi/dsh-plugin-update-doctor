import { randomUUID, createHash } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, sep, basename, dirname, normalize } from 'node:path';
import { makeRedactor } from './redact.js';
import { HistoryStore } from './history.js';
import { bundleState, classify } from './diagnosis.js';
import { scanUpdates, onlineSafety } from './online.js';
import { IdentityStore } from './identity.js';
import { PUBLIC_REGISTRY, publicRegistry, archiveKey } from './source.js';

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export const SELF = 'dsh-plugin-update-doctor';

export class DoctorService {
    constructor({ manager, profile, runtimeVersion, resolvePackage, probeLocks, statePath, taskGate, stager, now = () => Date.now() }) {
        Object.assign(this, { manager, profile, runtimeVersion, resolvePackage, probeLocks, now, taskGate, stager });
        this.redact = makeRedactor({ profileDir: profile.dir, installDir: process.env.DSH_INSTALL_DIR });
        this.store = new HistoryStore(statePath, this.redact);
        this.identities = new IdentityStore(join(dirname(statePath), 'identities.json'));
        this.sourceWarnings = new Map();
        this.tickets = new Map(); this.jobs = new Map(); this.external = new Set(); this.busy = null; this.closed = false;
    }
    async initialize() {
        await this.store.load(); await this.identities.load();
        if (!this.identities.warning && this.identities.recoveries.size) {
            const { bundles } = await this.snapshot();
            for (const recovery of [...this.identities.recoveries.values()]) {
                if (recovery.status !== 'prepared') continue;
                const bundle = bundles.find(value => value.name === recovery.name);
                const key = this.stager?.root ? archiveKey(this.stager.root, bundle?.source) : null;
                const touched = !bundle?.installed || key === recovery.next.archiveKey || key === recovery.previous.archiveKey;
                if (touched) {
                    try { await this.stager.reopen(recovery.previous); await this.identities.settle(recovery.name, null, { ...recovery, status: 'unknown', expectedFingerprint: this.fingerprint(bundle) }); }
                    catch { this.sourceWarnings.set(recovery.name, 'recovery-archive-unavailable'); }
                } else if (this.fingerprint(bundle) === recovery.expectedFingerprint) await this.identities.settle(recovery.name, this.lineageOf(bundle), null);
            }
        }
        // Upgrade only an exact currently referenced archive from earlier successful
        // Doctor records. Never infer a registry origin from a same-version file.
        if (this.stager?.adoptLegacy && !this.identities.warning) {
            const { bundles } = await this.snapshot();
            for (const bundle of bundles) {
                if (!bundle.source?.startsWith('file:') || this.lineageOf(bundle)) continue;
                const key = archiveKey(this.stager.root, bundle.source);
                const old = this.store.records.flatMap(record => record.items ?? []).find(item => item.name === bundle.name && item.to === bundle.version && item.status === 'updated' && item.origin === PUBLIC_REGISTRY && archiveKey(this.stager.root, item.archivePath) === key);
                if (!old || !key) continue;
                try { await this.identities.remember(await this.stager.adoptLegacy(bundle.name, bundle.version, bundle.source, old.originalSha256)); }
                catch { this.sourceWarnings.set(bundle.name, 'source-identity-unverified'); }
            }
        }
    }
    async snapshot() {
        const [bundles, rows] = await Promise.all([this.manager.listBundles(), this.manager.listPlugins()]);
        return { bundles, rows };
    }
    lineageOf(bundle) {
        const known = this.identities.get(bundle.name);
        if (!known || !this.stager?.root || known.version !== bundle.version || known.origin !== PUBLIC_REGISTRY) return null;
        return archiveKey(this.stager.root, bundle.source) === known.archiveKey ? known : null;
    }
    recoveryFor(name) { return this.identities.recovery(name); }
    summary(bundle, rows) {
        const observed = bundleState(bundle, rows);
        let sourceKind = bundle.update ?? (bundle.source?.startsWith('link:') || bundle.source?.startsWith('file:') ? 'local' : 'other');
        const lineage = this.lineageOf(bundle);
        if (lineage) sourceKind = 'registry';
        const reasons = [];
        if (bundle.name === SELF) reasons.push('self-update-blocked');
        if (!bundle.removable || bundle.readOnlyReason) reasons.push('management-or-shipped-bundle');
        if (sourceKind !== 'registry') reasons.push('registry-updates-only');
        if (!bundle.installed) reasons.push('not-profile-installed');
        const recovery = this.recoveryFor(bundle.name);
        const matchesRecovery = !!recovery && recovery.status !== 'prepared' && recovery.expectedFingerprint === this.fingerprint(bundle);
        if (this.sourceWarnings.has(bundle.name)) reasons.push(this.sourceWarnings.get(bundle.name));
        return {
            name: bundle.name, title: typeof bundle.meta?.title === 'string' ? bundle.meta.title : bundle.name, version: bundle.version ?? null,
            sourceKind, registry: lineage?.origin ?? null, installed: bundle.installed, enabled: bundle.enabled,
            state: observed.state, activeRows: observed.activeRows, totalRows: observed.totalRows,
            canUpdate: reasons.length === 0 && sourceKind === 'registry',
            canRestore: bundle.name !== SELF && !!bundle.removable && matchesRecovery,
            restoreVersion: matchesRecovery ? recovery.from : null, recoveryId: matchesRecovery ? recovery.id : null, reasons,
        };
    }
    async list() {
        const { bundles, rows } = await this.snapshot();
        const visible = bundles.filter(bundle => bundle.installed || bundle.name === SELF).map(bundle => this.summary(bundle, rows));
        for (const [name, recovery] of this.identities.recoveries) if (!visible.some(bundle => bundle.name === name)) {
            const raw = bundles.find(bundle => bundle.name === name);
            const matches = recovery.status !== 'prepared' && recovery.expectedFingerprint === this.fingerprint(raw);
            if (matches) visible.push({ name, title: name, version: raw?.version ?? null, installed: false, enabled: false, sourceKind: 'registry', state: 'missing',
                activeRows: 0, totalRows: 0, canUpdate: false, canRestore: name !== SELF, restoreVersion: recovery.from, recoveryId: recovery.id, reasons: ['recorded-recovery-only'] });
        }
        return this.redact({ profile: this.profile.name, runtimeVersion: this.runtimeVersion,
            bundles: visible,
            busy: this.busy ? { id: this.busy.id, package: this.busy.package, phase: this.busy.phase } : null,
            externalBusy: this.external.size > 0, history: this.store.list().slice(0, 20),
            persistenceWarning: this.store.warning ?? this.identities.warning, truncationWarning: this.store.truncationWarning,
            limitations: ['Host activation, package identity and this page\'s synchronization are separate observations.', 'The gate defers new formal steps; Agent setup, tool resolution, prompt assembly and independent workers are not a global execution freeze.', 'Remove and install are separate Host operations, not an atomic replacement. Changes from other tools or CLI may still intervene.', 'Task stopping is optional and requires an additional explicit user confirmation; no process termination, forced unlocking, version exemptions or script approvals.', 'Only verified public npm archives are staged; private registries and mirrors are never silently changed.'] });
    }
    async diagnose(name) {
        this.validateName(name);
        const { bundles, rows } = await this.snapshot();
        const raw = bundles.find(bundle => bundle.name === name);
        if (!raw) {
            const listed = await this.list(); const bundle = listed.bundles.find(item => item.name === name);
            if (!bundle) throw new DoctorError('unknown-bundle', 'Unknown bundle.');
            return this.redact({ bundle, rows: [], classification: classify({ bundle, record: this.store.list(name)[0] }), history: this.store.list(name).slice(0,12), locks: null });
        }
        const bundle = this.summary(raw, rows);
        const history = this.store.list(name);
        return this.redact({ bundle, rows: bundleState(raw, rows).rows,
            classification: classify({ bundle, record: history[0] }), history: history.slice(0, 12), locks: null,
            currentStateIndependentOfHistory: true });
    }
    async versions(name, signal) {
        this.validateName(name);
        const { bundles, rows } = await this.snapshot();
        const bundle = bundles.find(bundle => bundle.name === name);
        if (!bundle || !this.summary(bundle, rows).canUpdate) throw new DoctorError('not-updatable', 'Only removable profile registry bundles can be updated here.');
        const query = bundle.update === 'registry' ? await this.manager.listVersions(name, undefined, signal) : await this.stager.listVersions(name, bundle.version, signal);
        if (query.status === 'listed' && !publicRegistry(query.registry)) throw new DoctorError('registry-origin-unsupported', 'Only the verified public npm origin is supported; the configured source is not migrated.');
        return this.redact(query);
    }
    async locks(name, signal) {
        this.validateName(name);
        const { bundles } = await this.snapshot();
        const bundle = bundles.find(bundle => bundle.name === name);
        if (!bundle?.installed || bundle.availability !== 'profile') throw new DoctorError('not-profile-package', 'File-use checks only inspect an installed profile package.');
        const dir = await this.resolvePackage(name);
        if (!dir) return { status: 'unsupported', evidence: 'unknown', files: [], processes: [], limitations: ['Package directory unavailable.'] };
        const result = await this.probeLocks(dir, { signal });
        const safe = this.redact(result);
        return { ...safe, classification: classify({ locks: safe }) };
    }
    async prepare({ name, version, operation = 'update' }, { issueTicket = false, signal } = {}) {
        if (issueTicket) throw new DoctorError('use-batch-flow', 'User-only batch confirmation is required; agent plans cannot mutate plugins.');
        this.validateName(name);
        if (operation === 'restore') {
            const plan = await this.prepareRestore(name, signal, { issueTicket: false });
            if (version !== plan.items[0].to) throw new DoctorError('no-recovery-target', 'The exact recorded old version is required.');
            return plan;
        }
        if (operation !== 'update' || !VERSION.test(version ?? '')) throw new DoctorError('invalid-version', 'An exact supported version is required.');
        if (this.closed || this.busy || this.external.size) throw new DoctorError('busy', 'Another plugin operation is running.');
        const { bundles, rows } = await this.snapshot(); const raw = bundles.find(item => item.name === name);
        if (!raw || !this.summary(raw, rows).canUpdate) throw new DoctorError('not-updatable', 'This bundle cannot be safely updated by this plugin.');
        const query = await this.versions(name, signal);
        if (query.status !== 'listed' || !query.versions.some(item => item.version === version && item.bundle && !item.incompatible && !item.prerelease && !item.deprecated)) throw new DoctorError('version-not-admitted', 'Choose an offered compatible stable version.');
        return { operation: 'update', package: name, from: raw.version, to: version, registry: PUBLIC_REGISTRY, blocked: false, reasons: [], warnings: ['Diagnostic plan only; the authenticated panel prepares exact archives before user confirmation.'] };
    }
    async scan(signal) {
        const { bundles, rows } = await this.snapshot();
        const summaries = [];
        for (const raw of bundles.filter(bundle => bundle.installed)) {
            const summary = this.summary(raw, rows);
            let manifest;
            try { manifest = JSON.parse(await readFile(join(await this.resolvePackage(raw.name), 'package.json'), 'utf8')); } catch {}
            const safety = onlineSafety({ ...raw, update: summary.sourceKind === 'registry' ? 'registry' : raw.update }, manifest);
            if (!this.taskGate || !this.stager) safety.reasons.push('online-update-gate-unavailable');
            summaries.push({ ...summary, canUpdate: summary.canUpdate && safety.reasons.length === 0, reasons: [...new Set([...summary.reasons, ...safety.reasons])] });
        }
        const queryManager = { listVersions: async (name, options, signal) => {
            const raw = bundles.find(bundle => bundle.name === name);
            if (raw?.update === 'registry') return this.manager.listVersions(name, options, signal);
            return this.stager.listVersions(name, raw.version, signal);
        } };
        return this.redact({ profile: this.profile.name, runtimeVersion: this.runtimeVersion, items: await scanUpdates(queryManager, summaries, { signal }), taskPolicy: 'wait-for-idle' });
    }
    async sourceFor(name, signal) {
        const { bundles } = await this.snapshot(); const bundle = bundles.find(item => item.name === name);
        if (!bundle) throw new DoctorError('unknown-bundle', 'Unknown bundle.');
        const known = this.lineageOf(bundle);
        if (known) { await this.stager.reopen(known); return PUBLIC_REGISTRY; }
        const query = await this.manager.listVersions(name, undefined, signal);
        if (query.status !== 'listed' || !publicRegistry(query.registry)) throw new DoctorError(query.registry == null ? 'registry-origin-unverified' : 'registry-origin-unsupported', 'The installed source must be verified public npm; no private or mirror source is migrated.');
        return PUBLIC_REGISTRY;
    }
    async prepareBatch(items, signal) {
        if (this.busy || this.external.size || this.closed) throw new DoctorError('busy', 'Another plugin operation is running.');
        if (!Array.isArray(items) || items.length === 0 || items.length > 20) throw new DoctorError('invalid-batch', 'Select between 1 and 20 compatible plugin updates.');
        const seen = new Set();
        for (const item of items) {
            this.validateName(item.name);
            if (seen.has(item.name) || !VERSION.test(item.version ?? '')) throw new DoctorError('invalid-batch', 'Duplicate package or invalid exact version.');
            seen.add(item.name);
        }
        const scan = await this.scan(signal);
        const { bundles } = await this.snapshot();
        const plans = [];
        for (const item of items) {
            const offered = scan.items.find(candidate => candidate.name === item.name);
            const raw = bundles.find(candidate => candidate.name === item.name);
            if (!offered?.canUpdate || offered.latestVersion !== item.version || !raw) throw new DoctorError('version-not-admitted', 'Selection changed or is not the latest compatible stable version.');
            const registry = await this.sourceFor(item.name, signal);
            const next = await this.stager.stage(item.name, item.version, { signal, origin: registry });
            const known = this.lineageOf(raw);
            const previous = await this.stager.stage(item.name, raw.version, { signal, origin: registry });
            if (known && known.originalSha256 !== previous.originalSha256) throw new DoctorError('source-identity-unverified', 'The old public archive no longer matches the installed identity.');
            if (!known) await this.stager.verifyInstalledOriginal(previous, await this.resolvePackage(item.name));
            await this.stager.preserveGenerationPair?.(next, previous);
            const nextReference = this.stager.reference(next), previousReference = this.stager.reference(previous);
            plans.push({ name: item.name, from: raw.version, to: item.version, version: item.version, enabled: raw.enabled,
                fingerprint: this.fingerprint(raw), registry, nextReference, previousReference,
                highImpact: item.name==='dsh-plugin-wsl-env', runtimePackaging: item.name==='dsh-plugin-wsl-env'?'verified-generation':'original' });
        }
        const ticket = randomUUID();
        const plan = { id: randomUUID(), operation: 'batch-update', profile: this.profile.name, items: plans,
            expiresAt: new Date(this.now() + 120_000).toISOString(), taskPolicy: 'wait-for-idle', taskPolicies: ['wait-for-idle','cancel-active'],
            warnings: ['Choose whether to wait or explicitly stop the running Agent tasks captured at confirmation. Stopping clears their queued input and cannot undo completed tool effects.', 'New task steps and idle-agent input wait during replacement.', 'GUI terminals and independent background workers are not automatically terminated.', 'A failure or requested Host restart stops the remaining batch. DSH is never exited automatically.', ...(plans.some(item=>item.name==='dsh-plugin-wsl-env') ? ['WSL updates use a verified runtime-generation package: original JS/assets are unchanged, but package exports and own module names use independent paths to avoid stale Host caches.'] : [])] };
        this.tickets.clear(); this.tickets.set(ticket, { batch: true, plan });
        return this.redact({ ...plan, ticket });
    }
    async prepareRestore(name, signal, { issueTicket = true } = {}) {
        this.validateName(name);
        if (this.busy || this.external.size || this.closed) throw new DoctorError('busy', 'Another plugin operation is running.');
        const recovery = this.recoveryFor(name);
        if (!recovery || recovery.status === 'prepared') throw new DoctorError('no-recovery-target', 'Only a recorded failed update authorizes recovery.');
        const { bundles } = await this.snapshot(); const raw = bundles.find(item => item.name === name);
        if (recovery.expectedFingerprint !== this.fingerprint(raw)) throw new DoctorError('recovery-source-changed', 'The installed state no longer matches this failed update.');
        if (raw?.installed && (!raw.removable || raw.readOnlyReason)) throw new DoctorError('not-updatable', 'This target is protected.');
        try { await this.stager.reopen(recovery.previous); } catch { throw new DoctorError('recovery-archive-unavailable', 'The exact recorded recovery archive is missing or changed.'); }
        const plan = { id: randomUUID(), operation: 'batch-restore', profile: this.profile.name,
            items: [{ name, from: raw?.version ?? null, to: recovery.from, version: recovery.from, enabled: recovery.enabled,
                fingerprint: this.fingerprint(raw), registry: PUBLIC_REGISTRY, previousReference: recovery.previous, nextReference: recovery.previous,
                recoveryId: recovery.id, highImpact: name === 'dsh-plugin-wsl-env', runtimePackaging: recovery.previous.runtimeGeneration ? 'verified-generation' : 'original' }],
            expiresAt: new Date(this.now() + 120_000).toISOString(), taskPolicy: 'wait-for-idle', taskPolicies: ['wait-for-idle', 'cancel-active'],
            warnings: ['Recovery uses only the exact archived old version from this failed update; it is not an arbitrary downgrade.', 'Waiting is the default. Stopping tasks requires an additional explicit confirmation.', 'Changes affect this profile. Other manager or CLI operations can still intervene between removal and installation.'] };
        if (!issueTicket) return this.redact(plan);
        const ticket = randomUUID(); this.tickets.clear(); this.tickets.set(ticket, { batch: true, plan });
        return this.redact({ ...plan, ticket });
    }
    async commitBatch(ticket, prepared, { taskPolicy = 'wait-for-idle', confirmCancel = false } = {}) {
        if (!['wait-for-idle','cancel-active'].includes(taskPolicy) || (taskPolicy === 'cancel-active' && confirmCancel !== true)) throw new DoctorError('task-confirmation-required', 'Stopping tasks requires explicit user confirmation.');
        if (!this.taskGate || !this.stager) throw new DoctorError('online-unavailable', 'Online replacement support is unavailable.');
        const { bundles } = await this.snapshot();
        for (const item of prepared.plan.items) {
            const current = bundles.find(bundle => bundle.name === item.name);
            if (this.fingerprint(current) !== item.fingerprint) throw new DoctorError('state-changed', 'Plugin state changed; check again.');
            if (prepared.plan.operation === 'batch-restore' && this.recoveryFor(item.name)?.id !== item.recoveryId) throw new DoctorError('state-changed', 'Recovery changed; prepare again.');
        }
        if (this.busy || this.external.size || this.closed) throw new DoctorError('busy', 'Another plugin operation started.');
        const id = randomUUID(); const controller = new AbortController();
        const record = { id, origin: 'doctor', operation: prepared.plan.operation, taskPolicy, confirmCancel: taskPolicy === 'cancel-active' && confirmCancel === true, phase: 'waiting', startedAt: new Date(this.now()).toISOString(), items: prepared.plan.items.map(item => ({ ...item, status: 'waiting' })), steps: [] };
        const job = { id, package: '(batch)', phase: 'waiting', record, steps: record.steps, controller,
            cancelTargets: taskPolicy === 'cancel-active' ? this.taskGate.cancellationTargets?.() ?? [] : [] };
        this.busy = job; this.jobs.set(id, job);
        job.work = this.runBatch(job).catch(async error => {
            const cancelled = job.controller.signal.aborted;
            for (const item of job.record.items) if (['waiting', 'preparing'].includes(item.status)) item.status = 'skipped';
            job.phase = 'finished'; job.record = this.redact({ ...job.record, phase: 'finished', outcome: cancelled ? 'cancelled' : 'unknown', error: error?.message ?? String(error) });
            await this.store.put(job.record);
        }).finally(async () => {
            if (this.busy === job) this.busy = null;
            const stored = this.store.records.find(value => value.id === id);
            job.record = stored ?? { id, phase: 'finished', outcome: 'unknown', summary: 'bounded-history-unavailable' };
            job.steps = job.record.steps ?? []; job.boundedlogs = []; job.cancelTargets = []; job.activeInstall = null;
            this.trimJobs();
        });
        return { operationId: id };
    }
    async runBatch(job) {
        await this.store.put(job.record);
        const staged = [];
        // Download+validate both generations before any running plugin stops.
        for (const item of job.record.items) {
            item.status = 'preparing'; this.step(job, 'preparing-' + item.name);
            const restoring = job.record.operation === 'batch-restore';
            if (item.registry != null && item.registry !== PUBLIC_REGISTRY) throw new DoctorError('registry-origin-unsupported', 'The source is not the verified public npm origin.');
            if (!item.nextReference || !item.previousReference) throw new DoctorError('missing-prepared-archive', 'All exact archives must be prepared before user confirmation.');
            if (!restoring) await this.sourceFor(item.name, job.controller.signal);
            const next = await this.stager.reopen(item.nextReference);
            const previous = await this.stager.reopen(item.previousReference);
            const { bundles } = await this.snapshot(); const raw = bundles.find(bundle => bundle.name === item.name);
            const admission = raw ?? { name: item.name, version: item.to, removable: true, availability: 'profile', installed: false, update: 'registry' };
            if (onlineSafety({ ...admission, update: 'registry', version: item.to }, next.manifest).reasons.length || (!restoring && onlineSafety({ ...admission, update:'registry', version: item.from }, previous.manifest).reasons.length)) throw new DoctorError('unsafe-runtime-update', 'Staged package changes Host/shared/native dependencies; online replacement is blocked.');
            const liveRows = (await this.manager.listPlugins());
            const currentIds = new Set((raw?.rows ?? []).map(row=>row.rowId));
            for (const row of next.rows ?? []) if (liveRows.some(live=>live.patchId === row.id && !currentIds.has(row.id))) throw new DoctorError('row-id-collision', 'Target bundle conflicts with another existing Host row.');
            const oldPeers = previous.manifest.peerDependencies ?? {}, newPeers = next.manifest.peerDependencies ?? {};
            const wslGeneration = !!next.runtimeGeneration && !!previous.runtimeGeneration && item.name === 'dsh-plugin-wsl-env';
            if (!wslGeneration && JSON.stringify(Object.entries(oldPeers).sort()) !== JSON.stringify(Object.entries(newPeers).sort())) throw new DoctorError('peer-graph-change', 'Changed peer dependency graph requires separate review.');
            if (wslGeneration && JSON.stringify(Object.keys(oldPeers).sort()) !== JSON.stringify(Object.keys(newPeers).sort())) throw new DoctorError('peer-graph-change','New WSL runtime peers require separate review.');
            staged.push({ item, next, previous }); item.status = 'waiting';
            item.nextReference = this.stager.reference(next); item.previousReference = this.stager.reference(previous);
        }
        // Revalidate before the irreversible user-confirmed task cancellation.
        if (this.closed || this.external.size) throw new DoctorError('busy','Plugin state changed before task handling.');
        const currentSnapshot = await this.snapshot();
        for (const { item, next, previous } of staged) {
            const current = currentSnapshot.bundles.find(bundle=>bundle.name===item.name);
            if (this.fingerprint(current)!==item.fingerprint) throw new DoctorError('state-changed','Plugin state changed before stopping tasks.');
            await this.stager.verify(next); await this.stager.verify(previous);
            if (current?.installed) {
                const locks = await this.probeLocks(await this.resolvePackage(item.name), { signal:job.controller.signal });
                if (locks.files?.some(file=>file.probe==='sharing-violation')) throw new DoctorError('file-sharing-conflict','File sharing conflict observed before task handling.');
            }
            if (job.record.operation !== 'batch-restore') {
                const recovery = { id: randomUUID(), failedBatchId: job.id, name: item.name, from: item.from, to: item.to, enabled: item.enabled,
                    previous: item.previousReference, next: item.nextReference, status: 'prepared', expectedFingerprint: item.fingerprint };
                await this.identities.prepare(recovery); item.recoveryId = recovery.id;
            }
        }
        job.controller.signal.throwIfAborted();
        await this.taskGate.run(async signal => {
            if (this.external.size) throw new DoctorError('busy', 'Another manager operation is running.');
            job.phase = 'running'; job.record.phase = 'running';
            let stopped = false;
            try { for (const { item, next, previous } of staged) {
                if (stopped) { item.status = 'skipped'; continue; }
                if (this.closed) { item.status='skipped'; item.diagnostic='updater-unloading'; stopped=true; continue; }
                signal.throwIfAborted();
                const { bundles } = await this.snapshot(); const current = bundles.find(bundle => bundle.name === item.name);
                if (this.fingerprint(current) !== item.fingerprint) { item.status = 'skipped'; item.diagnostic = 'state-changed'; stopped = true; continue; }
                await this.stager.verify(next); await this.stager.verify(previous);
                if (current?.installed) {
                    const locks = await this.probeLocks(await this.resolvePackage(item.name), { signal });
                    if (locks.files?.some(file=>file.probe==='sharing-violation')) { item.status='failed'; item.diagnostic='file-sharing-conflict-observed'; item.locks=this.redact(locks); stopped=true; continue; }
                }
                if (job.record.operation === 'batch-restore') {
                    await this.performRecovery(job, item, next, current); stopped = item.status !== 'restored'; continue;
                }
                if (job.record.operation !== 'batch-restore') await this.sourceFor(item.name, signal);
                item.status = 'updating'; this.step(job, 'updating-' + item.name);
                if (next.runtimeGeneration && item.name==='dsh-plugin-wsl-env') {
                    // Never deselect WSL: doing so restores base providers and causes the
                    // observed duplicate-service registration failure on reinstallation.
                    item.origin='https://registry.npmjs.org';item.archivePath=next.archivePath;
                    item.runtimeGeneration=next.runtimeGeneration;item.originalSha256=next.originalSha256;
                    job.activeInstall = { name: item.name, requestId: job.id, recovery: false };
                    let installed;
                    try {
                        installed=await this.manager.installBundle(next.archivePath,{enabled:item.enabled,saveExact:true,expected:{name:item.name,version:item.to},requestId:job.id});
                        const checked=await this.verifyInstalled(item, item.nextReference, await this.verifyGeneration(item,next,installed));
                        item.result=await this.completeResult(checked);
                        if(checked.application==='applied'){item.status='updated';continue;}
                    } catch(error) { item.result={application:'failed',stage:'enable',error:{code:'generation-update-failed',diagnostic:this.redact(String(error.message??error))}}; }
                    item.status=item.result.application==='restart-required'?'restart-required':'failed';stopped=true;
                    // Recovery also uses an independent old-generation path and does not
                    // expose the base-provider gap created by removing the selected bundle.
                    try {
                        const observed = (await this.snapshot()).bundles.find(bundle => bundle.name === item.name);
                        if (observed?.installed && !await this.ownedTarget(item) && this.fingerprint(observed) !== item.fingerprint) { item.restore = { application: 'failed', diagnostic: 'external-target-not-restored' }; continue; }
                        job.activeInstall = { name: item.name, requestId: randomUUID(), recovery: true };
                        const targetVerification = item.verification;
                        const restored=await this.manager.installBundle(previous.archivePath,{enabled:item.enabled,saveExact:true,expected:{name:item.name,version:item.from},requestId:job.activeInstall.requestId});
                        item.restore=await this.completeResult(await this.verifyInstalled(item,item.previousReference,await this.verifyGeneration({...item,to:item.from},previous,restored)));
                        item.restoreVerification = item.verification; item.verification = targetVerification;
                    } catch(error) { item.restore={application:'failed',stage:'enable',error:{code:'generation-recovery-failed',diagnostic:this.redact(String(error.message??error))}}; }
                    continue;
                }
                const removed = await this.manager.removeBundle(item.name);
                if (removed.application !== 'applied') { item.result = await this.completeResult(removed); item.status = removed.application === 'restart-required' ? 'restart-required' : 'failed'; stopped = true; continue; }
                const afterRemoval = (await this.snapshot()).bundles.find(bundle => bundle.name === item.name);
                if (afterRemoval?.installed) { item.status = 'failed'; item.diagnostic = 'external-target-appeared'; stopped = true; continue; }
                item.origin = PUBLIC_REGISTRY; item.archivePath = next.archivePath;
                job.activeInstall = { name: item.name, requestId: job.id, recovery: false };
                let result;
                try { result = await this.manager.installBundle(next.archivePath, { enabled: item.enabled, saveExact: true, expected: { name: item.name, version: item.to }, requestId: job.id }); }
                catch (error) { result = { application: 'failed', stage: 'install', error: { code: 'operation-exception', diagnostic: String(error?.message ?? error) } }; }
                result = await this.verifyInstalled(item, item.nextReference, result);
                item.result = await this.completeResult(result);
                if (result.application === 'applied') { item.status = 'updated'; continue; }
                item.status = result.application === 'restart-required' ? 'restart-required' : 'failed'; stopped = true;
                if (result.application === 'restart-required') continue;
                // Failed target cleanup must succeed before recovery, never swallow its result.
                const after = (await this.snapshot()).bundles.find(bundle => bundle.name === item.name);
                let cleanup;
                if (after?.installed) {
                    if (!await this.ownedTarget(item)) { item.restore = { application: 'failed', diagnostic: 'external-target-not-removed' }; continue; }
                    try { cleanup = await this.manager.removeBundle(item.name); }
                    catch (error) { cleanup = { application: 'failed', stage: 'remove', error: { code: 'operation-exception', diagnostic: String(error?.message ?? error) } }; }
                }
                if (cleanup && cleanup.application !== 'applied') { item.restore = { application: 'failed', stage: 'remove', diagnostic: 'target-cleanup-failed', result: await this.completeResult(cleanup) }; continue; }
                if ((await this.snapshot()).bundles.find(bundle => bundle.name === item.name)?.installed) { item.restore = { application: 'failed', diagnostic: 'external-target-appeared' }; continue; }
                try {
                    job.activeInstall = { name: item.name, requestId: randomUUID(), recovery: true };
                    const targetVerification = item.verification;
                    const restored = await this.manager.installBundle(previous.archivePath, { enabled: item.enabled, saveExact: true, expected: { name: item.name, version: item.from }, requestId: job.activeInstall.requestId });
                    item.restore = await this.completeResult(await this.verifyInstalled(item, item.previousReference, restored));
                    item.restoreVerification = item.verification; item.verification = targetVerification;
                } catch (error) { item.restore = { application: 'failed', stage: 'install', error: { code: 'operation-exception', diagnostic: this.redact(String(error?.message ?? error)) } }; }
            } } finally {
                for (const { item } of staged) await this.persistItemOutcome(job, item);
            }
        }, { signal: job.controller.signal, taskPolicy: job.record.taskPolicy ?? 'wait-for-idle', confirmCancel: job.record.confirmCancel, cancelTargets: job.cancelTargets,
            onCancelled: state => { job.record.taskCancellation = state; this.step(job, 'user-confirmed-task-stop'); },
            onWaiting: state => { job.waiting = state; } });
        job.phase = 'finished'; job.record.phase = 'finished'; job.record.finishedAt = new Date(this.now()).toISOString();
        job.record.outcome = job.record.items.every(item => ['updated', 'restored'].includes(item.status)) ? 'applied'
            : job.record.items.some(item => item.status === 'restart-required') ? 'restart-required' : 'failed';
        await this.store.put(job.record);
    }
    async verifyInstalled(item, staged, result) {
        const { bundles, rows } = await this.snapshot(); const bundle = bundles.find(value => value.name === item.name);
        const state = bundle ? bundleState(bundle, rows) : { state: 'missing', activeRows: 0, totalRows: 0 };
        const exact = bundle?.version === staged.version && archiveKey(this.stager.root, bundle.source) === staged.archiveKey;
        item.verification = { package: { status: exact ? 'verified' : 'failed', version: bundle?.version ?? null },
            host: { status: !bundle?.enabled ? 'disabled' : state.state === 'active' ? 'active' : state.state === 'inactive' || state.state === 'partial' ? 'inactive' : 'unknown', activeRows: state.activeRows, totalRows: state.totalRows } };
        if (result.application === 'applied' && (!exact || (item.enabled && state.state !== 'active'))) return { ...result, application: 'failed', error: { code: 'installed-state-mismatch', diagnostic: 'Exact archive/version and enabled Host rows were not verified after installation.' } };
        return result;
    }
    async ownedTarget(item) {
        const bundle = (await this.snapshot()).bundles.find(value => value.name === item.name);
        return bundle?.installed && bundle.version === item.to && archiveKey(this.stager.root, bundle.source) === item.nextReference.archiveKey ? bundle : null;
    }
    async performRecovery(job, item, staged, current) {
        const recovery = this.recoveryFor(item.name);
        if (!recovery || recovery.id !== item.recoveryId || this.fingerprint(current) !== recovery.expectedFingerprint) throw new DoctorError('recovery-source-changed', 'Recovery target changed.');
        if (!staged.runtimeGeneration && current?.installed) {
            const removed = await this.manager.removeBundle(item.name);
            if (removed.application !== 'applied') { item.result = await this.completeResult(removed); item.status = 'failed'; return; }
        }
        const afterRemove = (await this.snapshot()).bundles.find(value => value.name === item.name);
        if (staged.runtimeGeneration && this.fingerprint(afterRemove) !== item.fingerprint) { item.status = 'failed'; item.diagnostic = 'external-target-not-restored'; return; }
        if (!staged.runtimeGeneration && afterRemove?.installed) { item.status = 'failed'; item.diagnostic = 'external-target-appeared'; return; }
        item.status = 'updating'; this.step(job, 'restoring-' + item.name);
        // Restoration has a separate request id; cancelling an update id cannot cancel recovery.
        job.activeInstall = { name: item.name, requestId: randomUUID(), recovery: true };
        let result = await this.manager.installBundle(staged.archivePath, { enabled: item.enabled, saveExact: true, expected: { name: item.name, version: item.to }, requestId: job.activeInstall.requestId });
        if (staged.runtimeGeneration) result = await this.verifyGeneration(item, staged, result);
        result = await this.verifyInstalled(item, item.nextReference, result);
        item.result = await this.completeResult(result); item.status = result.application === 'applied' ? 'restored' : result.application === 'restart-required' ? 'restart-required' : 'failed';
        job.activeInstall = null;
    }
    async persistItemOutcome(job, item) {
        const recovery = this.recoveryFor(item.name);
        if (!recovery) return;
        const bundle = (await this.snapshot()).bundles.find(value => value.name === item.name);
        const key = this.stager?.root ? archiveKey(this.stager.root, bundle?.source) : null;
        if (['preparing','waiting'].includes(item.status)) { await this.identities.settle(item.name, this.lineageOf(bundle ?? {name:item.name}), null); return; }
        const references = [item.nextReference, item.previousReference].filter(Boolean);
        const installed = references.find(value => value.version === bundle?.version && value.archiveKey === key) ?? this.lineageOf(bundle ?? { name: item.name });
        const isRestored = item.status === 'restored' || item.restore?.application === 'applied';
        const ours = !bundle?.installed || this.fingerprint(bundle) === item.fingerprint || references.some(value => value.version === bundle.version && value.archiveKey === key);
        const failed = ours && !['updated', 'restored', 'waiting', 'skipped'].includes(item.status) && !isRestored;
        try {
            await this.identities.settle(item.name, installed ?? null, failed ? { ...recovery, status: 'failed', expectedFingerprint: this.fingerprint(bundle) } : null);
            if (failed) { item.recoveryId = recovery.id; item.restoreVersion = recovery.from; }
            else { delete item.recoveryId; delete item.restoreVersion; }
        } catch {
            job.record.identityPersistenceWarning = 'identity-write-failed';
            // Actual management outcomes remain as observed. Durable recovery is unavailable
            // until the separate identity record can be committed.
        }
    }
    async verifyGeneration(item, staged, installed) {
        const admittedRestart = installed.application==='restart-required' && installed.restartReason==='unmanaged-plugin';
        if(installed.application!=='applied' && !admittedRestart) return installed;
        // Reapply the still-selected bundle once: real experiments show this settles
        // the package generation without changing the suppression of base services.
        const reapplied=await this.manager.setBundleEnabled(item.name,item.enabled);
        if(reapplied.application!=='applied')return {...reapplied,initialResult:installed};
        const initialWarnings=Array.isArray(installed.warnings)?installed.warnings:[];
        const addedWarnings=(reapplied.warnings??[]).filter(warning=>!initialWarnings.includes(warning));
        if(addedWarnings.length) return {...reapplied,application:'failed',initialResult:installed,error:{code:'new-generation-warnings',diagnostic:addedWarnings.join('\n')}};
        const {bundles,rows}=await this.snapshot();
        const bundle=bundles.find(candidate=>candidate.name===item.name);
        if(!bundle||bundle.version!==item.to)throw new DoctorError('generation-version-mismatch','Generation package version is not the expected target.');
        const aliases=new Map(staged.runtimeGeneration.moduleAliases);
        for(const expected of staged.rows){
            const current=rows.find(row=>row.patchId===expected.id || row.entryId==='include:'+expected.id);
            const moduleName=aliases.get(expected.name) ?? expected.name;
            if(!current || current.moduleName!==moduleName || (item.enabled && (current.enabled!==true || current.fiberPhase!=='active')))throw new DoctorError('generation-row-not-active','An expected plugin generation row did not activate.');
        }
        return {...reapplied,initialResult:installed,generationVerified:true,verifiedVersion:item.to};
    }
    cancelWait(id) {
        const job = this.jobs.get(id);
        if (!job || job.phase !== 'waiting') throw new DoctorError('too-late', 'Only a not-yet-started batch can be cancelled.');
        job.controller.abort(new Error('waiting-cancelled')); return { cancelled: true };
    }
    async commit(ticket, choices = {}) {
        const prepared = this.tickets.get(ticket);
        this.tickets.delete(ticket);
        if (!prepared || this.now() > Date.parse(prepared.plan.expiresAt)) throw new DoctorError('stale-confirmation', 'Confirmation expired; prepare again.');
        if (!prepared.batch) throw new DoctorError('use-batch-flow', 'Only guarded batch confirmations can change plugins.');
        return this.commitBatch(ticket, prepared, choices);
    }
    trimJobs() {
        const snapshots = new Map(this.store.records.map(value => [value.id, value]));
        const retained = new Set(snapshots.keys());
        for (const [id, job] of this.jobs) if (job !== this.busy && job.phase === 'finished') {
            if (!retained.has(id)) this.jobs.delete(id);
            else { job.record = snapshots.get(id); job.steps = job.record.steps ?? []; job.boundedlogs = []; job.controller = null; job.cancelTargets = []; }
        }
        while (this.jobs.size > 81) {
            const entry = [...this.jobs].find(([, job]) => job !== this.busy && job.phase === 'finished');
            if (!entry) break; this.jobs.delete(entry[0]);
        }
    }
    step(job, value) { job.steps.push({ step: value, time: new Date(this.now()).toISOString() }); if (job.steps.length > 100) job.steps.splice(0, job.steps.length - 100); }
    onInstallProgress(value) {
        const job = this.busy;
        if (!job?.activeInstall || value.requestId !== job.activeInstall.requestId) return;
        job.installProgress = { phase: value.phase, name: job.activeInstall.name, requestId: value.requestId };
    }
    onInstallLog(value) {
        const job = this.busy;
        if (!job?.activeInstall || value.requestId !== job.activeInstall.requestId || typeof value.text !== 'string') return;
        const chunk = this.redact({ name: job.activeInstall.name, stream: value.stream, text: value.text.slice(0, 4000) });
        job.boundedlogs = [...job.boundedlogs ?? [], chunk].slice(-40);
    }
    onUpdateState(value) {
        const job = this.jobs.get(value.requestId);
        if (job?.phase === 'running') this.step(job, value.step);
    }
    async observe(value) {
        if (!value || !['started', 'settled', 'unknown'].includes(value.phase)) return;
        if (value.phase === 'started' && value.target === SELF && (value.reason === 'remove' || (value.reason === 'bundle' && value.enabled === false))) {
            this.closed = true;
            if (this.busy?.phase === 'waiting') this.busy.controller?.abort(new Error('updater-unloading'));
        }
        if (value.phase === 'started') this.external.add(value.id); else this.external.delete(value.id);
        // The public event deliberately excludes exception text. Capture only its whitelist.
        const event = Object.fromEntries(['id', 'time', 'reason', 'target', 'stage', 'enabled', 'version', 'phase', 'application', 'changed', 'errorCode', 'restartReason'].filter(key => value[key] !== undefined).map(key => [key, value[key]]));
        await this.store.put({ id: 'event-' + value.id, package: value.target, phase: value.phase === 'started' ? 'running' : value.phase,
            operation: value.reason, origin: 'official-event', time: value.time, event,
            detailedDiagnosticAvailable: false, diagnosticNotice: 'Official operation events retain error codes only; use this panel for complete results.' });
    }
    async completeResult(result) {
        if (!result) return { application: 'failed', error: { code: 'missing-result' } };
        const copy = { ...result };
        const logPath = result.packageResult?.logPath;
        if (logPath) {
            try {
                const root = await realpath(join(this.profile.dir, '.plugin-manager', 'logs'));
                const candidate = await realpath(logPath);
                const rel = relative(root, candidate);
                if (!rel || isAbsolute(rel) || rel.split(sep).includes('..')) throw new Error('untrusted-log');
                const info = await lstat(candidate);
                if (!info.isFile() || info.isSymbolicLink() || info.size > 256_000) throw new Error('log-limit');
                copy.completeInstallLog = await readFile(candidate, 'utf8');
            } catch { copy.completeInstallLogUnavailable = true; }
        }
        return this.redact(copy);
    }
    operation(id) {
        const job = this.jobs.get(id);
        if (job) return this.redact({ phase: job.phase, steps: job.steps.slice(-100), waiting: job.waiting, record: job.record, after: job.after,
            installProgress: job.installProgress ?? null, boundedlogs: job.boundedlogs ?? [] });
        const record = this.store.records.find(item => item.id === id);
        if (record) return { phase: ['running','waiting','interrupted'].includes(record.phase) ? 'unknown' : 'finished', steps: record.steps ?? [], record };
        throw new DoctorError('unknown-operation', 'Operation not found; recheck current state.');
    }
    fingerprint(bundle) { return bundle ? createHash('sha256').update(JSON.stringify([bundle.name, bundle.version, bundle.source, bundle.enabled, bundle.installed, bundle.availability,
        bundle.overrides ?? [], (bundle.rows ?? []).map(row => [row.rowId, row.moduleName, row.entryId])])).digest('hex') : '<missing>'; }
    validateName(name) { if (typeof name !== 'string' || name.length > 214 || !NAME.test(name)) throw new DoctorError('invalid-name', 'An exact installed package name is required.'); }
    async dispose() {
        this.closed = true; this.tickets.clear();
        if (this.busy?.phase === 'waiting') this.busy.controller?.abort(new Error('updater-unloading'));
        // External disable/removal may already hold the official writer/HMR lock.
        // Never indefinitely await a job that needs that same lock from this disposer.
        if (this.busy?.work) {
            let timer;
            await Promise.race([this.busy.work, new Promise(resolve => { timer=setTimeout(resolve,5000); })]);
            clearTimeout(timer);
            if (this.busy) await this.store.put({ ...this.busy.record, phase:'interrupted', outcome:'unknown', summary:'updater-unloaded-before-result' });
        }
        await this.store.chain;
    }
}
export class DoctorError extends Error { constructor(code, message) { super(message); this.code = code; } }
