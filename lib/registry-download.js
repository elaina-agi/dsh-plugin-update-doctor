import { PUBLIC_REGISTRY, PUBLIC_MIRROR, registryOrigin } from './source.js';

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const PACKAGE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;

function issue(code, message, phase, registry, cause) {
    const error = new Error(message, cause === undefined ? undefined : { cause });
    error.code = code;
    const causeKind = cause?.name === 'TimeoutError' ? 'timeout'
        : cause?.cause?.message === 'unexpected redirect' ? 'redirect'
        : 'network';
    error.preflight = { phase, registry, ...(cause === undefined ? {} : { causeKind }) };
    return error;
}
function throwCancellation(signal) {
    if (signal?.aborted && signal.reason?.name !== 'TimeoutError') signal.throwIfAborted();
}
async function request(fetcher, url, options, phase) {
    throwCancellation(options.signal);
    try {
        const response = await fetcher(url, { ...options, credentials: 'omit' });
        throwCancellation(options.signal);
        return response;
    } catch (error) {
        throwCancellation(options.signal);
        const metadata = phase === 'metadata';
        const origin = registryOrigin(new URL(url).origin);
        const registry = origin === 'https://cdn.npmmirror.com' ? PUBLIC_MIRROR : origin;
        throw issue(metadata ? 'package-metadata-fetch-failed' : 'package-archive-fetch-failed',
            metadata ? 'Package metadata could not be downloaded from the verified public source.'
                : 'Package archive could not be downloaded from the verified public source.',
            phase, registry, error);
    }
}
async function rejectRedirect(response, registry) {
    try { await response?.body?.cancel(); } catch (error) { /* Preserve the policy refusal if disposing the rejected body fails. */ }
    throw issue('public-archive-redirect-unsupported', 'The package archive redirects to an unapproved address or requests another redirect.', 'archive', registry);
}

/** Read public package metadata without following redirects or sending credentials. */
export async function fetchRegistryMetadata(fetcher, url, options) {
    return request(fetcher, url, { ...options, redirect: 'error' }, 'metadata');
}

/** Permit only a canonical npmmirror archive's one exact package/version CDN hop.
 * Response bytes still require the caller's SRI and canonical official archive comparison.
 */
export async function fetchRegistryArchive(fetcher, url, options, { name, version }) {
    const source = new URL(url), registry = registryOrigin(source.origin);
    const path = `/${name}/-/${name.split('/').at(-1)}-${version}.tgz`;
    if (!PACKAGE.test(name ?? '') || !VERSION.test(version ?? '') || ![PUBLIC_REGISTRY, PUBLIC_MIRROR].includes(registry)
        || source.protocol !== 'https:' || source.username || source.password || source.search || source.hash || source.pathname !== path) {
        throw issue('public-archive-redirect-unsupported', 'The package archive address is not a canonical approved public package/version address.', 'archive', registry);
    }
    const mirror = registry === PUBLIC_MIRROR;
    let response = await request(fetcher, source, { ...options, redirect: mirror ? 'manual' : 'error' }, 'archive');
    if (response.url && response.url !== source.href) await rejectRedirect(response, registry);
    if (!REDIRECTS.has(response.status)) return response;
    if (!mirror) await rejectRedirect(response, registry);
    const expected = `https://cdn.npmmirror.com/packages/${name}/${version}/${name.split('/').at(-1)}-${version}.tgz`;
    const location = response.headers.get('location');
    if (location !== expected) await rejectRedirect(response, registry);
    try { await response.body?.cancel(); } catch (error) { /* The next request has its own cancellation and integrity checks. */ }
    throwCancellation(options.signal);
    response = await request(fetcher, expected, { ...options, redirect: 'manual' }, 'archive');
    if (response.url && response.url !== expected || REDIRECTS.has(response.status)) await rejectRedirect(response, registry);
    return response;
}
