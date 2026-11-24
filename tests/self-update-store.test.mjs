import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, lstat, realpath, rm, mkdir, symlink, access } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SelfUpdateStore } from '../lib/self-update-store.js';
import { makeRedactor } from '../lib/redact.js';

const SELF = 'dsh-plugin-update-doctor';
const source = 'https://registry.npmjs.org';
const target = overrides => ({ id: randomUUID(), from: '0.3.0', to: '0.3.1', registry: source, taskPolicy: 'wait-for-idle', confirmCancel: false, ...overrides });
const applied = overrides => ({ from: '0.3.0', to: '0.3.1', step: 'install', result: { changed: true, application: 'applied', stage: 'enable', target: SELF, bundle: SELF, version: '0.3.1', ...overrides } });
async function fixture(t, options = {}) {
    const temp = await realpath(tmpdir()), directory = await mkdtemp(join(temp, 'dsh-self-update-store-test-'));
    t.after(async () => {
        const actual = await realpath(directory), info = await lstat(directory);
        assert.equal(dirname(actual), temp); assert.equal(actual, resolve(directory)); assert(basename(actual).startsWith('dsh-self-update-store-test-')); assert(info.isDirectory() && !info.isSymbolicLink());
        await rm(actual, { recursive: true, force: true });
    });
    const root = join(directory, 'receipts'), redact = makeRedactor({ home: directory, profileDir: join(directory, 'profile') });
    return { directory, root, redact, store: new SelfUpdateStore(root, redact, options) };
}

test('GitHub receipts bind exact old/new commits and sanitize official Git targets', async t => {
    const { root, redact, store } = await fixture(t);
    const repository = 'elaina-agi/dsh-plugin-update-doctor', fromCommit = 'a'.repeat(40), toCommit = 'b'.repeat(40);
    const attempt = await store.start(target({ registry: undefined, sourceKind: 'git', repository, fromCommit, toCommit }));
    await store.markHandedOff(attempt.id);
    const result = applied({ application: 'failed', stage: 'install', target: `github:${repository}#${toCommit}`, error: { code: 'owned-failure' } });
    result.restore = { changed: true, application: 'applied', stage: 'enable', target: `git+https://github.com/${repository}.git#${fromCommit}`, bundle: SELF, version: '0.3.0' };
    await store.finish(attempt.id, result);
    const next = new SelfUpdateStore(root, redact), state = await next.latest();
    assert.equal(state.attempt.registry, undefined); assert.equal(state.attempt.fromCommit, fromCommit); assert.equal(state.attempt.toCommit, toCommit);
    assert.equal(state.result.result.target, SELF); assert.equal(state.result.restore.target, SELF); assert.equal(state.result.result.application, 'failed');
    const disk = await readFile(join(root, attempt.id, 'result.json'), 'utf8'); assert(!disk.includes('git+https')); assert(!disk.includes('github:'));
});

test('GitHub mixed source, malformed pin and foreign official spec never become known success', async t => {
    const { root, store } = await fixture(t);
    const git = { registry: undefined, sourceKind: 'git', repository: 'elaina-agi/dsh-plugin-update-doctor', fromCommit: 'a'.repeat(40), toCommit: 'b'.repeat(40) };
    for (const changes of [{ registry: source }, { fromCommit: 'main' }, { repository: 'other/repo' }, { toCommit: git.fromCommit }]) await assert.rejects(() => store.start(target({ ...git, ...changes })));
    await assert.rejects(() => access(root), error => error.code === 'ENOENT');
    const attempt = await store.start(target(git));
    for (const targetSpec of ['github:other/repo#' + git.toCommit, 'github:' + git.repository + '#' + git.fromCommit]) await assert.rejects(() => store.finish(attempt.id, applied({ target: targetSpec, stage: 'install' })), /self-update-official-target-invalid/);
    assert.equal((await store.latest()).result, null);
});

