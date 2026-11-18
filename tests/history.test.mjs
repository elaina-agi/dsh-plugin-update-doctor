import test from 'node:test';
import assert from 'node:assert/strict';
import { HistoryStore } from '../lib/history.js';
import { makeRedactor } from '../lib/redact.js';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const envelope = records => JSON.stringify({ schemaVersion: 1, records });
const envelopeBytes = records => Buffer.byteLength(envelope(records));
async function ownedStore(t, options = {}, redact = value => value) {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-history-budget-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'history.json');
    return { dir, file, store: new HistoryStore(file, redact, options) };
}
async function assertStoredBudget(store, file) {
    const text = await readFile(file, 'utf8');
    assert(Buffer.byteLength(text) <= store.maxBytes);
    assert(envelopeBytes(store.records) <= store.maxBytes);
    assert(store.records.length <= store.maxRecords);
    assert.deepEqual(JSON.parse(text).records, store.records);
}

// Both count and the complete UTF-8 JSON envelope are storage limits.
test('exact complete-envelope budget retains the latest record and evicts old records', async t => {
    const current = { id: 'new', operation: 'update', phase: 'finished', outcome: 'failed', diagnostic: '错误🙂\\n"quoted"' };
    const { store, file } = await ownedStore(t, { maxRecords: 80, maxBytes: envelopeBytes([current]) });
    await store.put({ ...current, id: 'old' });
    const returned = await store.put(current);
    assert.deepEqual(returned, current);
    assert.deepEqual(store.records, [current]);
    assert.equal(store.warning, null);
    assert.equal(store.truncationWarning, 'history-truncated');
    await assertStoredBudget(store, file);
    const loaded = new HistoryStore(file, value => value, { maxBytes: store.maxBytes });
    await loaded.load(); assert.deepEqual(loaded.records, [current]);
});
test('count and UTF-8 byte retention stay bounded across repeated large logs', async t => {
    const { store, file } = await ownedStore(t, { maxRecords: 3, maxBytes: 1600 });
    for (let i = 0; i < 15; i++) {
        const returned = await store.put({ id: 'record-' + i, operation: 'update', phase: 'finished', outcome: i % 2 ? 'failed' : 'applied', diagnostic: '汉字🙂'.repeat(1000) });
        assert.equal(returned.outcome, i % 2 ? 'failed' : 'applied');
        assert(returned.diagnostic.includes('<diagnostic-truncated>'));
        assert(returned.truncation);
        assert.deepEqual(returned, store.records[0]);
        await assertStoredBudget(store, file);
        assert.equal(store.warning, null);
    }
    assert.equal(store.records[0].id, 'record-14');
    assert.equal(store.truncationWarning, 'history-truncated');
});
test('oversized nested data compacts without changing the recorded outcome', async t => {
    const { store, file } = await ownedStore(t, { maxBytes: 800 });
    const returned = await store.put({ id: 'failed-with-nested-log', operation: 'update', phase: 'finished', outcome: 'failed',
        from: '1.0.0', to: '1.1.0', result: { application: 'failed', stage: 'enable', error: { code: 'original-error', diagnostic: 'x'.repeat(5000) } },
        irrelevant: Object.fromEntries(Array.from({ length: 180 }, (_, i) => ['key' + i, { deep: 'x'.repeat(5000) }])) });
    assert.equal(returned.outcome, 'failed'); assert.equal(returned.result.application, 'failed');
    assert.equal(returned.result.error.code, 'original-error');
    assert.equal(returned.truncation.compacted, true);
    assert.equal(returned.result.error.diagnostic, '<diagnostic-truncated>');
    assert.equal(store.warning, null); await assertStoredBudget(store, file);
});
test('I/O failure stays separate from truncation and leaves the bounded actual record', async t => {
    const { dir } = await ownedStore(t);
    const obstruction = join(dir, 'obstruction'); await writeFile(obstruction, 'fixture');
    const store = new HistoryStore(join(obstruction, 'history.json'), value => value, { maxBytes: 500 });
    const returned = await store.put({ id: 'io-failed', operation: 'update', phase: 'finished', outcome: 'failed', diagnostic: 'x'.repeat(4000) });
    assert.equal(store.warning, 'history-write-failed'); assert.equal(store.truncationWarning, 'history-truncated');
    assert.equal(returned.outcome, 'failed'); assert.deepEqual(returned, store.records[0]);
    assert(envelopeBytes(store.records) <= 500);
});
test('tiny budget refuses storage explicitly instead of lying about outcomes', async t => {
    const { store, file, dir } = await ownedStore(t, { maxBytes: 20 });
    const returned = await store.put({ id: 'cannot-fit', operation: 'update', phase: 'finished', outcome: 'failed' });
    assert.equal(returned, null); assert.deepEqual(store.records, []); assert.equal(store.warning, 'history-budget-too-small');
    assert.deepEqual(await readdir(dir), []);
    await assert.rejects(() => readFile(file), { code: 'ENOENT' });
    assert.throws(() => new HistoryStore(file, value => value, { maxRecords: 0 }), RangeError);
    assert.throws(() => new HistoryStore(file, value => value, { maxBytes: NaN }), RangeError);
});
test('same-process concurrent store instances write unique atomic siblings', async t => {
    const { store, file, dir } = await ownedStore(t, { maxBytes: 5000 });
    const second = new HistoryStore(file, value => value, { maxBytes: 5000 });
    await Promise.all([store.put({ id: 'first', outcome: 'failed' }), second.put({ id: 'second', outcome: 'applied' })]);
    assert.equal(store.warning, null); assert.equal(second.warning, null);
    const disk = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(disk.schemaVersion, 1); assert.equal(disk.records.length, 1);
    assert(['first', 'second'].includes(disk.records[0].id));
    assert.deepEqual(await readdir(dir), ['history.json']);
    // A returned record is a snapshot, not authority to mutate the store's retained facts.
    const returned = await store.put({ id: 'snapshot', outcome: 'failed' }); returned.outcome = 'applied';
    assert.equal(store.records[0].outcome, 'failed'); await assertStoredBudget(store, file);
});
test('load refuses corrupt schema and bounds transformed interrupted records', async t => {
    const { store, file } = await ownedStore(t, { maxBytes: 600, maxRecords: 2 });
    await writeFile(file, '{"schemaVersion":2,"records":[]}');
    await store.load(); assert.equal(store.warning, 'history-read-failed');
    const data = [{ id: 'running', phase: 'running', outcome: 'applied', diagnostic: 'x'.repeat(300) }, { id: 'old', phase: 'finished', outcome: 'failed' }];
    await writeFile(file, envelope(data)); await store.load();
    assert.equal(store.warning, null); assert(envelopeBytes(store.records) <= 600);
    assert.equal(store.records[0].phase, 'interrupted'); assert.equal(store.records[0].outcome, 'unknown');
});

