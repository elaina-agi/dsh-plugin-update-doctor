import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';
import { inspectSelfFiles, verifyCurrentFiles, stableNewer, SelfUpdatePreflight, SELF_UPDATE_PACKAGE,
    SELF_UPDATE_YAML_VERSION, SELF_UPDATE_HELPER_SHA256 } from './self-update-policy.js';

export const SELF_UPDATE_GITHUB_REPOSITORY = 'elaina-agi/dsh-plugin-update-doctor';
export const SELF_UPDATE_GITHUB_BRANCH = 'main';
export const SELF_UPDATE_GITHUB_SOURCE_LABEL = 'GitHub main HEAD (not a release)';
const API = `https://api.github.com/repos/${SELF_UPDATE_GITHUB_REPOSITORY}`;
const RAW = `https://raw.githubusercontent.com/${SELF_UPDATE_GITHUB_REPOSITORY}`;
const SHA = /^[a-f0-9]{40}$/;
const STABLE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const MAX_METADATA = 1024 * 1024, MAX_FILE = 4 * 1024 * 1024, MAX_FILES = 128;
const MAX_TREE = 512, MAX_TOTAL = 16 * 1024 * 1024, MAX_REQUESTS = 272;
const HELPER = 'native/win-x64/lock-probe.exe';
const FILE_SELECTORS = ['index.js', 'client.js', 'lib', 'native/win-x64/lock-probe.exe', 'native/LockProbe.cs',
    'native/build.ps1', 'locale', 'docs', 'icon.svg', 'cordis.patch.yml', 'README.md'];
const ATTRIBUTES = '* text=auto eol=lf\n*.exe binary\n*.svg text eol=lf\n';
const YAML_INTEGRITY = 'sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted) : plain(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const equal = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
function fail(code) { throw Object.assign(new Error(code), { code }); }
function need(condition, code) { if (!condition) fail(code); }
function canonicalSpec(commit) { need(SHA.test(commit ?? ''), 'self-github-commit-unsupported'); return `github:${SELF_UPDATE_GITHUB_REPOSITORY}#${commit}`; }

