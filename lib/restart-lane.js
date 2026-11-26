import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Restart handoff: the running Host sometimes refuses to unplug a plugin in-process
 * (`restart-required` with `changed: true`). The update can still be completed, but only
 * across a fresh process: the target is written to disk now, verified at the next start,
 * and rolled back to the staged previous archive when that verification fails.
 *
 * The pending record is bounded, sanitized evidence. It never carries paths, registry
 * credentials or command output, and a corrupt or unknown record is ignored rather than
 * acted on.
 */
export const RESTART_PENDING_SCHEMA = 1;
export const RESTART_MAX_ATTEMPTS = 2;
const PENDING_FILE = 'restart-pending.json';
const RESULT_FILE = 'restart-result.json';

const identifier = value => typeof value === 'string' && /^(?:@[a-z0-9._~-]+\/)?[a-z0-9][a-z0-9._~-]{0,213}$/i.test(value) ? value : null;
const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) ? value : null;
const rowsOf = value => Array.isArray(value)
    ? value.filter(row => row && typeof row.id === 'string' && typeof row.name === 'string').slice(0, 64).map(row => ({ id: row.id, name: row.name }))
    : [];

export const pendingRestartPath = root => join(root, PENDING_FILE);
export const restartResultPath = root => join(root, RESULT_FILE);

const writeDocument = async (path, document) => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = path + '.tmp';
    await writeFile(temporary, JSON.stringify(document) + '\n');
    await rename(temporary, path);
    return document;
};

export async function readPendingRestart(root) {
    try {
        const parsed = JSON.parse(await readFile(pendingRestartPath(root), 'utf8'));
        if (parsed?.schema !== RESTART_PENDING_SCHEMA) return null;
        if (!identifier(parsed.name) || !version(parsed.from) || !version(parsed.to)) return null;
        if (!['union-generation', 'archive'].includes(parsed.installMode)) return null;
        if (!parsed.nextReference || !parsed.previousReference) return null;
        return { ...parsed, rows: rowsOf(parsed.rows), attempts: Number.isSafeInteger(parsed.attempts) ? Math.max(0, Math.min(parsed.attempts, RESTART_MAX_ATTEMPTS)) : 0 };
    } catch { return null; }
}

export async function writePendingRestart(root, record) {
    return writeDocument(pendingRestartPath(root), {
        schema: RESTART_PENDING_SCHEMA,
        name: identifier(record.name), from: version(record.from), to: version(record.to),
        installMode: record.installMode === 'union-generation' ? 'union-generation' : 'archive',
        enabled: record.enabled !== false, registry: typeof record.registry === 'string' ? record.registry : null,
        rows: rowsOf(record.rows), nextReference: record.nextReference, previousReference: record.previousReference,
        attempts: Number.isSafeInteger(record.attempts) ? record.attempts : 0, recordedAt: new Date().toISOString(),
    });
}

export async function clearPendingRestart(root) {
    await rm(pendingRestartPath(root), { force: true });
}

export async function writeRestartResult(root, result) {
    return writeDocument(restartResultPath(root), { schema: RESTART_PENDING_SCHEMA, ...result, at: new Date().toISOString() });
}

export async function readRestartResult(root) {
    try {
        const parsed = JSON.parse(await readFile(restartResultPath(root), 'utf8'));
        return parsed?.schema === RESTART_PENDING_SCHEMA ? parsed : null;
    } catch { return null; }
}

/** Compare the installed target with the staged archive, expected Host rows and running namespace. */
export async function verifyRestartTarget(service, record, { signal } = {}) {
    const { bundles, rows } = await service.snapshot();
    const bundle = bundles.find(value => value.name === record.name);
    if (!bundle?.installed) return { status: 'failed', reason: 'target-not-installed', bytes: false, host: { verified: false, activeRows: 0, totalRows: 0 }, runtime: false };
    if (bundle.version !== record.to) return { status: 'failed', reason: 'target-version-mismatch', installedVersion: bundle.version, bytes: false, host: { verified: false, activeRows: 0, totalRows: 0 }, runtime: false };
    let directory = null;
    try { directory = await service.resolvePackage(record.name); } catch { /* reported as unverified bytes */ }
    let bytes = false;
    if (directory) {
        try {
            if (record.installMode === 'union-generation') await service.unionStager.verifyInstalledArchive(record.nextReference, directory, { signal });
            else await service.stager.verifyInstalledArchive(record.nextReference, directory);
            bytes = true;
        } catch { /* kept false */ }
    }
    const host = service.expectedHostState(bundle, rows, rowsOf(record.rows));
    let runtime = false;
    if (bytes && host.verified && record.installMode === 'union-generation' && directory) {
        try { runtime = await service.verifyRunningGeneration(directory, record.nextReference, { enabled: bundle.enabled === true, packageName: record.name }) === true; } catch { /* kept false */ }
    }
    const verified = bytes && host.verified && (record.installMode !== 'union-generation' || runtime);
    return { status: verified ? 'verified' : 'failed', bytes, host: { verified: host.verified, activeRows: host.activeRows, totalRows: host.totalRows }, runtime };
}

