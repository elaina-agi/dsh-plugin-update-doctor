import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedEvidence, evidenceFields } from './helpers/retained-evidence.mjs';

// Retained actual isolated Host evidence, not a rerun, browser click or public npm publication.
for (const mode of ['update-good', 'bad-rollback']) test(`retained self-update ${mode} verifies independent Host handoff and current code`, async t => {
    const result = await retainedEvidence(t, new URL('../experiments/self-update-proof-result.json', import.meta.url), { reproduce: 'Run experiments/run-self-update-proof.ps1.', required: ['completed', 'modes'] });
    if (result === null) return;
    assert.equal(result.completed, true);
    const modeResult = result.modes.find(item => item.mode === mode);
    assert.equal(modeResult?.exitCode, 0);
    const evidence = modeResult?.evidence;
    assert(evidence, 'Missing required mode');
    evidenceFields(evidence, ['passed', 'runtimeVersion', 'productionFilesSha256', 'results', 'lifecycle', 'cleaned', 'ownedStoreVerified', 'yamlOriginalIntegrityVerified']);
    assert.equal(evidence.passed, true); assert.equal(evidence.runtimeVersion, '0.2.2-rc.5'); assert.equal(evidence.cleaned, true); assert.equal(evidence.ownedStoreVerified, true); assert.equal(evidence.yamlOriginalIntegrityVerified, true);
    assert(Array.isArray(evidence.results) && evidence.results.length >= 5 && evidence.results.every(step => step.ok));
    const steps = new Map(evidence.results.map(step => [step.name, step.value]));
    const state = steps.get('new-or-restored-production-instance-reads-final-record');
    assert.equal(state.sameManager, true); assert.equal(state.samePid, true); assert.equal(state.yamlVersion, '2.9.1');
    if (mode === 'update-good') { assert.equal(state.state.result.result.application, 'applied'); assert.equal(state.state.verifiedApplied, true); assert.equal(state.code, 'production-code-0.3.1'); assert.equal(steps.get('same-version-owned-file-tamper-is-not-reported-as-verified-success').verifiedApplied, false); }
    else { assert.equal(state.state.result.result.application, 'failed'); assert.equal(state.state.result.restore.application, 'applied'); assert.equal(state.state.restoreVerification.package.status, 'verified'); assert.equal(state.state.restoreVerification.host.status, 'active'); assert.equal(state.state.verifiedApplied, false); assert.equal(state.code, 'production-code-0.3.0'); }
    assert.equal(steps.get('old-production-disposal-does-not-await-host-replacement').noFiveSecondCycle, true);
});
