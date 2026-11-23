import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, realpath, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { SelfUpdateCoordinator, SELF_UPDATE_PACKAGE as SELF } from '../lib/self-update.js';
import { DoctorService } from '../lib/service.js';
import { createHandler, PANEL_HEADER, PANEL_MARKER } from '../lib/http.js';
import { TaskGate } from '../lib/task-gate.js';
import { makeRedactor } from '../lib/redact.js';

const deferred = () => Promise.withResolvers();
async function fixture(t, { gate, hostFailure = false, git = false } = {}) {
    const temp = await realpath(tmpdir()), root = await mkdtemp(join(temp, 'dsh-self-coordinator-test-'));
    t.after(async () => { const actual = await realpath(root); assert.equal(actual, resolve(root)); assert.equal(dirname(actual), temp); assert(basename(actual).startsWith('dsh-self-coordinator-test-')); assert(!(await lstat(root)).isSymbolicLink()); await rm(root, { recursive: true, force: true }); });
    const bundle = { name: SELF, version: '0.3.0', source: SELF + '@0.3.0', update: 'registry', installed: true, enabled: true, removable: true, availability: 'profile' };
    const repo = 'elaina-agi/dsh-plugin-update-doctor', fromCommit = 'a'.repeat(40), toCommit = 'b'.repeat(40);
    if (git) { bundle.update = 'git'; bundle.source = `github:${repo}#${fromCommit}`; }
    const state = { source: 'https://registry.npmjs.org', failCheck: false, digest: 'b'.repeat(64), unavailable: false, commit: toCommit, noNewer: false };
    const calls = [], held = deferred(), started = deferred();
    const manager = {
        listBundles: async () => [structuredClone(bundle)],
        listPlugins: async () => [{ entryId: 'include:plugin-update-doctor', patchId: 'plugin-update-doctor', moduleName: SELF, enabled: true, fiberPhase: 'active' }],
        listVersions: async () => ({ status: 'listed', registry: state.source, versions: [{ version: '0.4.0', bundle: true }] }),
        registries: async () => ({ registry: 'https://registry.npmjs.org', resolved: 'https://registry.npmjs.org', fallbackRegistries: [] }),
        updateBundle: async (...args) => {
            calls.push(args); started.resolve(); await held.promise;
            if (hostFailure) return { from: '0.3.0', to: '0.4.0', step: 'install', result: { changed: true, application: 'failed', stage: 'enable', target: SELF, error: { code: 'owned-failure', diagnostic: 'Fixture activation failed' } }, restore: { changed: true, application: 'applied', stage: 'enable', target: SELF } };
            bundle.version = '0.4.0';
            if (git) bundle.source = args[2].spec; else bundle.source = SELF+'@0.4.0';
            return { from: '0.3.0', to: '0.4.0', step: 'install', result: { changed: true, application: 'applied', stage: 'enable', target: SELF, bundle: SELF, version: '0.4.0' } };
        },
    };
    const preflight = { verifyInstalled: async () => {}, check: async options => { assert.equal(options.queryRegistry, state.source); if (state.failCheck) throw Object.assign(Error('Changed bytes'), { code: 'owned-preflight-failed' }); return { previous: { sha256: 'a'.repeat(64), files: { 'index.js': 'a'.repeat(64) } }, next: { sha256: state.digest, files: { 'index.js': 'b'.repeat(64) } } }; } };
    const githubPreflight = {
        discover: async () => { if (state.noNewer) throw Object.assign(Error('No higher stable version'), { code: 'self-github-no-newer-version' }); return { version: '0.4.0', commit: state.commit, repository: repo, spec: `github:${repo}#${state.commit}` }; },
        check: async options => { assert.equal(options.targetCommit, state.commit); const checked = await preflight.check({ queryRegistry: state.source }); return { ...checked, sourceKind: 'git', repository: repo, fromCommit, toCommit: state.commit, previousSpec: `github:${repo}#${fromCommit}`, nextSpec: `github:${repo}#${state.commit}` }; },
        verifyInstalled: async () => {},
    };
    const fingerprint = value => JSON.stringify(value);
    const redact = makeRedactor({ home: root });
    const taskGate = gate ?? new TaskGate({ list: () => [] });
    const options = { manager, profile: { name: 'proof', dir: root, home: root }, taskGate, preflight, githubPreflight, resolvePackage: async () => root, resolveYamlVersion: async () => '2.9.1', fingerprint, redact, storeRoot: join(root, 'receipts'), unavailable: () => state.unavailable };
    const coordinator = new SelfUpdateCoordinator(options);
    const service = new DoctorService({ manager, profile: options.profile, runtimeVersion: '0.2.2-rc.5', resolvePackage: async () => root, probeLocks: async () => ({}), statePath: join(root, 'history.json'), taskGate });
    service.selfUpdate = coordinator;
    t.after(async () => { held.resolve(); await coordinator.job?.work; await coordinator.dispose(); await service.dispose(); });
    return { coordinator, options, bundle, state, calls, manager, held, started, service, taskGate, repo, fromCommit, toCommit };
}
test('GitHub self-update pins the offered commit, uses one official handoff and verifies source separately', async t => {
    const f = await fixture(t, { git: true });
    f.manager.listVersions = async () => { throw Error('GitHub must not query npm'); };
    f.manager.registries = async () => { throw Error('GitHub must not migrate the dependency registry'); };
    const offer = await f.coordinator.scan();
    assert.equal(offer.canUpdate, true); assert.equal(offer.latestCommit, f.toCommit); assert.equal(offer.sourceKind, 'git');
    const plan = await f.coordinator.prepare('0.4.0', undefined, { targetCommit: offer.latestCommit });
    assert.equal(plan.items[0].toCommit, f.toCommit); assert.equal(plan.items[0].fromCommit, f.fromCommit);
    await f.coordinator.commit(plan.ticket); await f.started.promise; const job = f.coordinator.job;
    await f.coordinator.dispose(); assert.equal(job.dispatched, true); assert.equal(f.taskGate.active, false);
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0][2].spec, `github:${f.repo}#${f.toCommit}`); assert.equal(f.calls[0][2].registry, undefined);
    f.held.resolve(); await job.work;
    const next = new SelfUpdateCoordinator(f.options), state = await next.state();
    assert.equal(state.verifiedApplied, true); assert.equal(state.verification.source.status, 'verified'); assert.equal(state.attempt.registry, undefined);
    f.bundle.source = `github:${f.repo}#${'c'.repeat(40)}`;
    const changed = await next.state(); assert.equal(changed.verification.package.status, 'verified'); assert.equal(changed.verification.source.status, 'failed'); assert.equal(changed.verifiedApplied, false);
});

