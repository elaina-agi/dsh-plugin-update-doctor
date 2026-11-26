import test from 'node:test';
import assert from 'node:assert/strict';
import { RegistryStager } from '../lib/staging.js';
import { tar } from './helpers/service-fixture.mjs';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const name = 'owned-mirror-package';
const manifest = { name, version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } };
const bytes = tar([['package/package.json', JSON.stringify(manifest)], ['package/cordis.patch.yml', '- insert:\n    - id: owned-feature\n      name: owned-mirror-package\n']]);
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const mirror = 'https://registry.npmmirror.com';

test('a mirror source is staged once with canonical bytes and its own query origin', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mirror-stager-')); t.after(() => rm(root, { recursive: true, force: true }));
    const counter = { archive: 0, metadata: 0 };
    const stager = new RegistryStager(root, { fetcher: async url => {
        const origin = new URL(url).origin;
        if (String(url).endsWith('.tgz')) { counter.archive += 1; return new Response(bytes); }
        counter.metadata += 1;
        return Response.json({ ...manifest, dist: { tarball: `${origin}/${name}/-/${name}-1.0.0.tgz`, integrity } });
    } });
    const value = await stager.stage(name, '1.0.0', { origin: mirror });
    assert.equal(value.queryRegistry, mirror);
    assert.equal(value.originalSha256, createHash('sha256').update(bytes).digest('hex'));
    // The archive is fetched exactly once: no second full download for a mirror source.
    assert.equal(counter.archive, 1);
    assert.equal(counter.metadata, 1);
});

test('a mirror document that differs from the tarball no longer refuses the update', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mirror-drift-')); t.after(() => rm(root, { recursive: true, force: true }));
    const stager = new RegistryStager(root, { fetcher: async url => {
        const origin = new URL(url).origin;
        if (String(url).endsWith('.tgz')) return new Response(bytes);
        // Registry documents drift: extra keys, stripped ./, normalised fields.
        return Response.json({ ...manifest, bin: { [name]: 'bin/tool.mjs' }, main: 'index.js', dist: { tarball: `${origin}/${name}/-/${name}-1.0.0.tgz`, integrity } });
    } });
    const value = await stager.stage(name, '1.0.0', { origin: mirror });
    assert.equal(value.queryRegistry, mirror);
    assert.equal(value.originalSha256, createHash('sha256').update(bytes).digest('hex'), 'integrity of the archive still decides');
});
