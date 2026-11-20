import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat, realpath, symlink } from 'node:fs/promises';
import { dirname, basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { GithubSelfUpdatePreflight, parseSelfGithubSource, SELF_UPDATE_GITHUB_REPOSITORY, SELF_UPDATE_GITHUB_SOURCE_LABEL } from '../lib/self-update-github.js';
import { SELF_UPDATE_PACKAGE } from '../lib/self-update-policy.js';

const REPO = 'elaina-agi/dsh-plugin-update-doctor', API = `https://api.github.com/repos/${REPO}`, RAW = `https://raw.githubusercontent.com/${REPO}`;
const PREVIOUS = 'a'.repeat(40), NEXT = 'b'.repeat(40);
const helper = Buffer.from('owned inert GitHub native helper fixture; never executed');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const helperSha256 = hash(helper), compatibility = () => undefined;
const attributes = '* text=auto eol=lf\n*.exe binary\n*.svg text eol=lf\n';
const lock = `lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: false\n  excludeLinksFromLockfile: false\nimporters:\n  .:\n    dependencies:\n      yaml:\n        specifier: 2.9.1\n        version: 2.9.1\npackages:\n  yaml@2.9.1:\n    resolution: {integrity: sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==}\n    engines: {node: '>= 14.6'}\n    hasBin: true\nsnapshots:\n  yaml@2.9.1: {}\n`;
const hasCode = code => error => error.code === code;
function manifest(version = '0.4.2') {
    return { name: SELF_UPDATE_PACKAGE, version, type: 'module', license: 'MIT',
        exports: { '.': './index.js', './client': './client.js', './locale/*.json': './locale/*.json', './icon': './icon.svg', './package.json': './package.json' },
        files: ['index.js', 'client.js', 'lib', 'native/win-x64/lock-probe.exe', 'native/LockProbe.cs', 'native/build.ps1', 'locale', 'docs', 'icon.svg', 'cordis.patch.yml', 'README.md'],
        engines: { node: '>=24.0.0', dsh: '>=0.2.2-rc.3 <0.3.0' }, dependencies: { yaml: '2.9.1' },
        peerDependencies: { '@deepseek-ai/dsh-tools': '>=0.2.2-rc.3 <0.3.0', '@deepseek-ai/dsh-app-boot': '>=0.2.2-rc.3 <0.3.0' },
        scripts: { test: 'node --test tests/*.test.mjs', check: 'node --check index.js' },
        dsh: { bundle: { patch: './cordis.patch.yml', platforms: ['win32'] }, client: { platform: 'web', immediately: true,
            inject: ['@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-modules'] } } };
}
function files(version = '0.4.2') {
    return new Map(Object.entries({ 'package.json': Buffer.from(JSON.stringify(manifest(version))),
        'index.js': Buffer.from("export function apply() { throw Error('fixture preflight must never execute source'); }"),
        'client.js': Buffer.from('// owned inert client'), 'cordis.patch.yml': Buffer.from(`- insert:\n    - id: plugin-update-doctor\n      name: ${SELF_UPDATE_PACKAGE}\n`),
        'icon.svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'locale/en.json': Buffer.from('{}'), 'locale/zh.json': Buffer.from('{}'),
        'native/win-x64/lock-probe.exe': helper, 'native/LockProbe.cs': Buffer.from('// fixture'), 'native/build.ps1': Buffer.from('# inert fixture'),
        'lib/owned.js': Buffer.from('// fixture'), 'docs/OWNED.md': Buffer.from('fixture'), README: Buffer.from('not a packed filename'), 'README.md': Buffer.from('fixture'), LICENSE: Buffer.from('MIT'),
        '.gitattributes': Buffer.from(attributes), '.gitignore': Buffer.from('node_modules/\n.tools/\n*.tgz\n!native/win-x64/lock-probe.exe\n'), 'pnpm-lock.yaml': Buffer.from(lock),
        'AGENTS.md': Buffer.from('inert repository instructions are never read by preflight'), 'tests/fixture.mjs': Buffer.from("throw Error('inert test file must not run')"),
        'experiments/fixture.mjs': Buffer.from("throw Error('inert experiment file must not run')") }));
}
function gitHash(type, bytes) { return createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex'); }
function gitTree(fileMap, overrides = new Map()) {
    const nodes = new Map();
    for (const [path, bytes] of fileMap) {
        const parts = path.split('/');
        for (let index = 1; index < parts.length; index++) { const dir = parts.slice(0, index).join('/'); if (!nodes.has(dir)) nodes.set(dir, { path: dir, mode: '040000', type: 'tree' }); }
        nodes.set(path, { path, mode: '100644', type: 'blob', sha: gitHash('blob', bytes), size: bytes.length, ...overrides.get(path) });
    }
    function directory(path = '') {
        const direct = [...nodes.values()].filter(node => dirname(node.path).replaceAll('\\', '/') === (path || '.'));
        for (const node of direct) if (node.type === 'tree') node.sha = directory(node.path);
        const sorted = direct.sort((a, b) => Buffer.compare(Buffer.from(a.path.split('/').at(-1) + (a.type === 'tree' ? '/' : '')), Buffer.from(b.path.split('/').at(-1) + (b.type === 'tree' ? '/' : ''))));
        const bytes = Buffer.concat(sorted.map(node => Buffer.concat([Buffer.from(`${node.type === 'tree' ? '40000' : node.mode} ${node.path.split('/').at(-1)}\0`), Buffer.from(node.sha, 'hex')])));
        return gitHash('tree', bytes);
    }
    const sha = directory(); return { sha, truncated: false, tree: [...nodes.values()] };
}
async function fixture(t) {
    const base = await realpath(tmpdir()), root = await mkdtemp(join(base, 'dsh-self-github-test-'));
    t.after(async () => {
        const absolute = await realpath(root), info = await lstat(root);
        assert.equal(absolute, resolve(root)); assert.equal(dirname(absolute), base); assert(basename(absolute).startsWith('dsh-self-github-test-')); assert(info.isDirectory() && !info.isSymbolicLink());
        await rm(absolute, { recursive: true, force: true });
    });
    const state = { previous: files('0.4.1'), next: files(), head: NEXT, fetches: [], treeAlter: null, commitAlter: null, blobAlter: null, responseAlter: null, overrides: new Map() };
    for (const [path, bytes] of state.previous) {
        if (!['package.json', 'README.md', 'LICENSE', 'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg'].includes(path)
            && !['lib/', 'locale/', 'docs/', 'native/'].some(prefix => path.startsWith(prefix))) continue;
        await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), bytes);
    }
    const fetcher = async (url, options) => {
        const text = String(url); state.fetches.push(text); options.signal.throwIfAborted();
        assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
        assert.deepEqual(Object.keys(options.headers), ['accept']); assert(!options.headers.authorization && !options.headers.cookie);
        let response;
        if (text === API) response = Response.json({ full_name: REPO, private: false, default_branch: 'main', ...state.repository });
        else if (text === API + '/git/ref/heads/main') response = Response.json({ ref: 'refs/heads/main', object: { type: 'commit', sha: state.head }, ...state.ref });
        else if (text.startsWith(API + '/git/commits/')) {
            const commit = text.slice((API + '/git/commits/').length), bytes = commit === PREVIOUS ? state.previous : state.next;
            const object = { sha: commit, tree: { sha: gitTree(bytes, state.overrides).sha } }; response = Response.json(state.commitAlter?.(object) ?? object);
        } else if (text.startsWith(API + '/git/trees/')) {
            const tree = text.slice((API + '/git/trees/').length).split('?')[0], previousTree = gitTree(state.previous, state.overrides), nextTree = gitTree(state.next, state.overrides);
            const value = tree === previousTree.sha ? previousTree : nextTree; assert.equal(value.sha, tree); response = Response.json(state.treeAlter?.(structuredClone(value)) ?? value);
        } else if (text.startsWith(RAW + '/')) {
            const [commit, ...parts] = text.slice((RAW + '/').length).split('/'), path = parts.map(decodeURIComponent).join('/');
            const map = commit === PREVIOUS ? state.previous : state.next, bytes = map.get(path); assert(bytes, `Unexpected fixed-origin blob ${path}`);
            response = new Response(state.blobAlter?.(bytes, path, commit) ?? bytes);
        } else assert.fail('Unexpected network endpoint');
        return state.responseAlter?.(response, text) ?? response;
    };
    const preflight = new GithubSelfUpdatePreflight({ fetcher, compatibility, helperSha256 });
    const input = { bundle: { name: SELF_UPDATE_PACKAGE, version: '0.4.1', source: `github:${REPO}#${PREVIOUS}`, update: 'git', installed: true, enabled: true, removable: true, availability: 'profile' },
        currentDirectory: root, targetVersion: '0.4.2', targetCommit: NEXT, resolvedYamlVersion: '2.9.1' };
    return { preflight, state, input, root };
}
function changeManifest(map, change) { const value = JSON.parse(map.get('package.json')); change(value); map.set('package.json', Buffer.from(JSON.stringify(value))); }

