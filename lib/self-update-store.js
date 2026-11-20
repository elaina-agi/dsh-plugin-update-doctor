import { open, mkdir, lstat, realpath, opendir, link, unlink, rmdir } from 'node:fs/promises';
import { resolve, join, dirname, basename, parse, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { boundedFile } from './file-read.js';
import { PUBLIC_REGISTRY, registryOrigin } from './source.js';

const SELF = 'dsh-plugin-update-doctor';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const SHA = /^[a-f0-9]{64}$/;
const APPLICATION = new Set(['applied', 'failed', 'cancelled', 'restart-required', 'overridden']);
const STAGES = new Set(['install', 'enable', 'remove']);
const RESTART = new Set(['no-hmr', 'package-moved', 'host-module', 'unmanaged-plugin', 'module-comparison']);
const ATTEMPT_KEYS = new Set(['schemaVersion', 'id', 'name', 'from', 'to', 'registry', 'pid', 'startedAt', 'taskPolicy', 'confirmCancel', 'previousSha256', 'nextSha256', 'previousFiles', 'nextFiles']);
const RESULT_KEYS = new Set(['schemaVersion', 'id', 'finishedAt', 'official', 'outcome', 'error', 'truncated']);
const HANDOFF_KEYS = new Set(['schemaVersion', 'id', 'handedOffAt']);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const exactKeys = (value, allowed) => { if (!object(value) || Object.keys(value).some(key => !allowed.has(key))) fail('self-update-record-format'); };
const identifier = value => { if (typeof value !== 'string' || !UUID.test(value)) fail('self-update-id-invalid'); return value; };
const timestamp = value => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('self-update-time-invalid'); return value; };

