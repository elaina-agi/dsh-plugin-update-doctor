import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPatches, inspectPatchEntries } from '../lib/patch-safety.js';
import { capabilityDelta } from '../lib/online.js';

test('the parser records declared rows instead of judging their shape', () => {
    assert.deepEqual(inspectPatches(['- insert:\n    - id: sample-feature\n      name: sample\n'], 'sample'), [{ id: 'sample-feature', name: 'sample' }]);
    // Suite rows, namespaced ids, foreign module names and group rows are normal DSH patches.
    const suite = '- insert:\n    - id: suite-core\n      name: suite\n    - id: suite-source-a\n      name: suite-source-a\n    - id: host-row\n      name: "@deepseek-ai/dsh-agent-loop"\n';
    assert.deepEqual(inspectPatches([suite], 'suite').map(row => row.name), ['suite', 'suite-source-a', '@deepseek-ai/dsh-agent-loop']);
    const group = "- insert:\n    - id: bundle\n      name: 'suite/bundle'\n      group: true\n      config:\n        - id: child-a\n          name: suite-source-a\n        - id: child-b\n          name: ./lib/child.mjs\n";
    assert.deepEqual(inspectPatches([group], 'suite').map(row => row.id), ['bundle', 'child-a', 'child-b']);
    // A relative in-package module path is a row name like any other.
    assert.deepEqual(inspectPatches(['- insert:\n    - id: local\n      name: ./packages/x/lib/index.mjs\n'], 'suite'), [{ id: 'local', name: './packages/x/lib/index.mjs' }]);
});

test('only malformed declarations are refused', () => {
    assert.throws(() => inspectPatches(['- id: hmr\n  disabled: true\n'], 'sample'), /override/, 'insert-only callers still refuse overrides');
    assert.throws(() => inspectPatches(['- insert:\n    - id: sample\n      name: !!js x\n'], 'sample'), /dynamic/);
    assert.throws(() => inspectPatches(['- insert:\n    - id: "bad id"\n      name: sample\n'], 'sample'), /duplicate-or-invalid/);
    assert.throws(() => inspectPatches(['- insert:\n    - id: a\n      name: sample\n    - id: a\n      name: sample\n'], 'sample'), /duplicate-or-invalid/);
    assert.throws(() => inspectPatches(['- insert:\n    - id: a\n      name: sample\n      insert:\n        - id: b\n          name: sample\n'], 'sample'), /unsupported-bundle-patch/);
    assert.throws(() => inspectPatches(['- insert: []\n'], 'sample'), /empty-plugin-bundle/);
});

test('declarative row expressions are inert data for the standard channel only', () => {
    const patch = '- insert:\n    - id: better-sidebar\n      name: \'sample\'\n      disabled: !!js "[...ctx.loader.entries()].length > 0"\n';
    // A dynamic tag stays outside the static isolated-generation contract.
    assert.throws(() => inspectPatches([patch], 'sample'), /dynamic/);
    assert.deepEqual(inspectPatches([patch], 'sample', { declarative: true }), [{ id: 'better-sidebar', name: 'sample' }]);
    assert.throws(() => inspectPatches(['- id: hmr\n  disabled: true\n'], 'sample', { declarative: true }), /override/);
    assert.throws(() => inspectPatches(['- insert:\n    - id: sample\n      name: sample\n      disabled: !!binary aGk=\n'], 'sample', { declarative: true }), /invalid-or-tagged|unsupported/);
    assert.throws(() => inspectPatches(['- insert:\n    - id: sample\n      name: sample\n      include: other\n'], 'sample', { declarative: true }), /dynamic/);
});

test('the standard channel records existing-row overrides instead of refusing the package', () => {
    const patch = [
        '- insert:',
        '    - id: sample-feature',
        "      name: 'sample'",
        '- id: hmr',
        '  disabled: false',
        '  config:',
        "    base: !!js 'process.getBuiltinModule(\"node:url\").pathToFileURL(process.cwd()).href'",
        '    root: []',
        '',
    ].join('\n');
    // Insert-only callers still refuse the whole package.
    assert.throws(() => inspectPatches([patch], 'sample', { declarative: true }), /override/);
    const parsed = inspectPatchEntries([patch], 'sample', { declarative: true, allowOverride: true });
    assert.deepEqual(parsed.rows, [{ id: 'sample-feature', name: 'sample' }]);
    assert.deepEqual(parsed.overrides, [{ id: 'hmr', disabled: false, config: { base: { __declarativeJs: 'process.getBuiltinModule("node:url").pathToFileURL(process.cwd()).href' }, root: [] } }]);
    // Override shape stays bounded: no insert, no foreign keys, no duplicates, no non-object config.
    assert.throws(() => inspectPatchEntries(['- id: hmr\n  name: x\n'], 'sample', { allowOverride: true }), /row-override/);
    assert.throws(() => inspectPatchEntries(['- id: hmr\n  config: 1\n'], 'sample', { allowOverride: true }), /row-override/);
    assert.throws(() => inspectPatchEntries(['- id: hmr\n  disabled: true\n- id: hmr\n  disabled: false\n'], 'sample', { allowOverride: true }), /row-override/);
    assert.throws(() => inspectPatchEntries(['- id: "bad id"\n  disabled: true\n'], 'sample', { allowOverride: true }), /row-override/);
    // An override does not admit a package that declares no row of its own.
    assert.throws(() => inspectPatchEntries(['- id: hmr\n  disabled: true\n'], 'sample', { allowOverride: true }), /empty-plugin-bundle/);
});

test('only a newly gained core capability is a takeover', () => {
    const own = { rows: [{ id: 'sample-feature', name: 'sample' }], overrides: [] };
    const same = { rows: [{ id: 'agent-compare', name: 'sample' }, { id: 'sample-feature', name: 'sample' }], overrides: [] };
    assert.deepEqual(capabilityDelta(own, same), [], 'namespaced rows and suite rows are not core takeover');
    assert.deepEqual(capabilityDelta(own, { rows: [...own.rows, { id: 'agent-loop', name: 'sample' }], overrides: [] }), ['core-service-takeover']);
    assert.deepEqual(capabilityDelta({ ...own, overrides: [{ id: 'hmr', config: { root: [] } }] }, { ...own, overrides: [{ id: 'hmr', config: { root: [] } }] }), [], 'an unchanged core rewire is kept');
    assert.deepEqual(capabilityDelta(own, { ...own, overrides: [{ id: 'hmr', config: { root: [] } }] }), ['core-service-takeover']);
    assert.deepEqual(capabilityDelta({ ...own, overrides: [{ id: 'hmr', config: { root: [] } }] }, { ...own, overrides: [{ id: 'hmr', config: { root: ['src'] } }] }), ['core-service-takeover']);
});