test('GitHub changed same-version offer refuses stale scan and rechecks commit before task stopping', async t => {
    const f = await fixture(t, { git: true });
    await assert.rejects(() => f.coordinator.prepare('0.4.0', undefined, { targetCommit: 'c'.repeat(40) }), error => error.code === 'version-not-admitted');
    const plan = await f.coordinator.prepare('0.4.0', undefined, { targetCommit: f.toCommit });
    f.state.commit = 'c'.repeat(40);
    await f.coordinator.commit(plan.ticket); const job = f.coordinator.job; await job.work;
    assert.equal(f.calls.length, 0); assert.equal((await f.coordinator.state()).result.outcome, 'failed');
});

test('GitHub source and offered commit are rechecked after waiting and rollback verifies old pin', async t => {
    const idle = deferred();
    const agent = { status: 'running', whenIdle: () => idle.promise, runMaintenance: () => Promise.resolve() };
    const f = await fixture(t, { git: true, gate: new TaskGate({ list: () => [agent] }) });
    const plan = await f.coordinator.prepare('0.4.0'); await f.coordinator.commit(plan.ticket); const job = f.coordinator.job;
    f.state.commit = 'c'.repeat(40); agent.status = 'idle'; idle.resolve(); await job.work;
    assert.equal(f.calls.length, 0);
    const failed = await fixture(t, { git: true, hostFailure: true });
    const retry = await failed.coordinator.prepare('0.4.0'); await failed.coordinator.commit(retry.ticket); await failed.started.promise;
    const rollbackJob = failed.coordinator.job; failed.held.resolve(); await rollbackJob.work;
    const state = await failed.coordinator.state(); assert.equal(state.result.result.application, 'failed'); assert.equal(state.restoreVerification.source.status, 'verified'); assert.equal(state.verifiedApplied, false);
});

test('GitHub fixed source rejects arbitrary repo, branch and no-newer check is not an update', async t => {
    const f = await fixture(t, { git: true });
    f.state.noNewer = true; assert.equal((await f.coordinator.scan()).status, 'up-to-date');
    for (const source of ['github:other/repo#' + f.fromCommit, `github:${f.repo}#main`, 'file:C:/owned']) {
        f.bundle.source = source; const answer = await f.coordinator.scan(); assert.equal(answer.canUpdate, false); assert.equal(answer.status, 'blocked');
    }
    assert.equal(f.calls.length, 0);
});