test('new plugin generation reads waiting and handoff without rewriting attempt, and accepts late official result', async t => {
    const { root, redact, store } = await fixture(t);
    const attempt = await store.start(target({ previousSha256: 'a'.repeat(64), nextSha256: 'b'.repeat(64) }));
    const file = join(root, attempt.id, 'attempt.json'), original = await readFile(file);
    const generation = new SelfUpdateStore(root, redact);
    assert.equal((await generation.latest()).phase, 'waiting');
    await store.markHandedOff(attempt.id);
    assert.equal((await generation.read(attempt.id)).phase, 'handed-off');
    await assert.rejects(() => store.markHandedOff(attempt.id), /self-update-already-handed-off/);
    assert((await readFile(file)).equals(original));
    await store.finish(attempt.id, applied());
    const finished = await generation.latest();
    assert.equal(finished.phase, 'finished'); assert.equal(finished.result.result.application, 'applied'); assert.equal(finished.attempt.id, attempt.id); assert(finished.handoff);
    assert((await readFile(file)).equals(original));
});

test('cross-process and timed-out pending receipts stay unknown and are never rewritten as successful', async t => {
    let now = Date.parse('2026-11-20T00:00:00.000Z');
    const { root, redact, store } = await fixture(t, { pid: 101, now: () => now });
    const attempt = await store.start(target()); await store.markHandedOff(attempt.id);
    const original = await readFile(join(root, attempt.id, 'attempt.json'));
    const other = new SelfUpdateStore(root, redact, { pid: 102, now: () => now });
    assert.equal((await other.read(attempt.id)).phase, 'unknown'); assert.equal((await other.read(attempt.id)).warning, 'self-update-interrupted');
    now += 30 * 60_000 + 1;
    assert.equal((await store.latest()).phase, 'unknown'); assert.equal((await store.latest()).warning, 'self-update-result-timeout');
    assert((await readFile(join(root, attempt.id, 'attempt.json'))).equals(original));
    await store.finish(attempt.id, applied());
    assert.equal((await other.latest()).phase, 'finished');
});

test('official target failure is retained separately from successful rollback with bounded sanitized diagnostics', async t => {
    const { root, directory, store } = await fixture(t);
    const attempt = await store.start(target()); await store.markHandedOff(attempt.id);
    const outcome = applied({ application: 'failed', error: { code: 'operation-error', diagnostic: 'Bad at ' + directory + '\\profile\\secret.json password="test-secret"' }, packageResult: { exitCode: 0, output: ('Bearer owned-secret\nC:\\Users\\Example\\private\\a.js\n').repeat(2000), logPath: directory + '/raw.log', truncated: false }, userConfig: { password: 'must-not-persist' }, warnings: Array(100).fill('Path ' + directory + '/private.json') });
    outcome.restore = { changed: true, application: 'applied', stage: 'enable', target: SELF, bundle: SELF, version: '0.3.0' };
    await store.finish(attempt.id, outcome);
    const view = await store.latest();
    assert.equal(view.result.result.application, 'failed'); assert.equal(view.result.restore.application, 'applied');
    const disk = await readFile(join(root, attempt.id, 'result.json'), 'utf8');
    assert(Buffer.byteLength(disk) <= 128 * 1024); assert(!disk.includes(directory)); assert(!disk.includes('test-secret')); assert(!disk.includes('owned-secret')); assert(!disk.includes('must-not-persist')); assert(!disk.includes('logPath')); assert(!disk.includes('C:\\\\Users'));
    assert(view.result.result.packageResult.output.length <= 8000); assert(view.result.result.warnings.length <= 12);
});

test('each result publishes once and late second writer cannot overwrite a completed outcome', async t => {
    const { root, store } = await fixture(t);
    const attempt = await store.start(target()); await store.markHandedOff(attempt.id);
    await store.finish(attempt.id, applied());
    const original = await readFile(join(root, attempt.id, 'result.json'));
    await assert.rejects(() => store.finish(attempt.id, applied({ application: 'failed' })), error => error.code === 'EEXIST');
    assert((await readFile(join(root, attempt.id, 'result.json'))).equals(original));
    await assert.rejects(() => store.start(attempt), /self-update-attempt-exists/);
    assert.equal((await store.read(attempt.id)).result.result.application, 'applied');
});

