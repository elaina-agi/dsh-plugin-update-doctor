import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, lstat, symlink } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SelfUpdatePreflight, inspectSelfArchive, verifySelfRegistryPlan, SELF_UPDATE_PACKAGE, SELF_UPDATE_HELPER_SHA256 } from '../lib/self-update-policy.js';

const helper = Buffer.from('owned inert helper fixture; never executed');
const helperSha256 = createHash('sha256').update(helper).digest('hex');
const compatibility = () => undefined;
const options = { role: 'next', version: '0.3.1', resolvedYamlVersion: '2.9.1', helperSha256, compatibility };
const registry = { registry: 'https://registry.npmjs.org', resolved: 'https://registry.npmjs.org', fallbackRegistries: [] };
function manifest(version = '0.3.1', yaml = '2.9.1') {
    return { name: SELF_UPDATE_PACKAGE, version, type: 'module', license: 'MIT',
        exports: { '.': './index.js', './client': './client.js', './locale/*.json': './locale/*.json', './icon': './icon.svg', './package.json': './package.json' },
        engines: { node: '>=24.0.0', dsh: '>=0.2.2-rc.3 <0.3.0' }, dependencies: { yaml },
        peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.2-rc.3 <0.3.0', '@deepseek-ai/dsh-app-boot': '>=0.2.2-rc.3 <0.3.0' },
        scripts: { test: 'node --test tests/*.test.mjs', check: 'node --check index.js' },
        dsh: { bundle: { patch: './cordis.patch.yml', platforms: ['win32'] }, client: { platform: 'web', immediately: true,
            inject: ['@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-modules'] } } };
}
function tar(entries) {
    const parts = [];
    for (const [name, text, type = 48] of entries) {
        const bytes = Buffer.from(text), h = Buffer.alloc(512);
        h.write(name, 0, 100); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
        h.write(bytes.length.toString(8).padStart(11, '0') + '\0', 124); h.fill(32, 148, 156); h[156] = type; h.write('ustar\0', 257);
        h.write([...h].reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
        parts.push(h, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
    }
    parts.push(Buffer.alloc(1024)); return gzipSync(Buffer.concat(parts));
}
function archive(value = manifest(), extra = [], patch = `- insert:\n    - id: plugin-update-doctor\n      name: ${SELF_UPDATE_PACKAGE}\n`) {
    return tar([['package/package.json', JSON.stringify(value)], ['package/cordis.patch.yml', patch],
        ['package/index.js', "export function apply() { throw Error('owned source must never run in preflight'); }"], ['package/client.js', '// owned client'],
        ['package/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>'], ['package/locale/en.json', '{}'], ['package/locale/zh.json', '{}'],
        ['package/native/win-x64/lock-probe.exe', helper], ['package/lib/owned.js', '// owned helper'], ...extra]);
}
const hasCode = wanted => error => error.code === wanted;
async function fixture(t) {
    const temp = await realpath(tmpdir()), root = await mkdtemp(join(temp, 'dsh-self-policy-test-'));
    t.after(async () => {
        const checked = await realpath(root), info = await lstat(root);
        assert.equal(checked, resolve(root)); assert.equal(dirname(checked), temp); assert(basename(checked).startsWith('dsh-self-policy-test-')); assert(info.isDirectory() && !info.isSymbolicLink());
        await rm(checked, { recursive: true, force: true });
    });
    const previousManifest = manifest('0.3.0', '^2.9.0'), nextManifest = manifest();
    const state = { previousManifest, nextManifest, previousBytes: archive(previousManifest), nextBytes: archive(nextManifest), metadataAlter: null, fetches: [] };
    const prior = inspectSelfArchive(state.previousBytes, { ...options, version: '0.3.0', role: 'previous' });
    for (const [path, bytes] of prior.files) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), bytes); }
    const fetcher = async (url, fetchOptions) => {
        fetchOptions.signal.throwIfAborted(); state.fetches.push(String(url)); assert.equal(fetchOptions.redirect, 'error');
        const to = String(url).includes('0.3.1'), bytes = to ? state.nextBytes : state.previousBytes, value = to ? state.nextManifest : state.previousManifest;
        if (String(url).endsWith('.tgz')) return new Response(bytes);
        let metadata = { ...value, dist: { tarball: `https://registry.npmjs.org/${SELF_UPDATE_PACKAGE}/-/${SELF_UPDATE_PACKAGE}-${value.version}.tgz`, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') } };
        metadata = state.metadataAlter?.(metadata) ?? metadata; return Response.json(metadata);
    };
    const preflight = new SelfUpdatePreflight({ fetcher, compatibility, helperSha256 });
    const input = { bundle: { name: SELF_UPDATE_PACKAGE, version: '0.3.0', update: 'registry', source: SELF_UPDATE_PACKAGE + '@0.3.0', installed: true, enabled: true, removable: true, availability: 'profile' },
        currentDirectory: root, targetVersion: '0.3.1', resolvedYamlVersion: '2.9.1', registries: registry, queryRegistry: 'https://registry.npmjs.org' };
    return { preflight, input, state, root };
}

test('self-only archive preflight accepts pinned YAML and fixed helper without executing source', () => {
    const inspected = inspectSelfArchive(archive(), options);
    assert.equal(inspected.manifest.name, SELF_UPDATE_PACKAGE); assert.equal(inspected.manifest.dependencies.yaml, '2.9.1'); assert(inspected.files.has('lib/owned.js'));
    assert.equal(SELF_UPDATE_HELPER_SHA256, '0d3422152918d219c333201e084d7883cea92fbcda6bf3108371e3cf664c0340');
});
test('live helper bytes retain the shipped read-only helper digest', async () => {
    const bytes = await readFile(new URL('../native/win-x64/lock-probe.exe', import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), SELF_UPDATE_HELPER_SHA256);
});
test('previous range is admitted only with the exact currently resolved reviewed YAML version', () => {
    const bytes = archive(manifest('0.3.0', '^2.9.0'));
    assert.equal(inspectSelfArchive(bytes, { ...options, role: 'previous', version: '0.3.0' }).manifest.dependencies.yaml, '^2.9.0');
    assert.throws(() => inspectSelfArchive(bytes, { ...options, role: 'previous', version: '0.3.0', resolvedYamlVersion: '2.9.2' }), hasCode('self-yaml-version-unverified'));
    assert.throws(() => inspectSelfArchive(archive(manifest('0.3.1', '^2.9.0')), options), hasCode('self-yaml-dependency-unsupported'));
});
test('foreign package, wrong version, absent compatibility and incompatible runtime fail closed', () => {
    const wrong = manifest(); wrong.name = 'foreign-package'; assert.throws(() => inspectSelfArchive(archive(wrong), options), hasCode('self-archive-identity-mismatch'));
    assert.throws(() => inspectSelfArchive(archive(), { ...options, version: '0.3.2' }), hasCode('self-archive-identity-mismatch'));
    assert.throws(() => inspectSelfArchive(archive(), { ...options, compatibility: undefined }), hasCode('self-runtime-compatibility-unverified'));
    assert.throws(() => inspectSelfArchive(archive(), { ...options, compatibility: () => ({ requirements: { dsh: '99' } }) }), hasCode('self-version-incompatible'));
});
test('new or optional dependencies, package resolution policies and non-pinned YAML are rejected', () => {
    for (const change of [value => value.dependencies.other = '1.0.0', value => value.dependencies.yaml = '^2.9.1', value => value.optionalDependencies = { other: '1.0.0' },
        value => value.bundledDependencies = ['yaml'], value => value.overrides = { yaml: '2.9.1' }, value => value.resolutions = { yaml: '2.9.1' }, value => value.pnpm = { overrides: { yaml: '2.9.1' } }, value => value.publishConfig = { registry: 'https://private.example.invalid' }]) {
        const value = manifest(); change(value); assert.throws(() => inspectSelfArchive(archive(value), options), error => /self-(?:dependency-policy|yaml-dependency)-unsupported/.test(error.code));
    }
});
test('installation and preparation scripts are rejected but inert test/check declarations are allowed', () => {
    for (const key of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish']) {
        const value = manifest(); value.scripts[key] = 'echo unsafe'; assert.throws(() => inspectSelfArchive(archive(value), options), hasCode('self-install-scripts-unsupported'));
    }
});
test('only the unchanged single own patch is admitted, not core takeover or additional rows', () => {
    for (const patch of ['- id: agent-loop\n  disabled: true\n', `- insert:\n    - id: plugin-update-doctor\n      name: foreign-package\n`,
        `- insert:\n    - id: plugin-update-doctor\n      name: ${SELF_UPDATE_PACKAGE}\n      config: {}\n`, `- insert:\n    - id: plugin-update-doctor\n      name: ${SELF_UPDATE_PACKAGE}\n    - id: other\n      name: ${SELF_UPDATE_PACKAGE}\n`,
        '- insert: !!js []\n', '- include: other.yml\n']) assert.throws(() => inspectSelfArchive(archive(manifest(), [], patch), options), hasCode('self-patch-unsupported'));
});
test('native digest changes, foreign native files, vendored modules and unreviewed paths are rejected', () => {
    assert.throws(() => inspectSelfArchive(archive(), { ...options, helperSha256: '0'.repeat(64) }), hasCode('self-native-helper-changed'));
    for (const path of ['package/native/foreign.dll', 'package/lib/addon.node', 'package/node_modules/yaml/index.js', 'package/lib/hidden.exe', 'package/tools/install.ps1'])
        assert.throws(() => inspectSelfArchive(archive(manifest(), [[path, 'owned rejected bytes']]), options), hasCode('self-archive-file-unsupported'));
});
test('unsafe, case-aliased and linked archive paths fail without extraction', () => {
    for (const [path, type] of [['package/../secret', 48], ['package/lib/NUL.js', 48], ['package/lib/bad:ads.js', 48], ['package/INDEX.js', 48], ['package/lib/link.js', 50]])
        assert.throws(() => inspectSelfArchive(archive(manifest(), [[path, 'owned bytes', type]]), options), error => ['self-archive-path-unsupported', 'self-archive-invalid'].includes(error.code));
});
test('runtime entry exports, wrong platform, extra Host peers and metadata are rejected', () => {
    for (const change of [value => value.exports['.'] = '@deepseek-ai/dsh-app-boot', value => value.exports['./other'] = './lib/owned.js', value => value.dsh.bundle.platforms = ['linux'],
        value => value.peerDependencies['@deepseek-ai/dsh-hmr'] = '*', value => value.peerDependenciesMeta = { '@deepseek-ai/dsh-tools': { optional: true } }, value => value.bin = './index.js', value => value.engines.node = '>=99.0.0', value => value.dsh.client.inject.push('@deepseek-ai/dsh-client-hmr')]) {
        const value = manifest(); change(value); assert.throws(() => inspectSelfArchive(archive(value), options));
    }
});
test('public query origin and an exact public-only Host registry plan are mandatory', () => {
    verifySelfRegistryPlan(registry, 'https://registry.npmjs.org/');
    verifySelfRegistryPlan({ ...registry, registry: null }, 'https://registry.npmjs.org');
    for (const origin of [undefined, null, 'https://private.example.invalid', 'http://registry.npmjs.org'])
        assert.throws(() => verifySelfRegistryPlan(registry, origin), hasCode('self-query-origin-unverified'));
    for (const plan of [{ ...registry, fallbackRegistries: ['https://registry.npmmirror.com'] }, { ...registry, registry: 'https://private.example.invalid' },
        { ...registry, resolved: 'https://registry.npmmirror.com' }, { ...registry, registry: null, resolved: undefined }, { registry: 'https://registry.npmjs.org' }])
        assert.throws(() => verifySelfRegistryPlan(plan, 'https://registry.npmjs.org'), hasCode('self-host-registry-plan-unsupported'));
});
test('fixed public mirror uses only already-known public Host registry plans', () => {
    const mirror='https://registry.npmmirror.com';
    const plan={registry:null,resolved:mirror,fallbackRegistries:['https://registry.npmjs.org/']};
    assert.deepEqual(verifySelfRegistryPlan(plan,mirror),{queryRegistry:mirror,registry:null,resolved:mirror,fallbackRegistries:['https://registry.npmjs.org']});
    for(const change of [{resolved:null},{registry:'https://private.example.invalid'},{fallbackRegistries:['https://private.example.invalid']},{resolved:'https://user:secret@registry.npmmirror.com/'}])
        assert.throws(()=>verifySelfRegistryPlan({...plan,...change},mirror),hasCode('self-host-registry-plan-unsupported'));
    assert.throws(()=>verifySelfRegistryPlan(plan,'https://arbitrary-mirror.invalid'),hasCode('self-query-origin-unverified'));
    assert.throws(()=>verifySelfRegistryPlan({...registry,fallbackRegistries:[mirror]},registry.registry),hasCode('self-host-registry-plan-unsupported'));
});

test('pair check matches installed original bytes and exposes only bounded metadata, not archive buffers or paths', async t => {
    const { preflight, input, state } = await fixture(t); const plan = await preflight.check(input);
    assert.equal(plan.from, '0.3.0'); assert.equal(plan.to, '0.3.1'); assert.equal(plan.registry, 'https://registry.npmjs.org'); assert.equal(state.fetches.length, 4);
    assert.equal(plan.previous.sha256, createHash('sha256').update(state.previousBytes).digest('hex')); assert.equal(plan.next.manifest.dependencies.yaml, '2.9.1');
    assert(!JSON.stringify(plan).includes(input.currentDirectory)); assert.equal(plan.next.bytes, undefined);
    assert.equal(plan.next.files['index.js'], createHash('sha256').update(Buffer.from("export function apply() { throw Error('owned source must never run in preflight'); }")).digest('hex'));
    assert(Object.keys(plan.next.files).length <= 128); assert(Object.values(plan.next.files).every(hash => /^[a-f0-9]{64}$/.test(hash)));
    assert.deepEqual(await preflight.verifyPrepared(plan, input), plan);
});
test('local receipt file hashes distinguish same-version modified code without network or execution', async t => {
    const { preflight, input, root, state } = await fixture(t); const plan = await preflight.check(input); const count = state.fetches.length;
    assert.deepEqual(await preflight.verifyInstalled(plan.previous, root), { status: 'verified', files: Object.keys(plan.previous.files).length });
    await writeFile(join(root, 'index.js'), '// altered same-version source');
    await assert.rejects(() => preflight.verifyInstalled(plan.previous, root), hasCode('self-installed-original-unverified'));
    assert.equal(state.fetches.length, count, 'Installed hash verification must not query the registry');
});
test('local hash verification requires a bounded complete reviewed file map rather than trusting a version or tar digest', async t => {
    const { preflight, input, root } = await fixture(t); const plan = await preflight.check(input);
    for (const reference of [{ sha256: plan.previous.sha256 }, { files: {} }, { files: { 'index.js': plan.previous.files['index.js'] } },
        { files: { ...plan.previous.files, '../outside.js': 'a'.repeat(64) } }, { files: { ...plan.previous.files, 'lib/own:ads.js': 'a'.repeat(64) } },
        { files: { ...plan.previous.files, 'INDEX.js': 'a'.repeat(64) } }, { files: { ...plan.previous.files, 'native/other.exe': 'a'.repeat(64) } },
        { files: { ...plan.previous.files, 'index.js': 'not-sha256' } },
        { files: { ...plan.previous.files, ...Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`lib/excess-${index}.js`, 'a'.repeat(64)])) } }])
        await assert.rejects(() => preflight.verifyInstalled(reference, root), hasCode('self-installed-files-unverified'));
});
test('local receipt hash verification rejects missing resources and junction paths', async t => {
    const { preflight, input, root } = await fixture(t); const plan = await preflight.check(input);
    const path = join(root, 'lib', 'owned.js'), library = join(root, 'lib');
    await rm(path); await assert.rejects(() => preflight.verifyInstalled(plan.previous, root));
    assert.equal(dirname(library), root); await rm(library, { recursive: true }); await symlink(root, library, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => preflight.verifyInstalled(plan.previous, root), hasCode('self-installed-original-unverified'));
});
test('self archive file inventory is capped before it can become an unbounded receipt', () => {
    const extra = Array.from({ length: 129 }, (_, index) => [`package/lib/excess-${index}.js`, '// inert fixture']);
    assert.throws(() => inspectSelfArchive(archive(manifest(), extra), options), hasCode('self-archive-file-count-unsupported'));
});
test('modified installed source cannot pass original package verification', async t => {
    const { preflight, input, root } = await fixture(t); await writeFile(join(root, 'index.js'), '// private local edit');
    await assert.rejects(() => preflight.check(input), hasCode('self-installed-original-unverified'));
});
test('linked installed resource or root is rejected without reading a private target', async t => {
    const { preflight, input, root, state } = await fixture(t);
    const inside = join(root, 'lib', 'owned.js'), library = join(root, 'lib');
    assert.equal(dirname(library), root); await rm(inside); await rm(library, { recursive: true });
    await symlink(root, library, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => preflight.check(input), hasCode('self-installed-original-unverified'));
    const linkedRoot = join(root, 'root-alias'); await symlink(root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => preflight.check({ ...input, currentDirectory: linkedRoot }), hasCode('self-current-directory-unverified'));
    assert(state.fetches.length > 0);
});
test('file/link, protected, disabled and missing packages are rejected before network access', async t => {
    const { preflight, input, state } = await fixture(t);
    for (const change of [{ update: undefined, source: 'link:owned-fixture' }, { update: 'git' }, { removable: false }, { availability: 'installation' }, { installed: false }, { enabled: false }, { readOnlyReason: 'management-required' }])
        await assert.rejects(() => preflight.check({ ...input, bundle: { ...input.bundle, ...change } }), hasCode('self-installed-source-unsupported'));
    assert.deepEqual(state.fetches, []);
});
test('same version, downgrade or prerelease target is never handed to the registry', async t => {
    const { preflight, input, state } = await fixture(t);
    for (const targetVersion of ['0.3.0', '0.2.9', '0.3.1-beta.1', 'not-a-version']) await assert.rejects(() => preflight.check({ ...input, targetVersion }), hasCode('self-target-version-unsupported'));
    assert.deepEqual(state.fetches, []);
});
test('private tarball, credentials, query parameters and mismatched integrity fail closed', async t => {
    const { preflight, input, state } = await fixture(t);
    for (const tarball of ['https://private.example.invalid/package.tgz', 'https://user:secret@registry.npmjs.org/package.tgz', `https://registry.npmjs.org/${SELF_UPDATE_PACKAGE}/-/${SELF_UPDATE_PACKAGE}-0.3.0.tgz?token=fixture`]) {
        state.metadataAlter = value => ({ ...value, dist: { ...value.dist, tarball } }); await assert.rejects(() => preflight.check(input), hasCode('self-tarball-origin-unsupported'));
    }
    state.metadataAlter = value => ({ ...value, dist: { ...value.dist, integrity: 'sha512-' + Buffer.alloc(64).toString('base64') } });
    await assert.rejects(() => preflight.check(input), hasCode('self-integrity-mismatch'));
});
test('registry runtime manifest mismatch and deprecated versions cannot replace the reviewed archive', async t => {
    const { preflight, input, state } = await fixture(t);
    state.metadataAlter = value => ({ ...value, dependencies: { yaml: '99.0.0' } }); await assert.rejects(() => preflight.check(input), hasCode('self-registry-manifest-mismatch'));
    state.metadataAlter = value => ({ ...value, deprecated: 'owned deprecated fixture' }); await assert.rejects(() => preflight.check(input), hasCode('self-version-deprecated'));
});
test('next Host peer, engine or client injection graph changes require a different reviewed path', async t => {
    const { preflight, input, state } = await fixture(t);
    for (const change of [value => value.peerDependencies['@deepseek-ai/dsh-tools'] = '>=0.2.2-rc.5 <0.3.0', value => value.engines.dsh = '>=0.2.2-rc.5 <0.3.0', value => value.dsh.client.inject.push('@deepseek-ai/dsh-client-locale')]) {
        state.nextManifest = manifest(); change(state.nextManifest); state.nextBytes = archive(state.nextManifest);
        await assert.rejects(() => preflight.check(input), hasCode('self-runtime-graph-changed'));
    }
});
test('revalidation rejects changed prepared target bytes and aborts before fetch for cancellation', async t => {
    const { preflight, input, state } = await fixture(t); const plan = await preflight.check(input);
    state.nextBytes = archive(state.nextManifest, [['package/docs/OWNED.md', 'changed target byte control']]);
    await assert.rejects(() => preflight.verifyPrepared(plan, input), hasCode('self-prepared-source-changed'));
    const abort = new AbortController(); abort.abort(new Error('owned cancellation')); const count = state.fetches.length;
    await assert.rejects(() => preflight.check({ ...input, signal: abort.signal }), /owned cancellation/); assert.equal(state.fetches.length, count);
});
