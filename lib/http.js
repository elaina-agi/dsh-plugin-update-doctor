export const ROUTE = '/api/plugin-update-doctor';
export const PANEL_HEADER = 'x-dsh-plugin-update-doctor';
export const PANEL_MARKER = 'panel-v1';

/**
 * Connection authenticates/trust-checks the physical request and permits only
 * owner Peers before dispatching this exact route. Its node:http bridge uses
 * http://dsh.internal as Request.url, so that URL is NOT the browser's origin.
 * A custom JSON header prevents simple cross-site/form requests; the existing
 * confirmation ticket and separate task-stop consent still gate mutations.
 */
export function isPanelRequest(request) {
    if (request.headers.get(PANEL_HEADER) !== PANEL_MARKER) return false;
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return false;
    const site = request.headers.get('sec-fetch-site');
    if (site !== null && site !== 'same-origin') return false;
    const origin = request.headers.get('origin');
    if (origin === null) return true; // An authenticated carrier need not retain Origin.
    let parsed;
    try { parsed = new URL(origin); } catch { return false; }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) return false;
    const host = request.headers.get('host');
    if (host !== null) {
        // Use only the original Host retained by the already-trusted carrier,
        // never Forwarded/X-Forwarded-Host or the synthetic internal origin.
        try {
            const target = new URL(parsed.protocol + '//' + host);
            if (target.host !== parsed.host || target.username || target.password || target.pathname !== '/' || target.search || target.hash) return false;
        } catch { return false; }
    }
    return true;
}

/** Registered only on the authenticated owner Connection, not a standalone HTTP listener. */
export function createHandler(service) {
    return async function handler(request) {
        const url = new URL(request.url);
        const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
        try {
            if (request.method === 'GET') {
                const action = url.searchParams.get('action') ?? 'list';
                const name = url.searchParams.get('name');
                if (action === 'list') return json(await service.list());
                if (action === 'scan') return json(await service.scan(request.signal));
                if (action === 'diagnose') return json(await service.diagnose(name));
                if (action === 'versions') return json(await service.versions(name, request.signal));
                if (action === 'history') return json({ records: service.store.list(name), persistenceWarning: service.store.warning });
                if (action === 'self-operation') return json(await service.selfUpdate?.state(url.searchParams.get('id')) ?? { phase: 'unknown' });
                if (action === 'operation') return json(service.operation(url.searchParams.get('id')));
                return json({ error: 'Unknown read action.', code: 'invalid-action' }, 400);
            }
            if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
            if (!isPanelRequest(request)) return json({ error: 'Use the authenticated update panel to review and confirm this action.', code: 'panel-request-required' }, 403);
            const bodyText = await request.text();
            if (Buffer.byteLength(bodyText) > 8192) return json({ error: 'Request too large.' }, 413);
            const body = JSON.parse(bodyText);
            if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request.' }, 400);
            if (body.action === 'prepare-self-update') {
                if (Object.keys(body).some(key => !['action', 'version', 'commit'].includes(key)) || !service.selfUpdate
                    || body.commit !== undefined && (typeof body.commit !== 'string' || !/^[a-f0-9]{40}$/.test(body.commit))) return json({ error: 'Self-update accepts only its offered exact version and commit.', code: 'invalid-self-update' }, 400);
                return json(await service.selfUpdate.prepare(body.version, request.signal, { targetCommit: body.commit }));
            }
            if (body.action === 'prepare-migration') {
                if(Object.keys(body).some(key=>!['action','name'].includes(key)))return json({error:'Migration accepts only an identified package name.',code:'invalid-migration'},400);
                return json(await service.prepareMigration(body.name,request.signal));
            }
            if (body.action === 'prepare-batch') return json(await service.prepareBatch(body.items, request.signal));
            if (body.action === 'prepare-restore') {
                if (Object.keys(body).some(key => !['action', 'name'].includes(key))) return json({ error: 'Recovery accepts only the recorded package name.', code: 'invalid-recovery' }, 400);
                return json(await service.prepareRestore(body.name, request.signal));
            }
            if (body.action === 'cancel-wait') return json(service.cancelWait(body.id));
            if (body.action === 'locks') return json(await service.locks(body.name, request.signal));
            if (body.action === 'prepare') return json({ error: 'Single-item management bypass is disabled. Use the batch confirmation flow.', code: 'use-batch-flow' }, 400);
            if (body.action === 'commit') {
                if (typeof body.ticket !== 'string') return json({ error: 'User confirmation ticket required.' }, 400);
                return json(await service.commit(body.ticket, { taskPolicy: body.taskPolicy ?? 'wait-for-idle', confirmCancel: body.confirmCancel === true, confirmPublicMirror:body.confirmPublicMirror===true, confirmUnionGeneration:body.confirmUnionGeneration===true }));
            }
            return json({ error: 'Unknown user action.', code: 'invalid-action' }, 400);
        } catch (error) {
            return json({ error: service.redact(error?.message ?? String(error)), code: error?.code ?? 'operation-error' },
                ['busy', 'stale-confirmation', 'state-changed'].includes(error?.code) ? 409 : 400);
        }
    };
}