test('only settled oldest attempts are pruned at capacity and foreign files remain untouched', async t => {
    let now = Date.parse('2026-11-20T00:00:00.000Z');
    const { root, store } = await fixture(t, { maxAttempts: 3, now: () => now });
    const old = await store.start(target()); await store.markHandedOff(old.id); await store.finish(old.id, applied()); now++;
    const retained = await store.start(target()); await store.finish(retained.id, { outcome: 'cancelled', error: 'User cancelled wait' }); now++;
    const third = await store.start(target()); await store.finish(third.id, { outcome: 'failed', error: 'Preflight refused' }); now++;
    const next = await store.start(target());
    assert.equal((await readdir(root)).length, 3); assert.equal(await store.read(old.id), null); assert(await store.read(retained.id)); assert(await store.read(next.id));
    await store.finish(next.id, { outcome: 'cancelled', error: 'Cancelled' });
    for (const item of [retained, third, next]) await writeFile(join(root, item.id, 'foreign.txt'), 'untouched');
    await assert.rejects(() => store.start(target()), /self-update-capacity-reached/);
    assert.equal(await readFile(join(root, retained.id, 'foreign.txt'), 'utf8'), 'untouched');
});

test('pending or unknown attempts block another generation from starting, even after timeout', async t => {
    let now = 100000;
    const { root, redact, store } = await fixture(t, { pid: 101, now: () => now });
    const pending = await store.start(target());
    now += 2_000_000;
    const next = new SelfUpdateStore(root, redact, { pid: 102, now: () => now });
    await assert.rejects(() => next.start(target()), /self-update-pending-attempt/);
    assert.equal((await readdir(root)).length, 1); assert.equal((await next.latest()).phase, 'unknown');
    await store.markHandedOff(pending.id); await store.finish(pending.id, new Error('Host reply lost'));
    await assert.rejects(() => next.start(target()), /self-update-pending-attempt/);
});

test('pre-handoff cancellation and failure are known local outcomes, not official installation success', async t => {
    const { store } = await fixture(t);
    const cancelled = await store.start(target());
    await store.finish(cancelled.id, { outcome: 'cancelled', error: { code: 'cancelled', message: 'Waiting cancelled by user' } });
    const view = await store.read(cancelled.id);
    assert.equal(view.phase, 'finished'); assert.equal(view.result.outcome, 'cancelled'); assert.equal(view.result.result, undefined);
    const failed = await store.start(target()); await store.finish(failed.id, { outcome: 'failed', error: 'Changed before handoff' });
    assert.equal((await store.read(failed.id)).result.outcome, 'failed');
    const handed = await store.start(target()); await store.markHandedOff(handed.id);
    await assert.rejects(() => store.finish(handed.id, { outcome: 'cancelled', error: 'Do not claim Host cancellation' }), /self-update-local-outcome-after-handoff/);
    await store.finish(handed.id, new Error('Host reply lost'));
    assert.equal((await store.read(handed.id)).phase, 'unknown'); assert.equal((await store.read(handed.id)).result, null);
});

test('invalid identifiers, task consent, digest and foreign source fail before creating receipts', async t => {
    const { root, store } = await fixture(t);
    for (const value of [target({ id: '../outside' }), target({ registry: 'https://private.example.invalid' }), target({ taskPolicy: 'cancel-active', confirmCancel: false }), target({ nextSha256: 'wrong' }), target({ from: 'not-version' }), target({ pid: process.pid + 1 })]) await assert.rejects(() => store.start(value));
    await assert.rejects(() => access(root), error => error.code === 'ENOENT');
    await assert.rejects(() => store.read('../outside'), /self-update-id-invalid/);
});

test('mismatched or malformed retained records and oversized results never read as applied', async t => {
    const { root, store } = await fixture(t);
    const attempt = await store.start(target());
    await writeFile(join(root, attempt.id, 'result.json'), '{broken');
    assert.equal((await store.read(attempt.id)).phase, 'unknown'); assert.equal((await store.latest()).warning, 'self-update-read-failed');
    await writeFile(join(root, attempt.id, 'result.json'), JSON.stringify({ schemaVersion: 1, id: randomUUID(), finishedAt: new Date().toISOString(), official: applied() }));
    assert.equal((await store.read(attempt.id)).phase, 'unknown');
    for (const content of ['null', '[]', '{}']) {
        await writeFile(join(root, attempt.id, 'result.json'), content);
        assert.equal((await store.read(attempt.id)).phase, 'unknown');
    }
    await writeFile(join(root, attempt.id, 'result.json'), 'x'.repeat(128 * 1024 + 1));
    assert.equal((await store.read(attempt.id)).phase, 'unknown');
});