test('default two-megabyte history keeps accepting updates after accumulated logs exceed the budget', async t => {
    const { store, file } = await ownedStore(t);
    for (let i = 0; i < 22; i++) {
        const returned = await store.put({ id: 'large-' + i, operation: 'update', phase: 'finished', outcome: 'failed', diagnostic: 'x'.repeat(180000) });
        assert.equal(returned.id, 'large-' + i); assert.equal(returned.outcome, 'failed');
        assert.equal(store.warning, null); assert(envelopeBytes(store.records) <= 2_000_000);
    }
    assert(store.records.length < 22); assert.equal(store.records[0].id, 'large-21');
    assert.equal(store.truncationWarning, 'history-truncated'); await assertStoredBudget(store, file);
    const loaded = new HistoryStore(file, value => value); await loaded.load();
    assert.equal(loaded.records[0].id, 'large-21'); assert.equal(loaded.warning, null);
});

test('single-store concurrent puts keep stored records bounded and persist the latest snapshot', async t => {
    const { store, file } = await ownedStore(t, { maxBytes: 700, maxRecords: 4 });
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => store.put({ id: 'queued-' + i, outcome: 'failed', diagnostic: '🙂'.repeat(2000) })));
    assert(results.every(result => result && result.outcome === 'failed'));
    assert.equal(store.records[0].id, 'queued-29'); assert.equal(store.warning, null);
    await assertStoredBudget(store, file);
});
test('unrepresentable metadata refuses the new record and does not retain unbounded prior state', async t => {
    const { store, file } = await ownedStore(t, { maxBytes: 200 });
    await store.put({ id: 'prior', outcome: 'failed' });
    const returned = await store.put({ id: 'huge-id-' + 'x'.repeat(5000), outcome: 'failed', items: [{ name: 'x'.repeat(5000), status: 'failed', result: { application: 'failed' } }] });
    assert.equal(returned, null); assert.equal(store.warning, 'history-record-too-large');
    assert.equal(store.records[0].id, 'prior'); await assertStoredBudget(store, file);
});

test('interrupted operations become unknown after Host restart', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-history-')); t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'history.json');
    await writeFile(file, JSON.stringify({ schemaVersion: 1, records: [{ id: 'x', phase: 'running', operation: 'update' }] }));
    const store = new HistoryStore(file, makeRedactor()); await store.load();
    assert.equal(store.records[0].phase, 'interrupted'); assert.equal(store.records[0].outcome, 'unknown');
});
test('history persistence failure does not falsely claim management success', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-history-denied-')); t.after(() => rm(dir, { recursive: true, force: true }));
    const obstructed = join(dir, 'not-a-directory'); await writeFile(obstructed, 'owned fixture');
    const store = new HistoryStore(join(obstructed, 'history.json'), makeRedactor());
    const result = await store.put({ id: 'failed', application: 'failed', diagnostic: 'password=private' });
    assert.equal(result.application, 'failed'); assert.equal(store.warning, 'history-write-failed');
    assert(!JSON.stringify(store.records).includes('private'));
});
test('oversized and corrupt history files report explicit warnings', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-doctor-history-limit-')); t.after(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, 'history.json'); await writeFile(file, 'x'.repeat(40));
    const store = new HistoryStore(file, makeRedactor(), { maxBytes: 20 }); await store.load(); assert.equal(store.warning, 'history-too-large');
});
