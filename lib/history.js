import { open, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const MARKER = '\n<diagnostic-truncated>';
const ACTIVE = new Set(['running', 'waiting', 'preparing', 'updating', 'restoring']);
const ITEM_ACTIVE = new Set(['waiting', 'preparing', 'updating', 'restoring']);
const FACTS = new Set(['id', 'batchId', 'package', 'name', 'operation', 'origin', 'phase', 'outcome', 'application',
    'status', 'from', 'to', 'version', 'target', 'bundle', 'stage', 'code', 'restartReason', 'archivePath',
    'sourceArchivePath', 'originalSha256', 'sha256', 'integrity', 'runtimePackaging', 'time', 'startedAt', 'finishedAt']);
const RECORD_FACTS = ['id', 'batchId', 'package', 'target', 'operation', 'origin', 'phase', 'outcome', 'application',
    'from', 'to', 'version', 'savedEnabled', 'enabled', 'time', 'startedAt', 'finishedAt', 'taskPolicy', 'confirmCancel'];
const ITEM_FACTS = ['name', 'from', 'to', 'version', 'status', 'outcome', 'phase', 'enabled', 'origin', 'archivePath',
    'sourceArchivePath', 'originalSha256', 'sha256', 'integrity', 'runtimePackaging', 'interrupted', 'previousStatus'];
const RESULT_FACTS = ['application', 'stage', 'target', 'bundle', 'version', 'changed', 'enabled', 'restartReason',
    'generationVerified', 'verifiedVersion', 'id', 'reason', 'time', 'phase', 'errorCode'];
const stringify = records => JSON.stringify({ schemaVersion: 1, records });
const bytes = text => Buffer.byteLength(text, 'utf8');
const scalar = value => value === null || ['string', 'boolean', 'number'].includes(typeof value);
const recordLike = value => value && typeof value === 'object' && !Array.isArray(value) && typeof value.id === 'string';

// Independent store instances can share a destination during Host reload. Only
// active writes live here; unique temporary files prevent accidental aliasing,
// and the per-path queue prevents racing Windows rename replacements.
const activeWriters = new Map();
async function writeExclusive(path, write) {
    const previous = activeWriters.get(path) ?? Promise.resolve();
    const current = previous.then(write, write);
    activeWriters.set(path, current);
    try { return await current; }
    finally { if (activeWriters.get(path) === current) activeWriters.delete(path); }
}

function facts(value, fields) {
    const result = {};
    for (const key of fields) if (value && Object.hasOwn(value, key) && scalar(value[key])) result[key] = value[key];
    return result;
}
function resultFacts(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const result = facts(value, RESULT_FACTS);
    if (value.error && typeof value.error === 'object') {
        result.error = facts(value.error, ['code']);
        if (typeof value.error.diagnostic === 'string') result.error.diagnostic = MARKER.trimStart();
    }
    if (value.packageResult && typeof value.packageResult === 'object') {
        result.packageResult = facts(value.packageResult, ['exitCode', 'kind', 'timedOut', 'truncated']);
        if (typeof value.packageResult.output === 'string') result.packageResult.output = MARKER.trimStart();
    }
    if (typeof value.diagnostic === 'string') result.diagnostic = MARKER.trimStart();
    return result;
}
function itemFacts(value) {
    const item = facts(value, ITEM_FACTS);
    for (const key of ['result', 'restore']) {
        const result = resultFacts(value?.[key]);
        if (result) item[key] = result;
    }
    if (typeof value?.diagnostic === 'string') item.diagnostic = MARKER.trimStart();
    return item;
}
function compactRecord(value, minimal = false) {
    const record = facts(value, RECORD_FACTS);
    for (const key of ['result', 'restore', 'event']) {
        const result = resultFacts(value[key]);
        if (result) record[key] = result;
    }
    if (Array.isArray(value.items)) {
        // The update panel admits twenty items. Keep all their identities and outcomes,
        // rather than spending the record budget on one item's verbose diagnostic.
        if (value.items.length > 500) return null;
        record.items = value.items.map(itemFacts);
    }
    if (value.item && typeof value.item === 'object') record.item = itemFacts(value.item);
    for (const key of ['diagnostic', 'summary', 'error']) if (typeof value[key] === 'string') record[key] = MARKER.trimStart();
    if (minimal) {
        const minimalItem = item => ({ ...facts(item, ['name', 'from', 'to', 'status', 'outcome', 'interrupted', 'previousStatus']),
            ...(item?.result ? { result: facts(item.result, ['application', 'stage']) } : {}),
            ...(item?.restore ? { restore: facts(item.restore, ['application', 'stage']) } : {}) });
        if (record.items) record.items = record.items.map(minimalItem);
        if (record.item) record.item = minimalItem(record.item);
        for (const key of ['result', 'restore', 'event']) if (record[key]) record[key] = facts(record[key], ['application', 'stage', 'errorCode']);
        for (const key of ['diagnostic', 'summary', 'error']) delete record[key];
    }
    record.truncation = { reason: 'history-byte-limit', compacted: true, ...(minimal ? { minimal: true } : {}) };
    return record;
}
function clipped(text, limit) {
    if (text.length <= limit) return text;
    let end = limit;
    // A truncation marker must not hide a broken UTF-16 surrogate pair.
    if (end > 0 && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    return text.slice(0, end) + MARKER;
}
function boundedCopy(value, limit, state, depth = 0, key = '') {
    if (++state.nodes > 5000 || depth > 16) { state.structural = true; return MARKER.trimStart(); }
    if (typeof value === 'string') {
        if (FACTS.has(key)) return value;
        const result = clipped(value, limit);
        if (result !== value || result.includes('<diagnostic-truncated>')) state.truncated = true;
        return result;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
        if (value.length > 500) state.structural = true;
        return value.slice(0, 500).map(item => boundedCopy(item, limit, state, depth + 1));
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length > 150) state.structural = true;
        const result = {};
        for (const [name, item] of entries.slice(0, 150)) {
            if (name.length > 256) { state.structural = true; continue; }
            if (typeof item === 'undefined' || typeof item === 'function' || typeof item === 'symbol') continue;
            Object.defineProperty(result, name, { value: boundedCopy(item, limit, state, depth + 1, name), enumerable: true, writable: true, configurable: true });
        }
        return result;
    }
    return null;
}
function interrupted(record) {
    if (!ACTIVE.has(record.phase)) return record;
    return { ...record, phase: 'interrupted', outcome: 'unknown', summary: 'host-exited-before-result',
        ...(Array.isArray(record.items) ? { items: record.items.map(item => ITEM_ACTIVE.has(item?.status)
            ? { ...item, previousStatus: item.status, status: 'unknown', outcome: 'unknown', interrupted: true }
            : item) } : {}) };
}
function projectedOutcome(record, item) {
    if (item.interrupted || (record.phase === 'interrupted' && ITEM_ACTIVE.has(item.status))) return 'unknown';
    return item.result?.application ?? item.outcome ?? ({ updated: 'applied', failed: 'failed', 'restart-required': 'restart-required', skipped: 'skipped' }[item.status] ?? 'unknown');
}

/** Bounded plugin-owned history. Read projections do not authorize package mutations. */
export class HistoryStore {
    constructor(path, redact, { maxRecords = 80, maxBytes = 2_000_000 } = {}) {
        if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError('Invalid history limits');
        this.path = resolve(path); this.redact = redact; this.maxRecords = maxRecords; this.maxBytes = maxBytes;
        this.records = []; this.warning = null; this.truncationWarning = null; this.chain = Promise.resolve();
    }
    fitRecord(value) {
        if (!recordLike(value)) return null;
        let limit = Math.min(128_000, this.maxBytes);
        while (true) {
            const state = { nodes: 0, truncated: false, structural: false };
            const record = boundedCopy(value, limit, state);
            if (state.structural) break;
            if (state.truncated) record.truncation = { ...value.truncation, reason: 'history-byte-limit', diagnosticStrings: true };
            if (bytes(stringify([record])) <= this.maxBytes) return record;
            if (limit === 0) break;
            limit = limit < 32 ? 0 : Math.floor(limit / 2);
        }
        for (const minimal of [false, true]) {
            const compact = compactRecord(value, minimal);
            if (compact && bytes(stringify([compact])) <= this.maxBytes) return compact;
        }
        return null;
    }
    boundRecords(values) {
        const records = []; let retainedBytes = bytes(stringify([])); let dropped = 0;
        for (let index = 0; index < values.length; index++) {
            if (records.length >= this.maxRecords) { dropped += values.length - index; break; }
            const record = this.fitRecord(values[index]);
            if (!record) { dropped++; continue; }
            const cost = bytes(JSON.stringify(record)) + (records.length ? 1 : 0);
            if (retainedBytes + cost > this.maxBytes) { dropped += values.length - index; break; }
            records.push(record); retainedBytes += cost;
        }
        return { records, dropped, truncated: dropped > 0 || records.some(record => !!record.truncation) };
    }
    async load() {
        let file;
        try {
            file = await open(this.path, 'r');
            const info = await file.stat();
            if (info.size > this.maxBytes) { this.warning = 'history-too-large'; return; }
            const buffer = Buffer.alloc(this.maxBytes + 1); let length = 0;
            while (length < buffer.length) {
                const read = await file.read(buffer, length, buffer.length - length, null);
                if (!read.bytesRead) break;
                length += read.bytesRead;
            }
            if (length > this.maxBytes) { this.warning = 'history-too-large'; return; }
            const parsed = JSON.parse(buffer.subarray(0, length).toString('utf8'));
            if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.records)) throw new Error('history-format');
            const safe = this.redact(parsed.records).filter(recordLike).map(interrupted);
            const bounded = this.boundRecords(safe);
            this.records = bounded.records; this.truncationWarning = bounded.truncated ? 'history-truncated' : null;
            this.warning = this.maxBytes < bytes(stringify([])) ? 'history-budget-too-small' : null;
        } catch (error) {
            if (error.code !== 'ENOENT') this.warning = 'history-read-failed';
        } finally { if (file) await file.close().catch(() => { this.warning = 'history-read-failed'; }); }
    }
    async put(record) {
        if (this.maxBytes < bytes(stringify([]))) {
            this.records = []; this.warning = 'history-budget-too-small'; return null;
        }
        try {
            const prior = this.boundRecords(this.records);
            this.records = prior.records;
            if (prior.truncated) this.truncationWarning = 'history-truncated';
        } catch { this.records = []; this.warning = 'history-record-invalid'; }
        let safe;
        try { safe = this.fitRecord(this.redact(record)); }
        catch { this.warning = 'history-record-invalid'; return null; }
        if (!safe) { this.warning = 'history-record-too-large'; this.truncationWarning = 'history-truncated'; return null; }
        const bounded = this.boundRecords([safe, ...this.records.filter(item => item.id !== safe.id)]);
        this.records = bounded.records; this.truncationWarning = bounded.truncated ? 'history-truncated' : null;
        const returned = JSON.parse(JSON.stringify(this.records[0]));
        this.chain = this.chain.then(() => writeExclusive(this.path, async () => {
            // Serialize the current bounded snapshot when its write actually starts,
            // rather than retaining a full payload for every queued progress event.
            const payload = stringify(this.records);
            const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
            let created = false, file;
            try {
                await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
                file = await open(temporary, 'wx', 0o600); created = true;
                await file.writeFile(payload); await file.close(); file = undefined;
                await rename(temporary, this.path); created = false;
                this.warning = null;
            } catch { this.warning = 'history-write-failed'; }
            finally {
                if (file) await file.close().catch(() => { this.warning = 'history-write-failed'; });
                // Only this write's unique sibling, never the history or another writer's file.
                if (created) await unlink(temporary).catch(() => { this.warning = 'history-write-failed'; });
            }
        }));
        await this.chain;
        return returned;
    }
    list(name) {
        if (!name) return this.records;
        const views = [];
        for (const record of this.records) {
            if (['batch-update', 'batch-restore'].includes(record.operation) && Array.isArray(record.items)) {
                for (const item of record.items.filter(item => item?.name === name)) views.push({
                    id: `${record.id}:${name}`, batchId: record.id, package: name,
                    operation: record.operation === 'batch-restore' ? 'restore' : 'update', origin: record.origin,
                    phase: record.phase, outcome: projectedOutcome(record, item), from: item.from, to: item.to,
                    result: item.result, restore: item.restore, savedEnabled: item.enabled ?? record.savedEnabled,
                    time: record.time, startedAt: record.startedAt, finishedAt: record.finishedAt, item,
                    ...(record.truncation ? { truncation: record.truncation } : {}),
                });
            } else if (record.package === name) views.push(record);
        }
        // The single-package projection duplicates result fields inside `item`;
        // account for that complete JSON representation too, without changing stored batch identities.
        return this.boundRecords(views).records;
    }
}
