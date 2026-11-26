import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import { archiveEntries } from './generation.js';
import { fetchRegistryArchive, fetchRegistryMetadata } from './registry-download.js';
import { safeWinArchivePath, unionRangeMatches } from './union-generation.js';

/**
 * Resolve and fetch a complete runtime dependency closure from the public registry.
 *
 * The closure is only ever materialised from public npm bytes whose SRI and manifest
 * identity are verified, so an isolated generation can be built for a target version whose
 * dependency declarations the installed tree no longer satisfies. Nothing here mutates the
 * profile: a plan is read-only, and a download failure leaves no trace beyond the doctor's
 * own cache.
 *
 * Resolution follows npm semantics per owner: each declared range resolves independently, so
 * two owners that need different majors of the same package receive separate physical copies
 * nested under their owner. The materialised tree is the same shape the isolated generation
 * embeds, and the existing snapshot/layout verifiers read it unchanged.
 */
const STABLE = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const HOST = name => name.startsWith('@deepseek-ai/');
export const CLOSURE_LIMITS = Object.freeze({ packages: 64, depth: 5, packageBytes: 16 * 1024 * 1024, totalBytes: 40 * 1024 * 1024, files: 20_000 });
const fail = code => { throw Object.assign(Error(code), { code }); };
const check = (condition, code) => { if (!condition) fail(code); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sri = bytes => 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const compare = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

/** Reject dependency values the registry cannot be trusted to resolve through. */
function checkRange(name, range) {
    if (!NAME.test(name) || typeof range !== 'string' || !range.length || range.length > 256) fail('dependency-closure-source');
    if (/^(?:file|link|git|git\+|workspace|npm|https?):/i.test(range) || range.includes('/')) fail('dependency-closure-source');
}

/** Declarative, platform-neutral package policy for a downloaded dependency. */
function checkManifest(manifest, name, version) {
    if (manifest?.name !== name || manifest?.version !== version) fail('dependency-closure-metadata-mismatch');
    if (manifest.gypfile) fail('dependency-closure-native');
    for (const key of ['preinstall', 'install', 'postinstall', 'prepare']) if (manifest.scripts?.[key]) fail('dependency-closure-script');
    for (const key of ['os', 'cpu', 'libc']) if (manifest[key] !== undefined) fail('dependency-closure-native');
    if (Object.keys(manifest.optionalDependencies ?? {}).length) fail('dependency-closure-source');
    if (Object.keys(manifest.bundledDependencies ?? manifest.bundleDependencies ?? {}).length) fail('dependency-closure-source');
}

function pickVersion(packument, name, range) {
    const versions = Object.keys(packument?.versions ?? {}).filter(version => STABLE.test(version) && unionRangeMatches(version, range));
    if (!versions.length) fail('dependency-closure-unavailable');
    versions.sort(compare);
    const version = versions[versions.length - 1];
    const metadata = packument.versions[version];
    if (typeof metadata?.dist?.integrity !== 'string' || !/^sha512-[A-Za-z0-9+/=]+$/.test(metadata.dist.integrity)
        || !/^https:\/\/registry\.npmjs\.org\//.test(String(metadata.dist?.tarball ?? ''))) fail('dependency-closure-integrity');
    return { version, metadata };
}

/**
 * Walk the declared dependency ranges into an owner-scoped graph. `download` is false for the
 * read-only scan, which only proves every range can be resolved.
 * @returns {Promise<{baseline: object[], nodes: object[], planned: number, totalBytes: number, digest: string}>}
 */
export async function resolveClosure(manifest, { fetcher = fetch, signal, download = true } = {}) {
    if (!manifest || typeof manifest !== 'object') fail('dependency-closure-source');
    const packuments = new Map(), nodes = new Map();
    const load = async name => {
        if (!packuments.has(name)) {
            const response = await fetchRegistryMetadata(fetcher, new URL('/' + name.replace('/', '%2f'), 'https://registry.npmjs.org/'),
                { signal, credentials: 'omit', headers: { accept: 'application/json' } });
            if (!response?.ok) fail('dependency-closure-unavailable');
            packuments.set(name, await response.json());
        }
        return packuments.get(name);
    };
    const resolve = async (name, range, depth) => {
        signal?.throwIfAborted();
        if (depth > CLOSURE_LIMITS.depth) fail('dependency-closure-depth');
        const { version, metadata } = pickVersion(await load(name), name, range);
        const key = name + '@' + version, known = nodes.get(key);
        if (known) {
            if (known.integrity !== metadata.dist.integrity) fail('dependency-closure-integrity');
            return key;
        }
        if (nodes.size >= CLOSURE_LIMITS.packages) fail('dependency-closure-too-large');
        const node = { key, name, version, integrity: metadata.dist.integrity, tarball: metadata.dist.tarball, edges: [] };
        nodes.set(key, node);
        for (const [child, childRange] of Object.entries(metadata.dependencies ?? {})) {
            if (HOST(child)) continue;
            checkRange(child, childRange);
            node.edges.push({ name: child, range: childRange, target: await resolve(child, childRange, depth + 1) });
        }
        node.edges.sort((a, b) => a.name.localeCompare(b.name));
        return key;
    };
    const baseline = [];
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
        if (HOST(name)) continue;
        checkRange(name, range);
        baseline.push({ name, range, target: await resolve(name, range, 1) });
    }
    baseline.sort((a, b) => a.name.localeCompare(b.name));
    const ordered = [...nodes.values()].sort((a, b) => a.key.localeCompare(b.key));
    // The plan digest deliberately excludes tarball bytes so a read-only plan and the
    // downloading stage produce the same admission value.
    const digest = sha256(JSON.stringify({
        baseline: baseline.map(({ name, target }) => [name, target]),
        nodes: ordered.map(node => [node.key, node.integrity, node.edges.map(({ name, range, target }) => [name, range, target])]),
    }));
    const plan = { baseline, nodes: ordered, planned: ordered.length, digest, totalBytes: 0 };
    if (!download) return plan;
    let totalBytes = 0;
    for (const node of ordered) {
        signal?.throwIfAborted();
        const response = await fetchRegistryArchive(fetcher, node.tarball, { signal, credentials: 'omit', redirect: 'error' }, { name: node.name, version: node.version });
        if (!response?.ok) fail('dependency-closure-unavailable');
        const length = Number(response.headers.get('content-length'));
        if (Number.isFinite(length) && length > CLOSURE_LIMITS.packageBytes) fail('dependency-closure-too-large');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > CLOSURE_LIMITS.packageBytes) fail('dependency-closure-too-large');
        totalBytes += bytes.length;
        if (totalBytes > CLOSURE_LIMITS.totalBytes) fail('dependency-closure-too-large');
        if (sri(bytes) !== node.integrity) fail('dependency-closure-integrity');
        const entries = archiveEntries(bytes);
        const packed = entries.find(entry => entry.name === 'package/package.json');
        if (!packed) fail('dependency-closure-metadata-mismatch');
        checkManifest(JSON.parse(packed.bytes.toString('utf8')), node.name, node.version);
        node.bytes = bytes; node.sha256 = sha256(bytes); node.entries = entries.length;
    }
    return { ...plan, totalBytes };
}

