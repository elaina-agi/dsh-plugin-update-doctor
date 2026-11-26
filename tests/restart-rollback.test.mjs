import test from 'node:test';
import assert from 'node:assert/strict';
import { DoctorService } from '../lib/service.js';

// The helper is the single place an ordinary removal is undone. It must never claim a
// restored profile without verifying the reinstalled bytes.
function harness({ install = { application: 'applied', stage: 'install', changed: true }, bytes = true } = {}) {
    const calls = [];
    const service = Object.create(DoctorService.prototype);
    service.stager = { verify: async () => {}, verifyInstalledOriginal: async () => { if (!bytes) throw Error('owned byte mismatch'); } };
    service.resolvePackage = async () => 'C:\\owned\\package';
    service.redact = value => value;
    service.manager = { installBundle: async (path, options) => { calls.push({ path, version: options.expected.version, enabled: options.enabled }); return install; } };
    return { service, calls };
}

test('a restart-required removal is undone with the staged original archive', async () => {
    const { service, calls } = harness();
    const item = { name: 'owned-plugin', from: '1.0.0', enabled: true };
    const job = { id: 'owned' };
    await service.restoreAfterRemoval(job, item, { archivePath: 'C:\\owned\\old.tgz' }, 'restart-required-removal');
    assert.deepEqual(calls, [{ path: 'C:\\owned\\old.tgz', version: '1.0.0', enabled: true }]);
    assert.equal(item.restore.application, 'applied');
    assert.equal(item.restoreKind, 'restart-required-removal');
    assert.equal(item.restoreInstalledBytes, 'verified');
    assert.equal(item.diagnostic, 'restart-required-removal');
    assert.equal(job.activeInstall.recovery, true);
});

test('a restart-required reinstall that cannot verify bytes stays unknown', async () => {
    const { service } = harness({ bytes: false });
    const item = { name: 'owned-plugin', from: '1.0.0', enabled: true };
    await service.restoreAfterRemoval({ id: 'owned' }, item, { archivePath: 'old.tgz' }, 'restart-required-removal');
    assert.equal(item.status, 'unknown');
    assert.equal(item.restoreInstalledBytes, 'unverified');
    assert.equal(item.diagnostic, undefined);
});

test('a missing rollback reply is unknown, never restarted', async () => {
    const { service } = harness({ install: null });
    const item = { name: 'owned-plugin', from: '1.0.0', enabled: true };
    await service.restoreAfterRemoval({ id: 'owned' }, item, { archivePath: 'old.tgz' }, 'restart-required-removal');
    assert.equal(item.restore.error.code, 'restart-rollback-unknown');
    assert.equal(item.status, 'unknown');
});

test('a restart-scoped rollback records applied bytes but claims no live reload', async () => {
    const { service } = harness({ install: { application: 'restart-required', stage: 'install', changed: true } });
    const item = { name: 'owned-plugin', from: '1.0.0', enabled: true };
    await service.restoreAfterRemoval({ id: 'owned' }, item, { archivePath: 'old.tgz' }, 'restart-required-removal');
    assert.equal(item.restore.application, 'restart-required');
    assert.equal(item.restoreInstalledBytes, 'verified');
});

test('a throwing reinstall keeps the failure sanitized and the target unclaimed', async () => {
    const service = Object.create(DoctorService.prototype);
    service.stager = { verify: async () => { throw Error('owned archive disappeared'); }, verifyInstalledOriginal: async () => {} };
    service.resolvePackage = async () => 'C:\\owned\\package';
    service.redact = value => value;
    service.manager = { installBundle: async () => { throw Error('should not be called'); } };
    const item = { name: 'owned-plugin', from: '1.0.0', enabled: true };
    await service.restoreAfterRemoval({ id: 'owned' }, item, { archivePath: 'old.tgz' }, 'restart-required-removal');
    assert.equal(item.status, 'unknown');
    assert.equal(item.restore.error.code, 'restart-rollback-failed');
    assert.match(item.restore.error.diagnostic, /archive disappeared/);
});
