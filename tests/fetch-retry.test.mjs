import test from 'node:test';
import assert from 'node:assert/strict';
import { retryingFetch, isRetryableTransport } from '../lib/fetch-retry.js';

test('transient transport failures are retried while policy responses are returned once', async () => {
    let calls = 0;
    const flaky = retryingFetch(async () => {
        calls++;
        if (calls < 3) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
        return new Response('ok', { status: 200 });
    }, { attempts: 3, delayMs: 1 });
    assert.equal((await flaky('https://registry.npmjs.org/owned')).status, 200);
    assert.equal(calls, 3);
    let notFoundCalls = 0;
    const notFound = retryingFetch(async () => { notFoundCalls++; return new Response('', { status: 404 }); }, { attempts: 3, delayMs: 1 });
    assert.equal((await notFound('https://registry.npmjs.org/owned')).status, 404);
    assert.equal(notFoundCalls, 1);
    let serverCalls = 0;
    const server = retryingFetch(async () => { serverCalls++; return new Response('', { status: serverCalls === 1 ? 503 : 200 }); }, { attempts: 2, delayMs: 1 });
    assert.equal((await server('https://registry.npmjs.org/owned')).status, 200);
    assert.equal(serverCalls, 2);
    await assert.rejects(() => retryingFetch(async () => { throw Object.assign(Error('integrity-mismatch'), { code: 'integrity-mismatch' }); }, { attempts: 3, delayMs: 1 })('https://registry.npmjs.org/owned'), /integrity-mismatch/);
    assert.equal(isRetryableTransport(Object.assign(new Error('x'), { cause: { code: 'ECONNRESET' } })), true);
    assert.equal(isRetryableTransport(Object.assign(Error('integrity-mismatch'), { code: 'integrity-mismatch' })), false);
});
