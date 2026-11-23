import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseDocument } from 'yaml';
import { archiveEntries } from './generation.js';
import { boundedFile } from './file-read.js';
import { PUBLIC_REGISTRY, PUBLIC_MIRROR, publicRegistry, approvedPublicRegistry, registryOrigin } from './source.js';

export const SELF_UPDATE_PACKAGE = 'dsh-plugin-update-doctor';
export const SELF_UPDATE_YAML_VERSION = '2.9.1';
export const SELF_UPDATE_HELPER_SHA256 = '0d3422152918d219c333201e084d7883cea92fbcda6bf3108371e3cf664c0340';
const MAX_ARCHIVE = 16 * 1024 * 1024;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_METADATA = 512 * 1024;
const VERSION = /^\d+\.\d+\.\d+$/;
const HELPER = 'native/win-x64/lock-probe.exe';
const EXPORTS = { '.': './index.js', './client': './client.js', './locale/*.json': './locale/*.json', './icon': './icon.svg', './package.json': './package.json' };
const HOST_PEERS = ['@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-tools'];
const REQUIRED = ['package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'locale/en.json', 'locale/zh.json', HELPER];
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const normalized = value => Array.isArray(value) ? value.map(normalized) : plain(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])])) : value;
const equal = (left, right) => JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
function refuse(code, message = code) { throw Object.assign(new Error(message), { code }); }
function required(condition, code, message) { if (!condition) refuse(code, message); }
function json(bytes, code) {
    required(bytes.length <= MAX_METADATA, code);
    try { const value = JSON.parse(bytes.toString('utf8')); required(plain(value), code); return value; }
    catch (error) { if (error.code) throw error; refuse(code); }
}
export function stableNewer(next, prior) {
    if (!VERSION.test(next ?? '') || !VERSION.test(prior ?? '')) return false;
    const a = next.split('.').map(Number), b = prior.split('.').map(Number);
    if (![...a, ...b].every(Number.isSafeInteger)) return false;
    for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index];
    return false;
}
function safeFilePath(path) {
    const parts = path.split('/');
    return parts.length > 0 && parts.every(part => part && !/[\x00-\x1f<>:"\\|?*]/.test(part) && !/[ .]$/.test(part)
        && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
function admittedFile(path) {
    return ['package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'native/LockProbe.cs', 'native/build.ps1', HELPER].includes(path)
        || /^lib\/[a-zA-Z0-9_-]+\.js$/.test(path)
        || /^locale\/[a-zA-Z0-9_-]+\.json$/.test(path)
        || /^docs\/[a-zA-Z0-9_.-]+\.md$/.test(path);
}
function noExtras(manifest) {
    const noKeys = ['optionalDependencies', 'bundledDependencies', 'bundleDependencies', 'overrides', 'resolutions', 'publishConfig'];
    for (const key of noKeys) {
        const value = manifest[key];
        required(value === undefined || (plain(value) && Object.keys(value).length === 0) || (Array.isArray(value) && value.length === 0), 'self-dependency-policy-unsupported');
    }
    required(manifest.pnpm === undefined || plain(manifest.pnpm) && Object.keys(manifest.pnpm).length === 0, 'self-dependency-policy-unsupported');
    required(manifest.bin === undefined, 'self-runtime-graph-unsupported');
    required(manifest.scripts === undefined || plain(manifest.scripts), 'self-install-scripts-unsupported');
    for (const key of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish']) {
        required(manifest.scripts?.[key] === undefined || manifest.scripts[key] === '', 'self-install-scripts-unsupported');
    }
}
function validateManifest(manifest, { version, role, resolvedYamlVersion, compatibility }) {
    required(manifest.name === SELF_UPDATE_PACKAGE && manifest.version === version && VERSION.test(version ?? ''), 'self-archive-identity-mismatch');
    required(manifest.type === 'module' && manifest.main === undefined && manifest.imports === undefined, 'self-runtime-graph-unsupported');
    required(equal(manifest.exports, EXPORTS), 'self-runtime-exports-unsupported');
    const ownBundle = plain(manifest.dsh) && plain(manifest.dsh.bundle);
    required(ownBundle && (equal(manifest.dsh.bundle, { patch: './cordis.patch.yml', platforms: ['win32'] })
        || equal(manifest.dsh.bundle, { patch: 'cordis.patch.yml', platforms: ['win32'] })), 'self-bundle-policy-unsupported');
    const allowedClientInject = ['@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar', '@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-modules'];
    required(plain(manifest.dsh.client) && manifest.dsh.client.platform === 'web' && manifest.dsh.client.immediately === true
        && Array.isArray(manifest.dsh.client.inject) && manifest.dsh.client.inject.length > 0
        && new Set(manifest.dsh.client.inject).size === manifest.dsh.client.inject.length && manifest.dsh.client.inject.every(value => allowedClientInject.includes(value))
        && Object.keys(manifest.dsh.client).every(key => ['platform', 'immediately', 'inject'].includes(key))
        && Object.keys(manifest.dsh).every(key => ['bundle', 'client'].includes(key)), 'self-runtime-graph-unsupported');
    required(plain(manifest.engines) && manifest.engines.node === '>=24.0.0' && typeof manifest.engines.dsh === 'string'
        && Object.keys(manifest.engines).every(key => ['node', 'dsh'].includes(key)), 'self-runtime-graph-unsupported');
    required(plain(manifest.peerDependencies) && equal(Object.keys(manifest.peerDependencies).sort(), HOST_PEERS)
        && Object.values(manifest.peerDependencies).every(value => typeof value === 'string' && value.length > 0), 'self-peer-graph-unsupported');
    required(manifest.peerDependenciesMeta === undefined || plain(manifest.peerDependenciesMeta) && Object.keys(manifest.peerDependenciesMeta).length === 0, 'self-peer-graph-unsupported');
    required(resolvedYamlVersion === SELF_UPDATE_YAML_VERSION, 'self-yaml-version-unverified');
    required(plain(manifest.dependencies) && equal(Object.keys(manifest.dependencies), ['yaml']), 'self-dependency-policy-unsupported');
    const wanted = manifest.dependencies.yaml;
    required(role === 'next' ? wanted === SELF_UPDATE_YAML_VERSION : wanted === SELF_UPDATE_YAML_VERSION || wanted === '^2.9.0', 'self-yaml-dependency-unsupported');
    noExtras(manifest);
    required(Number(process.versions.node.split('.')[0]) >= 24, 'self-node-runtime-unsupported');
    required(typeof compatibility === 'function', 'self-runtime-compatibility-unverified');
    required(!compatibility(manifest), 'self-version-incompatible');
}

/** Narrow self-only preflight. It parses verified bytes and never imports or executes their JavaScript. */
export function inspectSelfArchive(bytes, { version, role = 'next', resolvedYamlVersion, compatibility, helperSha256 = SELF_UPDATE_HELPER_SHA256 } = {}) {
    required(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_ARCHIVE, 'self-archive-size-unsupported');
    required(['previous', 'next'].includes(role), 'self-archive-role-invalid');
    required(/^[a-f0-9]{64}$/.test(helperSha256 ?? ''), 'self-helper-digest-unverified');
    let entries;
    try { entries = archiveEntries(bytes); } catch (error) { refuse('self-archive-invalid', error.message); }
    const files = new Map();
    for (const entry of entries) {
        const path = entry.name.slice('package/'.length);
        required(!files.has(path), 'self-archive-path-unsupported');
        files.set(path, entry.bytes);
    }
    return { ...inspectSelfFiles(files, { version, role, resolvedYamlVersion, compatibility, helperSha256 }), sha256: digest(bytes) };
}

/** Shared static runtime policy for npm archive entries and commit-bound GitHub blobs. */
export function inspectSelfFiles(files, { version, role = 'next', resolvedYamlVersion, compatibility, helperSha256 = SELF_UPDATE_HELPER_SHA256 } = {}) {
    required(files instanceof Map && ['previous', 'next'].includes(role), 'self-archive-role-invalid');
    required(/^[a-f0-9]{64}$/.test(helperSha256 ?? ''), 'self-helper-digest-unverified');
    const folded = new Set(); let total = 0;
    for (const [path, bytes] of files) {
        required(typeof path === 'string' && safeFilePath(path) && !folded.has(path.toLowerCase()), 'self-archive-path-unsupported');
        folded.add(path.toLowerCase());
        required(admittedFile(path) && Buffer.isBuffer(bytes) && bytes.length <= MAX_FILE, 'self-archive-file-unsupported');
        total += bytes.length; required(total <= MAX_ARCHIVE, 'self-archive-size-unsupported');
    }
    required(files.size <= 128, 'self-archive-file-count-unsupported');
    for (const path of REQUIRED) required(files.has(path), 'self-required-file-missing');
    const manifest = json(files.get('package.json'), 'self-archive-manifest-invalid');
    validateManifest(manifest, { version, role, resolvedYamlVersion, compatibility });
    const patch = files.get('cordis.patch.yml');
    required(patch.length <= MAX_METADATA && !/!!|!<|\b(?:include|extends):/i.test(patch.toString('utf8')), 'self-patch-unsupported');
    let document;
    try { document = parseDocument(patch.toString('utf8'), { uniqueKeys: true, maxAliasCount: 0, schema: 'core' }); }
    catch { refuse('self-patch-unsupported'); }
    required(document.errors.length === 0 && document.warnings.length === 0, 'self-patch-unsupported');
    let composed;
    try { composed = document.toJS({ maxAliasCount: 0 }); } catch { refuse('self-patch-unsupported'); }
    required(equal(composed, [{ insert: [{ id: 'plugin-update-doctor', name: SELF_UPDATE_PACKAGE }] }]), 'self-patch-unsupported');
    required(digest(files.get(HELPER)) === helperSha256, 'self-native-helper-changed');
    return { manifest, files };
}

/** The official path retains its strict no-fallback policy. The fixed mirror path
 * is separate and allows only already-configured, known public npm/mirror sources.
 * Returning normalized public facts permits confirmation to bind the entire plan.
 */
export function verifySelfRegistryPlan(registries, queryRegistry) {
    const query = registryOrigin(queryRegistry);
    required(approvedPublicRegistry(query), 'self-query-origin-unverified');
    if (query !== PUBLIC_MIRROR) {
        required(plain(registries) && Array.isArray(registries.fallbackRegistries) && registries.fallbackRegistries.length === 0
            && (registries.registry === null ? publicRegistry(registries.resolved) : publicRegistry(registries.registry))
            && (registries.resolved == null || publicRegistry(registries.resolved)), 'self-host-registry-plan-unsupported');
        return { queryRegistry: PUBLIC_REGISTRY, registry: registries.registry === null ? null : PUBLIC_REGISTRY,
            resolved: registries.resolved == null ? null : PUBLIC_REGISTRY, fallbackRegistries: [] };
    }
    required(plain(registries) && Array.isArray(registries.fallbackRegistries) && registries.fallbackRegistries.length <= 8
        && approvedPublicRegistry(registries.resolved)
        && (registries.registry === null || approvedPublicRegistry(registries.registry))
        && registries.fallbackRegistries.every(approvedPublicRegistry), 'self-host-registry-plan-unsupported');
    return { queryRegistry: PUBLIC_MIRROR, registry: registries.registry === null ? null : registryOrigin(registries.registry),
        resolved: registryOrigin(registries.resolved), fallbackRegistries: registries.fallbackRegistries.map(registryOrigin) };
}
function metadataIdentity(metadata, version, inspected) {
    required(metadata.name === SELF_UPDATE_PACKAGE && metadata.version === version, 'self-registry-identity-mismatch');
    // Registry-only fields are excluded. Runtime-bearing declarations must agree with the packed manifest.
    for (const key of ['name', 'version', 'type', 'exports', 'dsh', 'engines', 'dependencies', 'optionalDependencies', 'bundledDependencies', 'bundleDependencies', 'peerDependencies', 'peerDependenciesMeta', 'scripts', 'overrides', 'resolutions', 'pnpm', 'main', 'imports', 'bin']) {
        required(equal(metadata[key], inspected.manifest[key]), 'self-registry-manifest-mismatch');
    }
    required(metadata.deprecated === undefined || metadata.deprecated === '', 'self-version-deprecated');
}
async function body(response, maximum) {
    const chunks = []; let length = 0;
    required(response.body, 'self-registry-response-empty');
    const reader = response.body.getReader();
    try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; required(length <= maximum, 'self-registry-response-too-large'); chunks.push(Buffer.from(value)); } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return Buffer.concat(chunks, length);
}
function verifyIntegrity(bytes, value) {
    required(typeof value === 'string', 'self-integrity-missing');
    const expected = createHash('sha512').update(bytes).digest('base64');
    required(value.split(/\s+/).some(hash => hash.startsWith('sha512-') && hash.slice(7).split('?')[0] === expected), 'self-integrity-mismatch');
}
function checkedFileHashes(reference) {
    const files = reference?.files;
    required(plain(files), 'self-installed-files-unverified');
    const entries = Object.entries(files); const folded = new Set();
    required(entries.length > 0 && entries.length <= 128, 'self-installed-files-unverified');
    for (const [path, hash] of entries) {
        required(path.length <= 200 && safeFilePath(path) && admittedFile(path) && !folded.has(path.toLowerCase())
            && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash), 'self-installed-files-unverified');
        folded.add(path.toLowerCase());
    }
    for (const path of REQUIRED) required(Object.hasOwn(files, path), 'self-installed-files-unverified');
    return entries;
}
async function checkedCurrentRoot(currentDirectory) {
    required(typeof currentDirectory === 'string' && isAbsolute(currentDirectory), 'self-current-directory-unverified');
    const root = resolve(currentDirectory); let ancestor = root;
    while (true) {
        const info = await lstat(ancestor);
        required(info.isDirectory() && !info.isSymbolicLink(), 'self-current-directory-unverified');
        const parent = dirname(ancestor); if (parent === ancestor) break; ancestor = parent;
    }
    required(await realpath(root) === root, 'self-current-directory-unverified');
    return root;
}
async function checkedCurrentFile(root, path) {
    let target = root; const segments = path.split('/');
    for (const [index, segment] of segments.entries()) {
        target = join(target, segment); const rel = relative(root, target);
        required(rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep), 'self-installed-original-unverified');
        const info = await lstat(target);
        required(!info.isSymbolicLink() && (index === segments.length - 1 ? info.isFile() : info.isDirectory()), 'self-installed-original-unverified');
    }
    return target;
}
export async function verifyCurrentFiles(currentDirectory, files) {
    const root = await checkedCurrentRoot(currentDirectory);
    for (const [path, bytes] of files) {
        const target = await checkedCurrentFile(root, path);
        let installed;
        try { installed = await boundedFile(target, MAX_FILE); } catch { refuse('self-installed-original-unverified'); }
        required(installed.equals(bytes), 'self-installed-original-unverified');
    }
}

/** Fixed official/mirror archive preflight only: the Host still installs by registry
 * spec. Mirror bytes must independently equal canonical official archive digests. */
export class SelfUpdatePreflight {
    constructor({ fetcher = fetch, compatibility, helperSha256 = SELF_UPDATE_HELPER_SHA256 } = {}) {
        Object.assign(this, { fetcher, compatibility, helperSha256 });
    }
    async fetchArchive(version, role, resolvedYamlVersion, signal, registry = PUBLIC_REGISTRY) {
        const source = registryOrigin(registry);
        required(approvedPublicRegistry(source) && VERSION.test(version ?? ''), 'self-query-origin-unverified');
        const options = { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000), redirect: 'error', credentials: 'omit' };
        options.signal.throwIfAborted();
        const read = async origin => {
            const metadataURL = `${origin}/${SELF_UPDATE_PACKAGE}/${version}`;
            const metadataResponse = await this.fetcher(metadataURL, options);
            required(metadataResponse.ok, 'self-registry-metadata-unavailable');
            required(!metadataResponse.url || metadataResponse.url === metadataURL, 'self-tarball-origin-unsupported');
            const metadata = json(await body(metadataResponse, MAX_METADATA), 'self-registry-metadata-invalid');
            required(metadata.name === SELF_UPDATE_PACKAGE && metadata.version === version, 'self-registry-identity-mismatch');
            let url;
            try { url = new URL(metadata.dist?.tarball); } catch { refuse('self-tarball-origin-unsupported'); }
            required(url.protocol === 'https:' && (url.origin === origin || origin === PUBLIC_MIRROR && url.origin === PUBLIC_REGISTRY)
                && !url.username && !url.password && !url.search && !url.hash
                && url.pathname === `/${SELF_UPDATE_PACKAGE}/-/${SELF_UPDATE_PACKAGE}-${version}.tgz`, 'self-tarball-origin-unsupported');
            const response = await this.fetcher(url, options); required(response.ok, 'self-archive-unavailable');
            required(!response.url || response.url === url.href, 'self-tarball-origin-unsupported');
            const bytes = await body(response, MAX_ARCHIVE); verifyIntegrity(bytes, metadata.dist?.integrity);
            const inspected = inspectSelfArchive(bytes, { version, role, resolvedYamlVersion, compatibility: this.compatibility, helperSha256: this.helperSha256 });
            metadataIdentity(metadata, version, inspected);
            return { ...inspected, integrity: metadata.dist.integrity, canonicalIntegrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
        };
        const downloaded = await read(source);
        if (source === PUBLIC_MIRROR) {
            const canonical = await read(PUBLIC_REGISTRY);
            required(downloaded.sha256 === canonical.sha256 && downloaded.canonicalIntegrity === canonical.canonicalIntegrity,
                'self-public-mirror-archive-mismatch');
            return { ...downloaded, integrity: canonical.canonicalIntegrity };
        }
        const { canonicalIntegrity, ...official } = downloaded;
        return official;
    }
    async check({ bundle, currentDirectory, targetVersion, resolvedYamlVersion, registries, queryRegistry, signal } = {}) {
        required(bundle?.name === SELF_UPDATE_PACKAGE && bundle.update === 'registry' && bundle.installed === true && bundle.enabled === true
            && bundle.removable === true && bundle.availability === 'profile' && !bundle.readOnlyReason && !bundle.error, 'self-installed-source-unsupported');
        required(stableNewer(targetVersion, bundle.version), 'self-target-version-unsupported');
        const registry = registryOrigin(queryRegistry), publicMirror = registry === PUBLIC_MIRROR;
        const hostRegistryPlan = verifySelfRegistryPlan(registries, queryRegistry);
        signal?.throwIfAborted();
        const previous = await this.fetchArchive(bundle.version, 'previous', resolvedYamlVersion, signal, registry);
        await verifyCurrentFiles(currentDirectory, previous.files);
        const next = await this.fetchArchive(targetVersion, 'next', resolvedYamlVersion, signal, registry);
        for (const key of ['exports', 'peerDependencies', 'engines']) required(equal(previous.manifest[key], next.manifest[key]), 'self-runtime-graph-changed');
        required(equal(previous.manifest.dsh.client, next.manifest.dsh.client), 'self-runtime-graph-changed');
        const publicArchive = value => ({ sha256: value.sha256, integrity: value.integrity, manifest: value.manifest,
            files: Object.fromEntries([...value.files].map(([path, bytes]) => [path, digest(bytes)])) });
        signal?.throwIfAborted();
        return { name: SELF_UPDATE_PACKAGE, from: bundle.version, to: targetVersion, registry, currentManifest: previous.manifest,
            ...(publicMirror ? { sourceMode: 'public-mirror', publicMirror: true, hostRegistryPlan } : {}),
            previous: publicArchive(previous), next: publicArchive(next) };
    }
    /** Verify the recorded original resource hashes locally, independently of version labels and registry queries. */
    async verifyInstalled(reference, currentDirectory) {
        const entries = checkedFileHashes(reference);
        const root = await checkedCurrentRoot(currentDirectory);
        for (const [path, hash] of entries) {
            const target = await checkedCurrentFile(root, path);
            let bytes;
            try { bytes = await boundedFile(target, MAX_FILE); } catch { refuse('self-installed-original-unverified'); }
            required(digest(bytes) === hash, 'self-installed-original-unverified');
        }
        return { status: 'verified', files: entries.length };
    }
    async verifyPrepared(preflight, options) {
        const actual = await this.check({ ...options, targetVersion: preflight?.to });
        required(equal(actual, preflight), 'self-prepared-source-changed');
        return actual;
    }
}