test('GitHub HTTP accepts only offered commit identity, never arbitrary URL or spec', async t => {
    const f = await fixture(t, { git: true }), handler = createHandler(f.service);
    for (const commit of ['main', 'a'.repeat(39), 'https://github.com/other/repo']) assert.equal((await handler(post({ action: 'prepare-self-update', version: '0.4.0', commit }))).status, 400);
    const stale = await handler(post({ action: 'prepare-self-update', version: '0.4.0', commit: 'c'.repeat(40) })); assert.equal(stale.status, 400);
    const response = await handler(post({ action: 'prepare-self-update', version: '0.4.0', commit: f.toCommit })); assert.equal(response.status, 200);
    assert.equal((await response.json()).items[0].toCommit, f.toCommit); assert.equal(f.calls.length, 0);
});

const post = body => new Request('http://dsh.internal/api/plugin-update-doctor', { method: 'POST', headers: { 'content-type': 'application/json', [PANEL_HEADER]: PANEL_MARKER }, body: JSON.stringify(body) });

// Stateful mock orchestration regressions only. Real Host removal/installation is verified separately.
test('self-updates are separate confirmed Host operations; diagnostic plans never issue a ticket or mutate', async t => {
    const f = await fixture(t);
    const diagnostic = await f.service.prepare({ name: SELF, version: '0.4.0' });
    assert.equal(diagnostic.operation, 'host-self-update'); assert.equal(diagnostic.ticket, undefined); assert.equal(f.coordinator.tickets.size, 0); assert.equal(f.calls.length, 0);
    await assert.rejects(() => f.service.prepareBatch([{ name: SELF, version: '0.4.0' }, { name: 'other', version: '1.1.0' }]), error => error.code === 'self-update-separate-confirmation');
    await assert.rejects(() => f.service.prepareRestore(SELF), error => error.code === 'self-update-separate-confirmation');
    const plan = await f.coordinator.prepare('0.4.0');
    const committed = await f.service.commit(plan.ticket);
    await f.started.promise;
    assert.equal(committed.operation, 'host-self-update'); assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], SELF); assert.equal(f.calls[0][1], '0.4.0'); assert.equal(f.calls[0][2].registry, 'https://registry.npmjs.org');
    await assert.rejects(() => f.service.commit(plan.ticket), error => error.code === 'stale-confirmation');
    f.held.resolve(); await f.coordinator.job.work;
    const result = await f.coordinator.state(); assert.equal(result.result.result.application, 'applied'); assert.equal(result.verification.package.status, 'verified'); assert.equal(result.verification.host.status, 'active');
});

test('old updater teardown returns before independent Host reply and new generation reads the late result', async t => {
    const f = await fixture(t), plan = await f.coordinator.prepare('0.4.0');
    await f.coordinator.commit(plan.ticket); await f.started.promise;
    const job = f.coordinator.job;
    await f.coordinator.dispose();
    assert.equal(f.taskGate.active, false); assert.equal(job.dispatched, true); assert.equal(f.calls.length, 1);
    const next = new SelfUpdateCoordinator(f.options);
    assert.equal((await next.state()).phase, 'handed-off');
    await assert.rejects(() => next.prepare('0.4.0'), error => error.code === 'self-update-outcome-unknown');
    f.held.resolve(); await job.work;
    assert.equal((await next.state()).result.result.application, 'applied');
});

test('target failure stays failed even when Host rollback succeeds and current old Host is active', async t => {
    const f = await fixture(t, { hostFailure: true }), plan = await f.coordinator.prepare('0.4.0');
    await f.coordinator.commit(plan.ticket); await f.started.promise; const job = f.coordinator.job;
    f.held.resolve(); await job.work;
    const view = await f.coordinator.state();
    assert.equal(view.result.result.application, 'failed'); assert.equal(view.result.restore.application, 'applied'); assert.equal(view.verification.package.status, 'unknown'); assert.equal(view.verification.host.status, 'unknown');
});

