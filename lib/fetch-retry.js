/**
 * Retry only transient transport failures. Public registry reads are idempotent GETs; a
 * single reset or 5xx should not turn an otherwise valid update check into "unsupported".
 * Deterministic policy failures, integrity mismatches and aborts are never retried.
 */
const RETRYABLE = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR_SOCKET|fetch failed|socket hang up|network/i;
export const isRetryableTransport = error => RETRYABLE.test(String(error?.message ?? error))
    || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET'].includes(error?.cause?.code);
const wait = (milliseconds, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? Error('aborted'));
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener?.('abort', () => { clearTimeout(timer); reject(signal.reason ?? Error('aborted')); }, { once: true });
});

export function retryingFetch(fetcher = fetch, { attempts = 3, delayMs = 350 } = {}) {
    return async function retried(url, options = {}) {
        let lastError;
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const response = await fetcher(url, options);
                if ((response?.status === 429 || (response?.status ?? 0) >= 500) && attempt < attempts) {
                    try { await response.body?.cancel(); } catch (error) { /* the retry has its own response */ }
                    await wait(delayMs * attempt, options.signal);
                    continue;
                }
                return response;
            } catch (error) {
                lastError = error;
                if (attempt >= attempts || options.signal?.aborted || !isRetryableTransport(error)) throw error;
                await wait(delayMs * attempt, options.signal);
            }
        }
        throw lastError;
    };
}