test('fixed public repository and exact commit source parser canonicalize safe saved Git forms', () => {
    assert.equal(SELF_UPDATE_GITHUB_REPOSITORY, REPO);
    for (const source of [`github:${REPO}#${PREVIOUS}`, `git+https://github.com/${REPO}.git#${PREVIOUS}`, `https://github.com/${REPO}#${PREVIOUS}`,
        `git+ssh://git@github.com/${REPO}.git#${PREVIOUS}`, `ssh://git@github.com/${REPO}#${PREVIOUS}`, `git+ssh://git@github.com:${REPO}.git#${PREVIOUS}`, `git@github.com:${REPO}.git#${PREVIOUS}`]) {
        assert.deepEqual(parseSelfGithubSource(source), { commit: PREVIOUS, spec: `github:${REPO}#${PREVIOUS}`, repository: REPO });
    }
});
test('parser refuses refs, tags, abbreviations, aliases, subdirectories, credentials, alternate origins and queries', () => {
    for (const source of [undefined, `github:${REPO}`, `github:${REPO}#main`, `github:${REPO}#v0.4.2`, `github:${REPO}#${PREVIOUS.slice(0, 7)}`,
        `github:${REPO}#${PREVIOUS.toUpperCase()}`, `github:other/dsh-plugin-update-doctor#${PREVIOUS}`, `github:Elaina-agi/dsh-plugin-update-doctor#${PREVIOUS}`,
        `github:${REPO}/subdir#${PREVIOUS}`, `git+https://user:secret@github.com/${REPO}.git#${PREVIOUS}`,
        `git+https://github.com:443/${REPO}.git#${PREVIOUS}`, `git+https://github.example/${REPO}.git#${PREVIOUS}`, `git+http://github.com/${REPO}.git#${PREVIOUS}`,
        `git+https://github.com/${REPO}.git?token=fixture#${PREVIOUS}`, `git+ssh://user@github.com/${REPO}.git#${PREVIOUS}`]) assert.throws(() => parseSelfGithubSource(source), hasCode('self-github-source-unsupported'));
});
test('explicit discovery resolves main once to exact commit and labels it as source head, not release', async t => {
    const { preflight, state, input } = await fixture(t), offer = await preflight.discover(input);
    assert.deepEqual(offer, { version: '0.4.2', commit: NEXT, spec: `github:${REPO}#${NEXT}`, repository: REPO, sourceKind: 'git', branch: 'main', sourceLabel: SELF_UPDATE_GITHUB_SOURCE_LABEL });
    assert.equal(state.fetches.filter(url => url.endsWith('/git/ref/heads/main')).length, 1);
    assert(state.fetches.includes(`${RAW}/${NEXT}/package.json`)); assert(!state.fetches.some(url => url.includes('/tests/') || url.includes('/experiments/')));
});
test('pair preflight verifies original installed runtime and exposes only bounded public evidence', async t => {
    const { preflight, state, input } = await fixture(t), plan = await preflight.check(input);
    assert.equal(plan.sourceKind, 'git'); assert.equal(plan.repository, REPO); assert.equal(plan.fromCommit, PREVIOUS); assert.equal(plan.toCommit, NEXT);
    assert.equal(plan.previousSpec, `github:${REPO}#${PREVIOUS}`); assert.equal(plan.nextSpec, `github:${REPO}#${NEXT}`);
    assert.equal(plan.from, '0.4.1'); assert.equal(plan.to, '0.4.2'); assert.equal(plan.next.files['index.js'], hash(state.next.get('index.js')));
    assert(Object.keys(plan.next.files).length <= 128); assert(Object.values(plan.next.files).every(value => /^[a-f0-9]{64}$/.test(value)));
    assert(!JSON.stringify(plan).includes(input.currentDirectory)); assert(!JSON.stringify(plan).includes('Buffer'));
    assert.equal(plan.next.files['tests/fixture.mjs'], undefined); assert.equal(plan.next.files['AGENTS.md'], undefined);
    assert.match(plan.next.sha256, /^[a-f0-9]{64}$/); assert.match(plan.next.controlFiles['pnpm-lock.yaml'], /^[a-f0-9]{64}$/);
    assert(!state.fetches.some(url => url.endsWith('/git/ref/heads/main')), 'Exact pair checks must not follow a moving branch');
    assert.deepEqual(await preflight.verifyPrepared(plan, input), plan);
});
test('installed receipt verification is offline and detects same-version code changes', async t => {
    const { preflight, state, input, root } = await fixture(t), plan = await preflight.check(input), requests = state.fetches.length;
    assert.deepEqual(await preflight.verifyInstalled(plan.previous, root), { status: 'verified', files: Object.keys(plan.previous.files).length });
    await writeFile(join(root, 'index.js'), '// altered'); await assert.rejects(() => preflight.verifyInstalled(plan.previous, root), hasCode('self-installed-original-unverified'));
    assert.equal(state.fetches.length, requests);
});
test('same-version source modification and JSON reformatting fail strict original byte comparison', async t => {
    const { preflight, input, root } = await fixture(t);
    const value = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); await writeFile(join(root, 'package.json'), JSON.stringify(value, null, 2));
    await assert.rejects(() => preflight.check(input), hasCode('self-installed-original-unverified'));
});
test('unsupported installed packages and source migrations fail before network', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const change of [{ name: 'foreign' }, { update: 'registry' }, { installed: false }, { enabled: false }, { removable: false }, { availability: 'installation' }, { readOnlyReason: 'protected' }, { error: 'load-error' }]) {
        await assert.rejects(() => preflight.check({ ...input, bundle: { ...input.bundle, ...change } }), hasCode('self-installed-source-unsupported'));
    }
    for (const source of [`github:${REPO}#main`, `file:C:/owned/package.tgz`, `github:other/repo#${PREVIOUS}`]) await assert.rejects(() => preflight.discover({ ...input, bundle: { ...input.bundle, source } }), hasCode('self-github-source-unsupported'));
    assert.deepEqual(state.fetches, []);
});
test('stable newer version and full distinct commit are prerequisites before network', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const targetVersion of ['0.4.1', '0.3.9', '0.4.2-beta.1', '0.04.2', '9007199254740992.0.0', 'invalid']) await assert.rejects(() => preflight.check({ ...input, targetVersion }), hasCode('self-target-version-unsupported'));
    for (const targetCommit of [PREVIOUS, 'main', NEXT.slice(0, 7), NEXT.toUpperCase(), undefined]) await assert.rejects(() => preflight.check({ ...input, targetCommit }), hasCode('self-github-commit-unsupported'));
    assert.deepEqual(state.fetches, []);
});
test('discovery distinguishes no newer stable head from malformed or prerelease version', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const version of ['0.4.1', '0.3.0']) { changeManifest(state.next, value => value.version = version); await assert.rejects(() => preflight.discover(input), hasCode('self-github-no-newer-version')); }
    for (const version of ['0.4.2-beta.1', '0.04.2', '9007199254740992.0.0']) { changeManifest(state.next, value => value.version = version); await assert.rejects(() => preflight.discover(input), hasCode('self-target-version-unsupported')); }
});
test('public repository and fixed main commit shape are checked rather than accepting redirected metadata', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const repository of [{ private: true }, { full_name: 'other/repo' }, { default_branch: 'develop' }]) { state.repository = repository; await assert.rejects(() => preflight.discover(input), hasCode('self-github-repository-unsupported')); }
    state.repository = {};
    for (const ref of [{ ref: 'refs/tags/main' }, { object: { type: 'tag', sha: NEXT } }, { object: { type: 'commit', sha: 'main' } }]) { state.ref = ref; await assert.rejects(() => preflight.discover(input), hasCode('self-github-head-invalid')); }
});
test('commit identity and recursive tree hashes bind runtime paths before any source blob is trusted', async t => {
    const { preflight, state, input } = await fixture(t);
    state.commitAlter = object => ({ ...object, sha: NEXT }); await assert.rejects(() => preflight.check(input), hasCode('self-github-commit-mismatch'));
    state.commitAlter = null;
    for (const alter of [value => ({ ...value, sha: 'c'.repeat(40) }), value => ({ ...value, truncated: true })]) { state.treeAlter = alter; await assert.rejects(() => preflight.check(input), hasCode('self-github-tree-invalid')); }
    state.treeAlter = value => { value.tree.find(entry => entry.path === 'index.js').sha = 'c'.repeat(40); return value; };
    await assert.rejects(() => preflight.check(input), hasCode('self-github-tree-hash-mismatch'));
});
test('Git blob hash and declared byte length are checked for every fetched source/control file', async t => {
    const { preflight, state, input } = await fixture(t);
    state.blobAlter = (bytes, path) => path === 'index.js' ? Buffer.from(bytes.toString().replace('fixture', 'altered')) : bytes;
    await assert.rejects(() => preflight.check(input), error => ['self-github-blob-hash-mismatch', 'self-github-response-too-large'].includes(error.code));
    state.blobAlter = (bytes, path) => path === 'pnpm-lock.yaml' ? Buffer.alloc(bytes.length, 32) : bytes;
    await assert.rejects(() => preflight.check(input), hasCode('self-github-blob-hash-mismatch'));
});
test('links, executable aliases and submodules are rejected throughout tree, including ignored tests', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const override of [{ mode: '120000' }, { mode: '160000', type: 'commit' }, { mode: '100664' }]) {
        state.overrides = new Map([['tests/fixture.mjs', override]]); await assert.rejects(() => preflight.check(input), hasCode('self-github-tree-mode-unsupported'));
    }
});
test('traversal, case aliases, missing parents, ADS and Windows reserved tree names fail before fetching blobs', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const alter of [value => { value.tree.push({ ...value.tree.find(entry => entry.path === 'index.js'), path: 'INDEX.js' }); return value; },
        value => { value.tree.find(entry => entry.path === 'index.js').path = '../index.js'; return value; },
        value => { value.tree.find(entry => entry.path === 'index.js').path = 'lib/NUL.js'; return value; },
        value => { value.tree.find(entry => entry.path === 'index.js').path = 'lib/own:ads.js'; return value; },
        value => { value.tree = value.tree.filter(entry => entry.path !== 'lib'); return value; }]) {
        state.treeAlter = alter; await assert.rejects(() => preflight.check(input), error => ['self-github-tree-path-unsupported', 'self-github-tree-parent-invalid'].includes(error.code));
    }
});
test('Git packing controls, nested manifests, workspaces and unreviewed lockfiles anywhere are rejected', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const path of ['.npmignore', '.npmrc', '.pnpmfile.cjs', '.gitmodules', 'lib/.gitattributes', 'tests/.gitignore', 'pnpm-workspace.yaml', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'bun.lockb', 'lib/package.json', '.git/config', 'node_modules/owned.js', 'binding.gyp', 'tests/binding.gyp']) {
        state.next.set(path, Buffer.from('inert unsafe control')); await assert.rejects(() => preflight.check(input), hasCode('self-github-pack-control-unsupported')); state.next.delete(path);
    }
});
test('only exact reviewed root attributes are accepted, not filters or archive substitutions', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const text of ['* filter=owned\n', '* export-subst\n', 'lib export-ignore\n', attributes + '* text\n']) {
        state.next.set('.gitattributes', Buffer.from(text)); await assert.rejects(() => preflight.check(input), hasCode('self-github-pack-control-unsupported'));
    }
});
test('Git ignore fallback control is bounded, rejects dangerous negations, and cannot change between versions', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const text of ['!lib/owned.js\n', '../owned\n', 'lib\\owned\n', 'path\0owned\n']) {
        state.next.set('.gitignore', Buffer.from(text)); await assert.rejects(() => preflight.check(input), hasCode('self-github-pack-control-unsupported'));
    }
    state.next.set('.gitignore', Buffer.from('node_modules/\n')); await assert.rejects(() => preflight.check(input), hasCode('self-github-pack-controls-changed'));
});
test('reviewed YAML lock cannot introduce dependencies, hooks, alternative archives or policies', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const text of [lock.replaceAll('2.9.1', '2.9.2'), lock.replace('sha512-3NxN8', 'sha512-0NxN8'), lock + 'overrides: {yaml: 9.0.0}\n', lock + 'importers: {}\n', lock.replace('yaml@2.9.1: {}', 'yaml@2.9.1: {dependencies: {owned: 1.0.0}}')]) {
        state.next.set('pnpm-lock.yaml', Buffer.from(text)); await assert.rejects(() => preflight.check(input), hasCode('self-github-lock-policy-unsupported'));
    }
});
test('positive files inventory is exact: no selectors, globs, missing runtime directories or extra files', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const change of [value => value.files.push('tests'), value => value.files.push('lib/*.js'), value => value.files.push('!lib/owned.js'), value => value.files.pop(), value => value.files.push('lib'), value => delete value.files]) {
        state.next = files(); changeManifest(state.next, change); await assert.rejects(() => preflight.check(input), hasCode('self-github-files-policy-unsupported'));
    }
});
test('Git prepare/install/pack hooks and dependency-resolution controls cannot run during handoff', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const key of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish', 'dependencies']) {
        state.next = files(); changeManifest(state.next, value => value.scripts[key] = 'echo unsafe'); await assert.rejects(() => preflight.check(input), hasCode('self-install-scripts-unsupported'));
    }
    for (const change of [value => value.workspaces = ['tests'], value => value.packageManager = 'pnpm@11.28.5', value => value.devDependencies = { owned: '1.0.0' }, value => value.devEngines = {}, value => value.config = { owned: true }, value => value.gypfile = true]) {
        state.next = files(); changeManifest(state.next, change); await assert.rejects(() => preflight.check(input), hasCode('self-github-pack-policy-unsupported'));
    }
    for (const key of ['start', 'pretest', 'posttest', 'precheck', 'postcheck', 'build']) {
        state.next = files(); changeManifest(state.next, value => value.scripts[key] = 'echo unsafe'); await assert.rejects(() => preflight.check(input), hasCode('self-install-scripts-unsupported'));
    }
});
test('runtime policy still refuses helper changes, new natives, foreign takeover and dependency changes', async t => {
    const { preflight, state, input } = await fixture(t);
    state.next.set('native/win-x64/lock-probe.exe', Buffer.from('altered helper')); await assert.rejects(() => preflight.check(input), hasCode('self-native-helper-changed'));
    state.next = files(); state.next.set('lib/addon.node', Buffer.from('new native')); await assert.rejects(() => preflight.check(input), hasCode('self-archive-file-unsupported'));
    state.next = files(); state.next.set('cordis.patch.yml', Buffer.from('- id: core\n  disabled: true\n')); await assert.rejects(() => preflight.check(input), hasCode('self-patch-unsupported'));
    state.next = files(); changeManifest(state.next, value => value.dependencies.owned = '1.0.0'); await assert.rejects(() => preflight.check(input), hasCode('self-dependency-policy-unsupported'));
});
test('runtime peer, engine and client graph cannot change between original and target', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const change of [value => value.peerDependencies['@deepseek-ai/dsh-tools'] = '>=0.2.2-rc.5 <0.3.0', value => value.engines.dsh = '>=0.2.2-rc.5 <0.3.0', value => value.dsh.client.inject.pop()]) {
        state.next = files(); changeManifest(state.next, change); await assert.rejects(() => preflight.check(input), hasCode('self-runtime-graph-changed'));
    }
});
test('version identity must match commit package and resolved YAML/compatibility remain mandatory', async t => {
    const { preflight, state, input } = await fixture(t);
    await assert.rejects(() => preflight.check({ ...input, targetVersion: '0.4.3' }), hasCode('self-archive-identity-mismatch'));
    await assert.rejects(() => preflight.check({ ...input, resolvedYamlVersion: '2.9.2' }), hasCode('self-yaml-version-unverified'));
    preflight.compatibility = () => ({ requirements: { dsh: '99' } }); await assert.rejects(() => preflight.discover(input), hasCode('self-version-incompatible'));
    preflight.compatibility = undefined; await assert.rejects(() => preflight.discover(input), hasCode('self-runtime-compatibility-unverified'));
    changeManifest(state.previous, value => value.version = '0.4.0'); await assert.rejects(() => preflight.check(input), hasCode('self-archive-identity-mismatch'));
});
test('missing required runtime or linked installed resource is rejected without execution', async t => {
    const { preflight, state, input, root } = await fixture(t);
    state.next.delete('client.js'); await assert.rejects(() => preflight.check(input), hasCode('self-required-file-missing'));
    state.next = files(); const library = join(root, 'lib'); assert.equal(dirname(library), root); await rm(library, { recursive: true });
    await symlink(root, library, process.platform === 'win32' ? 'junction' : 'dir'); await assert.rejects(() => preflight.check(input), hasCode('self-installed-original-unverified'));
});
test('tree count, individual source sizes and runtime inventory are bounded before excess blob requests', async t => {
    const { preflight, state, input } = await fixture(t);
    state.treeAlter = value => ({ ...value, tree: Array.from({ length: 513 }, (_, index) => ({ path: `tests/owned${index}`, type: 'blob', mode: '100644', sha: 'c'.repeat(40), size: 1 })) });
    await assert.rejects(() => preflight.check(input), hasCode('self-github-tree-invalid'));
    state.treeAlter = value => { value.tree.find(entry => entry.path === 'index.js').size = 4 * 1024 * 1024 + 1; return value; };
    await assert.rejects(() => preflight.check(input), hasCode('self-github-tree-size-unsupported'));
    state.treeAlter = null; for (let index = 0; index < 129; index++) state.next.set(`lib/excess-${index}.js`, Buffer.from('// fixture'));
    await assert.rejects(() => preflight.check(input), hasCode('self-archive-file-count-unsupported'));
});
test('HTTP failures, redirect destinations, content lengths and streamed metadata enforce request bounds', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const status of [403, 429]) { state.responseAlter = () => new Response('', { status }); await assert.rejects(() => preflight.discover(input), hasCode('self-github-rate-limited')); }
    state.responseAlter = () => new Response('', { status: 404 }); await assert.rejects(() => preflight.discover(input), hasCode('self-github-response-unavailable'));
    state.responseAlter = response => ({ ok: true, body: response.body, headers: response.headers, url: 'https://alternate.example.invalid/' });
    await assert.rejects(() => preflight.discover(input), hasCode('self-github-response-origin-unsupported'));
    state.responseAlter = () => new Response('{}', { headers: { 'content-length': String(1024 * 1024 + 1) } });
    await assert.rejects(() => preflight.discover(input), hasCode('self-github-response-too-large'));
    state.responseAlter = () => new Response(' '.repeat(1024 * 1024 + 1)); await assert.rejects(() => preflight.discover(input), hasCode('self-github-response-too-large'));
});
test('compressed wire Content-Length does not reject small decoded Git blobs, while stream bounds remain strict', async t => {
    const { preflight, state, input } = await fixture(t);
    for (const encoding of ['gzip', 'br']) {
        state.responseAlter = (response, url) => {
            if (!url.startsWith(RAW + '/')) return response;
            const [commit, ...parts] = url.slice((RAW + '/').length).split('/');
            const file = (commit === PREVIOUS ? state.previous : state.next).get(parts.map(decodeURIComponent).join('/'));
            return { ok: true, status: 200, body: response.body, headers: new Headers({
                'content-encoding': encoding, 'content-length': String(file.length + 20) }) };
        };
        await preflight.check(input);
    }
    state.responseAlter = () => new Response(' '.repeat(1024 * 1024 + 1), { headers: { 'content-encoding': 'gzip', 'content-length': '59' } });
    await assert.rejects(() => preflight.discover(input), hasCode('self-github-response-too-large'));
    state.responseAlter = () => new Response('{}', { headers: { 'content-encoding': 'identity', 'content-length': String(1024 * 1024 + 1) } });
    await assert.rejects(() => preflight.discover(input), hasCode('self-github-response-too-large'));
});
test('pre-aborted operations make no requests and changed prepared evidence cannot revalidate', async t => {
    const { preflight, state, input } = await fixture(t), abort = new AbortController(); abort.abort(new Error('owned user cancellation'));
    await assert.rejects(() => preflight.check({ ...input, signal: abort.signal }), /owned user cancellation/);
    await assert.rejects(() => preflight.discover({ ...input, signal: abort.signal }), /owned user cancellation/); assert.deepEqual(state.fetches, []);
    const plan = await preflight.check(input); const altered = structuredClone(plan); altered.toCommit = 'c'.repeat(40);
    await assert.rejects(() => preflight.verifyPrepared(altered, input), hasCode('self-prepared-source-changed'));
});
test('reviewed current Git ignore bytes pass and network exceptions remain sanitized', async t => {
    const { preflight, state, input } = await fixture(t);
    const bytes = await readFile(new URL('../.gitignore', import.meta.url)); state.previous.set('.gitignore', bytes); state.next.set('.gitignore', bytes);
    await preflight.check(input);
    preflight.fetcher = async () => { throw new Error('private C:/path secret url must not escape'); };
    await assert.rejects(() => preflight.discover(input), error => error.code === 'self-github-network' && error.message === 'self-github-network');
});
test('cancellation between streamed body chunks cancels the reader and preserves user abort reason', async t => {
    const { preflight, state, input } = await fixture(t), controller = new AbortController(); let cancelled = false;
    state.responseAlter = () => ({ ok: true, headers: new Headers(), body: { getReader() { return {
        async read() { controller.abort(new Error('owned streaming cancellation')); return { done: false, value: Buffer.from('{}') }; },
        async cancel() { cancelled = true; }, releaseLock() {} }; } } });
    await assert.rejects(() => preflight.discover({ ...input, signal: controller.signal }), /owned streaming cancellation/);
    assert.equal(cancelled, true);
});
test('production Git preflight uses no subprocess, credential helper, arbitrary endpoints or execution primitives', async () => {
    const source = await readFile(new URL('../lib/self-update-github.js', import.meta.url), 'utf8');
    assert(!/child_process|\bspawn\(|\beval\(|new Function|\bimport\([^)]/.test(source));
    assert(!/authorization:|cookie:|credential.helper|\.git\/config/.test(source));
});