test('attempt identity mismatches and output target mismatch are rejected rather than merged with another attempt', async t => {
    const { root, store } = await fixture(t);
    const attempt = await store.start(target());
    await assert.rejects(() => store.finish(attempt.id, { ...applied(), to: '9.9.9' }), /self-update-result-target-mismatch/);
    await assert.rejects(() => store.finish(attempt.id, applied({ target: 'other-package' })), /self-update-official-target-invalid/);
    const corrupt = { ...attempt, id: randomUUID() }; await writeFile(join(root, attempt.id, 'attempt.json'), JSON.stringify(corrupt));
    assert.equal((await store.read(attempt.id)).phase, 'unknown');
    await assert.rejects(() => store.markHandedOff(attempt.id), /self-update-record-id-mismatch/);
});

test('linked roots are refused and no outside file is mutated', async t => {
    const { directory, store } = await fixture(t);
    const outside = join(directory, 'outside'); await mkdir(outside); await writeFile(join(outside, 'proof.txt'), 'untouched');
    await symlink(outside, store.root, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => store.start(target()), /self-update-directory-untrusted|self-update-directory-changed/);
    assert.equal(await readFile(join(outside, 'proof.txt'), 'utf8'), 'untouched');
    assert.equal((await store.latest()).phase, 'unknown');
});

test('stale owned start lock blocks rather than being force-cleared; write failure warns', async t => {
    const { root, store } = await fixture(t); await mkdir(root); await writeFile(join(root, '.start.lock'), 'owned-stale-lock');
    await assert.rejects(() => store.start(target()), /self-update-store-busy/);
    assert.equal(store.warning, 'self-update-write-failed'); assert.equal(await readFile(join(root, '.start.lock'), 'utf8'), 'owned-stale-lock');
});

test('a retained attempt cannot default absent identity or consent, and malformed handoff stays unknown', async t => {
    const { root, store } = await fixture(t);
    const attempt = await store.start(target());
    for (const key of ['pid', 'taskPolicy', 'confirmCancel', 'startedAt']) {
        const altered = { ...attempt }; delete altered[key];
        await writeFile(join(root, attempt.id, 'attempt.json'), JSON.stringify(altered));
        assert.equal((await store.read(attempt.id)).phase, 'unknown');
    }
    await writeFile(join(root, attempt.id, 'attempt.json'), JSON.stringify(attempt));
    await writeFile(join(root, attempt.id, 'handoff.json'), 'null');
    assert.equal((await store.read(attempt.id)).phase, 'unknown');
});

test('byte-budget write failure preserves pending state rather than fabricating a finished result', async t => {
    const { root, store } = await fixture(t, { maxBytes: 1024 });
    const attempt = await store.start(target()); await store.markHandedOff(attempt.id);
    await assert.rejects(() => store.finish(attempt.id, applied({ packageResult: { exitCode: 0, output: 'x'.repeat(5000), truncated: false } })), /self-update-byte-limit/);
    assert.equal(store.warning, 'self-update-write-failed');
    assert.equal((await store.read(attempt.id)).phase, 'unknown');
    assert.equal((await store.read(attempt.id)).warning, 'self-update-write-failed');
    await assert.rejects(() => access(join(root, attempt.id, 'result.json')), error => error.code === 'ENOENT');
});

test('mirror receipt binds acknowledgement registry and known-public Host plan across generations',async t=>{
    const {root,redact,store}=await fixture(t),mirror='https://registry.npmmirror.com';
    const input=target({registry:mirror,sourceMode:'public-mirror',publicMirror:true,confirmPublicMirror:true,hostRegistryPlan:{queryRegistry:mirror,registry:null,resolved:mirror,fallbackRegistries:['https://registry.npmjs.org']}});
    const attempt=await store.start(input);assert.equal(attempt.schemaVersion,2);
    const file=join(root,attempt.id,'attempt.json'),original=await readFile(file);
    await store.markHandedOff(attempt.id);await store.finish(attempt.id,applied({registries:[mirror,source,'https://user:secret@private.example.invalid/']}));
    const next=new SelfUpdateStore(root,redact),state=await next.latest();
    assert.equal(state.attempt.registry,mirror);assert.equal(state.attempt.confirmPublicMirror,true);assert.deepEqual(state.attempt.hostRegistryPlan.fallbackRegistries,[source]);
    assert.deepEqual(state.result.result.registries,[mirror,source,'<unsupported-registry>']);assert((await readFile(file)).equals(original));
});

