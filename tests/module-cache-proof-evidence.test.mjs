import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedEvidence } from './helpers/retained-evidence.mjs';

// Check retained real-host evidence, not a rerun and not a mock failure.
test('retained helper export transition is an ordinary update control, not an official failure repair', async t => {
    const result = await retainedEvidence(t, new URL('../experiments/module-cache-proof-result.json', import.meta.url), {
        reproduce: 'Run experiments/run-module-cache-proof.ps1.', required: ['completed', 'separateProcesses', 'methods'],
    });
    if (result === null) return;
    assert(Array.isArray(result.methods), 'Retained cache-proof methods must be an array');
    assert.equal(result.completed, true);
    assert.equal(result.separateProcesses, true);
    const methods = new Map(result.methods.map(item => [item.method, item]));
    assert.equal(methods.size, 3);
    for (const mode of ['official', 'generic']) {
        const { evidence, exitCode } = methods.get(mode);
        assert.equal(exitCode, 0);
        assert(Number.isSafeInteger(evidence.pid) && evidence.pid > 0, 'Retained cache-proof process id must exist');
        assert.equal(evidence.runtimeVersion, '0.2.2-rc.3');
        assert.equal(evidence.ownedPnpmStoreVerified, true);
        assert(evidence.actualStorePath.startsWith(evidence.root));
        assert.equal(evidence.completed, true);
        assert.equal(evidence.managementOutcome, 'applied');
        assert.equal(evidence.originalFailure, null);
        assert.equal(evidence.updateVerified, true);
        assert.equal(evidence.codeActuallyUpdated, true);
        assert.equal(evidence.allTargetRowsActive, true);
        assert.equal(evidence.after.codeResult, 'new-export-1.1.0');
        assert.equal(evidence.after.diskVersion, '1.1.0');
        assert.equal(evidence.after.runtimeVersion, '1.1.0');
        assert.equal(evidence.after.pid, evidence.pid);
        assert.equal(evidence.after.sameProcessIdentity, true);
        assert.equal(evidence.oldDisposeBeforeNewStart, true);
        assert.equal(evidence.unrelatedStayedAlive, true);
        assert.equal(evidence.cleanedOwnedRoot, true);
        assert.equal(evidence.cleanupError, undefined);
        assert.equal(evidence.hostCleanupError, undefined);
        assert.equal(evidence.intentionalActivationFailure.application, 'failed');
        assert.equal(evidence.recoveryVerified, true);
        const restored = evidence.badFixtureRecovery.at(-1).result;
        assert.equal(restored.codeResult, 'helper-v1');
        assert(restored.rows.length > 0 && restored.rows.every(row => row.enabled && row.phase === 'active'));
        assert(evidence.managerCalls.some(call => call.method === 'removeBundle' && call.result.application === 'applied'));
        assert(evidence.managerCalls.some(call => call.method === 'installBundle' && call.result.version === '1.1.0' && call.result.application === 'applied'));
        assert(evidence.limitations.some(line => line.includes('empty fixture registry')));
    }
    const cold = methods.get('cold-v2');
    assert.equal(cold.exitCode, 0);
    assert.equal(cold.evidence.coldV2Verified, true);
    assert.equal(cold.evidence.ownedPnpmStoreVerified, true);
    assert.equal(cold.evidence.after.codeResult, 'new-export-1.1.0');
    assert.equal(cold.evidence.cleanedOwnedRoot, true);
    assert.equal(cold.evidence.cleanupError, undefined);
});
