import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, lstat, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { RegistryStager } from '../lib/staging.js';
import { fetchRegistryArchive } from '../lib/registry-download.js';
import { PUBLIC_REGISTRY as OFFICIAL, PUBLIC_MIRROR as MIRROR } from '../lib/source.js';
import { tar } from './helpers/service-fixture.mjs';

const CDN = 'https://cdn.npmmirror.com';
const integrity = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');

async function fixture(t, name = 'owned-cdn-package') {
    const temporary = await realpath(tmpdir());
    const root = await mkdtemp(join(temporary, 'dsh-ordinary-cdn-'));
    t.after(async () => {
        const actual = await realpath(root);
        assert.equal(actual, resolve(root)); assert.equal(dirname(actual), temporary);
        assert(basename(actual).startsWith('dsh-ordinary-cdn-')); assert(!(await lstat(actual)).isSymbolicLink());
        await rm(actual, { recursive: true, force: true });
    });
    const version = '1.0.0', fileName = name.split('/').at(-1);
    const manifest = { name, version, type: 'module', exports: { '.': './index.js' }, dsh: { bundle: { patch: 'cordis.patch.yml' } } };
    const bytes = tar([['package/package.json', JSON.stringify(manifest)], ['package/cordis.patch.yml', `- insert:\n    - id: owned-cdn-row\n      name: ${JSON.stringify(name)}\n`], ['package/index.js', 'export function apply() {}']]);
    const expected = `${CDN}/packages/${name}/${version}/${fileName}-${version}.tgz`;
    const state = { requests: [], location: expected, cdnStatus: 200, cdnBytes: bytes };
    const fetcher = async (url, options) => {
        const parsed = new URL(url); state.requests.push(parsed.href);
        assert.equal(options.credentials, 'omit');
        if (parsed.origin === CDN) {
            assert.equal(options.redirect, 'manual');
            return state.cdnStatus === 200 ? new Response(state.cdnBytes) : new Response('', { status: state.cdnStatus, headers: { location: expected } });
        }
        assert([OFFICIAL, MIRROR].includes(parsed.origin));
        if (parsed.pathname.endsWith('.tgz')) {
            assert.equal(options.redirect, parsed.origin === MIRROR ? 'manual' : 'error');
            return parsed.origin === MIRROR ? new Response('', { status: 302, headers: state.location === null ? {} : { location: state.location } }) : new Response(bytes);
        }
        assert.equal(options.redirect, 'error');
        return Response.json({ ...manifest, dist: { tarball: `${parsed.origin}/${name}/-/${fileName}-${version}.tgz`, integrity: integrity(bytes) } });
    };
    return { root, state, name, version, bytes, expected, fetcher, stager: new RegistryStager(root, { fetcher }) };
}

test('a mirror-source update stages official bytes without a second mirror download', async t => {
    const f = await fixture(t);
    const staged = await f.stager.stage(f.name, f.version, { origin: MIRROR });
    assert.equal(staged.queryRegistry, MIRROR);
    assert.equal(staged.originalSha256, createHash('sha256').update(f.bytes).digest('hex'));
    // Staging reads the canonical public registry; mirror parity is verified after install.
    assert.deepEqual(f.state.requests.map(url => new URL(url).origin), [OFFICIAL, OFFICIAL]);
});

test('exactly one canonical CDN hop is allowed for a mirror archive', async t => {
    const f = await fixture(t);
    const response = await fetchRegistryArchive(f.fetcher, `${MIRROR}/${f.name}/-/${f.name}-${f.version}.tgz`,
        {}, { name: f.name, version: f.version });
    assert.equal(response.status, 200);
    assert.equal(f.state.requests.filter(url => url.startsWith(CDN + '/')).length, 1);
});

test('a second hop or a non-canonical mirror location is refused', async t => {
    const f = await fixture(t);
    f.state.location = `${CDN}/other/${f.name}-${f.version}.tgz`;
    await assert.rejects(() => fetchRegistryArchive(f.fetcher, `${MIRROR}/${f.name}/-/${f.name}-${f.version}.tgz`, {}, { name: f.name, version: f.version }), error => error.code === 'public-archive-redirect-unsupported');
    f.state.location = `${MIRROR}/${f.name}/-/${f.name}-${f.version}.tgz`;
    await assert.rejects(() => fetchRegistryArchive(f.fetcher, `${MIRROR}/${f.name}/-/${f.name}-${f.version}.tgz`, {}, { name: f.name, version: f.version }), error => error.code === 'public-archive-redirect-unsupported', 'a redirect back to the mirror is a second hop');
});

test('an unapproved registry origin cannot be staged', async t => {
    const f = await fixture(t);
    await assert.rejects(() => f.stager.stage(f.name, f.version, { origin: 'https://registry.example.invalid' }), /registry-origin-unsupported/);
});
