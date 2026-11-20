import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Evaluate only the actual selector declarations/calls, never React, DOM, subscriptions or Host operations.
const client = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const start = client.indexOf('    const selectLocale =');
const end = client.indexOf('    function DoctorPanel(', start);
assert(start >= 0 && end > start, 'Stable panel selectors must be declared');
const selectors = vm.runInNewContext(`${client.slice(start, end)}; ({ selectLocale, selectClientSync });`);
const panelStart = client.indexOf('    function DoctorPanel(');
const calls = client.slice(client.indexOf('\n', panelStart) + 1, client.indexOf('      const [snapshot,', panelStart));

function evaluateCalls(localeSnapshot, syncSnapshot) {
    const received = [];
    const strictSelector = snapshot => selector => {
        assert.equal(typeof selector, 'function', 'Injected snapshot Hook requires a selector');
        received.push(selector);
        return selector(snapshot);
    };
    const answer = vm.runInNewContext(`${calls}; ({ locale, clientSync });`, {
        ...selectors, useLocale: strictSelector(localeSnapshot), useClientSync: strictSelector(syncSnapshot),
    });
    return { answer, received };
}

test('actual panel Hook calls pass required selectors and preserve synchronization facts', () => {
    for (const active of ['zh', 'en']) {
        const sync = { syncing: true, failures: [{ id: 'owned-fixture', message: 'fixture failure' }] };
        const { answer, received } = evaluateCalls({ active, revision: 7, locales: [] }, sync);
        assert.equal(answer.locale, active); assert.equal(answer.clientSync, sync);
        assert.equal(received.length, 2); assert.equal(received[0], selectors.selectLocale); assert.equal(received[1], selectors.selectClientSync);
    }
});

test('old zero-argument Hook calls fail the required selector contract rather than being accepted by a permissive fixture', () => {
    const strict = selector => { assert.equal(typeof selector, 'function', 'Injected snapshot Hook requires a selector'); return selector({ active: 'zh' }); };
    assert.throws(() => vm.runInNewContext('useLocale().active', { useLocale: strict }), /requires a selector/);
    assert.throws(() => vm.runInNewContext('useClientSync()', { useClientSync: strict }), /requires a selector/);
    assert(!/\buse(?:Locale|ClientSync)\(\s*\)/.test(client));
});
