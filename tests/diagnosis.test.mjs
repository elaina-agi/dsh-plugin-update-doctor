import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRedactor } from '../lib/redact.js';
import { classify, bundleState } from '../lib/diagnosis.js';

test('redacts credentials, local home and private email without erasing operation facts', () => {
    const redact = makeRedactor({ home: 'C:\\Users\\Example', profileDir: 'C:\\Users\\Example\\.dsh\\profiles\\desktop', installDir: 'C:\\Apps\\DSH' });
    const value = redact({ output: 'C:\\Users\\Example\\.dsh\\profiles\\desktop\\node_modules\\x password=abc Bearer abcdef https://user:pass@example.com/ token=123 name@example.com', application: 'failed', apiToken: 'secret', version: '0.26.1' });
    assert.equal(value.application, 'failed'); assert.equal(value.version, '0.26.1');
    assert(!JSON.stringify(value).includes('Example')); assert(!JSON.stringify(value).includes('abcdef'));
    assert(!JSON.stringify(value).includes('name@example.com')); assert.equal(value.apiToken, '<credential>');
});
test('JSON-string and Basic credentials are redacted from captured log text', () => {
    const redact = makeRedactor();
    const safe = redact('{"password":"demo-password-value","api_key":"demo-api-value"} Authorization: Basic ZGVtbzpkZW1v');
    assert(!safe.includes('demo-password-value')); assert(!safe.includes('demo-api-value')); assert(!safe.includes('ZGVtbzpkZW1v'));
});
test('activation failure is not falsely classified as file occupancy', () => {
    assert.equal(classify({ result: { stage: 'enable', application: 'failed', error: { code: 'operation-error' } } }).code, 'activation-failed');
    assert.equal(classify({ result: { stage: 'install', application: 'failed', packageResult: { output: 'EPERM' } } }).code, 'permission-failed');
    assert.equal(classify({ locks: { status: 'checked', files: [{ probe: 'sharing-violation' }] } }).code, 'file-sharing-conflict');
});
test('disk enabled and actual active Host rows are separate observations', () => {
    const bundle = { enabled: true, availability: 'profile', rows: [{ rowId: 'a', entryId: 'include:a' }, { rowId: 'b', entryId: 'include:b' }] };
    const states = bundleState(bundle, [{ entryId: 'include:a', enabled: true, fiberPhase: 'active' }, { entryId: 'include:b', enabled: true, fiberPhase: 'failed' }]);
    assert.equal(states.state, 'partial'); assert.equal(states.activeRows, 1);
});
