import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { retainedEvidence, evidenceFields } from './helpers/retained-evidence.mjs';

async function ownedFixture(t) {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-retained-evidence-test-'));
    t.after(async () => {
        const checked = resolve(directory);
        assert.equal(dirname(checked), resolve(tmpdir()));
        assert(basename(checked).startsWith('dsh-retained-evidence-test-'));
        assert.equal(await realpath(checked), checked);
        assert(!(await lstat(checked)).isSymbolicLink());
        await rm(checked, { recursive: true, force: true });
    });
    const skips = [];
    return { path: join(directory, 'owned-result.json'), context: { skip: message => skips.push(message) }, skips };
}

test('absent private local evidence explicitly skips without inventing a successful result', async t => {
    const { path, context, skips } = await ownedFixture(t);
    const evidence = await retainedEvidence(context, path, { reproduce: 'Run the owned fixture experiment.', required: ['passed'] });
    assert.equal(evidence, null);
    assert.equal(skips.length, 1);
    assert.match(skips[0], /Private local experiment results are not included/);
    assert.match(skips[0], /Run the owned fixture experiment/);
});

test('valid retained evidence is returned without skipping', async t => {
    const { path, context, skips } = await ownedFixture(t);
    const expected = { passed: true, cleanup: { removed: true } };
    await writeFile(path, JSON.stringify(expected));
    assert.deepEqual(await retainedEvidence(context, path, { required: ['passed', 'cleanup.removed'] }), expected);
    assert.deepEqual(skips, []);
});

test('existing malformed JSON fails instead of skipping', async t => {
    const { path, context, skips } = await ownedFixture(t);
    await writeFile(path, '{broken JSON');
    await assert.rejects(() => retainedEvidence(context, path), SyntaxError);
    assert.deepEqual(skips, []);
});

test('existing non-object JSON fails instead of skipping', async t => {
    const { path, context, skips } = await ownedFixture(t);
    for (const value of [null, [], 'not evidence', true, 42]) {
        await writeFile(path, JSON.stringify(value));
        await assert.rejects(() => retainedEvidence(context, path), /Retained evidence must be a JSON object/);
    }
    assert.deepEqual(skips, []);
});

test('existing evidence with absent critical fields fails instead of skipping', async t => {
    const { path, context, skips } = await ownedFixture(t);
    await writeFile(path, JSON.stringify({ passed: true, cleanup: {} }));
    await assert.rejects(() => retainedEvidence(context, path, { required: ['cleanup.removed'] }), /missing required field: cleanup.removed/);
    assert.throws(() => evidenceFields({ pid: undefined }, ['pid']), /field is undefined: pid/);
    assert.deepEqual(skips, []);
});

test('a present unreadable evidence target propagates its read failure rather than skipping', async t => {
    const { path, context, skips } = await ownedFixture(t);
    await mkdir(path);
    await assert.rejects(() => retainedEvidence(context, path), error => error.code !== 'ENOENT');
    assert.deepEqual(skips, []);
});
