import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedEvidence, evidenceFields } from './helpers/retained-evidence.mjs';

test('retained Agent disposal proof isolates old waiting cycle and fixed global barrier', async t => {
    const data = await retainedEvidence(t, new URL('../experiments/agent-disposal-proof-result.json', import.meta.url), {
        reproduce: 'Run experiments/run-agent-disposal-proof.ps1.', required: ['methods'],
    });
    if (data === null) return;
    assert(Array.isArray(data.methods), 'Retained disposal methods must be an array');
    const modes = data.methods.map(item => item.evidence);
    assert.equal(modes.length, 2);
    for (const mode of modes) evidenceFields(mode, ['passed', 'cleanedOwnedRoot', 'ownedPackageStoreVerified', 'steps']);
    assert(modes.every(item => item.passed && item.cleanedOwnedRoot && item.ownedPackageStoreVerified));
    const legacy = new Map(modes[0].steps.map(step => [step.name, step.value]));
    assert.equal(legacy.get('legacy-own-disposal-cancel-does-not-release-claim').managerRemovalStillWaiting, true);
    const fixed = new Map(modes[1].steps.map(step => [step.name, step.value]));
    assert.equal(fixed.get('fixed-gate-owner-disposes-during-real-removal').disposalCompleted, true);
    assert.equal(fixed.get('fixed-gate-owner-disposes-during-real-removal').otherAgentStillClaimed, true);
    assert.equal(fixed.get('global-beforeStep-remains-held-after-owner-disposal').beforeStepHeld, true);
    assert.equal(fixed.get('replacement-and-unrelated-agent-live-after-release').samePid, true);
});
test('retained v0.3 recovery proof restores exact old code after independent confirmation', async t => {
    const data = await retainedEvidence(t, new URL('../experiments/recovery-v3-proof-result.json', import.meta.url), {
        reproduce: 'Run experiments/run-recovery-v3-proof.ps1.', required: ['passed', 'cleaned', 'runtimeVersion', 'pid', 'results', 'limitations'],
    });
    if (data === null) return;
    assert(Array.isArray(data.results), 'Retained recovery results must be an array');
    assert(Array.isArray(data.limitations), 'Retained recovery limitations must be an array');
    assert.equal(data.passed,true);assert.equal(data.cleaned,true);assert.equal(data.runtimeVersion,'0.2.2-rc.3');
    const results=new Map(data.results.map(item=>[item.name,item.value]));
    const failure=results.get('real-target-failure-and-injected-automatic-restore-failure');assert.equal(failure.outcome,'failed');assert.equal(failure.items[0].result.application,'failed');assert.equal(failure.items[0].restore.error.code,'owned-injected-failure');
    const restored=results.get('name-only-confirmed-exact-recovery');assert.equal(restored.record.operation,'batch-restore');assert.equal(restored.record.items[0].status,'restored');assert.equal(restored.record.confirmCancel,false);
    const code=results.get('restored-real-code-and-host');assert.equal(code.code,'original-code-1.0.0');assert.equal(code.pid,data.pid);assert(code.rows.length > 0);assert(code.rows.every(row=>row.enabled&&row.fiberPhase==='active'));
    assert(data.limitations.some(line=>line.includes('injected once')));
});
