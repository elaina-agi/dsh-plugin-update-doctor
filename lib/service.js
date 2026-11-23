import { randomUUID, createHash } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, sep, basename, dirname, normalize } from 'node:path';
import { makeRedactor } from './redact.js';
import { HistoryStore } from './history.js';
import { bundleState, classify } from './diagnosis.js';
import { scanUpdates, onlineSafety } from './online.js';
import { IdentityStore } from './identity.js';
import { PUBLIC_REGISTRY, PUBLIC_MIRROR, publicRegistry, approvedPublicRegistry, registryOrigin, archiveKey, readRegistryVersions } from './source.js';
import { dependencyDeclaration, inspectDependencyGraph, assertSameDependencyGraph } from './dependency-policy.js';
import { performUnionGeneration, performUnionRecovery, persistUnionOutcome } from './union-service.js';

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
export const SELF = 'dsh-plugin-update-doctor';

export class DoctorService {
    constructor({ manager, profile, runtimeVersion, resolvePackage, probeLocks, statePath, taskGate, stager, unionStager, verifyRunningGeneration, hmrAvailable=true, now = () => Date.now() }) {
        Object.assign(this, { manager, profile, runtimeVersion, resolvePackage, probeLocks, now, taskGate, stager, unionStager, verifyRunningGeneration, hmrAvailable });
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
                if(recovery.installMode==='union-generation'){
                    if(recovery.dispatchStarted || this.fingerprint(bundle)!==recovery.expectedFingerprint)await this.identities.settle(recovery.name,null,{...recovery,status:'unknown',expectedFingerprint:this.fingerprint(bundle)});
                    else await this.identities.settle(recovery.name,this.lineageOf(bundle),null);
                    continue;
                }
                if (['registry-spec','registry-migration'].includes(recovery.installMode)) {
                    // A Host result lost across restart is not proof that its registry
                    // update or rollback completed, even when version labels match.
                    if (recovery.dispatchStarted || this.fingerprint(bundle) !== recovery.expectedFingerprint) {
                        await this.identities.settle(recovery.name,null,{...recovery,status:'unknown',expectedFingerprint:this.fingerprint(bundle)});
                    } else await this.identities.settle(recovery.name, recovery.installMode === 'registry-migration' ? this.lineageOf(bundle) : null, null);
                    continue;
                }
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
    stageOwner(reference) { return reference?.runtimeGeneration?.kind === 'union-dependency' ? this.unionStager : this.stager; }
    archiveRoot(bundle, reference) { return (reference?.runtimeGeneration?.kind === 'union-dependency' || bundle?.name === 'dsh-union-search' && this.identities.get(bundle.name)?.runtimeGeneration?.kind === 'union-dependency') ? this.unionStager?.root : this.stager?.root; }
    async reopenReference(reference) { const stager=this.stageOwner(reference); if(!stager)throw new DoctorError('union-generation-unavailable','The required generation verifier is unavailable.');return stager.reopen(reference); }
    async verifyReference(reference,directory) { const stager=this.stageOwner(reference); if(!stager)throw new DoctorError('union-generation-unavailable','The required generation verifier is unavailable.');return stager.verifyInstalledArchive(reference,directory); }
    unionRoute(bundle) { return bundle?.name === 'dsh-union-search' && this.hmrAvailable && !!this.unionStager && typeof this.verifyRunningGeneration === 'function' && ['0.10.24','0.10.25'].includes(bundle.version) && (bundle.update === 'registry' || this.lineageOf(bundle)?.runtimeGeneration?.kind === 'union-dependency'); }
    unionPair(bundle,to) { return this.unionRoute(bundle) && this.unionStager.canAdmit(bundle.name,bundle.version,to) && bundle.version === '0.10.24' && to === '0.10.25'; }
    lineageOf(bundle) {
        if(!bundle)return null;
        const known = this.identities.get(bundle.name),root=this.archiveRoot(bundle,known);
        if (!known || !root || known.version !== bundle.version || known.origin !== PUBLIC_REGISTRY) return null;
        return archiveKey(root, bundle.source) === known.archiveKey ? known : null;
    }
    recoveryFor(name) { return this.identities.recovery(name); }
    summary(bundle, rows) {
        const observed = bundleState(bundle, rows);
        let sourceKind = bundle.update ?? (bundle.source?.startsWith('link:') || bundle.source?.startsWith('file:') ? 'local' : 'other');
        const lineage = this.lineageOf(bundle), unionGeneration=this.unionRoute(bundle), knownUnion=lineage?.runtimeGeneration?.kind === 'union-dependency';
        if (lineage && !knownUnion) sourceKind = 'registry';
        const reasons = [];
        if(bundle.name==='dsh-union-search'&&this.hmrAvailable&&!unionGeneration)reasons.push('dependency-runtime-reload-unverified');
        if(this.identities.warning)reasons.push('identity-store-unverified');
        if (lineage && !knownUnion && bundle.name !== 'dsh-plugin-wsl-env' && bundle.update !== 'registry') reasons.push('legacy-archive-source-requires-migration');
        if (bundle.name === SELF) reasons.push('self-update-blocked');
        if (!bundle.removable || bundle.readOnlyReason) reasons.push('management-or-shipped-bundle');
        if (sourceKind !== 'registry' && !knownUnion) reasons.push('registry-updates-only');
        if (!bundle.installed) reasons.push('not-profile-installed');
        const recovery = this.recoveryFor(bundle.name);
        if (['registry-spec','registry-migration','union-generation'].includes(recovery?.installMode) && (recovery.status === 'unknown' || recovery.status === 'prepared' && recovery.dispatchStarted)) reasons.push(recovery.installMode === 'union-generation' ? 'union-generation-outcome-unknown' : 'registry-update-outcome-unknown');
        const matchesRecovery = !!recovery && recovery.status !== 'prepared' && !(['registry-spec','registry-migration','union-generation'].includes(recovery.installMode) && recovery.status === 'unknown') && recovery.expectedFingerprint === this.fingerprint(bundle);
        if (this.sourceWarnings.has(bundle.name)) reasons.push(this.sourceWarnings.get(bundle.name));
        const unionCurrentReference=recovery?.installMode==='union-generation'&&bundle.installed&&([recovery.next,recovery.previous].find(reference=>reference?.version===bundle.version&&archiveKey(this.unionStager?.root??'',bundle.source)===reference.archiveKey)??(knownUnion?lineage:null));
        const recoveryAdmitted = matchesRecovery && !this.identities.warning && !(bundle.name === 'dsh-union-search' && this.hmrAvailable && (recovery?.installMode !== 'union-generation' || !this.unionStager?.prepareRecovery || !unionCurrentReference));
        return {
            name: bundle.name, title: typeof bundle.meta?.title === 'string' ? bundle.meta.title : bundle.name, version: bundle.version ?? null,
            sourceKind, registry: lineage?.origin ?? null, doctorArchive:!!lineage, unionGeneration, runtimePackaging:knownUnion?'union-dependency-generation':'original', installed: bundle.installed, enabled: bundle.enabled,
            state: observed.state, activeRows: observed.activeRows, totalRows: observed.totalRows,
            canUpdate: reasons.length === 0 && (sourceKind === 'registry' || knownUnion),
            canMigrate: !!lineage && bundle.name!==SELF && bundle.name!=='dsh-plugin-wsl-env' && !knownUnion && bundle.removable && !bundle.readOnlyReason && !bundle.error && bundle.availability==='profile' && !(this.hmrAvailable&&bundle.name==='dsh-union-search') && !recovery && !this.identities.warning,
            canRestore: bundle.name !== SELF && !!bundle.removable && recoveryAdmitted,
            restoreVersion: recoveryAdmitted ? recovery.from : null, recoveryId: recoveryAdmitted ? recovery.id : null, reasons,
        };
    }
    async list() {
        const { bundles, rows } = await this.snapshot();
        const visible = bundles.filter(bundle => bundle.installed || bundle.name === SELF).map(bundle => this.summary(bundle, rows));
        for (const [name, recovery] of this.identities.recoveries) if (!visible.some(bundle => bundle.name === name)) {
            const raw = bundles.find(bundle => bundle.name === name);
            const unknownRegistry = ['registry-spec','registry-migration','union-generation'].includes(recovery.installMode) && recovery.status === 'unknown';
            const matches = recovery.status !== 'prepared' && recovery.expectedFingerprint === this.fingerprint(raw);
            const recoveryBlocked = unknownRegistry || this.identities.warning || (name === 'dsh-union-search' && this.hmrAvailable);
            if (matches) visible.push({ name, title: name, version: raw?.version ?? null, installed: false, enabled: false, sourceKind: 'registry', state: 'missing',
                activeRows: 0, totalRows: 0, canUpdate: false, canRestore: name !== SELF && !recoveryBlocked, restoreVersion:recoveryBlocked?null:recovery.from, recoveryId:recoveryBlocked?null:recovery.id,
                reasons:[unknownRegistry?'registry-update-outcome-unknown':'recorded-recovery-only', ...(name === 'dsh-union-search' && this.hmrAvailable ? ['dependency-runtime-reload-unverified'] : []), ...(this.identities.warning ? ['identity-store-unverified'] : [])] });
        }
        const selfUpdate = await this.selfUpdate?.state();
        return this.redact({ profile: this.profile.name, runtimeVersion: this.runtimeVersion, selfUpdate,
            bundles: visible,
            busy: this.busy ? { id: this.busy.id, package: this.busy.package, phase: this.busy.phase } : null,
            externalBusy: this.external.size > 0, history: this.store.list().slice(0, 20),
            persistenceWarning: this.store.warning ?? this.identities.warning, truncationWarning: this.store.truncationWarning,
            limitations: ['Host activation, package identity and this page\'s synchronization are separate observations.', 'The gate defers new formal steps; Agent setup, tool resolution, prompt assembly and independent workers are not a global execution freeze.', 'Normal registry updates preserve the npm spec through the official Host updater; the Host refetches and uses its existing fallback plan. Preflight archives do not form an exact-archive or atomic replacement.', 'WSL generation and older archive recovery remain local-source operations; old ordinary archive installations are not silently migrated.', 'Task stopping is optional and requires an additional explicit user confirmation; no process termination, forced unlocking, version exemptions or script approvals.', 'Only public npm archives are prepared as evidence; a verified source claim does not prove all Host refetch/dependency transport bytes.'] });
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
        if (name === SELF && this.selfUpdate) return this.redact(await this.selfUpdate.versions(signal));
        const { bundles, rows } = await this.snapshot();
        const bundle = bundles.find(bundle => bundle.name === name);
        if (!bundle || !this.summary(bundle, rows).canUpdate) throw new DoctorError('not-updatable', 'Only removable profile registry bundles can be updated here.');
        const query = bundle.update === 'registry' ? await readRegistryVersions(this.manager, name, signal) : await this.stager.listVersions(name, bundle.version, signal);
        if (query.status === 'listed' && !approvedPublicRegistry(query.registry)) throw new DoctorError('registry-origin-unsupported', 'Only approved public npm query origins are supported; private sources are not migrated.');
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
        if (name === SELF && operation === 'update' && this.selfUpdate) return this.selfUpdate.prepare(version, signal, { issueTicket: false });
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
            const safety = onlineSafety({ ...raw, update: summary.sourceKind === 'registry' || summary.unionGeneration ? 'registry' : raw.update }, manifest);
            if (!this.taskGate || !this.stager) safety.reasons.push('online-update-gate-unavailable');
            summaries.push({ ...summary, canUpdate: summary.canUpdate && safety.reasons.length === 0, reasons: [...new Set([...summary.reasons, ...safety.reasons])] });
        }
        const queryManager = { registries: () => this.manager.registries?.(), listVersions: async (name, options, signal) => {
            const raw = bundles.find(bundle => bundle.name === name);
            if (raw?.update === 'registry') return this.manager.listVersions(name, options, signal);
            return this.stager.listVersions(name, raw.version, signal);
        } };
        const items = await scanUpdates(queryManager, summaries, { signal });
        for(const item of items)if(item.unionGeneration && item.latestVersion && !this.unionPair(bundles.find(bundle=>bundle.name===item.name),item.latestVersion)){item.canUpdate=false;item.updateStatus='blocked';item.status='blocked';item.reasons=[...new Set([...item.reasons,'union-version-not-reviewed'])];}
        if (this.selfUpdate) {
            const selfOffer = await this.selfUpdate.scan(signal);
            const index = items.findIndex(item => item.name === SELF);
            if (index !== -1) items[index] = { ...items[index], ...selfOffer };
        }
        return this.redact({ profile: this.profile.name, runtimeVersion: this.runtimeVersion, items, taskPolicy: 'wait-for-idle' });
    }
    async sourceFor(name, signal, expectedRegistry) {
        const { bundles } = await this.snapshot(); const bundle = bundles.find(item => item.name === name);
        if (!bundle) throw new DoctorError('unknown-bundle', 'Unknown bundle.');
        const known = this.lineageOf(bundle);
        if (known) { await this.reopenReference(known); return PUBLIC_REGISTRY; }
        const query = await readRegistryVersions(this.manager, name, signal);
        if (query.status !== 'listed' || !approvedPublicRegistry(query.registry)) throw new DoctorError(query.registry == null ? 'registry-origin-unverified' : 'registry-origin-unsupported', 'The installed query source must be approved public npm; no private source is migrated.');
        if(expectedRegistry&&registryOrigin(query.registry)!==registryOrigin(expectedRegistry))throw new DoctorError('registry-origin-changed','The query source changed after confirmation; check and prepare again.');
        return registryOrigin(query.registry);
    }
    async prepareBatch(items, signal) {
        if(this.identities.warning)throw new DoctorError('identity-store-unverified','Installation and recovery identities cannot be verified; inspect the official manager before any update.');
        if (this.busy || this.external.size || this.closed) throw new DoctorError('busy', 'Another plugin operation is running.');
        if (!Array.isArray(items) || items.length === 0 || items.length > 20) throw new DoctorError('invalid-batch', 'Select between 1 and 20 compatible plugin updates.');
        if (items.some(item => item?.name === SELF)) throw new DoctorError('self-update-separate-confirmation', 'Self-updates require a separate Host handoff; never mix them with normal batches.');
        await this.selfUpdate?.assertNoPending();
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
            if(this.hmrAvailable&&item.name==='dsh-union-search'&&!this.unionPair(raw,item.version))throw new DoctorError('dependency-runtime-reload-unverified','This Union Search target has no reviewed complete-dependency generation path.');
            if(this.identities.warning)throw new DoctorError('identity-store-unverified','Migration/recovery records cannot be verified.');
            if (!offered?.canUpdate || offered.latestVersion !== item.version || !raw) throw new DoctorError('version-not-admitted', 'Selection changed or is not the latest compatible stable version.');
            const registry = await this.sourceFor(item.name, signal);
            if(this.unionPair(raw,item.version)){
                if(registry!==PUBLIC_REGISTRY)throw new DoctorError('union-generation-public-source-required','The reviewed Union generation path currently requires the official public source.');
                const pair=await this.unionStager.stagePair({name:item.name,from:raw.version,to:item.version,packageDirectory:await this.resolvePackage(item.name),knownReference:this.lineageOf(raw),signal});
                plans.push({name:item.name,from:raw.version,to:item.version,version:item.version,enabled:raw.enabled,fingerprint:this.fingerprint(raw),registry,nextReference:this.unionStager.reference(pair.next),previousReference:this.unionStager.reference(pair.previous),baseline:pair.baseline,installMode:'union-generation',sourceMode:'derived-local-union-generation',requiresUnionGenerationAcknowledgement:true,runtimePackaging:'union-dependency-generation',highImpact:false});
                continue;
            }
            const next = await this.stager.stage(item.name, item.version, { signal, origin: registry });
            const known = this.lineageOf(raw);
            const previous = await this.stager.stage(item.name, raw.version, { signal, origin: registry });
            if (known && known.originalSha256 !== previous.originalSha256) throw new DoctorError('source-identity-unverified', 'The old public archive no longer matches the installed identity.');
            if (!known) await this.stager.verifyInstalledOriginal(previous, await this.resolvePackage(item.name));
            else await this.stager.verifyInstalledArchive(known,await this.resolvePackage(item.name));
            if(dependencyDeclaration(next.manifest)!==dependencyDeclaration(previous.manifest))throw new DoctorError('dependency-graph-changed','Dependency declaration changes need separate review; unchanged reviewed graphs are supported.');
            const dependencyGraph=await inspectDependencyGraph(await this.resolvePackage(item.name),previous.manifest,signal);
            await this.stager.preserveGenerationPair?.(next, previous, known);
            const nextReference = this.stager.reference(next), previousReference = this.stager.reference(previous);
            let observed;
            try {observed=await this.manager.registries();}catch{}
            const hostRegistryTransport = { scope:'Host owns package refetch and fallback; staged bytes are preflight evidence',
                fallbackConfigured:Array.isArray(observed?.fallbackRegistries) ? observed.fallbackRegistries.length > 0 : null };
            const installMode = raw.update === 'registry' && item.name !== 'dsh-plugin-wsl-env' ? 'registry-spec' : 'archive';
            if (installMode === 'registry-spec' && typeof this.manager.updateBundle !== 'function') throw new DoctorError('registry-handoff-unavailable', 'The public Host registry update path is unavailable.');
            if (installMode === 'registry-spec') await this.assertRegistryTransport(registry,signal);
            plans.push({ name: item.name, from: raw.version, to: item.version, version: item.version, enabled: raw.enabled,
                fingerprint: this.fingerprint(raw), registry, nextReference, previousReference, installMode, hostRegistryTransport, dependencyGraph,
                highImpact: item.name==='dsh-plugin-wsl-env', runtimePackaging: item.name==='dsh-plugin-wsl-env'?'verified-generation':'original' });
        }
        const ticket = randomUUID();
        const plan = { id: randomUUID(), operation: 'batch-update', profile: this.profile.name, items: plans,
            unionGenerationRequiresAcknowledgement:plans.some(item=>item.installMode==='union-generation'),
            mirrorRiskRequiresAcknowledgement:plans.some(item=>item.registry===PUBLIC_MIRROR),
            expiresAt: new Date(this.now() + 120_000).toISOString(), taskPolicy: 'wait-for-idle', taskPolicies: ['wait-for-idle','cancel-active'],
            warnings: ['Choose whether to wait or explicitly stop the running Agent tasks captured at confirmation. Stopping clears their queued input and cannot undo completed tool effects.', 'Normal npm updates use the official Host exact-version update path and keep registry source identity. Prepared archives are evidence; the Host downloads again using its existing registry fallback settings, not an atomic exact-archive replacement.', 'New task steps and idle-agent input wait during replacement.', 'GUI terminals and independent background workers are not automatically terminated.', 'A failure or requested Host restart stops the remaining batch. DSH is never exited automatically.', ...(plans.some(item=>item.name==='dsh-plugin-wsl-env') ? ['WSL updates use a verified runtime-generation package: original JS/assets are unchanged, but package exports and own module names use independent paths to avoid stale Host caches.'] : [])] };
        this.tickets.clear(); this.tickets.set(ticket, { batch: true, plan });
        return this.redact({ ...plan, ticket });
    }
    async prepareMigration(name, signal, {issueTicket=true}={}) {
        this.validateName(name);await this.selfUpdate?.assertNoPending();
        if(this.hmrAvailable&&name==='dsh-union-search')throw new DoctorError('dependency-runtime-reload-unverified','This known hot-reload failure cannot be bypassed by source migration.');
        if(name===SELF||name==='dsh-plugin-wsl-env')throw new DoctorError('migration-not-admitted','Self and WSL sources require their independent update paths.');
        if(this.identities.warning||this.busy||this.external.size||this.closed)throw new DoctorError('busy','Migration cannot begin while state is unavailable or another operation is running.');
        const {bundles}=await this.snapshot(),raw=bundles.find(value=>value.name===name),known=raw&&this.lineageOf(raw);
        if(!raw?.installed||!raw.removable||raw.readOnlyReason||raw.error||raw.availability!=='profile'||raw.update==='registry'||!known||this.recoveryFor(name))throw new DoctorError('migration-not-admitted','Only an identified ordinary Doctor archive without pending recovery can migrate.');
        const previous=await this.stager.reopen(known);await this.stager.verifyInstalledOriginal(previous,await this.resolvePackage(name));
        const next=await this.stager.stage(name,raw.version,{signal,origin:PUBLIC_REGISTRY});
        if(next.originalSha256!==known.originalSha256||next.runtimeGeneration)throw new DoctorError('source-identity-unverified','Migration must reinstall the identical public original version.');
        const dependencyGraph=await inspectDependencyGraph(await this.resolvePackage(name),previous.manifest,signal);
        const plan={id:randomUUID(),operation:'source-migration',profile:this.profile.name,items:[{name,from:raw.version,to:raw.version,version:raw.version,enabled:raw.enabled,fingerprint:this.fingerprint(raw),registry:PUBLIC_REGISTRY,
            previousReference:known,nextReference:this.stager.reference(next),installMode:'registry-migration',dependencyGraph}],expiresAt:new Date(this.now()+120000).toISOString(),taskPolicy:'wait-for-idle',taskPolicies:['wait-for-idle','cancel-active'],
            warnings:['This is an explicit source migration, not a newer-version update. The same reviewed version is reinstalled by npm spec to restore official Versions eligibility.','The Host downloads again; installation and recovery may fail. The previous exact local archive is retained for failure recovery.']};
        if(!issueTicket)return this.redact(plan);const ticket=randomUUID();this.tickets.clear();this.tickets.set(ticket,{batch:true,plan});return this.redact({...plan,ticket});
    }
    async prepareRestore(name, signal, { issueTicket = true } = {}) {
        if(this.identities.warning)throw new DoctorError('identity-store-unverified','Recovery identities cannot be verified; do not overwrite unknown records.');
        if(this.hmrAvailable&&name==='dsh-union-search'&&(!this.unionStager?.prepareRecovery||this.recoveryFor(name)?.installMode!=='union-generation'))throw new DoctorError('dependency-runtime-reload-unverified','Only a positively verified fresh Union generation recovery path is admitted.');
        this.validateName(name);
        if (name === SELF) throw new DoctorError('self-update-separate-confirmation', 'Self recovery is owned by the official Host manager, not ordinary recovery batches.');
        await this.selfUpdate?.assertNoPending();
        if (this.busy || this.external.size || this.closed) throw new DoctorError('busy', 'Another plugin operation is running.');
        const recovery = this.recoveryFor(name);
        if (!recovery || recovery.status === 'prepared') throw new DoctorError('no-recovery-target', 'Only a recorded failed update authorizes recovery.');
        const { bundles } = await this.snapshot(); const raw = bundles.find(item => item.name === name);
        if(recovery.installMode==='union-generation')return this.prepareUnionRestore(name,recovery,raw,signal,{issueTicket});
        if (['registry-spec','registry-migration'].includes(recovery.installMode) && recovery.status === 'unknown') throw new DoctorError('registry-update-outcome-unknown','A lost registry update result cannot authorize recovery; inspect the official manager.');
        if (recovery.expectedFingerprint !== this.fingerprint(raw)) throw new DoctorError('recovery-source-changed', 'The installed state no longer matches this failed update.');
        if (raw?.installed && (!raw.removable || raw.readOnlyReason)) throw new DoctorError('not-updatable', 'This target is protected.');
        try { await this.stager.reopen(recovery.previous); } catch { throw new DoctorError('recovery-archive-unavailable', 'The exact recorded recovery archive is missing or changed.'); }
        if (recovery.installMode === 'registry-spec') {
            await this.verifyRegistryRecoverySource({name,registry:PUBLIC_REGISTRY},await this.stager.reopen(recovery.previous),signal);
            await this.assertRegistryTransport(recovery.registry??PUBLIC_REGISTRY,signal);
        }
        const plan = { id: randomUUID(), operation: 'batch-restore', profile: this.profile.name,
            items: [{ name, from: raw?.version ?? null, to: recovery.from, version: recovery.from, enabled: recovery.enabled,
                fingerprint: this.fingerprint(raw), registry: recovery.registry??PUBLIC_REGISTRY, previousReference: recovery.previous, nextReference: recovery.previous,
                installMode: recovery.installMode === 'registry-migration' ? 'archive' : recovery.installMode ?? 'archive', originRecoveryMode:recovery.installMode, dependencyGraph:recovery.dependencyGraph,
                recoveryId: recovery.id, highImpact: name === 'dsh-plugin-wsl-env', runtimePackaging: recovery.previous.runtimeGeneration ? 'verified-generation' : 'original' }],
            expiresAt: new Date(this.now() + 120_000).toISOString(), taskPolicy: 'wait-for-idle', taskPolicies: ['wait-for-idle', 'cancel-active'],
            warnings: [recovery.installMode === 'registry-spec' ? 'Recovery reinstalls only the recorded old npm version by registry spec; the Host downloads again, and actual source/files/Host are verified afterward.' : 'Recovery uses only the exact archived old version from this failed update; it is not an arbitrary downgrade.', 'Waiting is the default. Stopping tasks requires an additional explicit confirmation.', 'Changes affect this profile. Other manager or CLI operations can still intervene between removal and installation.'] };
        if (!issueTicket) return this.redact(plan);
        const ticket = randomUUID(); this.tickets.clear(); this.tickets.set(ticket, { batch: true, plan });
        return this.redact({ ...plan, ticket });
    }
    async prepareUnionRestore(name,recovery,raw,signal,{issueTicket=true}={}) {
        if(recovery.status!=='failed'||recovery.expectedFingerprint!==this.fingerprint(raw))throw new DoctorError('union-generation-outcome-unknown','Only a known failed matching Union operation can authorize fresh recovery.');
        if(!raw?.installed||!raw.removable||raw.readOnlyReason)throw new DoctorError('union-generation-recovery-unavailable','Manual Union recovery currently requires a verifiable installed generation.');
        const currentReference=[recovery.next,recovery.previous].find(reference=>reference.version===raw.version&&archiveKey(this.unionStager.root,raw.source)===reference.archiveKey)??this.lineageOf(raw);
        if(!currentReference)throw new DoctorError('recovery-source-changed','The installed generation is not one owned by this recovery.');
        await this.unionStager.verifyInstalledArchive(currentReference,await this.resolvePackage(name),{signal});
        const staged=await this.unionStager.prepareRecovery(recovery.previous,{knownCurrentReference:currentReference,packageDirectory:await this.resolvePackage(name),signal}),nextReference=this.unionStager.reference(staged);
        const plan={id:randomUUID(),operation:'batch-restore',profile:this.profile.name,items:[{name,from:raw.version,to:recovery.from,version:recovery.from,enabled:recovery.enabled,fingerprint:this.fingerprint(raw),registry:PUBLIC_REGISTRY,nextReference,previousReference:recovery.previous,currentReference,installMode:'union-generation',sourceMode:'derived-local-union-generation',recoveryId:recovery.id,runtimePackaging:'union-dependency-generation'}],unionGenerationRequiresAcknowledgement:true,expiresAt:new Date(this.now()+120000).toISOString(),taskPolicy:'wait-for-idle',taskPolicies:['wait-for-idle','cancel-active'],warnings:['Recovery restores only the recorded original Union version using a fresh derived local generation, not the old already-executed path or npm source.','Source, resource bytes, Host and exact running namespace are verified separately; failures remain failures and unknown outcomes are not resent.']};
        if(!issueTicket)return this.redact(plan);const ticket=randomUUID();this.tickets.clear();this.tickets.set(ticket,{batch:true,plan});return this.redact({...plan,ticket});
    }
    async commitBatch(ticket, prepared, { taskPolicy = 'wait-for-idle', confirmCancel = false, confirmPublicMirror=false, confirmUnionGeneration=false } = {}) {
        if(prepared.plan.items.some(item=>item.installMode==='union-generation')&&confirmUnionGeneration!==true)throw new DoctorError('union-generation-confirmation-required','Explicit acknowledgement of derived local generation source and recovery is required.');
                if(prepared.plan.mirrorRiskRequiresAcknowledgement || prepared.plan.items.some(item=>item.registry===PUBLIC_MIRROR)) {
            if(confirmPublicMirror!==true)throw new DoctorError('self-public-mirror-confirmation-required','Explicit public mirror acknowledgement is required.');
        }
        if(this.identities.warning)throw new DoctorError('identity-store-unverified','Installation and recovery identities cannot be verified.');
        await this.selfUpdate?.assertNoPending();
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
        if(this.identities.warning)throw new DoctorError('identity-store-unverified','Refuse replacement with unverifiable identity records.');
        await this.store.put(job.record);
        const staged = [];
        // Download+validate both generations before any running plugin stops.
        for (const item of job.record.items) {
            item.status = 'preparing'; this.step(job, 'preparing-' + item.name);
            const migration=job.record.operation==='source-migration';
            const restoring = job.record.operation === 'batch-restore';
            if (item.registry != null && !approvedPublicRegistry(item.registry)) throw new DoctorError('registry-origin-unsupported', 'The confirmed query source is not approved public npm.');
            if (!item.nextReference || !item.previousReference) throw new DoctorError('missing-prepared-archive', 'All exact archives must be prepared before user confirmation.');
            if (!restoring && !migration) await this.sourceFor(item.name, job.controller.signal,item.registry);
            const next = await this.reopenReference(item.nextReference);
            const previous = await this.reopenReference(item.previousReference);
            const { bundles } = await this.snapshot(); const raw = bundles.find(bundle => bundle.name === item.name);
            const admission = raw ?? { name: item.name, version: item.to, removable: true, availability: 'profile', installed: false, update: 'registry' };
            if (onlineSafety({ ...admission, update: 'registry', version: item.to }, next.manifest).reasons.length || (!restoring && onlineSafety({ ...admission, update:'registry', version: item.from }, previous.manifest).reasons.length)) throw new DoctorError('unsafe-runtime-update', 'Staged package changes Host/shared/native dependencies; online replacement is blocked.');
            const liveRows = (await this.manager.listPlugins());
            const currentIds = new Set((raw?.rows ?? []).map(row=>row.rowId));
            for (const row of next.rows ?? []) if (liveRows.some(live=>live.patchId === row.id && !currentIds.has(row.id))) throw new DoctorError('row-id-collision', 'Target bundle conflicts with another existing Host row.');
            const oldPeers = previous.manifest.peerDependencies ?? {}, newPeers = next.manifest.peerDependencies ?? {};
            const wslGeneration = !!next.runtimeGeneration && !!previous.runtimeGeneration && item.name === 'dsh-plugin-wsl-env';
            const reviewedUnionPeerChange=item.name==='dsh-union-search'&&item.from==='0.10.24'&&item.to==='0.10.25'
                &&previous.originalSha256==='b1e412d69fb79de5b96de50268df640de27d01d0f89f41886ef3a16029cd0f47'&&next.originalSha256==='9de39d37a1594b10f3a074b7289232b29089d46fa18f674632f30ba1a24c2926'
                &&JSON.stringify(Object.keys(oldPeers).sort())===JSON.stringify(Object.keys(newPeers).sort());
            if (!wslGeneration && !reviewedUnionPeerChange && JSON.stringify(Object.entries(oldPeers).sort()) !== JSON.stringify(Object.entries(newPeers).sort())) throw new DoctorError('peer-graph-change', 'Changed peer dependency graph requires separate review.');
            if (wslGeneration && JSON.stringify(Object.keys(oldPeers).sort()) !== JSON.stringify(Object.keys(newPeers).sort())) throw new DoctorError('peer-graph-change','New WSL runtime peers require separate review.');
            if(item.dependencyGraph)assertSameDependencyGraph(item.dependencyGraph,await inspectDependencyGraph(await this.resolvePackage(item.name),previous.manifest,job.controller.signal));
            staged.push({ item, next, previous }); item.status = 'waiting';
            item.nextReference = this.stageOwner(item.nextReference).reference(next); item.previousReference = this.stageOwner(item.previousReference).reference(previous);
        }
        for(const stagedItem of staged)if(stagedItem.item.installMode==='union-generation'){if(job.record.operation==='batch-restore'){if(stagedItem.item.baseline)await this.unionStager.verifyBaseline(stagedItem.item.baseline,await this.resolvePackage(stagedItem.item.name),job.controller.signal);}else {const raw=(await this.snapshot()).bundles.find(bundle=>bundle.name===stagedItem.item.name);if(!this.unionPair(raw,stagedItem.item.to))throw new DoctorError('union-version-not-reviewed','The reviewed Union pair changed.');await this.unionStager.verifyBaseline(stagedItem.item.baseline,await this.resolvePackage(stagedItem.item.name),job.controller.signal);}}
        // Revalidate before the irreversible user-confirmed task cancellation.
        if (this.closed || this.external.size) throw new DoctorError('busy','Plugin state changed before task handling.');
        const currentSnapshot = await this.snapshot();
        for (const { item, next, previous } of staged) {
            const current = currentSnapshot.bundles.find(bundle=>bundle.name===item.name);
            if (this.fingerprint(current)!==item.fingerprint) throw new DoctorError('state-changed','Plugin state changed before stopping tasks.');
            await this.stageOwner(item.nextReference).verify(next); await this.stageOwner(item.previousReference).verify(previous);
            if(job.record.operation==='source-migration')await this.stager.verifyInstalledArchive(item.previousReference,await this.resolvePackage(item.name));
            if(item.name==='dsh-plugin-wsl-env'&&this.lineageOf(current))await this.stager.verifyInstalledArchive(this.lineageOf(current),await this.resolvePackage(item.name));
            if(item.dependencyGraph)assertSameDependencyGraph(item.dependencyGraph,await inspectDependencyGraph(await this.resolvePackage(item.name),previous.manifest,job.controller.signal));
            if (current?.installed) {
                const locks = await this.probeLocks(await this.resolvePackage(item.name), { signal:job.controller.signal });
                if (locks.files?.some(file=>file.probe==='sharing-violation')) throw new DoctorError('file-sharing-conflict','File sharing conflict observed before task handling.');
            }
            if (job.record.operation !== 'batch-restore') {
                const unresolved=this.recoveryFor(item.name);
                if(unresolved&&['registry-spec','registry-migration','union-generation'].includes(unresolved.installMode)&&unresolved.status==='unknown')throw new DoctorError('registry-update-outcome-unknown','The previous registry update has no final result.');
                const recovery = { id: randomUUID(), failedBatchId: job.id, name: item.name, from: item.from, to: item.to, enabled: item.enabled,
                    previous: item.previousReference, next: item.nextReference, registry:item.registry, dependencyGraph:item.dependencyGraph, installMode:item.installMode ?? 'archive', status: 'prepared', expectedFingerprint: item.fingerprint };
                await this.identities.prepare(recovery); item.recoveryId = recovery.id;
            }
        }
        if (job.record.operation !== 'batch-restore' && job.record.operation!=='source-migration') for (const { item } of staged) {
            await this.sourceFor(item.name,job.controller.signal,item.registry);
            if (item.installMode === 'registry-spec') await this.assertRegistryTransport(item.registry,job.controller.signal);
        }
        else for (const {item,next} of staged) if(item.installMode==='registry-spec') {
            await this.verifyRegistryRecoverySource(item,next,job.controller.signal);
            await this.assertRegistryTransport(item.registry,job.controller.signal);
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
                await this.stageOwner(item.nextReference).verify(next); await this.stageOwner(item.previousReference).verify(previous);
                if(item.name==='dsh-plugin-wsl-env'&&this.lineageOf(current))await this.stager.verifyInstalledArchive(this.lineageOf(current),await this.resolvePackage(item.name));
                if (current?.installed) {
                    const locks = await this.probeLocks(await this.resolvePackage(item.name), { signal });
                    if (locks.files?.some(file=>file.probe==='sharing-violation')) { item.status='failed'; item.diagnostic='file-sharing-conflict-observed'; item.locks=this.redact(locks); stopped=true; continue; }
                }
                if (job.record.operation === 'batch-restore') {
                    try {await this.performRecovery(job,item,next,current);}
                    catch(error) {
                        if(item.installMode==='union-generation'){if(item.unionDispatchStarted){item.status='unknown';item.unionOutcomeUnknown=true;item.result={application:'unknown',error:{code:'union-generation-outcome-unknown',diagnostic:this.redact(String(error?.message??error))}};}else{item.status='skipped';item.result={application:'failed',error:{code:'union-generation-preflight-failed',diagnostic:this.redact(String(error?.message??error))}};}}else {
                        if(item.installMode!=='registry-spec'&&item.originRecoveryMode!=='registry-migration')throw error;
                        item.status='unknown';item.registryOutcomeUnknown=true;item.result={application:'unknown',error:{code:'registry-update-outcome-unknown',diagnostic:this.redact(String(error?.message??error))}};
                        }
                    }
                    stopped = item.status !== 'restored'; continue;
                }
                if (job.record.operation !== 'batch-restore' && job.record.operation!=='source-migration') await this.sourceFor(item.name, signal,item.registry);
                item.status = 'updating'; this.step(job, 'updating-' + item.name);
                if (item.installMode === 'union-generation') {
                    try { await this.performUnionGeneration(job,item,next,previous); }
                    catch(error){if(item.unionDispatchStarted){item.status='unknown';item.unionOutcomeUnknown=true;item.result=item.result??{application:'unknown',error:{code:'union-generation-outcome-unknown',diagnostic:this.redact(String(error?.message??error))}};}else{item.status='skipped';item.result={application:'failed',error:{code:'union-generation-preflight-failed',diagnostic:this.redact(String(error?.message??error))}};}}
                    stopped=item.status!=='updated';continue;
                }
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
                if (item.installMode === 'registry-migration') {
                    try{await this.performMigration(job,item,next,previous);}catch(error){item.status='unknown';item.registryOutcomeUnknown=true;const issue={application:'unknown',error:{code:'migration-outcome-unknown',diagnostic:this.redact(String(error))}};if(item.result)item.restore=issue;else item.result=issue;}
                    stopped=item.status!=='updated';continue;
                }
                if (item.installMode === 'registry-spec') {
                    try {await this.performRegistryUpdate(job,item,next,previous);}
                    catch(error) {
                        item.status='unknown';item.registryOutcomeUnknown=true;
                        item.result={application:'unknown',error:{code:'registry-update-outcome-unknown',diagnostic:this.redact(String(error?.message??error))}};
                    }
                    stopped = item.status !== 'updated';
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
            : job.record.items.some(item => item.status === 'unknown') ? 'unknown'
            : job.record.items.some(item => item.status === 'restart-required') ? 'restart-required' : 'failed';
        await this.store.put(job.record);
    }
    async assertRegistryTransport(registry, signal) {
        // The chosen query must be public npm, but the Host owns its existing
        // fallback/dependency transport. Preflight bytes do not constrain refetch.
        if (!approvedPublicRegistry(registry)) throw new DoctorError('registry-origin-unsupported','The confirmed query origin is not an approved public npm source.');
        signal?.throwIfAborted();
    }
    expectedHostState(bundle, rows, expectedRows = []) {
        // A deselected bundle contributes no live Loader rows. Selected bundles
        // may retain independently disabled rows; only enabled rows must be active.
        const observations = expectedRows.map(expected => ({ expected, live: rows.find(row =>
            row.patchId === expected.id || row.entryId === 'include:' + expected.id) }));
        const identityMatches = expectedRows.length > 0 && observations.every(({ expected, live }) =>
            !live ? bundle?.enabled === false : live.moduleName === expected.name
                && typeof live.enabled === 'boolean' && (live.enabled ? bundle?.enabled === true : live.fiberPhase !== 'active'));
        const enabled = observations.filter(({ live }) => live?.enabled === true);
        const activeRows = enabled.filter(({ live }) => live.fiberPhase === 'active').length;
        const verified = identityMatches && activeRows === enabled.length;
        return { verified, status: verified ? enabled.length ? 'active' : 'disabled' : 'unknown', activeRows, totalRows:expectedRows.length };
    }
    async verifyRegistryInstalled(item, staged, result, field = 'verification') {
        const { bundles, rows } = await this.snapshot();
        const bundle = bundles.find(value => value.name === item.name);
        const sourceMatches = bundle?.installed === true && bundle.update === 'registry' && bundle.version === staged.version
            && bundle.source === `${item.name}@${staged.version}` && bundle.enabled === item.enabled;
        let bytesMatch = false;
        if (sourceMatches) {
            try {
                await this.stager.verifyInstalledOriginal(staged, await this.resolvePackage(item.name));
                if(item.dependencyGraph)assertSameDependencyGraph(item.dependencyGraph,await inspectDependencyGraph(await this.resolvePackage(item.name),staged.manifest));
                bytesMatch = true;
            } catch {}
        }
        const expectedRows = staged.rows ?? [];
        const host = this.expectedHostState(bundle, rows, expectedRows);
        const hostMatches = sourceMatches && host.verified;
        item[field] = {
            package:{status:bytesMatch ? 'verified' : 'failed', version:bundle?.version ?? null, expectedVersion:staged.version},
            source:{status:sourceMatches ? 'verified' : 'failed', expectedKind:'registry', kind:bundle?.update ?? 'unknown', officialVersionCheckEligible:sourceMatches},
            host:{status:hostMatches ? host.status : 'unknown', activeRows:host.activeRows, totalRows:host.totalRows},
        };
        if (result?.application === 'applied' && (!bytesMatch || !hostMatches)) return { ...result, observedApplication:'applied', application:'failed', error:{code:'registry-installed-state-mismatch',diagnostic:'Registry source, exact version, original file bytes and expected Host rows were not all verified.'} };
        return result;
    }
    async performMigration(job,item,next,previous) {
        const current=(await this.snapshot()).bundles.find(value=>value.name===item.name),known=current&&this.lineageOf(current);
        if(!known||this.fingerprint(current)!==item.fingerprint||known.sha256!==item.previousReference.sha256)throw new DoctorError('migration-state-changed','The identified archive changed before migration.');
        await this.stager.verifyInstalledOriginal(previous,await this.resolvePackage(item.name));
        if(item.dependencyGraph)assertSameDependencyGraph(item.dependencyGraph,await inspectDependencyGraph(await this.resolvePackage(item.name),previous.manifest,job.controller.signal));
        const recovery=this.recoveryFor(item.name);await this.identities.prepare({...recovery,dispatchStarted:true});
        if(this.fingerprint((await this.snapshot()).bundles.find(value=>value.name===item.name))!==item.fingerprint)throw new DoctorError('migration-state-changed','Archive target changed before migration dispatch.');
        job.activeInstall={name:item.name,requestId:job.id,recovery:false};
        let removed;try{removed=await this.manager.removeBundle(item.name);}catch(error){item.status='unknown';item.registryOutcomeUnknown=true;item.result={application:'unknown',error:{code:'migration-outcome-unknown',diagnostic:this.redact(String(error))}};return;}
        if(!removed||!['applied','failed','cancelled','restart-required','overridden'].includes(removed.application)){item.result={application:'unknown'};item.status='unknown';item.registryOutcomeUnknown=true;return;}
        if(removed.application!=='applied'){item.result=removed;item.status=removed.application==='restart-required'?'restart-required':'failed';return;}
        if((await this.snapshot()).bundles.find(value=>value.name===item.name)?.installed){item.status='failed';item.diagnostic='external-target-appeared';return;}
        let result;try{result=await this.manager.installBundle(`${item.name}@${item.to}`,{registry:item.registry,expected:{name:item.name,version:item.to},enabled:item.enabled,saveExact:true,requestId:job.id});}catch(error){item.status='unknown';item.registryOutcomeUnknown=true;item.result={application:'unknown',error:{code:'migration-outcome-unknown',diagnostic:this.redact(String(error))}};return;}
        if(!result||!['applied','failed','cancelled','restart-required','overridden'].includes(result.application)){item.status='unknown';item.registryOutcomeUnknown=true;item.result={application:'unknown'};return;}
        item.result=await this.completeResult(await this.verifyRegistryInstalled(item,next,result));item.status=item.result.application==='applied'?'updated':item.result.application==='restart-required'?'restart-required':'failed';
        if(result.application==='applied'&&item.result.application!=='applied'){item.registryOutcomeUnknown=true;return;}
        if(item.status==='failed'){
            const now=(await this.snapshot()).bundles.find(value=>value.name===item.name);
            if(now?.installed){if(now.update!=='registry'||now.source!==`${item.name}@${item.to}`){item.diagnostic='external-target-not-restored';return;}await this.stager.verifyInstalledOriginal(next,await this.resolvePackage(item.name));const cleanup=await this.manager.removeBundle(item.name);if(!cleanup||!['applied','failed','cancelled','restart-required','overridden'].includes(cleanup.application)){item.restore={application:'unknown'};item.registryOutcomeUnknown=true;return;}if(cleanup.application!=='applied'){item.restore=cleanup;return;}}
            if((await this.snapshot()).bundles.find(value=>value.name===item.name)?.installed){item.diagnostic='external-target-not-restored';return;}
            const verification=item.verification;const restored=await this.manager.installBundle(previous.archivePath,{expected:{name:item.name,version:item.from},enabled:item.enabled,saveExact:true,requestId:randomUUID()});
            if(!restored||!['applied','failed','cancelled','restart-required','overridden'].includes(restored.application)){item.restore={application:'unknown'};item.registryOutcomeUnknown=true;return;}
            item.restore=await this.completeResult(await this.verifyInstalled(item,item.previousReference,restored));item.restoreVerification=item.verification;item.verification=verification;
            if(restored.application==='applied'&&item.restore.application!=='applied')item.registryOutcomeUnknown=true;
        }
        job.activeInstall=null;
    }
    async performRegistryUpdate(job, item, next, previous) {
        const current = (await this.snapshot()).bundles.find(value => value.name === item.name);
        if (current?.update !== 'registry' || this.fingerprint(current) !== item.fingerprint) throw new DoctorError('state-changed','The registry installation changed before Host handoff.');
        if(this.hmrAvailable&&item.name==='dsh-union-search')throw new DoctorError('dependency-runtime-reload-unverified','The verified Host hot-reload limitation requires an independent restart path.');
        if (typeof this.manager.updateBundle !== 'function') throw new DoctorError('registry-handoff-unavailable','The public Host update path is unavailable.');
        const recovery=this.recoveryFor(item.name);
        if(item.dependencyGraph)assertSameDependencyGraph(item.dependencyGraph,await inspectDependencyGraph(await this.resolvePackage(item.name),previous.manifest,job.controller.signal));
        if (recovery) await this.identities.prepare({...recovery,dispatchStarted:true});
        await this.assertRegistryTransport(item.registry,job.controller.signal);
        const finalCurrent=(await this.snapshot()).bundles.find(value=>value.name===item.name);
        if(this.identities.warning || this.fingerprint(finalCurrent)!==item.fingerprint || finalCurrent?.update!=='registry')throw new DoctorError('state-changed','The registry target changed during final preparation.');
        job.activeInstall = { name:item.name, requestId:job.id, recovery:false };
        item.origin = PUBLIC_REGISTRY; item.management = 'official-registry-update';
        let official;
        try { official = await this.manager.updateBundle(item.name, item.to, { registry:item.registry, requestId:job.id }); }
        catch (error) {
            item.status='unknown'; item.registryOutcomeUnknown=true;
            item.result={application:'unknown',stage:'install',error:{code:'registry-update-outcome-unknown',diagnostic:this.redact(String(error?.message ?? error))}};
            job.activeInstall=null; return;
        }
        if (!official || official.from !== item.from || official.to !== item.to || !official.result
            || (official.result.target && official.result.target !== item.name && official.result.target !== `${item.name}@${item.to}`)
            || !['applied','failed','cancelled','restart-required','overridden'].includes(official.result.application)) {
            item.status='unknown'; item.registryOutcomeUnknown=true;
            item.result={application:'unknown',error:{code:'registry-update-outcome-unknown',diagnostic:'The Host did not return a complete matching update result.'}};
            job.activeInstall=null; return;
        }
        item.officialUpdate = this.redact(official);
        item.result = await this.completeResult(await this.verifyRegistryInstalled(item,next,official.result));
        item.status = item.result.application === 'applied' ? 'updated' : item.result.application === 'restart-required' ? 'restart-required' : 'failed';
        // The Host may already have restored old bytes before returning. Target and
        // restore checks observe current disk independently, not an invented intermediate state.
        if (official.restore !== undefined) {
            if(!official.restore || (official.restore.target && official.restore.target !== item.name && official.restore.target !== `${item.name}@${item.from}`)
                || !['applied','failed','cancelled','restart-required','overridden'].includes(official.restore.application)) {
                item.restore={application:'unknown',error:{code:'registry-update-outcome-unknown'}};item.registryOutcomeUnknown=true;
            } else {
                item.restore = await this.completeResult(await this.verifyRegistryInstalled(item,previous,official.restore,'restoreVerification'));
                if(official.restore.application==='applied'&&item.restore.application!=='applied')item.registryOutcomeUnknown=true;
            }
        }
        if (official.result.application === 'applied' && item.result.application !== 'applied') item.registryOutcomeUnknown=true;
        job.activeInstall=null;
    }
    async verifyInstalled(item, staged, result) {
        const { bundles, rows } = await this.snapshot(); const bundle = bundles.find(value => value.name === item.name);
        const state = bundle ? bundleState(bundle, rows) : { state: 'missing', activeRows: 0, totalRows: 0 };
        let exact = bundle?.version === staged.version && archiveKey(this.stager.root, bundle.source) === staged.archiveKey;
        if(exact&&(item.name==='dsh-plugin-wsl-env'||item.installMode==='registry-migration'||item.originRecoveryMode==='registry-migration')&&result.application==='applied'){
            try{await this.stager.verifyInstalledArchive(staged,await this.resolvePackage(item.name));if(item.dependencyGraph)assertSameDependencyGraph(item.dependencyGraph,await inspectDependencyGraph(await this.resolvePackage(item.name),staged.manifest));}catch{exact=false;}
        }
        const expectedRows=staged.rows?.map(row=>({...row,name:new Map(staged.runtimeGeneration?.moduleAliases??[]).get(row.name)??row.name}));
        const host=expectedRows?.length ? this.expectedHostState(bundle,rows,expectedRows) : null;
        item.verification = { package: { status: exact ? 'verified' : 'failed', version: bundle?.version ?? null },
            host: host ? {status:host.status,activeRows:host.activeRows,totalRows:host.totalRows} : { status: !bundle?.enabled ? 'disabled' : state.state === 'active' ? 'active' : state.state === 'inactive' || state.state === 'partial' ? 'inactive' : 'unknown', activeRows: state.activeRows, totalRows: state.totalRows } };
        const hostMatches=host ? host.verified && bundle?.enabled===item.enabled : !item.enabled || state.state==='active';
        if (result.application === 'applied' && (!exact || !hostMatches)) return { ...result, application: 'failed', error: { code: 'installed-state-mismatch', diagnostic: 'Exact archive/version and enabled Host rows were not verified after installation.' } };
        return result;
    }
    async ownedTarget(item) {
        const bundle = (await this.snapshot()).bundles.find(value => value.name === item.name);
        return bundle?.installed && bundle.version === item.to && archiveKey(this.stageOwner(item.nextReference).root, bundle.source) === item.nextReference.archiveKey ? bundle : null;
    }
    async performRecovery(job, item, staged, current) {
        if(item.installMode==='union-generation')return performUnionRecovery(this,job,item,staged,current,this.recoveryFor(item.name));
        if(this.hmrAvailable&&item.name==='dsh-union-search')throw new DoctorError('dependency-runtime-reload-unverified','The known hot-reload limitation cannot be bypassed by recovery.');
        const recovery = this.recoveryFor(item.name);
        if (!recovery || recovery.id !== item.recoveryId || this.fingerprint(current) !== recovery.expectedFingerprint) throw new DoctorError('recovery-source-changed', 'Recovery target changed.');
        if (item.installMode === 'registry-spec') {
            await this.performRegistryRecovery(job,item,staged,current,recovery);
            return;
        }
        if(item.originRecoveryMode==='registry-migration'){
            if(current?.installed){
                if(current.update==='registry'){const reference=[recovery.previous,recovery.next].find(value=>value.version===current.version);if(!reference||current.source!==`${item.name}@${current.version}`)throw new DoctorError('recovery-source-changed','The current source is not the recorded registry target.');await this.stager.verifyInstalledOriginal(await this.stager.reopen(reference),await this.resolvePackage(item.name));}
                else await this.stager.verifyInstalledArchive(recovery.previous,await this.resolvePackage(item.name));
            }
            await this.identities.prepare({...recovery,status:'prepared',dispatchStarted:true});
            if(this.fingerprint((await this.snapshot()).bundles.find(value=>value.name===item.name))!==item.fingerprint)throw new DoctorError('recovery-source-changed','Recovery target changed before mutation.');
        }
        if (!staged.runtimeGeneration && current?.installed) {
            const removed = await this.manager.removeBundle(item.name);
            if(item.originRecoveryMode==='registry-migration'&&(!removed||!['applied','failed','cancelled','restart-required','overridden'].includes(removed.application))){item.status='unknown';item.registryOutcomeUnknown=true;item.result={application:'unknown'};return;}
            if (removed.application !== 'applied') { item.result = await this.completeResult(removed); item.status = removed.application==='restart-required'?'restart-required':'failed'; return; }
        }
        const afterRemove = (await this.snapshot()).bundles.find(value => value.name === item.name);
        if (staged.runtimeGeneration && this.fingerprint(afterRemove) !== item.fingerprint) { item.status = 'failed'; item.diagnostic = 'external-target-not-restored'; return; }
        if (!staged.runtimeGeneration && afterRemove?.installed) { item.status = 'failed'; item.diagnostic = 'external-target-appeared'; return; }
        item.status = 'updating'; this.step(job, 'restoring-' + item.name);
        // Restoration has a separate request id; cancelling an update id cannot cancel recovery.
        job.activeInstall = { name: item.name, requestId: randomUUID(), recovery: true };
        let result = await this.manager.installBundle(staged.archivePath, { enabled: item.enabled, saveExact: true, expected: { name: item.name, version: item.to }, requestId: job.activeInstall.requestId });
        if(item.originRecoveryMode==='registry-migration'&&(!result||!['applied','failed','cancelled','restart-required','overridden'].includes(result.application))){item.status='unknown';item.registryOutcomeUnknown=true;item.result={application:'unknown'};return;}
        if (staged.runtimeGeneration) result = await this.verifyGeneration(item, staged, result);
        const observedArchiveApplication=result.application;
        result = await this.verifyInstalled(item, item.nextReference, result);
        if(item.originRecoveryMode==='registry-migration'&&observedArchiveApplication==='applied'&&result.application!=='applied')item.registryOutcomeUnknown=true;
        item.result = await this.completeResult(result); item.status = result.application === 'applied' ? 'restored' : result.application === 'restart-required' ? 'restart-required' : 'failed';
        job.activeInstall = null;
    }
    async performRegistryRecovery(job,item,staged,current,recovery) {
        if (recovery.status !== 'failed' || staged.runtimeGeneration || staged.name !== item.name || staged.version !== recovery.from) throw new DoctorError('registry-recovery-unavailable','Only a known failed registry update admits its recorded old version.');
        if (current?.installed) {
            const reference=[recovery.previous,recovery.next].find(value=>value.version===current.version);
            if (current.update !== 'registry' || current.source !== `${item.name}@${current.version}` || !reference) throw new DoctorError('recovery-source-changed','The registry recovery target is not the recorded package.');
            await this.stager.verifyInstalledOriginal(await this.stager.reopen(reference),await this.resolvePackage(item.name));
        }
        await this.verifyRegistryRecoverySource(item,staged,job.controller.signal);
        await this.assertRegistryTransport(item.registry,job.controller.signal);
        item.status='updating';this.step(job,'restoring-'+item.name);
        await this.identities.prepare({...recovery,status:'prepared',dispatchStarted:true});
        const finalCurrent=(await this.snapshot()).bundles.find(value=>value.name===item.name);
        if(this.identities.warning||this.fingerprint(finalCurrent)!==item.fingerprint)throw new DoctorError('recovery-source-changed','Recovery target changed during final preparation.');
        if (current?.installed) {
            let removed;
            try {removed=await this.manager.removeBundle(item.name);}catch(error){item.status='unknown';item.registryOutcomeUnknown=true;item.result={application:'unknown',error:{code:'registry-update-outcome-unknown',diagnostic:this.redact(String(error?.message??error))}};return;}
            if (!removed || !['applied','failed','cancelled','restart-required','overridden'].includes(removed.application)) {item.status='unknown';item.registryOutcomeUnknown=true;item.result={application:'unknown',error:{code:'registry-update-outcome-unknown'}};return;}
            if (removed.application !== 'applied') {item.result=await this.completeResult(removed);item.status=removed.application==='restart-required'?'restart-required':'failed';return;}
        }
        if ((await this.snapshot()).bundles.find(value=>value.name===item.name)?.installed) {item.status='failed';item.diagnostic='external-target-appeared';return;}
        job.activeInstall={name:item.name,requestId:randomUUID(),recovery:true};
        let result;
        try { result=await this.manager.installBundle(`${item.name}@${item.to}`,{registry:item.registry,enabled:item.enabled,saveExact:true,expected:{name:item.name,version:item.to},requestId:job.activeInstall.requestId}); }
        catch(error) {item.status='unknown';item.registryOutcomeUnknown=true;item.result={application:'unknown',error:{code:'registry-update-outcome-unknown',diagnostic:this.redact(String(error?.message??error))}};job.activeInstall=null;return;}
        if (!result || !['applied','failed','cancelled','restart-required','overridden'].includes(result.application)) {
            item.status='unknown';item.registryOutcomeUnknown=true;item.result={application:'unknown',error:{code:'registry-update-outcome-unknown',diagnostic:'The Host returned no complete registry recovery result.'}};job.activeInstall=null;return;
        }
        const observed=result.application;
        result=await this.verifyRegistryInstalled(item,staged,result);
        if(observed==='applied'&&result.application!=='applied')item.registryOutcomeUnknown=true;
        item.result=await this.completeResult(result);item.status=result.application==='applied'?'restored':result.application==='restart-required'?'restart-required':'failed';
        job.activeInstall=null;
    }
    async verifyRegistryRecoverySource(item,staged,signal) {
        const fetched=await this.stager.stage(item.name,staged.version,{signal,origin:item.registry??PUBLIC_REGISTRY});
        if (fetched.originalSha256 !== staged.originalSha256) throw new DoctorError('recovery-archive-changed','The recorded public old version changed.');
        signal?.throwIfAborted();
    }
    async performUnionGeneration(job,item,next,previous){return performUnionGeneration(this,job,item,next,previous);}
    async persistItemOutcome(job, item) {
        const recovery = this.recoveryFor(item.name);
        if (!recovery) return;
        const bundle = (await this.snapshot()).bundles.find(value => value.name === item.name);
        if(item.installMode==='union-generation')return persistUnionOutcome(this,job,item,bundle,recovery);
        if (['registry-spec','registry-migration'].includes(item.installMode)||item.originRecoveryMode==='registry-migration') {
            let retainedArchive = null;
            if (item.installMode === 'registry-migration' && bundle) {
                const known = this.lineageOf(bundle);
                if (known) try { await this.stager.verifyInstalledArchive(known,await this.resolvePackage(item.name)); retainedArchive=known; } catch {}
            }
            if (item.registryOutcomeUnknown || item.status === 'unknown') {
                await this.identities.settle(item.name,null,{...recovery,status:'unknown',expectedFingerprint:this.fingerprint(bundle)});
                delete item.recoveryId; delete item.restoreVersion; return;
            }
            if((item.installMode==='registry-migration'&&item.restore?.application==='applied')||(item.originRecoveryMode==='registry-migration'&&item.status==='restored')) {
                const oldKey=archiveKey(this.stager.root,bundle?.source);
                if(bundle?.version===item.previousReference.version&&oldKey===item.previousReference.archiveKey){await this.identities.settle(item.name,item.previousReference,null);delete item.recoveryId;delete item.restoreVersion;return;}
            }
            if (['preparing','waiting','skipped'].includes(item.status) || item.status === 'updated' || item.status === 'restored'
                || item.restore?.application === 'applied' && item.restoreVerification?.package.status === 'verified' && item.restoreVerification?.source.status === 'verified') {
                await this.identities.settle(item.name,retainedArchive,null);delete item.recoveryId;delete item.restoreVersion;return;
            }
            const knownCurrent = bundle?.update === 'registry' && [item.to,item.from].includes(bundle.version) && bundle.source === `${item.name}@${bundle.version}`;
            let verifiedCurrent = !bundle?.installed;
            if (knownCurrent) {
                const reference = [item.nextReference,item.previousReference].find(value=>value.version===bundle.version);
                try { const staged=await this.stager.reopen(reference);await this.stager.verifyInstalledOriginal(staged,await this.resolvePackage(item.name));verifiedCurrent=true; } catch {}
            }
            const untouched = this.fingerprint(bundle) === item.fingerprint;
            await this.identities.settle(item.name,retainedArchive,verifiedCurrent || untouched ? {...recovery,status:'failed',expectedFingerprint:this.fingerprint(bundle)} : null);
            if (verifiedCurrent || untouched) {item.recoveryId=recovery.id;item.restoreVersion=recovery.from;}
            else {delete item.recoveryId;delete item.restoreVersion;}
            return;
        }
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
        if(!bundle||bundle.version!==item.to||bundle.enabled!==item.enabled)throw new DoctorError('generation-version-mismatch','Generation package version or enabled selection is not the expected target.');
        const aliases=new Map(staged.runtimeGeneration.moduleAliases);
        const host=this.expectedHostState(bundle,rows,staged.rows.map(row=>({...row,name:aliases.get(row.name)??row.name})));
        if(!host.verified)throw new DoctorError('generation-row-not-active','An expected plugin generation row did not activate consistently with its identity or disabled state.');
        if(installed.application==='applied'&&staged.archivePath){const reference=this.stager.reference(staged);await this.stager.verifyInstalledArchive(reference,await this.resolvePackage(item.name));}
        return {...reapplied,initialResult:installed,generationVerified:true,verifiedVersion:item.to};
    }
    cancelWait(id) {
        if (this.selfUpdate?.job?.id === id) return this.selfUpdate.cancelWait(id);
        const job = this.jobs.get(id);
        if (!job || job.phase !== 'waiting') throw new DoctorError('too-late', 'Only a not-yet-started batch can be cancelled.');
        job.controller.abort(new Error('waiting-cancelled')); return { cancelled: true };
    }
    async commit(ticket, choices = {}) {
        if (this.selfUpdate?.hasTicket(ticket)) return this.selfUpdate.commit(ticket, choices);
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
