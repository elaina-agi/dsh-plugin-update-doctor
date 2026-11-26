import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const MAX_ENTRIES = 10;
const MAX_TEXT = 16_000;
const MAX_BYTES = 192_000;
const clip = value => typeof value !== 'string' ? value : value.length > MAX_TEXT ? value.slice(0, MAX_TEXT) + '\n<diagnostic-truncated>' : value;
const resultOf = value => value && typeof value === 'object' ? {
    application: clip(value.application), stage: clip(value.stage),
    ...(value.error ? { error: { code: clip(value.error.code), diagnostic: clip(value.error.diagnostic) } } : {}),
} : null;
const verificationOf = value => value && typeof value === 'object' ? {
    package: value.package?.status ?? null, source: value.source?.status ?? null,
    host: value.host?.status ?? null, runtime: value.runtime?.status ?? null,
    ...(value.dependency ? { dependency: clip(value.dependency.digest) } : {}),
} : null;

/**
 * Bounded, sanitized last-failure details outside the rolling history budget.
 *
 * The history store trims old records to stay bounded, which can leave only an error
 * code after a restart. This log keeps the ten most recent terminal failures with
 * their message, steps and recovery result so a later report still explains what
 * happened. It never authorizes a package mutation and a write failure only sets a
 * warning.
 */
export class FailureLog {
    constructor(path, redact, { maxEntries = MAX_ENTRIES, maxBytes = MAX_BYTES } = {}) {
        this.path = resolve(path); this.redact = redact; this.maxEntries = maxEntries; this.maxBytes = maxBytes;
        this.entries = []; this.warning = null; this.chain = Promise.resolve();
    }
    entry(value) {
        if (!value || typeof value !== 'object' || typeof value.id !== 'string') return null;
        return {
            id: clip(value.id), time: clip(value.time), package: clip(value.package), operation: clip(value.operation),
            phase: clip(value.phase), status: clip(value.status), outcome: clip(value.outcome),
            from: clip(value.from), to: clip(value.to), installMode: clip(value.installMode),
            error: value.error ? { code: clip(value.error.code), diagnostic: clip(value.error.diagnostic) } : null,
            result: resultOf(value.result), restore: value.restore ? {
                application: clip(value.restore.application),
                ...(value.restore.error ? { error: { code: clip(value.restore.error.code), diagnostic: clip(value.restore.error.diagnostic) } } : {}),
            } : null,
            verification: verificationOf(value.verification),
            steps: Array.isArray(value.steps) ? value.steps.slice(-20).map(step => typeof step === 'string' ? clip(step) : ({ step: clip(step?.step), time: clip(step?.time) })) : [],
        };
    }
    fit(entries) {
        const kept = [];
        let bytes = 2;
        for (const entry of entries) {
            if (kept.length >= this.maxEntries) break;
            const cost = Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1;
            if (bytes + cost > this.maxBytes) break;
            kept.push(entry); bytes += cost;
        }
        return kept;
    }
    async load() {
        let file;
        try {
            file = await open(this.path, 'r');
            const info = await file.stat();
            if (info.size > this.maxBytes) { this.warning = 'failure-log-too-large'; return; }
            const buffer = Buffer.alloc(info.size + 1);
            const { bytesRead } = await file.read(buffer, 0, info.size, 0);
            const parsed = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
            if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.entries)) throw new Error('failure-log-format');
            this.entries = this.fit(this.redact(parsed.entries).map(value => this.entry(value)).filter(Boolean));
        } catch (error) { if (error.code !== 'ENOENT') this.warning = 'failure-log-read-failed'; }
        finally { if (file) await file.close().catch(() => { this.warning = 'failure-log-read-failed'; }); }
    }
    async remember(value) {
        if (this.maxBytes < 64) { this.warning = 'failure-log-budget-too-small'; return null; }
        let safe;
        try { safe = this.entry(this.redact(value)); } catch { this.warning = 'failure-log-record-invalid'; return null; }
        if (!safe) { this.warning = 'failure-log-record-invalid'; return null; }
        this.entries = this.fit([safe, ...this.entries.filter(entry => entry.id !== safe.id)]);
        const payload = JSON.stringify({ schemaVersion: 1, entries: this.entries });
        if (Buffer.byteLength(payload, 'utf8') > this.maxBytes) { this.warning = 'failure-log-too-large'; return safe; }
        this.chain = this.chain.then(async () => {
            const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
            let created = false, file;
            try {
                await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
                file = await open(temporary, 'wx', 0o600); created = true;
                await file.writeFile(payload); await file.close(); file = undefined;
                await rename(temporary, this.path); created = false;
                this.warning = null;
            } catch { this.warning = 'failure-log-write-failed'; }
            finally {
                if (file) await file.close().catch(() => { this.warning = 'failure-log-write-failed'; });
                if (created) await unlink(temporary).catch(() => { this.warning = 'failure-log-write-failed'; });
            }
        });
        await this.chain;
        return safe;
    }
    list(name) {
        return this.entries.filter(entry => !name || entry.package === name);
    }
}