test('state or archive changes refuse before task stopping and Host mutation', async t => {
    const f = await fixture(t), plan = await f.coordinator.prepare('0.4.0');
    f.bundle.enabled = false;
    await assert.rejects(() => f.coordinator.commit(plan.ticket), error => error.code === 'self-update-registry-required'); assert.equal(f.calls.length, 0);
    f.bundle.enabled = true;
    const next = await f.coordinator.prepare('0.4.0'); f.state.digest = 'c'.repeat(64);
    await f.coordinator.commit(next.ticket); const job = f.coordinator.job; await job.work;
    assert.equal(f.calls.length, 0); assert.equal((await f.coordinator.state()).result.outcome, 'failed');
});

test('stop policy requires separate consent and waiting cancellation never dispatches Host replacement', async t => {
    const idle = deferred(); let cancelled = 0;
    const agent = { status: 'running', whenIdle: () => idle.promise, cancel() { cancelled++; }, runMaintenance: async () => {} };
    const gate = new TaskGate({ list: () => [agent] });
    const f = await fixture(t, { gate }), plan = await f.coordinator.prepare('0.4.0');
    await assert.rejects(() => f.coordinator.commit(plan.ticket, { taskPolicy: 'cancel-active' }), error => error.code === 'task-confirmation-required'); assert.equal(cancelled, 0); assert.equal(f.calls.length, 0);
    const waiting = await f.coordinator.prepare('0.4.0'); const result = await f.coordinator.commit(waiting.ticket);
    const job = f.coordinator.job; f.coordinator.cancelWait(result.operationId); await job.work;
    assert.equal(f.calls.length, 0); assert.equal(cancelled, 0); assert.equal((await f.coordinator.state()).result.outcome, 'cancelled'); idle.resolve();
});

