import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPatches } from '../lib/patch-safety.js';

test('only safe own-package insert rows pass staged patch admission', () => {
    assert.deepEqual(inspectPatches(['- insert:\n    - id: sample-feature\n      name: sample\n'], 'sample'), [{id:'sample-feature',name:'sample'}]);
    assert.throws(() => inspectPatches(['- id: agent-loop\n  disabled: true\n'], 'sample'), /override/);
    assert.throws(() => inspectPatches(['- insert:\n    - id: plugin-update-doctor\n      name: sample\n'], 'sample'), /protected/);
    assert.throws(() => inspectPatches(['- insert:\n    - id: sample\n      name: "@deepseek-ai/dsh-agent-loop"\n'], 'sample'), /foreign/);
    assert.throws(() => inspectPatches(['- insert:\n    - id: sample\n      name: !!js x\n'], 'sample'), /dynamic/);
});
