import { parseDocument } from 'yaml';
import { inspectPatches } from './patch-safety.js';
import { assertUnionDependencyPolicy, unionDigest, safeWinArchivePath, unionRangeMatches } from './union-generation.js';

export const ISOLATED_DEPENDENCIES = 'isolated-js-v1';
const HTML_STACK = ['cheerio', 'turndown', '@joplin/turndown-plugin-gfm'];
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const check = (ok, code) => { if (!ok) throw Object.assign(Error(code), { code }); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function isIsolatedPackageName(name) {
    return typeof name === 'string' && name.length <= 214 && NAME.test(name) && !name.startsWith('@deepseek-ai/')
        && !['dsh-plugin-update-doctor', 'dsh-plugin-wsl-env'].includes(name);
}
export function isIsolatedStableVersion(version) {
    return typeof version === 'string' && version.length <= 48 && VERSION.test(version) && version.split('.').map(Number).every(Number.isSafeInteger);
}

/** This predicate only selects which path to inspect. It does not admit an update. */
export function needsDependencyIsolation(name, manifest) {
    // A known broken Host reload never silently falls back to the normal updater.
    if (name === 'dsh-union-search') return true;
    return isIsolatedPackageName(name) && manifest?.name === name
        && HTML_STACK.every(dependency => Object.hasOwn(manifest.dependencies ?? {}, dependency));
}

/** Ordered stable versions are not evidence of package support. */
export function canInspectIsolatedPair(name, from, to) {
    if (!isIsolatedPackageName(name) || !isIsolatedStableVersion(from) || !isIsolatedStableVersion(to)) return false;
    const a = from.split('.').map(Number), b = to.split('.').map(Number);
    return (b[0] - a[0] || b[1] - a[1] || b[2] - a[2]) > 0;
}

function patchContract(texts, name) {
    const rows = inspectPatches(texts, name);
    check(rows.length === 1 && rows[0].name === name, 'union-host-row-contract');
    const parsed = texts.map(text => parseDocument(text, { schema: 'core', uniqueKeys: true }).toJS({ maxAliasCount: 0 }));
    const row = parsed.flatMap(patch => patch.flatMap(insertion => insertion.insert))[0];
    check(Object.keys(row).every(key => ['id', 'name', 'disabled', 'config'].includes(key))
        && (row.disabled === undefined || typeof row.disabled === 'boolean')
        && (row.config === undefined || plain(row.config)), 'union-host-row-contract');
    return { rows, parsed };
}

/** Inspect original data without loading code. Static single-row ESM packages only. */
export function inspectIsolatedRoot(manifest, entries, patchTexts) {
    check(isIsolatedPackageName(manifest.name) && isIsolatedStableVersion(manifest.version)
        && needsDependencyIsolation(manifest.name, manifest), 'union-package-contract');
    assertUnionDependencyPolicy(manifest, { root: true });
    check(HTML_STACK.every(name => Object.hasOwn(manifest.dependencies ?? {}, name)), 'union-dependency-contract');
    check(manifest.type === 'module' && plain(manifest.exports) && typeof manifest.main === 'string'
        && !manifest.imports && !manifest.bin && !manifest.pnpm && !manifest.workspaces, 'union-entry-contract');
    const files = new Set(entries.map(entry => entry.name));
    const main = './' + manifest.main.replace(/^\.\//, '');
    check(manifest.exports['.'] === main && /^\.\/[A-Za-z0-9._/-]+\.m?js$/.test(main), 'union-entry-contract');
    for (const [key, path] of Object.entries(manifest.exports)) {
        check(typeof path === 'string' && path.startsWith('./'), 'union-export-route');
        if (key === './package.json') { check(path === key, 'union-export-route'); continue; }
        if (key === './locale/*.json') {
            check(path === key && entries.some(entry => /^package\/locale\/[^/]+\.json$/.test(entry.name)), 'union-export-route');
            continue;
        }
        check(['.', './client', './icon'].includes(key) && !path.includes('*'), 'union-export-route');
        safeWinArchivePath('package/' + path.slice(2));
        check(files.has('package/' + path.slice(2)), 'union-export-route');
    }
    if (manifest.icon !== undefined) {
        // A root icon stays the legacy resource; new consumers may use the routed export.
        check(manifest.icon === './icon.svg' && files.has('package/icon.svg'), 'union-export-route');
    }
    check(plain(manifest.dsh?.bundle) && (!manifest.dsh.client || manifest.dsh.client.platform === 'web' && manifest.exports['./client'])
        && (!manifest.exports['./client'] || manifest.dsh.client), 'union-client-contract');
    const { rows, parsed } = patchContract(patchTexts, manifest.name);
    const { compatibility: _discoveryMetadata, ...dsh } = manifest.dsh;
    const peers = Object.fromEntries(Object.entries(manifest.peerDependencies ?? {}).map(([name, range]) => {
        check(typeof range === 'string', 'union-peer-contract');
        // DSH runtime peer ranges are checked by RegistryStager in the running Host.
        return [name, name.startsWith('@deepseek-ai/dsh-') ? true : range];
    }));
    const declaration = { name: manifest.name, main, exports: manifest.exports, icon: manifest.icon, dsh,
        node: manifest.engines?.node, os: manifest.os, cpu: manifest.cpu, libc: manifest.libc,
        peers, peerMetadata: manifest.peerDependenciesMeta ?? {}, patches: parsed };
    return { rows, contractDigest: unionDigest(declaration) };
}

export function requireIsolatedTransition(old, next, { snapshot } = {}) {
    // The generation is derived from the new declaration itself; rows, exports and peers are
    // verified after installation instead of being pinned to the version that was first reviewed.
    check(old.manifest.name === next.manifest.name, 'union-package-name-changed');
    if (unionDigest(old.manifest.dependencies ?? {}) === unionDigest(next.manifest.dependencies ?? {})) return;
    // A version bump may move dependency *ranges* while the already verified closure still
    // satisfies them: keep the installed copies and let the generation carry them. Anything
    // the closure cannot satisfy needs the download path and is refused by name.
    const installed = new Map((snapshot?.packages ?? []).map(pkg => [pkg.name, pkg.version]));
    check(installed.size > 0, 'dependency-closure-requires-download');
    const missing = Object.entries(next.manifest.dependencies ?? {})
        .filter(([name, range]) => { const version = installed.get(name); return !version || !unionRangeMatches(version, range); })
        .map(([name]) => name);
    check(missing.length === 0, 'dependency-closure-requires-download');
}