test('mirror receipt without exact risk consent or plan cannot be created or reinterpreted',async t=>{
    const {root,store}=await fixture(t),mirror='https://registry.npmmirror.com';
    const input=target({registry:mirror,sourceMode:'public-mirror',publicMirror:true,confirmPublicMirror:true,hostRegistryPlan:{queryRegistry:mirror,registry:mirror,resolved:mirror,fallbackRegistries:[]}});
    for(const change of [{confirmPublicMirror:false},{sourceMode:undefined},{publicMirror:false},{hostRegistryPlan:undefined},{registry:'https://other-mirror.invalid'}])await assert.rejects(()=>store.start({...input,...change}));
    const attempt=await store.start(input);const file=join(root,attempt.id,'attempt.json');
    for(const change of [{schemaVersion:1},{confirmPublicMirror:false},{registry:source}]){await writeFile(file,JSON.stringify({...attempt,...change}));assert.equal((await store.read(attempt.id)).phase,'unknown');}
});

test('schema3 public fallback receipt preserves separate acknowledgement and stays immutable across generations',async t=>{
    const {root,redact,store}=await fixture(t),mirror='https://registry.npmmirror.com';
    const input=target({sourceMode:'public-fallback',publicFallback:true,confirmPublicMirror:true,hostRegistryPlan:{queryRegistry:source,registry:null,resolved:source,fallbackRegistries:[mirror]}});
    const attempt=await store.start(input);assert.equal(attempt.schemaVersion,3);assert.equal(attempt.publicMirror,undefined);
    const file=join(root,attempt.id,'attempt.json'),original=await readFile(file);
    await store.markHandedOff(attempt.id);await store.finish(attempt.id,applied({registries:[source,mirror]}));
    const next=new SelfUpdateStore(root,redact),state=await next.latest();assert.equal(state.phase,'finished');assert.equal(state.attempt.registry,source);
    assert.equal(state.attempt.publicFallback,true);assert.deepEqual(state.attempt.hostRegistryPlan.fallbackRegistries,[mirror]);assert((await readFile(file)).equals(original));
});

test('public fallback cannot be disguised as legacy official or mirror evidence',async t=>{
    const {root,store}=await fixture(t),mirror='https://registry.npmmirror.com';
    const input=target({sourceMode:'public-fallback',publicFallback:true,confirmPublicMirror:true,hostRegistryPlan:{queryRegistry:source,registry:null,resolved:source,fallbackRegistries:[mirror]}});
    for(const change of [{confirmPublicMirror:false},{publicFallback:false},{publicMirror:true},{hostRegistryPlan:undefined},{registry:mirror},{hostRegistryPlan:{queryRegistry:source,registry:source,resolved:source,fallbackRegistries:[]}}])await assert.rejects(()=>store.start({...input,...change}));
    const attempt=await store.start(input),file=join(root,attempt.id,'attempt.json');
    for(const change of [{schemaVersion:1},{schemaVersion:2},{confirmPublicMirror:false},{publicFallback:false},{sourceMode:'public-mirror'}]) {
        await writeFile(file,JSON.stringify({...attempt,...change}));assert.equal((await store.read(attempt.id)).phase,'unknown');
    }
});

test('exclusive concurrent starts never exceed the configured receipt cap', async t => {
    const { root, redact } = await fixture(t);
    const first = new SelfUpdateStore(root, redact, { maxAttempts: 1 }), second = new SelfUpdateStore(root, redact, { maxAttempts: 1 });
    const outcomes = await Promise.allSettled([first.start(target()), second.start(target())]);
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal((await readdir(root)).filter(name => name !== '.start.lock').length, 1);
});
