import { relative, resolve, isAbsolute, sep } from 'node:path';

export const PUBLIC_REGISTRY = 'https://registry.npmjs.org';

/** Public npm only. A missing, private or mirror origin never silently becomes npm. */
export function registryOrigin(value) {
    if (typeof value !== 'string' || value.length > 512) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : null;
    } catch { return null; }
}
export function publicRegistry(value) { return registryOrigin(value) === PUBLIC_REGISTRY; }

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
