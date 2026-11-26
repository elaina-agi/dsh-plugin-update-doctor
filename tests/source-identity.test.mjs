import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { IdentityStore } from '../lib/identity.js';
import { scanUpdates } from '../lib/online.js';
import { serviceFixture } from './helpers/service-fixture.mjs';

test('private and missing origins remain blocked; fixed public mirror is not relabelled as official', async () => {
    for (const registry of ['https://private.example.invalid', 'https://registry.npmmirror.com', undefined]) {
        const [result] = await scanUpdates({ listVersions: async () => ({ status: 'listed', registry, versions: [{ version: '1.1.0', bundle: true }] }) }, [{ name: 'sample', canUpdate: true, sourceKind: 'registry', reasons: [] }]);
        assert.equal(result.canUpdate,registry==='https://registry.npmmirror.com');
        assert.equal(result.registry, registry ?? null, 'A safe origin is displayed, never promoted to public npm');
    }
});
test('query-origin changes during confirmation preparation stop before plugin mutation', async t => {
    const { service, state, calls } = await serviceFixture(t); state.registry = 'https://private.example.invalid';
    await assert.rejects(() => service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]), /Selection changed/); assert.deepEqual(calls, []);
});
test('a tampered prepared archive never reaches task stopping or plugin removal', async t => {
    const { service, stager, calls } = await serviceFixture(t); const plan = await service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]);
    const real = service.tickets.get(plan.ticket).plan.items[0]; const staged = await stager.reopen(real.nextReference); await writeFile(staged.archivePath, 'tampered');
    const start = await service.commit(plan.ticket); await service.jobs.get(start.operationId).work; assert.deepEqual(calls, []); assert.notEqual(service.operation(start.operationId).record.outcome, 'applied');
});
test('an external package appearing after removal is not overwritten or automatically removed', async t => {
    const { service, state, calls, bundles } = await serviceFixture(t); state.afterRemove = b => Object.assign(b, { installed: true, version: '9.0.0', source: 'external@9.0.0' });
    const plan = await service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]); const start = await service.commit(plan.ticket); await service.jobs.get(start.operationId).work;
    assert.equal(bundles[0].version, '9.0.0'); assert.deepEqual(calls.map(call=>call.slice(0,2)), [['update','sample-plugin@1.1.0'],['remove','sample-plugin']]); assert.equal(service.recoveryFor('sample-plugin'), undefined);
});
test('registry updates do not become local archive identities after history rotation or reload', async t => {
    const { service } = await serviceFixture(t); const plan = await service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]); const start = await service.commit(plan.ticket); await service.jobs.get(start.operationId).work;
    const raw = (await service.snapshot()).bundles[0]; assert.equal(raw.update,'registry');assert.equal(raw.source,'sample-plugin@1.1.0');assert.equal(service.lineageOf(raw),null);
    for (let i = 0; i < 90; i++) await service.store.put({ id: 'noise-' + i, package: 'other', phase: 'settled' });
    const reload = new IdentityStore(service.identities.path); await reload.load(); assert.equal(reload.get(raw.name),undefined);
    assert.equal((await service.list()).bundles[0].canUpdate,true);
    const serialized = await readFile(service.identities.path, 'utf8'); assert(!serialized.includes(service.profile.home));
});

test('persisted policy metadata and source integrity are rechecked against archive bytes', async t => {
    const { stager } = await serviceFixture(t); const staged = await stager.stage('sample-plugin', '1.0.0');
    const reference = stager.reference(staged);
    await assert.rejects(() => stager.reopen({ ...reference, manifest: { ...reference.manifest, description: 'invented' } }), /metadata-changed/);
    await assert.rejects(() => stager.reopen({ ...reference, rows: [{ id: 'other', name: 'sample-plugin' }] }), /metadata-changed/);
    await writeFile(staged.sourceArchivePath, 'corrupt'); await assert.rejects(() => stager.reopen(reference), /integrity/);
});
test('interrupted prepared update offers only exact archived recovery after restart', async t => {
    const { service, bundles } = await serviceFixture(t); const plan = await service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]);
    const item = service.tickets.get(plan.ticket).plan.items[0];
    await service.identities.prepare({ id: 'crash-recovery', failedBatchId: 'crashed-batch', name: item.name, from: item.from, to: item.to, enabled: item.enabled,
        previous: item.previousReference, next: item.nextReference, status: 'prepared', expectedFingerprint: item.fingerprint });
    bundles[0].installed = false; await service.initialize();
    assert.equal(service.recoveryFor(item.name).status, 'unknown');
    assert.equal((await service.list()).bundles.find(b => b.name === item.name).canRestore, true);
});
test('changed installed bytes are recorded as a warning, not a permanent refusal', async t => {
    const { service, root, calls } = await serviceFixture(t);
    await writeFile(root + '/sample-plugin/index.js', 'private implementation');
    const plan = await service.prepareBatch([{ name: 'sample-plugin', version: '1.1.0' }]);
    assert.match(plan.items[0].installedOriginalWarning ?? '', /installed-original/, 'the rollback archive is the staged one, so a changed tree is evidence rather than a blocker');
    assert.deepEqual(calls, [], 'no Host mutation happens before the authenticated confirmation');
});