/**
 * Write a resolved closure as an owner-scoped `node_modules` tree. A package whose visible
 * copy already satisfies its range is not copied again; an incompatible range gets its own
 * nested copy under the owner. Paths are validated before any write.
 */
export async function materializeClosure(root, closure, { signal } = {}) {
    const base = resolvePath(root);
    const files = new Map();
    const add = (target, bytes) => {
        safeWinArchivePath('package/' + target);
        check(!files.has(target), 'dependency-closure-duplicate');
        files.set(target, bytes);
        check(files.size <= CLOSURE_LIMITS.files, 'dependency-closure-too-large');
    };
    if (Array.isArray(closure?.portableFiles) && Array.isArray(closure?.nodes)) {
        // Installed copies are reused in place; a downloaded package replaces the visible copy
        // at exactly the path npm would use, including that copy's own nested corrections.
        const placements = closure.nodes.map(node => node.placement);
        const replaced = target => placements.some(path => target === path || target.startsWith(path + '/'));
        for (const file of closure.portableFiles) if (!replaced(file.name)) add(file.name, file.bytes);
        for (const node of closure.nodes) {
            check(node.bytes, 'dependency-closure-source');
            for (const entry of archiveEntries(node.bytes)) {
                if (!entry.name.startsWith('package/')) continue;
                const relative = entry.name.slice('package/'.length);
                if (!relative) continue;
                add(node.placement + '/' + relative, entry.bytes);
            }
        }
    } else {
        const byKey = new Map((closure?.nodes ?? []).map(node => [node.key, node]));
        const baseline = new Map((closure?.baseline ?? []).map(edge => [edge.name, edge.target]));
        const emit = (key, prefix, visible, ancestors) => {
            signal?.throwIfAborted();
            check(!ancestors.includes(key), 'dependency-closure-cycle');
            const node = byKey.get(key);
            check(node?.bytes, 'dependency-closure-source');
            for (const entry of archiveEntries(node.bytes)) {
                if (!entry.name.startsWith('package/')) continue;
                const relative = entry.name.slice('package/'.length);
                if (!relative) continue;
                add(prefix + '/' + relative, entry.bytes);
            }
            const corrections = (node.edges ?? []).filter(edge => visible.get(edge.name) !== edge.target);
            const next = new Map(visible);
            for (const edge of corrections) next.set(edge.name, edge.target);
            for (const edge of corrections) emit(edge.target, prefix + '/node_modules/' + edge.name, next, [...ancestors, key]);
        };
        for (const [name, target] of baseline) emit(target, 'node_modules/' + name, baseline, []);
    }
    let total = 0;
    for (const [target, bytes] of files) {
        total += bytes.length;
        check(total <= CLOSURE_LIMITS.totalBytes, 'dependency-closure-too-large');
        const path = join(base, ...target.split('/'));
        check(path.startsWith(base + sep), 'dependency-closure-source');
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes, { flag: 'wx' });
    }
    return { files: files.size, digest: closure.digest };
}

