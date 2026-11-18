import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedEvidence } from './helpers/retained-evidence.mjs';

// This validates retained real-runtime evidence, not a rerun or a mock update.
// Use experiments/run-online-proof.ps1 and run-agent-gate-proof.ps1 to reproduce.
test('retained real online proof establishes new code and cold-version recovery', async t => {
    const result = await retainedEvidence(t, new URL('../experiments/online-proof-result.json', import.meta.url), {
        reproduce: 'Run experiments/run-online-proof.ps1.', required: ['runtimeVersion', 'passed', 'pid', 'results'],
    });
    if (result === null) return;
    assert(Array.isArray(result.results), 'Retained online results must be an array');
    assert(Number.isSafeInteger(result.pid) && result.pid > 0, 'Retained online process id must exist');
    assert.equal(result.runtimeVersion, '0.2.2-rc.3'); assert.equal(result.passed, true);
    const values = new Map(result.results.map(item => [item.name, item.value]));
    assert.equal(values.get('hot-v2-code-and-unrelated').revision, 'real-code-1.1.0');
    assert.equal(values.get('hot-v2-code-and-unrelated').pid, result.pid);
    assert.equal(values.get('active-work-quiescence-barrier').workCompletedWithoutCancellation, true);
    assert.equal(values.get('bad-v3-real-activation').application, 'failed');
    assert.equal(values.get('bad-v3-real-activation').stage, 'enable');
    assert.equal(values.get('restored-code-is-really-v1').revision, 'real-code-1.0.0');
});
test('retained real AgentGate proof establishes idle wait and admission hold', async t => {
    const result = await retainedEvidence(t, new URL('../experiments/agent-gate-proof-result.json', import.meta.url), {
        reproduce: 'Run experiments/run-agent-gate-proof.ps1.', required: ['passed', 'steps', 'limitations'],
    });
    if (result === null) return;
    assert(Array.isArray(result.steps), 'Retained AgentGate steps must be an array');
    assert(Array.isArray(result.limitations), 'Retained AgentGate limitations must be an array');
    assert.equal(result.passed, true); assert.equal(result.steps.length, 6);
    assert(result.steps.every(step => step.ok === true));
    assert(result.steps.some(step => step.name === 'new-agent-creation-completes-during-maintenance' && step.value.creationCompletedWithoutDeadlock));
    assert(result.steps.some(step => step.name === 'new-agent-first-step-pauses-during-maintenance' && step.value.preStepHeld && step.value.noModelCall));
    assert(result.limitations.some(line => line.includes('not a model request')));
});
