import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, realpath, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { inspectDependencyGraph, assertSameDependencyGraph } from '../lib/dependency-policy.js';

async function fixture(t) {
    const temp = await realpath(tmpdir()), root = await mkdtemp(join(temp, 'doctor-pure-graph-proof-'));
    t.after(async () => {
        const actual = await realpath(root); assert.equal(actual, resolve(root)); assert.equal(dirname(actual), temp);
        assert(basename(actual).startsWith('doctor-pure-graph-proof-')); assert(!(await lstat(actual)).isSymbolicLink());
        await rm(actual, { recursive: true, force: true });
    });
    const dep = join(root, 'node_modules', 'owned-pure-dependency'); await mkdir(dep, { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'owned-root', version: '1.0.0', type: 'module' }));
    await writeFile(join(dep, 'package.json'), JSON.stringify({ name: 'owned-pure-dependency', version: '1.0.0', type: 'module', exports: { '.': './index.js', './package.json': './package.json' } }));
    await writeFile(join(dep, 'index.js'), "export const marker = 'owned-pure';");
    return { root, dep, manifest: version => ({ name: 'owned-root', version, dependencies: { 'owned-pure-dependency': '1.0.0' } }) };
}

test('unchanged pure dependency graph survives top-level plugin version update', async t => {
    const { root, manifest } = await fixture(t);
    const before = await inspectDependencyGraph(root, manifest('1.0.0'));
    const after = await inspectDependencyGraph(root, manifest('1.1.0'));
    assertSameDependencyGraph(before, after); assert.equal(before.packageCount, 1);
    assert.equal(before.edges[0].owner, 'root:owned-root'); assert.equal(after.edges[0].owner, 'root:owned-root');
    assert.equal(before.digest, after.digest);
});

test('unchanged version labels do not hide dependency byte modification', async t => {
    const { root, dep, manifest } = await fixture(t);
    const before = await inspectDependencyGraph(root, manifest('1.0.0'));
    await writeFile(join(dep, 'index.js'), "export const marker = 'owned-changed';");
    const after = await inspectDependencyGraph(root, manifest('1.1.0'));
    assert.throws(() => assertSameDependencyGraph(before, after), /dependency-graph-changed/);
});
