import { randomUUID } from 'node:crypto';
import { PUBLIC_REGISTRY, publicRegistry } from './source.js';
import { SelfUpdateStore } from './self-update-store.js';
import { parseSelfGithubSource } from './self-update-github.js';

export const SELF_UPDATE_PACKAGE = 'dsh-plugin-update-doctor';
const stable = value => /^\d+\.\d+\.\d+$/.test(value ?? '');
const failure = (code, message) => Object.assign(new Error(message), { code });

/** One user-confirmed handoff. After dispatch only the independent official manager mutates packages. */
export class SelfUpdateCoordinator {
    constructor({ manager, profile, taskGate, preflight, githubPreflight, resolvePackage, resolveYamlVersion, fingerprint, redact, storeRoot, unavailable = () => false, now = () => Date.now() }) {
        Object.assign(this, { manager, profile, taskGate, preflight, githubPreflight, resolvePackage, resolveYamlVersion, fingerprint, redact, unavailable, now });
        this.store = new SelfUpdateStore(storeRoot, redact, { now });
        this.tickets = new Map(); this.job = null; this.closed = false;
    }
    async current() {
        const [bundles, rows] = await Promise.all([this.manager.listBundles(), this.manager.listPlugins()]);
        const bundle = bundles.find(item => item.name === SELF_UPDATE_PACKAGE);
        return { bundle, rows: rows.filter(row => row.moduleName === SELF_UPDATE_PACKAGE || row.moduleName?.startsWith(SELF_UPDATE_PACKAGE + '/')) };
    }
    async assertNoPending() {
        const retained = await this.store.latest();
        if (this.job || retained?.attempt && !retained.result || retained?.warning && !retained?.attempt) throw failure('self-update-outcome-unknown', 'A self-update has no final evidence. Inspect the official manager before any new update.');
    }
    async assertAvailable() {
        if (this.closed || this.job || this.unavailable()) throw failure('busy', 'Another plugin operation is running.');
        await this.assertNoPending();
    }
    assertBundle(bundle, rows) {
        if (!bundle?.installed || !bundle.enabled || !bundle.removable || bundle.readOnlyReason || bundle.error || bundle.availability !== 'profile' || !['registry', 'git'].includes(bundle.update)) {
            throw failure('self-update-registry-required', 'Self-updates require a removable public registry or fixed-commit GitHub installation; local and unpinned sources are not migrated.');
        }
        if (bundle.update === 'git') {
            parseSelfGithubSource(bundle.source);
            if (!this.githubPreflight) throw failure('self-update-handoff-unavailable', 'GitHub commit preflight is unavailable.');
        }
        if (!stable(bundle.version) || rows.length !== 1 || rows[0].moduleName !== SELF_UPDATE_PACKAGE || !(rows[0].patchId === 'plugin-update-doctor' || rows[0].entryId === 'include:plugin-update-doctor') || !rows.every(row => row.enabled === true && row.fiberPhase === 'active')) {
            throw failure('self-update-host-not-active', 'The installed updater must have its expected active Host row.');
        }
        if (typeof this.manager.updateBundle !== 'function' || !this.taskGate || !this.preflight) throw failure('self-update-handoff-unavailable', 'Independent Host update support is unavailable.');
    }
    async versions(signal) {
        const { bundle, rows } = await this.current(); this.assertBundle(bundle, rows);
        if (bundle.update === 'git') {
            let offered;
            try { offered = await this.githubPreflight.discover({ bundle, signal }); }
            catch (error) { if (error.code !== 'self-github-no-newer-version') throw error; return { status: 'listed', sourceKind: 'git', repository: parseSelfGithubSource(bundle.source).repository, versions: [] }; }
            return { status: 'listed', sourceKind: 'git', repository: offered.repository, versions: offered.version ? [{ ...offered, bundle: true }] : [] };
        }
        const answer = await this.manager.listVersions(SELF_UPDATE_PACKAGE, undefined, signal);
        if (answer.status !== 'listed' || !publicRegistry(answer.registry)) throw failure('self-update-public-origin-required', 'Self-update version discovery must answer from the public npm origin.');
        return answer;
    }
    async checkOffer(bundle, offer, query, signal) {
        const common = { bundle, currentDirectory: await this.resolvePackage(SELF_UPDATE_PACKAGE), targetVersion: offer.version, resolvedYamlVersion: await this.resolveYamlVersion(), signal };
        if (bundle.update === 'git') return this.githubPreflight.check({ ...common, targetCommit: offer.commit });
        return this.preflight.check({ ...common, registries: await this.manager.registries(), queryRegistry: query.registry });
    }
    assertPrepared(actual, prepared) {
        if (actual.previous.sha256 !== prepared.previous.sha256 || actual.next.sha256 !== prepared.next.sha256
            || actual.sourceKind !== prepared.sourceKind || actual.fromCommit !== prepared.fromCommit || actual.toCommit !== prepared.toCommit
            || actual.nextSpec !== prepared.nextSpec) throw failure('self-update-archive-changed', 'Prepared source identities or package bytes changed; prepare a new confirmation.');
    }
    async scan(signal) {
        try {
            const { bundle, rows } = await this.current(); this.assertBundle(bundle, rows);
            const query = await this.versions(signal);
            const versions = query.versions.filter(item => stable(item.version) && item.bundle && !item.incompatible && !item.prerelease && !item.deprecated);
            await this.assertAvailable();
            if (versions.length) await this.checkOffer(bundle, versions[0], query, signal);
            return { name: SELF_UPDATE_PACKAGE, version: bundle.version, latestVersion: versions[0]?.version ?? null,
                ...(bundle.update === 'git' ? { sourceKind: 'git', repository: query.repository, branch: 'main', sourceLabel: 'GitHub main HEAD (not a release)', latestCommit: versions[0]?.commit ?? null, currentCommit: parseSelfGithubSource(bundle.source).commit } : { registry: PUBLIC_REGISTRY }),
                canUpdate: !!versions.length, status: versions.length ? 'available' : 'up-to-date', mode: 'host-self-update', reasons: [] };
        } catch (error) {
            return { name: SELF_UPDATE_PACKAGE, latestVersion: null, canUpdate: false, status: 'blocked', mode: 'host-self-update', reasons: [error.code ?? 'self-update-check-failed'] };
        }
    }
    async validateTarget(version, signal, targetCommit) {
        await this.assertAvailable();
        const { bundle, rows } = await this.current(); this.assertBundle(bundle, rows);
        const versions = await this.versions(signal);
        const offered = versions.versions.find(item => stable(item.version) && item.bundle && !item.incompatible && !item.prerelease && !item.deprecated);
        if (offered?.version !== version || bundle.update === 'git' && targetCommit !== undefined && offered.commit !== targetCommit
            || bundle.update !== 'git' && targetCommit !== undefined) throw failure('version-not-admitted', 'Choose the exact offered version and commit from the latest check.');
        const checked = await this.checkOffer(bundle, offered, versions, signal);
        return { bundle, checked, fingerprint: this.fingerprint(bundle) };
    }
    async prepare(version, signal, { issueTicket = true, targetCommit } = {}) {
        if (!stable(version)) throw failure('invalid-version', 'An exact stable version is required.');
        const { bundle, checked, fingerprint } = await this.validateTarget(version, signal, targetCommit);
        const git = bundle.update === 'git';
        const plan = { id: randomUUID(), operation: 'host-self-update', profile: this.profile.name,
            items: [{ name: SELF_UPDATE_PACKAGE, from: bundle.version, to: version, version, mode: 'host-self-update', highImpact: true,
                ...(git ? { sourceKind: 'git', repository: checked.repository, fromCommit: checked.fromCommit, toCommit: checked.toCommit } : { sourceKind: 'registry' }) }],
            expiresAt: new Date(this.now() + 120000).toISOString(), taskPolicy: 'wait-for-idle', taskPolicies: ['wait-for-idle', 'cancel-active'],
            warnings: ['This is a separate self-update, not a normal batch. The independent official Host manager performs installation and its own rollback.',
                'Current Agent tasks are coordinated before handoff. The old gate is released when the updater unloads; new tasks are not frozen throughout Host replacement.',
                git ? 'GitHub main HEAD is discovery, not a signed release. The confirmed full commit pins the target. The Host fetches it again; preflight is not an atomic byte replacement.' : 'Downloaded old/new archives are preflight evidence only. The Host downloads registry packages again; it has no exact-archive replacement or atomic compare-and-swap API.',
                ...(git ? ['GitHub package dependencies use the existing Host registry configuration. No registry migration or build-script approval is granted; Host restoration uses the old saved commit and is verified separately.'] : []),
                'The panel may disappear and reload. Missing final evidence remains unknown and is never automatically retried. If both installation and Host recovery fail, use the official manager.'] };
        if (!issueTicket) return this.redact(plan);
        const ticket = randomUUID(); this.tickets.clear(); this.tickets.set(ticket, { plan, checked, fingerprint });
        return this.redact({ ...plan, ticket });
    }
    hasTicket(ticket) { return this.tickets.has(ticket); }
    async commit(ticket, { taskPolicy = 'wait-for-idle', confirmCancel = false } = {}) {
        const prepared = this.tickets.get(ticket); this.tickets.delete(ticket);
        if (!prepared || this.now() >= Date.parse(prepared.plan.expiresAt)) throw failure('stale-confirmation', 'Self-update confirmation expired; prepare again.');
        if (!['wait-for-idle', 'cancel-active'].includes(taskPolicy) || taskPolicy === 'cancel-active' && confirmCancel !== true) throw failure('task-confirmation-required', 'Stopping tasks requires separate explicit consent.');
        await this.assertAvailable();
        const { bundle, rows } = await this.current(); this.assertBundle(bundle, rows);
        if (this.fingerprint(bundle) !== prepared.fingerprint) throw failure('state-changed', 'The updater changed since confirmation preparation.');
        if (this.job || this.closed || this.unavailable()) throw failure('busy', 'Another self-update confirmation started.');
        const id = randomUUID(), controller = new AbortController();
        const job = { id, phase: 'waiting', controller, dispatched: false, cancelTargets: taskPolicy === 'cancel-active' ? this.taskGate.cancellationTargets() : [], prepared, observedWarnings: [] };
        this.job = job;
        try {
            const source = prepared.checked.sourceKind === 'git'
                ? { sourceKind: 'git', repository: prepared.checked.repository, fromCommit: prepared.checked.fromCommit, toCommit: prepared.checked.toCommit }
                : { registry: PUBLIC_REGISTRY };
            await this.store.start({ id, name: SELF_UPDATE_PACKAGE, from: bundle.version, to: prepared.plan.items[0].to, ...source, startedAt: new Date(this.now()).toISOString(), taskPolicy, confirmCancel: taskPolicy === 'cancel-active', previousSha256: prepared.checked.previous.sha256, nextSha256: prepared.checked.next.sha256,
                ...(prepared.checked.previous.files ? { previousFiles: prepared.checked.previous.files } : {}), ...(prepared.checked.next.files ? { nextFiles: prepared.checked.next.files } : {}) });
        } catch (error) { this.job = null; throw error; }
        job.work = this.run(job, { taskPolicy, confirmCancel }).finally(() => { if (this.job === job) this.job = null; });
        job.work.catch(() => {});
        return { operationId: id, operation: 'host-self-update', phase: 'waiting' };
    }
    async run(job, policy) {
        try {
            // Recheck source, bytes and state before task cancellation and before any mutation.
            const target = job.prepared.plan.items[0].to;
            const { bundle, rows } = await this.current(); this.assertBundle(bundle, rows);
            if (this.fingerprint(bundle) !== job.prepared.fingerprint || this.unavailable()) throw failure('state-changed', 'Updater state changed before handoff.');
            const query = await this.versions(job.controller.signal);
            const offeredBeforeTasks = query.versions.find(item => stable(item.version) && item.bundle && !item.incompatible && !item.prerelease && !item.deprecated);
            if (offeredBeforeTasks?.version !== target || offeredBeforeTasks?.commit !== job.prepared.checked.toCommit) throw failure('version-not-admitted', 'Self-update offer changed before task handling.');
            const checked = await this.checkOffer(bundle, offeredBeforeTasks, query, job.controller.signal);
            this.assertPrepared(checked, job.prepared.checked);
            job.controller.signal.throwIfAborted();
            if (this.closed) throw failure('updater-unloading', 'Updater unloaded before task handling.');
            await this.taskGate.run(async gateSignal => {
                const current = await this.current(); this.assertBundle(current.bundle, current.rows);
                if (this.fingerprint(current.bundle) !== job.prepared.fingerprint || this.unavailable() || this.closed) throw failure('state-changed', 'Updater changed while waiting.');
                const refreshedQuery = await this.versions(gateSignal);
                const refreshedOffered = refreshedQuery.versions.find(item => stable(item.version) && item.bundle && !item.incompatible && !item.prerelease && !item.deprecated);
                if (refreshedOffered?.version !== target || refreshedOffered?.commit !== job.prepared.checked.toCommit) throw failure('version-not-admitted', 'Self-update offer changed while waiting.');
                const refreshed = await this.checkOffer(current.bundle, refreshedOffered, refreshedQuery, gateSignal);
                this.assertPrepared(refreshed, job.prepared.checked);
                gateSignal.throwIfAborted();
                if (this.closed || this.unavailable()) throw failure('state-changed', 'Updater unloaded before handoff.');
                job.phase = 'handing-off';
                await this.store.markHandedOff(job.id);
                gateSignal.throwIfAborted();
                if (this.closed || this.unavailable()) throw failure('state-changed', 'Updater unloaded during handoff.');
                job.phase = 'handed-off'; job.dispatched = true;
                // Capture the public manager method once. Its own ownerContext performs the package flow.
                const manager = this.manager;
                const options = refreshed.sourceKind === 'git' ? { spec: refreshed.nextSpec, requestId: job.id } : { registry: PUBLIC_REGISTRY, requestId: job.id };
                const result = await manager.updateBundle(SELF_UPDATE_PACKAGE, target, options);
                // The sole post-unload work is bounded sanitized evidence persistence.
                await this.store.finish(job.id, result);
            }, { ...policy, signal: job.controller.signal, cancelTargets: job.cancelTargets });
        } catch (error) {
            const outcomeUncertain = job.dispatched || job.phase === 'handing-off';
            try { await this.store.finish(job.id, outcomeUncertain ? error : { outcome: job.controller.signal.aborted ? 'cancelled' : 'failed', error: { message: this.redact(error.message ?? String(error)) } }); }
            catch { /* Original pending evidence remains unknown when finalization fails. */ }
        }
    }
    cancelWait(id) {
        if (!this.job || this.job.id !== id || this.job.dispatched) throw failure('too-late', 'Only a self-update that has not handed off may be cancelled.');
        this.job.controller.abort(failure('waiting-cancelled', 'Self-update waiting cancelled.')); return { cancelled: true };
    }
    async state(id) {
        const entry = id ? await this.store.read(id) : await this.store.latest();
        if (!entry?.attempt) return entry;
        const current = await this.current();
        const git = entry.attempt.sourceKind === 'git';
        const verify = async (version, files, expectedCommit) => {
            let packageStatus = 'unknown', sourceStatus = git ? 'unknown' : undefined;
            if (git) {
                try { sourceStatus = current.bundle?.update === 'git' && parseSelfGithubSource(current.bundle.source).commit === expectedCommit ? 'verified' : 'failed'; } catch { sourceStatus = 'failed'; }
            }
            const verifier = git ? this.githubPreflight : this.preflight;
            if (current.bundle?.version === version && files && typeof verifier?.verifyInstalled === 'function') {
                try {
                    await verifier.verifyInstalled({ files }, await this.resolvePackage(SELF_UPDATE_PACKAGE));
                    if (await this.resolveYamlVersion() !== '2.9.1') throw failure('self-yaml-version-unverified', 'Installed YAML changed.');
                    packageStatus = 'verified';
                } catch { packageStatus = 'failed'; }
            }
            const expectedRows = current.rows.length === 1 && current.rows[0].moduleName === SELF_UPDATE_PACKAGE && (current.rows[0].patchId === 'plugin-update-doctor' || current.rows[0].entryId === 'include:plugin-update-doctor');
            const hostStatus = current.bundle?.version === version && expectedRows && current.rows.every(row => row.enabled && row.fiberPhase === 'active') ? 'active' : 'unknown';
            return { package: { status: packageStatus, version: current.bundle?.version ?? null, expectedVersion: version }, host: { status: hostStatus, activeRows: current.rows.filter(row => row.enabled && row.fiberPhase === 'active').length, totalRows: current.rows.length },
                ...(git ? { source: { status: sourceStatus, repository: entry.attempt.repository, expectedCommit } } : {}) };
        };
        const verification = await verify(entry.attempt.to, entry.attempt.nextFiles, entry.attempt.toCommit);
        const restoreVerification = entry.result?.restore ? await verify(entry.attempt.from, entry.attempt.previousFiles, entry.attempt.fromCommit) : undefined;
        const verifiedApplied = entry.result?.result?.application === 'applied' && verification.package.status === 'verified' && verification.host.status === 'active' && (!git || verification.source.status === 'verified');
        return { ...entry, verification, restoreVerification, verifiedApplied };
    }
    async dispose() {
        this.closed = true; this.tickets.clear();
        if (this.job && !this.job.dispatched) {
            this.job.controller.abort(failure('updater-unloading', 'Updater unloaded before handoff.'));
            let timer;
            await Promise.race([this.job.work, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
            clearTimeout(timer);
        }
        // Never await/cancel Host replacement from the old plugin's disposer: it needs this teardown to finish.
        if (this.job?.dispatched) await this.taskGate.release();
    }
}
