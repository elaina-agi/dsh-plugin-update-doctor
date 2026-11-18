import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryStore } from '../lib/history.js';

const size = records => Buffer.byteLength(JSON.stringify({ schemaVersion: 1, records }));
async function fixture(t, options = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-history-batch-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const path = join(dir, 'history.json');
    return { path, store: new HistoryStore(path, value => value, options) };
}
const item = (name, status = 'failed') => ({ name, from: '1.0.0', to: '1.1.0', version: '1.1.0', enabled: true, status,
    result: { application: status === 'updated' ? 'applied' : 'failed', stage: 'enable', error: { code: 'fixture', diagnostic: 'x'.repeat(12000) } },
    restore: { application: 'failed', stage: 'install', error: { code: 'restore-fixture', diagnostic: 'x'.repeat(12000) } },
});
test('oversized twenty-item batch retains every package identity and outcome with explicit truncation', async t => {
    const { store, path } = await fixture(t, { maxBytes: 11000 });
    const items = Array.from({ length: 20 }, (_, index) => item('plugin-' + index, index % 2 ? 'updated' : 'failed'));
    const returned = await store.put({ id: 'full-batch', operation: 'batch-update', origin: 'doctor', phase: 'finished', outcome: 'failed', items,
        steps: Array.from({ length: 600 }, () => ({ diagnostic: 'x'.repeat(10000) })) });
    assert.equal(returned.outcome, 'failed'); assert.equal(returned.items.length, 20);
    assert.deepEqual(returned.items.map(value => value.name), items.map(value => value.name));
    assert.deepEqual(returned.items.map(value => value.status), items.map(value => value.status));
    assert.deepEqual(returned.items.map(value => value.result.application), items.map(value => value.result.application));
    assert(returned.truncation.compacted); assert.equal(store.warning, null); assert.equal(store.truncationWarning, 'history-truncated');
    assert(size(store.records) <= store.maxBytes);
    assert(Buffer.byteLength(await readFile(path, 'utf8')) <= store.maxBytes);
    const view = store.list('plugin-0')[0];
    assert.equal(view.operation, 'update'); assert.equal(view.batchId, 'full-batch'); assert.equal(view.package, 'plugin-0');
    assert.equal(view.from, '1.0.0'); assert.equal(view.to, '1.1.0'); assert.equal(view.result.application, 'failed');
    assert.equal(view.restore.application, 'failed'); assert.equal(view.outcome, 'failed'); assert.equal(view.item.name, 'plugin-0');
    assert(size(store.list('plugin-0')) <= store.maxBytes);
    assert.equal(store.records[0].operation, 'batch-update'); assert.equal(store.records[0].id, 'full-batch');
});
test('minimal fallback keeps all twenty essential item facts rather than dropping the batch tail', async t => {
    const { store } = await fixture(t, { maxBytes: 4300 });
    const items = Array.from({ length: 20 }, (_, index) => ({ ...item('plugin-' + index), archivePath: 'x'.repeat(1000), metadata: Object.fromEntries(Array.from({ length: 160 }, (_, i) => ['field' + i, i])) }));
    const returned = await store.put({ id: 'minimal-batch', operation: 'batch-update', origin: 'doctor', phase: 'finished', outcome: 'failed', items });
    assert(returned); assert.equal(returned.truncation.minimal, true); assert.equal(returned.items.length, 20);
    assert.deepEqual(returned.items.map(value => [value.name, value.from, value.to, value.status, value.result.application]), items.map(value => [value.name, value.from, value.to, value.status, value.result.application]));
    assert(size(store.records) <= 4300);
});
test('package projection preserves legacy and official records and does not mutate stored batch identity', async t => {
    const { store } = await fixture(t);
    await store.put({ id: 'legacy', package: 'plugin-a', operation: 'update', origin: 'doctor', phase: 'finished', outcome: 'failed', from: '0.9.0', to: '1.0.0' });
    await store.put({ id: 'official', package: 'plugin-a', operation: 'install', origin: 'official-event', phase: 'settled', event: { application: 'applied' } });
    await store.put({ id: 'batch', operation: 'batch-update', origin: 'doctor', phase: 'finished', outcome: 'failed', items: [item('plugin-a'), item('plugin-b', 'updated')] });
    const views = store.list('plugin-a');
    assert.deepEqual(views.map(value => value.id), ['batch:plugin-a', 'official', 'legacy']);
    assert.equal(views[0].operation, 'update'); assert.equal(views[0].origin, 'doctor'); assert.equal(views[0].savedEnabled, true);
    assert.equal(views[1].origin, 'official-event');
    views[0].item.status = 'updated';
    assert.equal(store.records[0].items[0].status, 'failed');
    assert.equal(store.list()[0].id, 'batch'); assert.equal(store.list()[0].items.length, 2);
    assert.deepEqual(store.list('not-recorded'), []);
});
test('restore batches project restore operations without granting update mutation authority', async t => {
    const { store } = await fixture(t);
    await store.put({ id: 'restore-batch', operation: 'batch-restore', origin: 'doctor', phase: 'finished', outcome: 'failed', items: [{ name: 'plugin-a', from: '1.1.0', to: '1.0.0', enabled: false, status: 'failed', result: { application: 'failed', stage: 'enable' } }] });
    const view = store.list('plugin-a')[0];
    assert.equal(view.operation, 'restore'); assert.equal(view.savedEnabled, false); assert.equal(view.outcome, 'failed');
    assert.equal(view.ticket, undefined); assert.equal(view.canRestore, undefined);
    assert.equal(store.records[0].operation, 'batch-restore');
});
test('interrupted batch marks in-flight item unknown while preserving genuinely completed item results', async t => {
    const { store, path } = await fixture(t);
    const record = { id: 'interrupted-batch', operation: 'batch-update', origin: 'doctor', phase: 'running', outcome: 'applied', items: [
        { name: 'complete', from: '1.0.0', to: '1.1.0', status: 'updated', result: { application: 'applied' } },
        { name: 'in-flight', from: '1.0.0', to: '1.1.0', status: 'updating', result: { application: 'applied' } },
        { name: 'waiting', from: '1.0.0', to: '1.1.0', status: 'waiting' },
    ] };
    await writeFile(path, JSON.stringify({ schemaVersion: 1, records: [record] }));
    await store.load();
    assert.equal(store.records[0].phase, 'interrupted'); assert.equal(store.records[0].outcome, 'unknown');
    assert.equal(store.records[0].items[1].status, 'unknown'); assert.equal(store.records[0].items[1].previousStatus, 'updating');
    assert.equal(store.list('complete')[0].outcome, 'applied');
    assert.equal(store.list('in-flight')[0].outcome, 'unknown'); assert.equal(store.list('waiting')[0].outcome, 'unknown');
    assert.equal(store.list('in-flight')[0].result.application, 'applied');
    assert.equal(store.records[0].items.length, 3);
});