/** Restore the staged previous archive after a fresh process rejected the target. */
export async function rollbackRestartTarget(service, record, { signal, requestId } = {}) {
    const observed = (await service.snapshot()).bundles.find(value => value.name === record.name);
    if (observed?.installed) {
        let removed;
        try { removed = await service.manager.removeBundle(record.name); }
        catch (error) { return { application: 'failed', stage: 'remove', detail: String(error?.message ?? error) }; }
        if (removed?.application !== 'applied') return { application: 'failed', stage: 'remove', detail: String(removed?.application ?? 'unknown') };
    }
    let staged;
    try {
        staged = record.installMode === 'union-generation'
            ? await service.unionStager.reopen(record.previousReference)
            : await service.stager.reopen(record.previousReference);
    } catch { return { application: 'failed', stage: 'prepare', detail: 'previous-archive-unavailable' }; }
    let installed;
    try {
        installed = await service.manager.installBundle(staged.archivePath, { enabled: record.enabled !== false, saveExact: true,
            expected: { name: record.name, version: record.from }, requestId: requestId ?? `restart-rollback-${record.name}` });
    } catch (error) { return { application: 'unknown', stage: 'install', detail: String(error?.message ?? error) }; }
    if (!installed || !['applied', 'restart-required'].includes(installed.application)) {
        return { application: installed?.application === 'failed' ? 'failed' : 'unknown', stage: 'install', detail: String(installed?.application ?? 'missing') };
    }
    let bytes = false;
    try {
        const directory = await service.resolvePackage(record.name);
        if (record.installMode === 'union-generation') await service.unionStager.verifyInstalledArchive(record.previousReference, directory, { signal });
        else await service.stager.verifyInstalledArchive(record.previousReference, directory);
        bytes = true;
    } catch { /* reported below */ }
    return { application: installed.application, stage: 'install', bytesVerified: bytes, signal: signal?.aborted === true };
}

/**
 * Run at start-up: finish or roll back a pending handoff, and keep one bounded result for
 * the panel. Unknown states are retained as unknown instead of being presented as success.
 */
export async function resumePendingRestart(service) {
    const record = await readPendingRestart(service.restartRoot);
    if (!record) return null;
    if (record.attempts >= RESTART_MAX_ATTEMPTS) {
        const result = { name: record.name, from: record.from, to: record.to, outcome: 'unknown', reason: 'attempt-limit', target: null, rollback: null };
        await writeRestartResult(service.restartRoot, result);
        await clearPendingRestart(service.restartRoot);
        service.restartEvidence = result;
        return result;
    }
    const attempt = { ...record, attempts: record.attempts + 1 };
    await writePendingRestart(service.restartRoot, attempt);
    let target;
    try { target = await verifyRestartTarget(service, attempt); }
    catch (error) { target = { status: 'failed', reason: String(error?.message ?? error).slice(0, 200), bytes: false, host: { verified: false }, runtime: false }; }
    if (target.status === 'verified') {
        const result = { name: attempt.name, from: attempt.from, to: attempt.to, outcome: 'applied', reason: null, target, rollback: null };
        await clearPendingRestart(service.restartRoot);
        await writeRestartResult(service.restartRoot, result);
        service.restartEvidence = result;
        return result;
    }
    const rollback = await rollbackRestartTarget(service, attempt, { requestId: `restart-rollback-${attempt.attempts}` });
    const settled = rollback.bytesVerified === true ? (rollback.application === 'applied' ? 'applied' : 'restart-required') : 'unknown';
    const result = { name: attempt.name, from: attempt.from, to: attempt.to,
        outcome: settled === 'applied' ? 'rolled-back' : 'unknown', reason: target.reason ?? null, target, rollback };
    if (settled === 'unknown' && attempt.attempts < RESTART_MAX_ATTEMPTS) {
        await writePendingRestart(service.restartRoot, { ...attempt, attempts: RESTART_MAX_ATTEMPTS });
    } else await clearPendingRestart(service.restartRoot);
    await writeRestartResult(service.restartRoot, result);
    service.restartEvidence = result;
    return result;
}
