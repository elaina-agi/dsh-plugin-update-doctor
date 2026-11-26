import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const occurrences = value => source.split(value).length - 1;

test('the panel marks a plugin that declares Host packages as ordinary dependencies', () => {
    assert.equal(occurrences('pud-host-dependencies-badge'), 1, 'one inline badge');
    assert.equal(occurrences('pud-host-dependencies\''), 1, 'one detail line');
    // Both hooks are conditional on recorded evidence; nothing renders for ordinary plugins.
    assert.equal(occurrences('item.packagePreflight?.hostDependencies?.length'), 2);
    assert.match(source, /t\('hostDependenciesWarning'\)\.replace\('\{list\}', item\.packagePreflight\.hostDependencies\.join\(', '\)\)/);
});

test('the warning exists in both locales and never claims a refusal', () => {
    assert.equal(occurrences('hostDependenciesBadge:'), 2, 'English and Chinese badge text');
    assert.equal(occurrences('hostDependenciesWarning:'), 2, 'English and Chinese explanation');
    assert.match(source, /The update is still attempted\./);
    assert.match(source, /更新仍会照常尝试/);
    assert.doesNotMatch(source, /hostDependencies[^\n]*pud-confirm/, 'a warning must not add a confirmation gate');
});