test('HTTP self preparation accepts only offered version and refuses absent panel marker or arbitrary package/spec', async t => {
    const f = await fixture(t), handler = createHandler(f.service);
    const foreign = new Request('http://dsh.internal/api/plugin-update-doctor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'prepare-self-update', version: '0.4.0' }) });
    assert.equal((await handler(foreign)).status, 403);
    for (const extra of [{ name: 'other' }, { spec: 'https://private.example/pkg.tgz' }, { path: 'C:\\private' }]) assert.equal((await handler(post({ action: 'prepare-self-update', version: '0.4.0', ...extra }))).status, 400);
    const response = await handler(post({ action: 'prepare-self-update', version: '0.4.0' })); assert.equal(response.status, 200); assert.equal((await response.json()).operation, 'host-self-update'); assert.equal(f.calls.length, 0);
});

test('cancellation during durable handoff publication never dispatches the Host update', async t => {
    const f = await fixture(t), plan = await f.coordinator.prepare('0.4.0');
    const entered = deferred(), publish = deferred(), original = f.coordinator.store.markHandedOff.bind(f.coordinator.store);
    f.coordinator.store.markHandedOff = async id => { entered.resolve(); await publish.promise; return original(id); };
    const result = await f.coordinator.commit(plan.ticket); const job = f.coordinator.job;
    await entered.promise; f.coordinator.cancelWait(result.operationId); publish.resolve(); await job.work;
    assert.equal(f.calls.length, 0); const state = await f.coordinator.state(); assert.equal(state.phase, 'unknown'); assert.equal(state.result, null);
});

test('gate deadline cancellation during handoff publication prevents Host dispatch', async t => {
    const deadline = new AbortController();
    const gate = { cancellationTargets: () => [], release: async () => {}, run: async operation => operation(deadline.signal) };
    const f = await fixture(t, { gate }), plan = await f.coordinator.prepare('0.4.0');
    const entered = deferred(), publish = deferred(), original = f.coordinator.store.markHandedOff.bind(f.coordinator.store);
    f.coordinator.store.markHandedOff = async id => { entered.resolve(); await publish.promise; return original(id); };
    await f.coordinator.commit(plan.ticket); const job = f.coordinator.job;
    await entered.promise; deadline.abort(new Error('Owned gate deadline')); publish.resolve(); await job.work;
    assert.equal(f.calls.length, 0); assert.equal((await f.coordinator.state()).phase, 'unknown');
});

test('offer and source are rechecked at handoff after waiting for idle', async t => {
    const idle = deferred();
    const agent = { status: 'running', whenIdle: () => idle.promise, runMaintenance: () => Promise.resolve() };
    const f = await fixture(t, { gate: new TaskGate({ list: () => [agent] }) }), plan = await f.coordinator.prepare('0.4.0');
    await f.coordinator.commit(plan.ticket); const job = f.coordinator.job;
    f.state.source = 'https://registry.private.example'; agent.status = 'idle'; idle.resolve(); await job.work;
    assert.equal(f.calls.length, 0); assert.equal((await f.coordinator.state()).result.outcome, 'failed');
});

test('concurrent confirmed handoffs cannot both reserve one profile', async t => {
    const f = await fixture(t), other = new SelfUpdateCoordinator(f.options);
    const first = await f.coordinator.prepare('0.4.0'), second = await other.prepare('0.4.0');
    const answers = await Promise.allSettled([f.coordinator.commit(first.ticket), other.commit(second.ticket)]);
    assert.equal(answers.filter(answer => answer.status === 'fulfilled').length, 1);
    f.held.resolve(); await Promise.all([f.coordinator.job?.work, other.job?.work]);
    assert.equal(f.calls.length, 1);
});

test('self scan distinguishes mirror no-newer state from strict official fallback refusal', async t => {
    const f=await fixture(t); f.manager.listVersions=async()=>({status:'listed',registry:null,versions:[]});
    f.manager.registries=async()=>({registry:null,resolved:'https://registry.npmmirror.com',fallbackRegistries:[]});
    let answer=await f.coordinator.scan();
    assert.equal(answer.versionStatus,'up-to-date');assert.equal(answer.updateStatus,'no-update');assert.equal(answer.registry,'https://registry.npmmirror.com');
    assert.equal(answer.publicMirror,true);assert(answer.infoWarnings.includes('public-mirror-may-lag'));assert.equal(f.calls.length,0);
    f.manager.registries=async()=>({registry:null,resolved:'https://registry.npmjs.org',fallbackRegistries:['https://registry.npmmirror.com']});
    answer=await f.coordinator.scan();assert.equal(answer.versionStatus,'up-to-date');assert(answer.reasons.includes('self-host-registry-plan-unsupported'));
});

test('null self query origin can resolve to public npm without bypassing strict preflight or saved plan', async t => {
    const f=await fixture(t);f.manager.listVersions=async()=>({status:'listed',registry:null,versions:[{version:'0.4.0',bundle:true}]});
    f.manager.registries=async()=>({registry:null,resolved:'https://registry.npmjs.org',fallbackRegistries:[]});
    assert.equal((await f.coordinator.scan()).canUpdate,true);
    const plan=await f.coordinator.prepare('0.4.0');assert(plan.ticket);assert.equal(f.calls.length,0);
});

test('self source transition during null query stays unknown and cannot issue a ticket', async t => {
    const f=await fixture(t);let step=0;
    f.manager.listVersions=async()=>({status:'listed',registry:null,versions:[]});
    f.manager.registries=async()=>({registry:null,resolved:++step%2?'https://registry.npmjs.org':'https://registry.npmmirror.com',fallbackRegistries:[]});
    const result=await f.coordinator.scan();assert.equal(result.versionStatus,'unknown');assert.equal(result.canUpdate,false);assert(result.reasons.includes('registry-origin-changed'));
    await assert.rejects(()=>f.coordinator.prepare('0.4.0'));assert.equal(f.calls.length,0);assert.equal(f.coordinator.tickets.size,0);
});

test('self fallback added after confirmation is rejected before stopping tasks and Host handoff', async t => {
    let entered=0;const f=await fixture(t,{gate:{cancellationTargets:()=>[],run:async()=>{entered++;}}});
    const plan=await f.coordinator.prepare('0.4.0');
    f.manager.registries=async()=>({registry:'https://registry.npmjs.org',resolved:'https://registry.npmjs.org',fallbackRegistries:['https://registry.npmmirror.com']});
    // This fixture replaces byte preflight; use the real source-plan guard within the stub.
    const {verifySelfRegistryPlan}=await import('../lib/self-update-policy.js');
    f.options.preflight.check=async options=>{verifySelfRegistryPlan(options.registries,options.queryRegistry);return {};};
    await f.coordinator.commit(plan.ticket,{taskPolicy:'cancel-active',confirmCancel:true});await f.coordinator.job?.work;
    assert.equal(entered,0);assert.equal(f.calls.length,0);
});

test('incomplete higher self metadata cannot issue a ticket for a lower candidate', async t => {
    const f=await fixture(t); f.manager.listVersions=async()=>({status:'listed',registry:'https://registry.npmjs.org',versions:[{version:'0.5.0',bundle:false,metadataIncomplete:true},{version:'0.4.0',bundle:true}]});
    const answer=await f.coordinator.scan();assert.equal(answer.versionStatus,'unknown');assert.equal(answer.canUpdate,false);
    await assert.rejects(()=>f.coordinator.prepare('0.4.0'));assert.equal(f.coordinator.tickets.size,0);assert.equal(f.calls.length,0);
});

test('self metadata becoming incomplete before tasks prevents cancellation and handoff', async t => {
    let entered=0;const f=await fixture(t,{gate:{cancellationTargets:()=>[],run:async()=>{entered++;}}});
    const plan=await f.coordinator.prepare('0.4.0');
    f.manager.listVersions=async()=>({status:'listed',registry:'https://registry.npmjs.org',versions:[{version:'0.5.0',metadataIncomplete:true},{version:'0.4.0',bundle:true}]});
    await f.coordinator.commit(plan.ticket,{taskPolicy:'cancel-active',confirmCancel:true});await f.coordinator.job?.work;
    assert.equal(entered,0);assert.equal(f.calls.length,0);
});

test('self metadata becoming incomplete after idle waiting prevents Host handoff', async t => {
    const f=await fixture(t,{gate:{cancellationTargets:()=>[],run:async operation=>{
        f.manager.listVersions=async()=>({status:'listed',registry:'https://registry.npmjs.org',versions:[{version:'0.5.0',metadataIncomplete:true},{version:'0.4.0',bundle:true}]});
        return operation(new AbortController().signal);
    }}});
    const plan=await f.coordinator.prepare('0.4.0');await f.coordinator.commit(plan.ticket);await f.coordinator.job?.work;assert.equal(f.calls.length,0);
});

test('self fallback added during byte preflight is caught before task handling', async t => {
    let entered=0;const f=await fixture(t,{gate:{cancellationTargets:()=>[],run:async()=>{entered++;}}});
    const plan=await f.coordinator.prepare('0.4.0'), check=f.options.preflight.check;
    f.options.preflight.check=async options=>{const checked=await check(options);f.manager.registries=async()=>({registry:'https://registry.npmjs.org',resolved:'https://registry.npmjs.org',fallbackRegistries:['https://registry.npmmirror.com']});return checked;};
    await f.coordinator.commit(plan.ticket,{taskPolicy:'cancel-active',confirmCancel:true});await f.coordinator.job?.work;
    assert.equal(entered,0);assert.equal(f.calls.length,0);
});

test('self fallback added while publishing handoff preserves unknown and never dispatches or resends', async t => {
    const f=await fixture(t), plan=await f.coordinator.prepare('0.4.0');
    const original=f.coordinator.store.markHandedOff.bind(f.coordinator.store);
    f.coordinator.store.markHandedOff=async id=>{await original(id);f.manager.registries=async()=>({registry:'https://registry.npmjs.org',resolved:'https://registry.npmjs.org',fallbackRegistries:['https://registry.npmmirror.com']});};
    await f.coordinator.commit(plan.ticket);await f.coordinator.job?.work;
    assert.equal(f.calls.length,0);assert.equal((await f.coordinator.state()).phase,'unknown');
    await assert.rejects(()=>f.coordinator.prepare('0.4.0'),error=>error.code==='self-update-outcome-unknown');
    assert.equal(f.calls.length,0);
});

test('mirror self plan requires extra consent and binds registry to one official Host handoff',async t=>{
    const f=await fixture(t),mirror='https://registry.npmmirror.com';f.state.source=mirror;
    f.manager.registries=async()=>({registry:null,resolved:mirror,fallbackRegistries:['https://registry.npmjs.org']});
    const check=f.options.preflight.check;
    const {verifySelfRegistryPlan}=await import('../lib/self-update-policy.js');
    f.options.preflight.check=async options=>({...await check(options),registry:mirror,sourceMode:'public-mirror',publicMirror:true,hostRegistryPlan:verifySelfRegistryPlan(options.registries,mirror)});
    const scan=await f.coordinator.scan();assert.equal(scan.canUpdate,true);assert.equal(scan.publicMirror,true);
    let plan=await f.coordinator.prepare('0.4.0');assert.equal(plan.mirrorRiskRequiresAcknowledgement,true);assert.equal(plan.items[0].registry,mirror);
    await assert.rejects(()=>f.coordinator.commit(plan.ticket),error=>error.code==='self-public-mirror-confirmation-required');assert.equal(f.calls.length,0);
    plan=await f.coordinator.prepare('0.4.0');await f.coordinator.commit(plan.ticket,{confirmPublicMirror:true});await f.started.promise;
    const job=f.coordinator.job;assert.equal(f.calls.length,1);assert.equal(f.calls[0][2].registry,mirror);
    f.held.resolve();await job.work;const state=await f.coordinator.state();assert.equal(state.attempt.registry,mirror);assert.equal(state.attempt.confirmPublicMirror,true);assert.equal(state.verifiedApplied,true);
});

test('mirror canonical preflight evidence is mandatory before offering an update',async t=>{
    const f=await fixture(t),mirror='https://registry.npmmirror.com';f.state.source=mirror;
    f.manager.registries=async()=>({registry:mirror,resolved:mirror,fallbackRegistries:[]});
    assert.equal((await f.coordinator.scan()).canUpdate,false);await assert.rejects(()=>f.coordinator.prepare('0.4.0'),error=>error.code==='self-public-mirror-preflight-unverified');assert.equal(f.calls.length,0);
});

test('confirmed mirror source or public fallback plan drift never reaches task handling',async t=>{
    for(const drift of ['source','fallback']){
        let entered=0;const f=await fixture(t,{gate:{cancellationTargets:()=>[],run:async()=>{entered++;}}}),mirror='https://registry.npmmirror.com';f.state.source=mirror;
        let fallbacks=['https://registry.npmjs.org'];f.manager.registries=async()=>({registry:mirror,resolved:mirror,fallbackRegistries:fallbacks});
        const check=f.options.preflight.check;const {verifySelfRegistryPlan}=await import('../lib/self-update-policy.js');
        f.options.preflight.check=async options=>({...await check(options),registry:options.queryRegistry,sourceMode:'public-mirror',publicMirror:true,hostRegistryPlan:verifySelfRegistryPlan(options.registries,options.queryRegistry)});
        const plan=await f.coordinator.prepare('0.4.0');if(drift==='source')f.state.source='https://registry.npmjs.org';else fallbacks=[];
        await f.coordinator.commit(plan.ticket,{confirmPublicMirror:true,taskPolicy:'cancel-active',confirmCancel:true});await f.coordinator.job?.work;
        assert.equal(entered,0);assert.equal(f.calls.length,0);
    }
});

test('mirror public plan changing after wait or handoff publication never dispatches',async t=>{
    for(const phase of ['after-wait','after-handoff']){
        const f=await fixture(t),mirror='https://registry.npmmirror.com';f.state.source=mirror;
        let fallbacks=['https://registry.npmjs.org'];f.manager.registries=async()=>({registry:mirror,resolved:mirror,fallbackRegistries:fallbacks});
        const check=f.options.preflight.check,{verifySelfRegistryPlan}=await import('../lib/self-update-policy.js');
        f.options.preflight.check=async options=>({...await check(options),registry:mirror,sourceMode:'public-mirror',publicMirror:true,hostRegistryPlan:verifySelfRegistryPlan(options.registries,mirror)});
        const plan=await f.coordinator.prepare('0.4.0');
        if(phase==='after-wait')f.coordinator.taskGate={cancellationTargets:()=>[],release:async()=>{},run:async operation=>{fallbacks=[];return operation(new AbortController().signal);}};
        else{const mark=f.coordinator.store.markHandedOff.bind(f.coordinator.store);f.coordinator.store.markHandedOff=async id=>{await mark(id);fallbacks=[];};}
        await f.coordinator.commit(plan.ticket,{confirmPublicMirror:true});await f.coordinator.job?.work;
        assert.equal(f.calls.length,0);if(phase==='after-handoff'){assert.equal((await f.coordinator.state()).phase,'unknown');await assert.rejects(()=>f.coordinator.prepare('0.4.0'),error=>error.code==='self-update-outcome-unknown');}
    }
});

test('private source, linked installation, busy and non-active Host never offer self-update', async t => {
    const f = await fixture(t); f.state.source = 'https://registry.private.example';
    assert.equal((await f.coordinator.scan()).canUpdate, false);
    f.state.source = 'https://registry.npmjs.org'; f.bundle.update = undefined;
    assert.equal((await f.coordinator.scan()).canUpdate, false);
    f.bundle.update = 'registry'; f.state.unavailable = true;
    assert.equal((await f.coordinator.scan()).canUpdate, false); assert.equal(f.calls.length, 0);
});