const joinPath = (base, name) => (base ? base + '/node_modules/' : 'node_modules/') + name;

/**
 * Resolve only the declarations the already verified installed closure cannot satisfy.
 * Installed copies stay in place (the existing snapshot proves their bytes), and a missing
 * range is downloaded and placed at the same path npm would use, replacing a visible copy
 * whose version no longer satisfies the new declaration.
 */
export async function resolveMissingClosure(manifest, snapshot, { fetcher = fetch, signal, download = true } = {}) {
    if (!manifest || typeof manifest !== 'object') fail('dependency-closure-source');
    if (!snapshot || !Array.isArray(snapshot.packages) || !Array.isArray(snapshot.layout) || !Array.isArray(snapshot.portableFiles)) fail('dependency-closure-source');
    const byKey = new Map(snapshot.packages.map(pkg => [pkg.key, pkg]));
    const copies = new Map();
    for (const row of snapshot.layout) {
        const pkg = byKey.get(row.key);
        if (pkg) copies.set(row.path, { ...pkg, path: row.path });
    }
    const visible = (fromPath, name) => {
        let cursor = fromPath;
        while (true) {
            const candidate = copies.get(joinPath(cursor, name));
            if (candidate) return candidate;
            if (!cursor) return null;
            const cut = cursor.lastIndexOf('/node_modules/');
            cursor = cut < 0 ? '' : cursor.slice(0, cut);
        }
    };
    const packuments = new Map(), fresh = new Map();
    const load = async name => {
        if (!packuments.has(name)) {
            const response = await fetchRegistryMetadata(fetcher, new URL('/' + name.replace('/', '%2f'), 'https://registry.npmjs.org/'),
                { signal, credentials: 'omit', headers: { accept: 'application/json' } });
            if (!response?.ok) fail('dependency-closure-unavailable');
            packuments.set(name, await response.json());
        }
        return packuments.get(name);
    };
    const reuse = [];
    const resolveEdge = async (ownerPath, name, range, depth) => {
        signal?.throwIfAborted();
        if (depth > CLOSURE_LIMITS.depth) fail('dependency-closure-depth');
        const existing = visible(ownerPath, name);
        if (existing && unionRangeMatches(existing.version, range)) {
            if (!ownerPath) reuse.push({ name, version: existing.version, target: existing.key });
            return;
        }
        const placement = joinPath(ownerPath, name);
        const occupied = copies.get(placement);
        if (occupied && unionRangeMatches(occupied.version, range)) return;
        if (fresh.has(placement)) {
            check(unionRangeMatches(fresh.get(placement).version, range), 'dependency-closure-conflict');
            return;
        }
        const { version, metadata } = pickVersion(await load(name), name, range);
        const key = name + '@' + version;
        check(fresh.size < CLOSURE_LIMITS.packages, 'dependency-closure-too-large');
        const node = { key, name, version, integrity: metadata.dist.integrity, tarball: metadata.dist.tarball, placement, edges: [] };
        fresh.set(placement, node);
        copies.set(placement, { key, name, version, manifest: metadata, path: placement, edges: [] });
        for (const [child, childRange] of Object.entries(metadata.dependencies ?? {})) {
            if (HOST(child)) continue;
            checkRange(child, childRange);
            node.edges.push({ name: child, range: childRange, target: await resolveEdge(placement, child, childRange, depth + 1) });
        }
        node.edges.sort((a, b) => a.name.localeCompare(b.name));
    };
    for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
        if (HOST(name)) continue;
        checkRange(name, range);
        await resolveEdge('', name, range, 1);
    }
    reuse.sort((a, b) => a.name.localeCompare(b.name));
    const nodes = [...fresh.values()].sort((a, b) => a.placement.localeCompare(b.placement));
    const digest = sha256(JSON.stringify({
        reuse: reuse.map(({ name, target }) => [name, target]),
        nodes: nodes.map(node => [node.key, node.placement, node.integrity, node.edges.map(({ name, range, target }) => [name, range, target ?? null])]),
    }));
    const plan = { reuse, nodes, planned: nodes.length, digest, totalBytes: 0, portableFiles: snapshot.portableFiles };
    if (!download) return plan;
    let totalBytes = 0;
    for (const node of nodes) {
        signal?.throwIfAborted();
        const response = await fetchRegistryArchive(fetcher, node.tarball, { signal, credentials: 'omit', redirect: 'error' }, { name: node.name, version: node.version });
        if (!response?.ok) fail('dependency-closure-unavailable');
        const length = Number(response.headers.get('content-length'));
        if (Number.isFinite(length) && length > CLOSURE_LIMITS.packageBytes) fail('dependency-closure-too-large');
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > CLOSURE_LIMITS.packageBytes) fail('dependency-closure-too-large');
        totalBytes += bytes.length;
        if (totalBytes > CLOSURE_LIMITS.totalBytes) fail('dependency-closure-too-large');
        if (sri(bytes) !== node.integrity) fail('dependency-closure-integrity');
        const entries = archiveEntries(bytes);
        const packed = entries.find(entry => entry.name === 'package/package.json');
        if (!packed) fail('dependency-closure-metadata-mismatch');
        checkManifest(JSON.parse(packed.bytes.toString('utf8')), node.name, node.version);
        node.bytes = bytes; node.sha256 = sha256(bytes); node.entries = entries.length;
    }
    return { ...plan, totalBytes };
}