/** Immutable per-attempt handoff receipts; reading from a new plugin generation never rewrites them. */
export class SelfUpdateStore {
    constructor(root, redact = value => value, { pid = process.pid, now = Date.now, maxBytes = 128 * 1024, maxAttempts = 8, pendingTimeoutMs = 30 * 60_000 } = {}) {
        if (typeof root !== 'string' || !root || !Number.isSafeInteger(pid) || pid < 1 || typeof now !== 'function' || typeof redact !== 'function') fail('self-update-store-options');
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > 128 * 1024 || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 8 || !Number.isFinite(pendingTimeoutMs) || pendingTimeoutMs < 0) fail('self-update-store-options');
        Object.assign(this, { root: resolve(root), redact, pid, now, maxBytes, maxAttempts, pendingTimeoutMs });
        this.warning = null;
    }
    time() { return new Date(this.now()).toISOString(); }
    attempt(value, reading = false) {
        if (!object(value)) fail('self-update-attempt-invalid');
        if (reading) {
            exactKeys(value, ATTEMPT_KEYS);
            if (value.schemaVersion !== 1 || value.name !== SELF || ['id', 'from', 'to', 'registry', 'pid', 'startedAt', 'taskPolicy', 'confirmCancel'].some(key => !Object.hasOwn(value, key))) fail('self-update-record-format');
            if (!Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.confirmCancel !== 'boolean' || !['wait-for-idle', 'cancel-active'].includes(value.taskPolicy)) fail('self-update-record-format');
            timestamp(value.startedAt);
        }
        const id = identifier(value.id ?? randomUUID());
        if (!VERSION.test(value.from ?? '') || !VERSION.test(value.to ?? '') || value.from === value.to || registryOrigin(value.registry) !== PUBLIC_REGISTRY) fail('self-update-attempt-target');
        const pid = value.pid ?? this.pid;
        if (!Number.isSafeInteger(pid) || pid < 1 || !reading && pid !== this.pid) fail('self-update-attempt-pid');
        const taskPolicy = value.taskPolicy ?? 'wait-for-idle', confirmCancel = value.confirmCancel ?? false;
        if (!['wait-for-idle', 'cancel-active'].includes(taskPolicy) || typeof confirmCancel !== 'boolean' || taskPolicy === 'cancel-active' && !confirmCancel || taskPolicy === 'wait-for-idle' && confirmCancel) fail('self-update-task-policy');
        const result = { schemaVersion: 1, id, name: SELF, from: value.from, to: value.to, registry: PUBLIC_REGISTRY, pid, startedAt: timestamp(value.startedAt ?? this.time()), taskPolicy, confirmCancel };
        for (const key of ['previousSha256', 'nextSha256']) if (value[key] !== undefined) { if (!SHA.test(value[key])) fail('self-update-digest-invalid'); result[key] = value[key]; }
        for (const key of ['previousFiles', 'nextFiles']) if (value[key] !== undefined) {
            if (!object(value[key]) || Object.keys(value[key]).length === 0 || Object.keys(value[key]).length > 128) fail('self-update-files-invalid');
            result[key] = {};
            for (const [path, sha] of Object.entries(value[key])) {
                if (!/^(?:package\.json|index\.js|client\.js|cordis\.patch\.yml|icon\.svg|README\.md|LICENSE|native\/(?:LockProbe\.cs|build\.ps1|win-x64\/lock-probe\.exe)|lib\/[a-zA-Z0-9_-]+\.js|locale\/[a-zA-Z0-9_-]+\.json|docs\/[a-zA-Z0-9_.-]+\.md)$/.test(path) || !SHA.test(sha)) fail('self-update-files-invalid');
                result[key][path] = sha;
            }
        }
        return result;
    }
    text(value, maximum = 2048) {
        if (typeof value !== 'string') return undefined;
        const redacted = this.redact(value);
        if (typeof redacted !== 'string') fail('self-update-redactor-invalid');
        // Diagnostic facts never need absolute local paths or arbitrary URL user information.
        return redacted.replace(/(?:file:\/\/\/)?[A-Z]:[\\/][^\r\n"'<>]*|(?:\/home|\/Users|\/tmp|\/private\/tmp)\/[^\s"'<>]+/gi, '<local-path>')
            .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/gi, 'https://<credential>@')
            .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g, '<credential>')
            .replace(/\b(?:Bearer|Basic|Digest)\s+[^\r\n,;]+/gi, '<authorization>')
            .replace(/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|_authToken)["']?\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1<credential>')
            .replace(/([?&](?:token|key|password|secret|auth)=)[^&#\s]+/gi, '$1<credential>')
            .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
            .slice(0, maximum);
    }
    change(value) {
        if (!object(value) || !APPLICATION.has(value.application) || !STAGES.has(value.stage) || typeof value.changed !== 'boolean') fail('self-update-official-result-invalid');
        if (value.target !== SELF && !(typeof value.target === 'string' && value.target.startsWith(SELF + '@') && VERSION.test(value.target.slice(SELF.length + 1)))) fail('self-update-official-target-invalid');
        const result = { changed: value.changed, application: value.application, stage: value.stage, target: SELF };
        if (typeof value.enabled === 'boolean') result.enabled = value.enabled;
        if (value.bundle === SELF) result.bundle = SELF;
        if (VERSION.test(value.version ?? '')) result.version = value.version;
        if (RESTART.has(value.restartReason)) result.restartReason = value.restartReason;
        if (object(value.error)) {
            result.error = { code: this.text(value.error.code, 100) ?? 'operation-error' };
            const diagnostic = this.text(value.error.diagnostic); if (diagnostic !== undefined) result.error.diagnostic = diagnostic;
        }
        if (Array.isArray(value.warnings)) result.warnings = value.warnings.slice(0, 12).filter(item => typeof item === 'string').map(item => this.text(item, 512));
        if (object(value.packageResult)) {
            const source = value.packageResult;
            result.packageResult = {};
            if (Number.isSafeInteger(source.exitCode)) result.packageResult.exitCode = source.exitCode;
            if (typeof source.output === 'string') result.packageResult.output = this.text(source.output, 8000);
            if (typeof source.truncated === 'boolean') result.packageResult.truncated = source.truncated || (source.output?.length ?? 0) > 8000;
            if (typeof source.timedOut === 'boolean') result.packageResult.timedOut = source.timedOut;
            if (typeof source.kind === 'string') result.packageResult.kind = this.text(source.kind, 64);
        }
        if (Array.isArray(value.registries)) result.registries = value.registries.slice(0, 8).map(registry => registry === null ? null : registryOrigin(registry) === PUBLIC_REGISTRY ? PUBLIC_REGISTRY : '<unsupported-registry>');
        if (['registry', 'spec-host'].includes(value.failedAt)) result.failedAt = value.failedAt;
        return result;
    }
    outcome(id, value, attempt) {
        const result = { schemaVersion: 1, id, finishedAt: this.time() };
        if (object(value) && object(value.result)) {
            if (value.to !== attempt.to || value.from !== attempt.from && !(value.from === '' && value.step === 'check' && value.result.application === 'failed') || !['check', 'remove', 'install'].includes(value.step)) fail('self-update-result-target-mismatch');
            result.official = { from: value.from, to: value.to, step: value.step, result: this.change(value.result) };
            if (value.restore !== undefined) result.official.restore = this.change(value.restore);
            result.truncated = [value.result, value.restore].filter(object).some(change =>
                typeof change.error?.diagnostic === 'string' && change.error.diagnostic.length > 2048
                || Array.isArray(change.warnings) && (change.warnings.length > 12 || change.warnings.some(item => typeof item === 'string' && item.length > 512))
                || typeof change.packageResult?.output === 'string' && change.packageResult.output.length > 8000);
        } else {
            const error = value instanceof Error ? value.message : object(value) ? value.error : value;
            const message = this.text(error instanceof Error ? error.message : typeof error === 'string' ? error : object(error) ? error.message : undefined);
            if (message === undefined || !message) fail('self-update-final-result-missing');
            result.error = { message };
            if (object(value) && ['failed', 'cancelled'].includes(value.outcome)) result.outcome = value.outcome;
        }
        return result;
    }
    async checkedRoot(create = false) {
        let current = parse(this.root).root;
        const parts = this.root.slice(current.length).split(sep).filter(Boolean);
        for (const part of [null, ...parts]) {
            if (part !== null) current = join(current, part);
            let info;
            try { info = await lstat(current); }
            catch (error) {
                if (!create || error.code !== 'ENOENT') throw error;
                try { await mkdir(current, { mode: 0o700 }); } catch (created) { if (created.code !== 'EEXIST') throw created; }
                info = await lstat(current);
            }
            if (!info.isDirectory() || info.isSymbolicLink()) fail('self-update-directory-untrusted');
        }
        if (resolve(await realpath(this.root)) !== this.root) fail('self-update-directory-changed');
        return this.root;
    }
    async checkedDirectory(id) {
        identifier(id); await this.checkedRoot();
        const path = join(this.root, id), info = await lstat(path);
        if (dirname(resolve(path)) !== this.root || basename(path) !== id || !info.isDirectory() || info.isSymbolicLink() || resolve(await realpath(path)) !== path) fail('self-update-directory-untrusted');
        return path;
    }
    async files(id) {
        const directory = await this.checkedDirectory(id);
        const attempt = JSON.parse((await boundedFile(join(directory, 'attempt.json'), this.maxBytes)).toString('utf8'));
        this.attempt(attempt, true); if (attempt.id !== id) fail('self-update-record-id-mismatch');
        let handoff = null;
        try { handoff = JSON.parse((await boundedFile(join(directory, 'handoff.json'), this.maxBytes)).toString('utf8')); if (!object(handoff)) fail('self-update-handoff-format'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (handoff !== null) { exactKeys(handoff, HANDOFF_KEYS); if (handoff.schemaVersion !== 1 || handoff.id !== id) fail('self-update-record-id-mismatch'); timestamp(handoff.handedOffAt); }
        let result = null;
        try { result = JSON.parse((await boundedFile(join(directory, 'result.json'), this.maxBytes)).toString('utf8')); if (!object(result)) fail('self-update-result-format'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (result !== null) {
            exactKeys(result, RESULT_KEYS);
            if (result.schemaVersion !== 1 || result.id !== id) fail('self-update-record-id-mismatch');
            timestamp(result.finishedAt);
            if (result.official !== undefined) { if (result.outcome !== undefined || result.error !== undefined) fail('self-update-result-conflict'); this.outcome(id, result.official, attempt); }
            else if (!object(result.error) || typeof result.error.message !== 'string' || !result.error.message || result.outcome !== undefined && !['failed', 'cancelled'].includes(result.outcome)) fail('self-update-final-result-missing');
            // Never surface unexpected fields inserted into a diagnostic record.
            result = { ...result, ...(result.official === undefined ? { error: { message: this.text(result.error.message) } } : { official: this.outcome(id, result.official, attempt).official }) };
        }
        return { attempt, handoff, result };
    }
    async ids() {
        await this.checkedRoot();
        const handle = await opendir(this.root), ids = [];
        for await (const entry of handle) {
            if (entry.name === '.start.lock') continue;
            if (!UUID.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) fail('self-update-root-entry-untrusted');
            ids.push(entry.name); if (ids.length > 64) fail('self-update-directory-count-limit');
        }
        return ids;
    }
    view({ attempt, handoff = null, result }) {
        if (result?.official) return { id: attempt.id, phase: 'finished', attempt, handoff, result: result.official, finishedAt: result.finishedAt, warning: null, ...(result.truncated ? { truncationWarning: 'self-update-result-clipped' } : {}) };
        if (result?.error) return { id: attempt.id, phase: result.outcome ? 'finished' : 'unknown', attempt, handoff, result: result.outcome ? { outcome: result.outcome, error: result.error } : null, error: result.error, finishedAt: result.finishedAt, warning: result.outcome ? null : 'self-update-result-unknown' };
        if (this.warning === 'self-update-write-failed') return { id: attempt.id, phase: 'unknown', attempt, handoff, result: null, warning: this.warning };
        const expired = this.now() - Date.parse(attempt.startedAt) > this.pendingTimeoutMs;
        const sameProcess = attempt.pid === this.pid;
        return { id: attempt.id, phase: sameProcess && !expired ? handoff ? 'handed-off' : 'waiting' : 'unknown', attempt, handoff, result: null, warning: !sameProcess ? 'self-update-interrupted' : expired ? 'self-update-result-timeout' : null };
    }
    async read(id) {
        identifier(id);
        try { const view = this.view(await this.files(id)); this.warning = view.warning; return view; }
        catch (error) {
            if (error.code === 'ENOENT') {
                // An entirely absent attempt is not an outcome; a partial attempt is an I/O failure.
                try { await lstat(join(this.root, id)); } catch (missing) { if (missing.code === 'ENOENT') return null; }
            }
            this.warning = 'self-update-read-failed'; return { id, phase: 'unknown', attempt: null, result: null, warning: this.warning };
        }
    }
    async latest() {
        try {
            let ids;
            try { ids = await this.ids(); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
            const records = await Promise.all(ids.map(id => this.files(id)));
            records.sort((a, b) => Date.parse(b.attempt.startedAt) - Date.parse(a.attempt.startedAt) || b.attempt.id.localeCompare(a.attempt.id));
            if (!records.length) return null;
            const view = this.view(records[0]); this.warning = view.warning; return view;
        } catch { this.warning = 'self-update-read-failed'; return { id: null, phase: 'unknown', attempt: null, result: null, warning: this.warning }; }
    }
    async publish(id, filename, value) {
        if (!['attempt.json', 'handoff.json', 'result.json'].includes(filename)) fail('self-update-file-invalid');
        const payload = JSON.stringify(value);
        if (Buffer.byteLength(payload) > this.maxBytes) fail('self-update-byte-limit');
        const directory = await this.checkedDirectory(id), target = join(directory, filename), temporary = join(directory, '.' + randomUUID() + '.tmp');
        const handle = await open(temporary, 'wx', 0o600);
        let pinned;
        try {
            try { await handle.writeFile(payload, 'utf8'); await handle.sync(); pinned = await handle.stat(); }
            finally { await handle.close(); }
            await this.checkedDirectory(id);
            const named = await lstat(temporary);
            if (!named.isFile() || named.isSymbolicLink() || named.ino !== pinned.ino || named.dev !== pinned.dev) fail('self-update-temporary-changed');
            await link(temporary, target); // Atomic publication; an existing result is never overwritten.
        } finally {
            const info = await lstat(temporary);
            if (info.isFile() && !info.isSymbolicLink() && dirname(resolve(temporary)) === directory && (!pinned || info.ino === pinned.ino && info.dev === pinned.dev)) await unlink(temporary);
        }
    }
    async prune(record) {
        if (!record.result) return false; // Even expired or cross-process pending attempts are retained.
        const id = record.attempt.id, directory = await this.checkedDirectory(id);
        const handle = await opendir(directory), names = [];
        for await (const entry of handle) names.push(entry.name);
        const expected = record.handoff ? ['attempt.json', 'handoff.json', 'result.json'] : ['attempt.json', 'result.json'];
        if (names.length !== expected.length || expected.some(name => !names.includes(name))) return false;
        const current = await this.files(id);
        if (JSON.stringify(current) !== JSON.stringify(record)) fail('self-update-record-changed');
        for (const name of ['result.json', ...(record.handoff ? ['handoff.json'] : []), 'attempt.json']) {
            const target = join(directory, name), info = await lstat(target);
            if (dirname(resolve(target)) !== directory || !info.isFile() || info.isSymbolicLink() || resolve(await realpath(target)) !== target) fail('self-update-cleanup-untrusted');
            await unlink(target);
        }
        await this.checkedDirectory(id); await rmdir(directory); return true;
    }
    async start(value) {
        const attempt = this.attempt(value), lockPath = join(this.root, '.start.lock');
        let lock;
        try {
            await this.checkedRoot(true);
            try { lock = await open(lockPath, 'wx', 0o600); } catch (error) { if (error.code === 'EEXIST') fail('self-update-store-busy'); throw error; }
            const ids = await this.ids(), records = await Promise.all(ids.map(id => this.files(id)));
            if (ids.includes(attempt.id)) fail('self-update-attempt-exists');
            if (records.some(record => !record.result || record.result.error && !record.result.outcome)) fail('self-update-pending-attempt');
            records.sort((a, b) => Date.parse(a.attempt.startedAt) - Date.parse(b.attempt.startedAt) || a.attempt.id.localeCompare(b.attempt.id));
            let retained = records.length;
            for (const record of records) if (retained >= this.maxAttempts && await this.prune(record)) retained--;
            if (retained >= this.maxAttempts) fail('self-update-capacity-reached');
            const path = join(this.root, attempt.id); await mkdir(path, { mode: 0o700 });
            await this.publish(attempt.id, 'attempt.json', attempt);
            this.warning = null; return attempt;
        } catch (error) { this.warning = 'self-update-write-failed'; throw error; }
        finally {
            if (lock) {
                const pinned = await lock.stat(); await lock.close();
                const named = await lstat(lockPath);
                if (!named.isFile() || named.isSymbolicLink() || named.ino !== pinned.ino || named.dev !== pinned.dev) fail('self-update-lock-changed');
                await unlink(lockPath);
            }
        }
    }
    async markHandedOff(id) {
        identifier(id);
        try {
            const record = await this.files(id);
            if (record.result) fail('self-update-already-finished');
            if (record.handoff) fail('self-update-already-handed-off');
            if (record.attempt.pid !== this.pid) fail('self-update-attempt-pid');
            const handoff = { schemaVersion: 1, id, handedOffAt: this.time() };
            await this.publish(id, 'handoff.json', handoff);
            this.warning = null; return this.view({ ...record, handoff });
        } catch (error) { this.warning = 'self-update-write-failed'; throw error; }
    }
    async finish(id, value) {
        identifier(id);
        try {
            const record = await this.files(id), result = this.outcome(id, value, record.attempt);
            if (record.handoff && result.outcome !== undefined) fail('self-update-local-outcome-after-handoff');
            await this.publish(id, 'result.json', result);
            this.warning = null; return this.view({ ...record, result });
        } catch (error) { this.warning = 'self-update-write-failed'; throw error; }
    }
}
