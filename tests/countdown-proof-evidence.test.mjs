import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedEvidence, evidenceFields } from './helpers/retained-evidence.mjs';

// Retained runtime evidence checks, not a real-host rerun. Missing ignored
// results are explicitly skipped on a fresh checkout; reproduce with the wrapper.
for (const mode of ['official', 'doctor']) {
    test(`retained countdown ${mode} evidence verifies code supply and settings, not an official failure`, async t => {
        const evidence = await retainedEvidence(t, new URL(`../experiments/countdown-${mode}-proof-result.json`, import.meta.url), {
            reproduce: 'Run experiments/run-countdown-proof.ps1.',
            required: ['mode', 'runtimeVersion', 'pid', 'passed', 'application', 'samePid', 'cleanup.rootVerified', 'cleanup.removed', 'results', 'ownedPackageStore', 'limitations'],
        });
        if (evidence === null) return;
        assert(Array.isArray(evidence.results), 'Retained countdown results must be an array');
        assert(Array.isArray(evidence.limitations), 'Retained countdown limitations must be an array');
        assert.equal(evidence.mode, mode);
        assert.equal(evidence.runtimeVersion, '0.2.2-rc.3');
        assert.equal(evidence.passed, true);
        assert.equal(evidence.application, 'applied');
        assert.equal(evidence.samePid, true);
        assert.equal(evidence.cleanup.rootVerified, true);
        assert.equal(evidence.cleanup.removed, true);
        assert.equal(evidence.serviceCleanupError, undefined);
        assert.equal(evidence.hostCleanupError, undefined);
        assert.equal(evidence.cleanup.error, undefined);
        assert(evidence.results.every(item => item.ok === true));
        const results = new Map(evidence.results.map(item => [item.name, item.value]));
        const installLog = results.get('install-original-npm-baseline').output.replace(/\\/g, '/');
        assert(installLog.includes(evidence.ownedPackageStore.replace(/\\/g, '/')));
        assert(installLog.includes('Packages are copied'));
        const before = results.get('cold-original-host-all-active');
        const after = results.get('updated-original-host-all-active');
        assert.equal(before.version, '1.2.0');
        assert.equal(after.version, '1.2.1');
        for (const state of [before, after]) {
            assert.equal(state.pid, evidence.pid);
            assert.equal(state.enabled, true);
            assert.equal(state.rows.length, 1);
            assert(state.rows.every(row => row.enabled === true && row.fiberPhase === 'active'));
            assert.deepEqual(state.otherInactive, []);
        }
        evidenceFields(before, ['clientSha256', 'hostSha256']);
        evidenceFields(after, ['clientSha256', 'hostSha256']);
        assert.notEqual(before.clientSha256, after.clientSha256);
        assert.equal(before.hostSha256, after.hostSha256);
        const oldClient = results.get('cold-client-graph-and-served-bytes');
        const newClient = results.get('updated-client-graph-and-served-new-code');
        evidenceFields(oldClient, ['entry.rev']);
        evidenceFields(newClient, ['entry.rev']);
        assert.notEqual(oldClient.entry.rev, newClient.entry.rev);
        assert.equal(oldClient.hasNewNoDragRule, false);
        assert.equal(newClient.hasNewNoDragRule, true);
        const saved = results.get('pre-update-real-settings-post-and-get');
        const preserved = results.get('settings-and-file-bytes-preserved');
        assert(saved && typeof saved === 'object', 'Retained settings response must exist');
        evidenceFields(preserved, ['state']);
        assert.deepEqual(preserved.state, saved);
        assert.equal(preserved.fileBytesUnchanged, true);
        assert.equal(results.get('updated-real-settings-still-writable').leadMinutes, 25);
        assert(evidence.limitations.some(line => line.includes('No browser renders/executes')));
        if (mode === 'official') {
            assert.equal(results.get('official-updateBundle-exact-target').result.application, 'applied');
            assert.deepEqual(results.get('official-updateBundle-exact-target').result.warnings, []);
        } else {
            const record = results.get('production-runBatch-owned-fixture');
            assert.equal(record.taskPolicy, 'wait-for-idle');
            assert.equal(record.confirmCancel, false);
            assert.equal(record.items[0].status, 'updated');
            assert.equal(record.items[0].runtimePackaging, 'original');
            assert.deepEqual(record.items[0].result.warnings, []);
            assert.equal(results.get('actual-native-lock-samples-and-no-task-stops').liveAgents, 0);
            assert.equal(results.get('actual-native-lock-samples-and-no-task-stops').taskCancellation, null);
        }
    });
}
