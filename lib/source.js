import { relative, resolve, isAbsolute, sep } from 'node:path';

export const PUBLIC_REGISTRY = 'https://registry.npmjs.org';
export const PUBLIC_MIRROR = 'https://registry.npmmirror.com';
export function approvedPublicRegistry(value) { const origin=registryOrigin(value);return origin===PUBLIC_REGISTRY||origin===PUBLIC_MIRROR; }

/** Public npm only. A missing, private or mirror origin never silently becomes npm. */
export function registryOrigin(value) {
    if (typeof value !== 'string' || value.length > 512) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : null;
    } catch { return null; }
}
export function publicRegistry(value) { return registryOrigin(value) === PUBLIC_REGISTRY; }

/** Host null means pnpm's configured registry, not a missing or implicitly public origin.
 * Resolve it only when the public before/after snapshots agree. Never expose raw registry plans.
 */
export async function readRegistryVersions(manager, name, signal) {
    const snapshot = async () => {
        if (typeof manager.registries !== 'function') return null;
        try { return await manager.registries(); }
        catch (error) { if (signal?.aborted) throw error; return null; }
    };
    signal?.throwIfAborted();
    const before = await snapshot();
    signal?.throwIfAborted();
    const answer = await manager.listVersions(name, undefined, signal);
    signal?.throwIfAborted();
    if (answer?.status !== 'listed') return { status:'refused', problem:['not-updatable','not-found','network','unknown'].includes(answer?.problem) ? answer.problem : 'unknown' };
    let registry = registryOrigin(answer.registry), queryReasons = [];
    if (answer.registry === null) {
        const after = await snapshot();
        signal?.throwIfAborted();
        const first = registryOrigin(before?.resolved), last = registryOrigin(after?.resolved);
        if (first && first === last) registry = first;
        else queryReasons = [first && last && first !== last ? 'registry-origin-changed' : 'registry-origin-unverified'];
    }
    if (!registry && !queryReasons.length) queryReasons = ['registry-origin-unverified'];
    return { status:'listed', installed:answer.installed, versions:answer.versions, omitted:answer.omitted, registry, queryReasons };
}

/** Store package-owned archive references relative to the staging root, not user paths. */
export function archiveKey(root, filename) {
    if (typeof filename !== 'string') return null;
    const file = filename.replace(/^file:/, '').replace(/^<user-home>/, process.env.USERPROFILE ?? '').replace(/^<profile>/, process.env.DSH_PROFILE_DIR ?? '');
    const rel = relative(resolve(root), resolve(file));
    if (!rel || isAbsolute(rel) || rel.split(sep).includes('..')) return null;
    const key = rel.split(sep).join('/');
    return /^[a-zA-Z0-9-]+\/package\.tgz$/.test(key) ? key : null;
}
export function archivePath(root, key) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9-]+\/package\.tgz$/.test(key)) throw new Error('untrusted-archive-reference');
    return resolve(root, ...key.split('/'));
}