/** Accept only this public repository pinned to a full lowercase commit, never a moving ref or source migration. */
export function parseSelfGithubSource(source) {
    need(typeof source === 'string' && source.length <= 256, 'self-github-source-unsupported');
    const repo = SELF_UPDATE_GITHUB_REPOSITORY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [new RegExp(`^github:${repo}#([a-f0-9]{40})$`),
        new RegExp(`^(?:git\\+)?https://github\\.com/${repo}(?:\\.git)?#([a-f0-9]{40})$`),
        new RegExp(`^(?:git\\+)?ssh://git@github\\.com/${repo}(?:\\.git)?#([a-f0-9]{40})$`),
        new RegExp(`^git\\+ssh://git@github\\.com:${repo}(?:\\.git)?#([a-f0-9]{40})$`),
        new RegExp(`^git@github\\.com:${repo}(?:\\.git)?#([a-f0-9]{40})$`)];
    const match = patterns.map(pattern => pattern.exec(source)).find(Boolean);
    need(match, 'self-github-source-unsupported');
    return { commit: match[1], spec: canonicalSpec(match[1]), repository: SELF_UPDATE_GITHUB_REPOSITORY };
}
function sourceOf(bundle) {
    need(bundle?.name === SELF_UPDATE_PACKAGE && bundle.update === 'git' && bundle.installed === true
        && bundle.enabled === true && bundle.removable === true && bundle.availability === 'profile'
        && !bundle.readOnlyReason && !bundle.error, 'self-installed-source-unsupported');
    need(STABLE.test(bundle.version ?? '') && bundle.version.split('.').every(value => Number.isSafeInteger(Number(value))), 'self-target-version-unsupported');
    return parseSelfGithubSource(bundle.source);
}
function pathSafe(path) {
    return typeof path === 'string' && path.length > 0 && path.length <= 200 && path.split('/').length <= 12
        && path.split('/').every(part => part && part !== '.' && part !== '..' && /^[\x20-\x7e]+$/.test(part)
            && !/[<>:"\\|?*]/.test(part) && !/[ .]$/.test(part)
            && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
function unsafeControl(path) {
    const leaf = path.split('/').at(-1).toLowerCase();
    if (path === '.gitattributes' || path === '.gitignore' || path === 'pnpm-lock.yaml') return false;
    return /^(?:\.git(?:attributes|ignore|modules)?|\.npm(?:ignore|rc)|\.pnpmfile(?:\..*)?|pnpm-workspace(?:\..*)?|pnpm-lock\.(?:yaml|yml)|(?:package-lock|npm-shrinkwrap)\.json|yarn\.lock|bun\.lockb?|\.yarnrc(?:\..*)?|\.pnp\..*|lerna\.json|binding\.gyp|\.gypi?)$/.test(leaf)
        || path.split('/').some(part => ['.git', 'node_modules', '.yarn', '.pnpm'].includes(part.toLowerCase()))
        || leaf === 'package.json' && path !== 'package.json';
}
function gitHash(kind, bytes) { return createHash('sha1').update(`${kind} ${bytes.length}\0`).update(bytes).digest('hex'); }
function parseJson(bytes, code) {
    try { const value = JSON.parse(bytes.toString('utf8')); need(plain(value), code); return value; }
    catch (error) { if (error.code) throw error; fail(code); }
}
function treeEntries(value, expectedSha) {
    need(plain(value) && value.sha === expectedSha && value.truncated === false && Array.isArray(value.tree)
        && value.tree.length > 0 && value.tree.length <= MAX_TREE, 'self-github-tree-invalid');
    const entries = new Map(), folds = new Set(); let declaredBytes = 0;
    for (const entry of value.tree) {
        need(plain(entry) && pathSafe(entry.path) && SHA.test(entry.sha ?? '') && !folds.has(entry.path.toLowerCase()), 'self-github-tree-path-unsupported');
        need((entry.type === 'tree' && entry.mode === '040000') || (entry.type === 'blob' && ['100644', '100755'].includes(entry.mode)), 'self-github-tree-mode-unsupported');
        if (entry.type === 'blob') {
            need(Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= MAX_FILE, 'self-github-tree-size-unsupported');
            declaredBytes += entry.size; need(declaredBytes <= MAX_TOTAL * 2, 'self-github-tree-size-unsupported');
        }
        need(!unsafeControl(entry.path), 'self-github-pack-control-unsupported');
        folds.add(entry.path.toLowerCase()); entries.set(entry.path, entry);
    }
    const children = new Map([['', []]]);
    for (const entry of entries.values()) {
        const split = entry.path.lastIndexOf('/'), parent = split < 0 ? '' : entry.path.slice(0, split);
        need(parent === '' || entries.get(parent)?.type === 'tree', 'self-github-tree-parent-invalid');
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(entry);
        if (entry.type === 'tree' && !children.has(entry.path)) children.set(entry.path, []);
    }
    // Reconstruct every Git tree object, not just an unverified recursive path listing.
    for (const [path, direct] of children) {
        const ordered = direct.map(entry => ({ entry, name: entry.path.slice(entry.path.lastIndexOf('/') + 1) }))
            .sort((a, b) => Buffer.compare(Buffer.from(a.name + (a.entry.type === 'tree' ? '/' : '')), Buffer.from(b.name + (b.entry.type === 'tree' ? '/' : ''))));
        const bytes = Buffer.concat(ordered.map(({ entry, name }) => Buffer.concat([
            Buffer.from(`${entry.type === 'tree' ? '40000' : entry.mode} ${name}\0`), Buffer.from(entry.sha, 'hex')])));
        need(gitHash('tree', bytes) === (path === '' ? expectedSha : entries.get(path).sha), 'self-github-tree-hash-mismatch');
    }
    return entries;
}
function packing(manifest, entries) {
    need(manifest.name === SELF_UPDATE_PACKAGE && Array.isArray(manifest.files)
        && manifest.files.length >= FILE_SELECTORS.length && manifest.files.length <= FILE_SELECTORS.length + 1
        && new Set(manifest.files).size === manifest.files.length
        && FILE_SELECTORS.every(path => manifest.files.includes(path))
        && manifest.files.every(path => FILE_SELECTORS.includes(path) || path === 'LICENSE'), 'self-github-files-policy-unsupported');
    for (const key of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish', 'dependencies']) {
        need(!manifest.scripts?.[key], 'self-install-scripts-unsupported');
    }
    need(manifest.scripts === undefined || plain(manifest.scripts) && Object.keys(manifest.scripts).every(key => ['test', 'check'].includes(key)), 'self-install-scripts-unsupported');
    // These can change Git checkout/pack dependency resolution even when runtime fields look unchanged.
    need(manifest.workspaces === undefined && manifest.packageManager === undefined && manifest.devEngines === undefined
        && manifest.devDependencies === undefined && manifest.config === undefined && manifest.gypfile === undefined, 'self-github-pack-policy-unsupported');
    const files = [];
    for (const entry of entries.values()) {
        if (entry.type !== 'blob') continue;
        if (['package.json', 'README.md', 'LICENSE'].includes(entry.path) || manifest.files.some(selector => entry.path === selector || entry.path.startsWith(selector + '/'))) files.push(entry);
    }
    need(files.length > 0 && files.length <= MAX_FILES, 'self-archive-file-count-unsupported');
    let total = 0; for (const entry of files) { total += entry.size; need(total <= MAX_TOTAL, 'self-archive-size-unsupported'); }
    return files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
function checkedLock(bytes) {
    let value;
    try {
        const document = parseDocument(bytes.toString('utf8'), { uniqueKeys: true, maxAliasCount: 0, schema: 'core' });
        need(!document.errors.length && !document.warnings.length, 'self-github-lock-policy-unsupported');
        value = document.toJS({ maxAliasCount: 0 });
    } catch (error) { if (error.code) throw error; fail('self-github-lock-policy-unsupported'); }
    const expected = { lockfileVersion: '9.0', settings: { autoInstallPeers: false, excludeLinksFromLockfile: false },
        importers: { '.': { dependencies: { yaml: { specifier: SELF_UPDATE_YAML_VERSION, version: SELF_UPDATE_YAML_VERSION } } } },
        packages: { 'yaml@2.9.1': { resolution: { integrity: YAML_INTEGRITY }, engines: { node: '>= 14.6' }, hasBin: true } },
        snapshots: { 'yaml@2.9.1': {} } };
    need(equal(value, expected), 'self-github-lock-policy-unsupported');
}
async function responseBytes(response, maximum, signal) {
    need(response?.ok && response.body && typeof response.body.getReader === 'function', 'self-github-response-unavailable');
    const declared = response.headers?.get('content-length'), encoding = response.headers?.get('content-encoding')?.trim().toLowerCase();
    // Fetch exposes decoded bytes, while Content-Length measures the compressed wire payload.
    // Compression overhead can exceed a tiny Git blob's exact decoded size; the stream limit below
    // remains authoritative for every encoding and blob() still verifies exact length/hash.
    need(encoding && encoding !== 'identity' || declared == null || /^\d+$/.test(declared) && Number(declared) <= maximum, 'self-github-response-too-large');
    const reader = response.body.getReader(), chunks = []; let total = 0;
    try {
        while (true) {
            signal.throwIfAborted(); const { done, value } = await reader.read(); if (done) break;
            total += value.length; need(total <= maximum, 'self-github-response-too-large'); chunks.push(Buffer.from(value));
        }
        signal.throwIfAborted(); return Buffer.concat(chunks, total);
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Read-only fixed-public-repository preflight. No Git/npm commands, code execution, or prepared-byte installation. */
export class GithubSelfUpdatePreflight {
    constructor({ fetcher = fetch, compatibility, helperSha256 = SELF_UPDATE_HELPER_SHA256 } = {}) {
        Object.assign(this, { fetcher, compatibility, helperSha256 });
        this.installedVerifier = new SelfUpdatePreflight({ compatibility, helperSha256 });
    }
    context(signal) { return { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000), requests: 0, bytes: 0 }; }
    async fetchBytes(url, maximum, context) {
        context.signal.throwIfAborted(); need(++context.requests <= MAX_REQUESTS, 'self-github-request-limit');
        let response;
        try { response = await this.fetcher(url, { signal: context.signal, redirect: 'error', credentials: 'omit',
            headers: { accept: url.startsWith(API + '/') || url === API ? 'application/vnd.github+json' : 'application/octet-stream' } }); }
        catch { context.signal.throwIfAborted(); fail('self-github-network'); }
        need(![403, 429].includes(response?.status), 'self-github-rate-limited');
        need(!response?.url || response.url === url, 'self-github-response-origin-unsupported');
        const bytes = await responseBytes(response, maximum, context.signal);
        context.bytes += bytes.length; need(context.bytes <= MAX_TOTAL * 2 + 8 * MAX_METADATA, 'self-github-response-too-large');
        return bytes;
    }
    async api(path, context) { return parseJson(await this.fetchBytes(API + path, MAX_METADATA, context), 'self-github-api-invalid'); }
    async publicRepository(context) {
        const value = await this.api('', context);
        need(value.full_name === SELF_UPDATE_GITHUB_REPOSITORY && value.private === false && value.default_branch === SELF_UPDATE_GITHUB_BRANCH,
            'self-github-repository-unsupported');
    }
    async descriptor(commit, context) {
        need(SHA.test(commit ?? ''), 'self-github-commit-unsupported');
        const object = await this.api(`/git/commits/${commit}`, context);
        need(object.sha === commit && plain(object.tree) && SHA.test(object.tree.sha ?? ''), 'self-github-commit-mismatch');
        const tree = object.tree.sha, entries = treeEntries(await this.api(`/git/trees/${tree}?recursive=1`, context), tree);
        const packageEntry = entries.get('package.json'); need(packageEntry?.type === 'blob' && packageEntry.size <= 512 * 1024, 'self-github-manifest-missing');
        const bytes = await this.blob(commit, packageEntry, context);
        const manifest = parseJson(bytes, 'self-github-manifest-invalid'), selected = packing(manifest, entries);
        return { commit, tree, entries, manifest, selected, packageBytes: bytes };
    }
    async blob(commit, entry, context) {
        const bytes = await this.fetchBytes(`${RAW}/${commit}/${entry.path.split('/').map(encodeURIComponent).join('/')}`, entry.size, context);
        need(bytes.length === entry.size && gitHash('blob', bytes) === entry.sha, 'self-github-blob-hash-mismatch');
        return bytes;
    }
    async controls(descriptor, context) {
        const files = new Map();
        for (const [path, max] of [['.gitattributes', 1024], ['.gitignore', 16 * 1024], ['pnpm-lock.yaml', 64 * 1024]]) {
            const entry = descriptor.entries.get(path); if (!entry) continue;
            need(entry.type === 'blob' && entry.size <= max, 'self-github-pack-control-unsupported');
            const bytes = await this.blob(descriptor.commit, entry, context);
            if (path === '.gitattributes') need(bytes.equals(Buffer.from(ATTRIBUTES)), 'self-github-pack-control-unsupported');
            if (path === '.gitignore') {
                // An explicit positive files inventory wins; nevertheless refuse traversal, wildcard negations,
                // Windows aliases, escaped patterns and control characters in this Git-pack fallback input.
                const lines = bytes.toString('utf8').split('\n');
                need(lines.every(line => !line || line.startsWith('#') || /^[!a-zA-Z0-9_.*\/-]+$/.test(line)
                    && !line.includes('..') && !line.includes('\\') && (!line.startsWith('!') || line === '!' + HELPER)), 'self-github-pack-control-unsupported');
            }
            if (path === 'pnpm-lock.yaml') checkedLock(bytes);
            files.set(path, bytes);
        }
        return files;
    }
    async snapshot(descriptor, role, resolvedYamlVersion, context) {
        const controls = await this.controls(descriptor, context);
        const files = new Map([['package.json', descriptor.packageBytes]]);
        for (const entry of descriptor.selected) if (entry.path !== 'package.json') files.set(entry.path, await this.blob(descriptor.commit, entry, context));
        const inspected = inspectSelfFiles(files, { version: descriptor.manifest.version, role, resolvedYamlVersion,
            compatibility: this.compatibility, helperSha256: this.helperSha256 });
        need(inspected.manifest.dependencies.yaml === SELF_UPDATE_YAML_VERSION, 'self-yaml-dependency-unsupported');
        return { ...descriptor, ...inspected, controls };
    }
    publicReference(value) {
        const files = Object.fromEntries([...value.files].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([path, bytes]) => [path, hash(bytes)]));
        const controls = Object.fromEntries([...value.controls].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([path, bytes]) => [path, hash(bytes)]));
        const sha256 = hash(Buffer.from(JSON.stringify(sorted({ format: 'github-tree-v1', repository: SELF_UPDATE_GITHUB_REPOSITORY,
            commit: value.commit, tree: value.tree, files, controlFiles: controls }))));
        return { sha256, manifest: value.manifest, files, commit: value.commit, tree: value.tree, controlFiles: controls };
    }
    /** Invoke only for an explicit user scan; main is a source head, not a release-channel guarantee. */
    async discover({ bundle, signal, resolvedYamlVersion } = {}) {
        sourceOf(bundle); const context = this.context(signal); await this.publicRepository(context);
        const ref = await this.api('/git/ref/heads/main', context);
        need(ref.ref === 'refs/heads/main' && plain(ref.object) && ref.object.type === 'commit' && SHA.test(ref.object.sha ?? ''), 'self-github-head-invalid');
        const descriptor = await this.descriptor(ref.object.sha, context), version = descriptor.manifest.version;
        need(STABLE.test(version ?? '') && version.split('.').every(value => Number.isSafeInteger(Number(value))), 'self-target-version-unsupported');
        if (!stableNewer(version, bundle.version)) fail('self-github-no-newer-version');
        need(descriptor.manifest.dependencies?.yaml === SELF_UPDATE_YAML_VERSION && (resolvedYamlVersion === undefined || resolvedYamlVersion === SELF_UPDATE_YAML_VERSION), 'self-yaml-version-unverified');
        need(typeof this.compatibility === 'function', 'self-runtime-compatibility-unverified');
        need(!this.compatibility(descriptor.manifest), 'self-version-incompatible');
        await this.controls(descriptor, context); context.signal.throwIfAborted();
        return { version, commit: descriptor.commit, spec: canonicalSpec(descriptor.commit), repository: SELF_UPDATE_GITHUB_REPOSITORY,
            sourceKind: 'git', branch: SELF_UPDATE_GITHUB_BRANCH, sourceLabel: SELF_UPDATE_GITHUB_SOURCE_LABEL };
    }
    async check({ bundle, currentDirectory, targetVersion, targetCommit, resolvedYamlVersion, signal } = {}) {
        const source = sourceOf(bundle);
        need(STABLE.test(targetVersion ?? '') && stableNewer(targetVersion, bundle.version), 'self-target-version-unsupported');
        need(SHA.test(targetCommit ?? '') && targetCommit !== source.commit, 'self-github-commit-unsupported');
        const context = this.context(signal); await this.publicRepository(context);
        const original = await this.descriptor(source.commit, context);
        need(original.manifest.version === bundle.version, 'self-archive-identity-mismatch');
        const previous = await this.snapshot(original, 'previous', resolvedYamlVersion, context);
        await verifyCurrentFiles(currentDirectory, previous.files); context.signal.throwIfAborted();
        const target = await this.descriptor(targetCommit, context);
        need(target.manifest.version === targetVersion, 'self-archive-identity-mismatch');
        const next = await this.snapshot(target, 'next', resolvedYamlVersion, context);
        for (const key of ['exports', 'peerDependencies', 'engines']) need(equal(previous.manifest[key], next.manifest[key]), 'self-runtime-graph-changed');
        need(equal(previous.manifest.dsh.client, next.manifest.dsh.client), 'self-runtime-graph-changed');
        // Exact original control bytes are evidence too; changing Git fallback/lock behavior needs a new review.
        need(equal(Object.fromEntries([...previous.controls].map(([path, bytes]) => [path, hash(bytes)])),
            Object.fromEntries([...next.controls].map(([path, bytes]) => [path, hash(bytes)]))), 'self-github-pack-controls-changed');
        context.signal.throwIfAborted();
        return { name: SELF_UPDATE_PACKAGE, sourceKind: 'git', repository: SELF_UPDATE_GITHUB_REPOSITORY,
            fromCommit: source.commit, toCommit: targetCommit, previousSpec: source.spec, nextSpec: canonicalSpec(targetCommit),
            from: bundle.version, to: targetVersion, currentManifest: previous.manifest,
            previous: this.publicReference(previous), next: this.publicReference(next) };
    }
    async verifyInstalled(reference, currentDirectory) { return this.installedVerifier.verifyInstalled(reference, currentDirectory); }
    async verifyPrepared(preflight, options) {
        const actual = await this.check({ ...options, targetVersion: preflight?.to, targetCommit: preflight?.toCommit });
        need(equal(actual, preflight), 'self-prepared-source-changed'); return actual;
    }
}
