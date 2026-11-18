import assert from 'node:assert/strict';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHandler, ROUTE, PANEL_HEADER, PANEL_MARKER } from '../lib/http.js';

// The real installed Connection dispatcher + node:http bridge; identity is an
// isolated fixture, never the user's browser credential or active profile.
const anchor = process.env.DSH_INSTALL_DIR;
if (!anchor?.includes('app.asar')) throw Error('Use installed ASAR Electron runtime');
const require = createRequire(join(anchor, 'package.json'));
const { HostConnectionService } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-client-connection')).href);
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const connectionDir = dirname(require.resolve('@deepseek-ai/dsh-client-connection/package.json'));
const bridgeSource=await readFile(join(connectionDir,'src/http-bridge.ts'),'utf8');
const bridgeModule=stripTypeScriptTypes(bridgeSource,{mode:'strip'});
const { bridge }=await import('data:text/javascript;base64,'+Buffer.from(bridgeModule).toString('base64'));
const ctx = new Context();
ctx.provide('webServer', { host: '127.0.0.1', protocol: 'http:' });
const auth = { isAuthenticated: request => request.headers['x-fixture-owner'] === 'fixture-owner', authenticateApi: () => undefined };
const connection = new HostConnectionService(ctx, [], auth);
const calls = []; let observed;
const service = {
    redact: value => value,
    prepareBatch: async items => { calls.push('prepare'); return { ticket: 'owned-fixture-ticket', items }; },
    commit: async () => { throw Error('This proof must never execute a commit'); },
};
const panel = createHandler(service);
const dispose = connection.fetch.register({ path: ROUTE, methods: ['POST'], requestBody: 'buffered', fetch: request => {
    observed = { syntheticOrigin: new URL(request.url).origin, physicalOrigin: request.headers.get('origin') };
    return panel(request);
} });
const shared = connection.createSharedFetchHandler('/api');
const server = createServer(async (req, res) => {
    try {
        const admission = connection.admit(req);
        if ('rejection' in admission) { res.writeHead(admission.rejection); res.end('refused'); return; }
        await bridge(req, res, shared, admission.peer);
    } catch (error) { res.writeHead(500); res.end(String(error.message)); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const body = JSON.stringify({ action: 'prepare-batch', items: [{ name: 'fixture-plugin', version: '1.0.1' }] });
const headers = { 'content-type': 'application/json', [PANEL_HEADER]: PANEL_MARKER, 'x-fixture-owner': 'fixture-owner', origin, 'sec-fetch-site': 'same-origin' };
try {
    const accepted = await fetch(origin + ROUTE, { method: 'POST', headers, body });
    assert.equal(accepted.status, 200, await accepted.clone().text());
    assert.equal((await accepted.json()).ticket, 'owned-fixture-ticket');
    assert.equal(observed.syntheticOrigin, 'http://dsh.internal'); assert.equal(observed.physicalOrigin, origin);
    const unauth = { ...headers }; delete unauth['x-fixture-owner'];
    assert.equal((await fetch(origin + ROUTE, { method: 'POST', headers: unauth, body })).status, 401);
    assert.equal((await fetch(origin + ROUTE, { method: 'POST', headers: { ...headers, origin: 'https://foreign.example' }, body })).status, 403);
    const unmarked = { ...headers }; delete unmarked[PANEL_HEADER];
    assert.equal((await fetch(origin + ROUTE, { method: 'POST', headers: unmarked, body })).status, 403);
    const readonlyPeer = { principal: { kind: 'observer' } };
    assert.equal((await shared.fetch(new Request('http://dsh.internal' + ROUTE, { method: 'POST', headers, body }), readonlyPeer)).status, 403);
    assert.deepEqual(calls, ['prepare']);
    console.log(JSON.stringify({ passed: true, realInstalledConnectionAndBridge: true, syntheticOriginObserved: observed.syntheticOrigin, sameOriginPreparation: 200, unauthenticated: 401, crossSite: 403, unmarkedPanel: 403, nonOwner: 403, updateCalls: 0, taskStops: 0 }));
} finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await dispose(); await ctx.fiber.dispose();
}
