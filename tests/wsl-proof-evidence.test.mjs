import test from 'node:test';
import assert from 'node:assert/strict';
import { retainedEvidence, evidenceFields } from './helpers/retained-evidence.mjs';

const load = (t, name) => retainedEvidence(t, new URL('../experiments/' + name, import.meta.url), {
    reproduce: 'Run the corresponding mode of experiments/run-wsl-full-proof.ps1.', required: ['runtimeVersion', 'pid', 'results'],
});
const byName = e => {
    assert(Array.isArray(e.results), 'Retained WSL results must be an array');
    assert(Number.isSafeInteger(e.pid) && e.pid > 0, 'Retained WSL process id must exist');
    return new Map(e.results.map(r => [r.name, r.value]));
};

test('complete WSL cold baseline validates actual required services before reproducing official failure',async t=>{
 const e=await load(t, 'wsl-full-proof-result.json');
  if (e === null) return;
  const v=byName(e);
 assert.equal(e.runtimeVersion,'0.2.2-rc.3');assert.equal(v.get('cold-full-wsl-0.24.0-all-active').activeCount,14);
 const services = v.get('real-host-required-services');
 evidenceFields(services, ['commands', 'agents', 'tools', 'sandboxPolicy', 'workingDirectory', 'connection', 'agentPresets', 'shellEnv']);
 assert(Object.values(services).every(Boolean));
 const result=v.get('official-updateBundle-0.26.1');assert.equal(result.result.packageResult.exitCode,0);assert.equal(result.result.application,'failed');assert.equal(result.restore.application,'failed');
 assert.match(result.result.error.diagnostic,/service "subprocess" has been registered/);assert.match(result.result.error.diagnostic,/service "fs" has been registered/);
});
test('in-place WSL update isolates stale-import failure and restores active old generation',async t=>{
 const e=await load(t, 'wsl-full-inplace-proof-result.json');
  if (e === null) return;
  const v=byName(e);
 assert.equal(v.get('cold-full-wsl-0.24.0-all-active').activeCount,14);
 assert.equal(v.get('inplace-staged-install-0.26.1').packageResult.exitCode,0);assert.match(v.get('inplace-staged-install-0.26.1').error.diagnostic,/mergeAutoPresetSeam/);
 assert.equal(v.get('copy-on-write-identical-js-files').contentChanged,false);assert.equal(v.get('copy-on-write-identical-js-files').count,58);
 assert.equal(v.get('inplace-staged-restore-0.24.0').application,'applied');assert.equal(v.get('inplace-restored-0.24.0-all-active').activeCount,14);
});
test('production generation preserves bare client anchor and real Host services',async t=>{
 const e=await load(t, 'wsl-full-inplace-0.26.2-generation-names-production-proof-result.json');
  if (e === null) return;
  const v=byName(e);
 assert.equal(e.completed,true);assert.equal(v.get('cold-full-wsl-0.24.0-all-active').activeCount,14);
 assert.equal(v.get('public-reapply-0.26.1').application,'applied');assert.equal(v.get('public-reapply-0.26.1-all-active').activeCount,15);
 const smoke=v.get('production-bare-anchor-and-host-services');assert.equal(smoke.bareAnchorPreserved,true);assert.equal(smoke.anchorActive,true);assert.equal(smoke.filesystemReadable,true);assert.equal(smoke.subprocessPresent,true);assert.equal(smoke.pid,e.pid);
 assert.equal(v.get('restore-public-reapply-0.24.0').application,'applied');assert.equal(v.get('restore-public-reapply-0.24.0-all-active').activeCount,14);
});
test('rolling production pair keeps legacy resources and both update generations active',async t=>{
 const e=await load(t, 'wsl-full-inplace-0.26.2-generation-names-production-rolling-proof-result.json');
  if (e === null) return;
  const v=byName(e);
 assert.equal(e.completed,true);assert.equal(v.get('cold-full-wsl-0.24.0-all-active').activeCount,14);
 assert.equal(v.get('inplace-staged-install-0.26.1').application,'applied');assert.equal(v.get('inplace-full-wsl-0.26.1-all-active').activeCount,15);
 const resources=v.get('rolling-legacy-and-next-resource-bytes');assert.equal(resources.legacyRootPreserved,true);assert.equal(resources.nextGenerationPreserved,true);assert.equal(resources.pid,e.pid);
 assert.equal(v.get('inplace-staged-restore-0.24.0').application,'applied');assert.equal(v.get('inplace-restored-0.24.0-all-active').activeCount,14);
});
test('generation-specific Loader names load WSL 0.26.2 and restore old version in one Host',async t=>{
 const e=await load(t, 'wsl-full-inplace-0.26.2-generation-names-proof-result.json');
  if (e === null) return;
  const v=byName(e);
 assert.equal(e.completed,true);assert.equal(v.get('cold-full-wsl-0.24.0-all-active').activeCount,14);
 const transformed=v.get('versioned-runtime-generation-transform');evidenceFields(transformed, ['originalFiles', 'copiedFiles']);assert.equal(transformed.preservedOriginalRuntimeBytes,true);assert.equal(transformed.originalFiles,transformed.copiedFiles);assert.deepEqual(transformed.changedPatchFiles,['package/cordis.patch.yml']);
 assert.equal(v.get('inplace-staged-install-0.26.1').application,'restart-required');
 assert.equal(v.get('public-reapply-0.26.1').application,'applied');const next=v.get('public-reapply-0.26.1-all-active');assert.equal(next.version,'0.26.2');assert.equal(next.activeCount,15);assert.equal(next.pid,e.pid);
 assert.equal(v.get('restore-public-reapply-0.24.0').application,'applied');const old=v.get('restore-public-reapply-0.24.0-all-active');assert.equal(old.activeCount,14);assert.equal(old.pid,e.pid);
});
