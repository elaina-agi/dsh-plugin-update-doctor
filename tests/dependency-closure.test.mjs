import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeClosure, resolveClosure } from '../lib/dependency-closure.js';
import { tar } from './helpers/service-fixture.mjs';

const sha512 = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const tarball = (name, version, extra = {}) => {
    const manifest = { name, version, dependencies: {}, ...extra };
    return tar([['package/package.json', JSON.stringify(manifest)], ['package/index.js', `export const version='${version}'\n`]]);
};
const registry = entries => {
    const calls = [];
    const fetcher = async url => {
        const href = String(url);
        calls.push(href);
        const match = /^https:\/\/registry\.npmjs\.org\/((?:@[^/]+\/)?[^/]+)(?:\/-\/[^/]+-(\d+\.\d+\.\d+)\.tgz)?$/.exec(href);
        if (!match) return new Response('', { status: 404 });
        const [, name, fileVersion] = match;
        const versions = entries[name]?.versions ?? {};
        if (fileVersion) {
            const bytes = versions[fileVersion]?.bytes;
            return bytes ? new Response(bytes) : new Response('', { status: 404 });
        }
        return Response.json({ name, versions: Object.fromEntries(Object.entries(versions).map(([version, value]) => [version, {
            name, version, dependencies: value.dependencies ?? {}, dist: { integrity: value.integrity, tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz` } }])) });
    };
    return { fetcher, calls };
};
const version = (name, value, extra = {}) => {
    const bytes = tarball(name, value, extra);
    return { integrity: sha512(bytes), bytes, dependencies: extra.dependencies ?? {} };
};

test('a closure is resolved, downloaded and digest-bound', async () => {
    const { fetcher, calls } = registry({ 'dep-a': { versions: { '1.0.0': version('dep-a', '1.0.0'), '1.2.0': version('dep-a', '1.2.0', { dependencies: { 'dep-b': '^2.0.0' } }) } },
        'dep-b': { versions: { '2.1.0': version('dep-b', '2.1.0') } } });
    const closure = await resolveClosure({ name: 'root', version: '2.0.0', dependencies: { 'dep-a': '^1.0.0' } }, { fetcher });
    assert.deepEqual(closure.nodes.map(node => node.key), ['dep-a@1.2.0', 'dep-b@2.1.0']);
    assert.match(closure.digest, /^[a-f0-9]{64}$/);
    assert(closure.nodes.every(node => node.sha256 && node.integrity && node.bytes));
    assert.equal(closure.baseline[0].target, 'dep-a@1.2.0');
    assert.equal(calls.filter(href => href.endsWith('.tgz')).length, 2);
});

test('a read-only plan downloads no archives and binds the same digest', async () => {
    const { fetcher, calls } = registry({ 'dep-a': { versions: { '1.0.0': version('dep-a', '1.0.0') } } });
    const plan = await resolveClosure({ dependencies: { 'dep-a': '^1.0.0' } }, { fetcher, download: false });
    const complete = await resolveClosure({ dependencies: { 'dep-a': '^1.0.0' } }, { fetcher });
    assert.equal(plan.nodes.length, 1); assert.equal(plan.totalBytes, 0);
    assert.equal(plan.digest, complete.digest, 'the read-only admission matches the staged closure');
    assert.equal(calls.filter(href => href.endsWith('.tgz')).length, 1);
});

test('a shared major resolves once while an incompatible owner gets a nested copy', async () => {
    const { fetcher } = registry({
        'dep-a': { versions: { '1.5.0': version('dep-a', '1.5.0'), '2.1.0': version('dep-a', '2.1.0') } },
        'dep-c': { versions: { '1.0.0': version('dep-c', '1.0.0', { dependencies: { 'dep-a': '^2.0.0' } }) } } });
    const closure = await resolveClosure({ dependencies: { 'dep-a': '^1.0.0', 'dep-c': '^1.0.0' } }, { fetcher });
    assert.deepEqual(closure.nodes.map(node => node.key), ['dep-a@1.5.0', 'dep-a@2.1.0', 'dep-c@1.0.0']);
    const root = await mkdtemp(join(tmpdir(), 'dsh-closure-unit-'));
    try {
        const written = await materializeClosure(root, closure);
        assert.equal(written.files, 6);
        assert.match(await readFile(join(root, 'node_modules', 'dep-a', 'index.js'), 'utf8'), /1\.5\.0/);
        assert.match(await readFile(join(root, 'node_modules', 'dep-c', 'node_modules', 'dep-a', 'index.js'), 'utf8'), /2\.1\.0/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('missing versions and unsupported sources are refused', async () => {
    const { fetcher } = registry({ 'dep-a': { versions: { '1.0.0': version('dep-a', '1.0.0') } } });
    await assert.rejects(() => resolveClosure({ dependencies: { 'dep-a': '^3.0.0' } }, { fetcher }), /dependency-closure-unavailable/);
    await assert.rejects(() => resolveClosure({ dependencies: { 'dep-a': 'file:../owned' } }, { fetcher }), /dependency-closure-source/);
    await assert.rejects(() => resolveClosure({ dependencies: { 'https://evil.invalid/x': '^1.0.0' } }, { fetcher }), /dependency-closure-source/);
});

test('lifecycle scripts, native constraints and integrity mismatches are refused', async () => {
    const scripted = version('dep-a', '1.0.0', { scripts: { install: 'owned' } });
    await assert.rejects(() => resolveClosure({ dependencies: { 'dep-a': '^1.0.0' } }, { fetcher: registry({ 'dep-a': { versions: { '1.0.0': scripted } } }).fetcher }), /dependency-closure-script/);
    const native = version('dep-a', '1.0.0', { os: ['linux'] });
    await assert.rejects(() => resolveClosure({ dependencies: { 'dep-a': '^1.0.0' } }, { fetcher: registry({ 'dep-a': { versions: { '1.0.0': native } } }).fetcher }), /dependency-closure-native/);
    const broken = version('dep-a', '1.0.0');
    const tampered = tar([['package/package.json', JSON.stringify({ name: 'dep-a', version: '1.0.0' })]]);
    const fetcher = async url => String(url).endsWith('.tgz') ? new Response(tampered) : Response.json({ versions: { '1.0.0': { name: 'dep-a', version: '1.0.0', dependencies: {}, dist: { integrity: broken.integrity, tarball: 'https://registry.npmjs.org/dep-a/-/dep-a-1.0.0.tgz' } } } });
    await assert.rejects(() => resolveClosure({ dependencies: { 'dep-a': '^1.0.0' } }, { fetcher }), /dependency-closure-integrity/);
});

test('host-provided packages stay outside the closure', async () => {
    const closure = await resolveClosure({ dependencies: { '@deepseek-ai/schemastery': '^3.19.0' } }, { fetcher: async () => { throw Error('must not fetch'); }, download: false });
    assert.equal(closure.nodes.length, 0);
});

test('materialisation refuses to overwrite an existing tree', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-closure-unit-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const { fetcher } = registry({ 'dep-a': { versions: { '1.0.0': version('dep-a', '1.0.0') } } });
    const closure = await resolveClosure({ dependencies: { 'dep-a': '^1.0.0' } }, { fetcher });
    const written = await materializeClosure(root, closure);
    assert.equal(written.files, 2);
    assert.match((await readFile(join(root, 'node_modules', 'dep-a', 'index.js'), 'utf8')), /1\.0\.0/);
    await assert.rejects(() => materializeClosure(root, closure), /EEXIST/);
});
