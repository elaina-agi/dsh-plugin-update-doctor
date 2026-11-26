import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../lib/http.js';
import { serviceFixture } from './helpers/service-fixture.mjs';

const id = () => 'scan-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

test('a running scan exposes its phase and current package before completing', async t => {
    const f = await serviceFixture(t);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const original = f.stager.inspectPackage.bind(f.stager);
    f.stager.inspectPackage = async (...args) => { await gate; return original(...args); };
    const progressId = id();
    const running = f.service.scan(undefined, { progressId });
    await new Promise(resolve => setTimeout(resolve, 100));
    const during = f.service.scanProgressOf(progressId);
    assert.equal(during.phase, 'preflight');
    assert.equal(during.current, f.bundles[0].name);
    assert.equal(during.done, 0);
    assert.equal(during.total, 1);
    release();
    const answer = await running;
    assert.equal(answer.items.length, 1);
    const finished = f.service.scanProgressOf(progressId);
    assert.equal(finished.phase, 'complete');
    assert.equal(finished.done, finished.total);
    assert.equal(finished.current, null);
});

test('scan progress is readable over the panel route and unknown ids are refused', async t => {
    const f = await serviceFixture(t);
    const progressId = id();
    await f.service.scan(undefined, { progressId });
    const handler = createHandler(f.service);
    const response = await handler(new Request(`http://dsh.internal/api/plugin-update-doctor?action=scan-progress&id=${progressId}`));
    assert.equal(response.status, 200);
    const progress = await response.json();
    assert.equal(progress.phase, 'complete');
    assert.equal(progress.id, progressId);
    assert(!JSON.stringify(progress).includes(f.root), 'progress stays free of profile paths');
    const unknown = await handler(new Request('http://dsh.internal/api/plugin-update-doctor?action=scan-progress&id=not-running'));
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).code, 'unknown-operation');
});
