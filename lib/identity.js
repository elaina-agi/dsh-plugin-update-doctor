import { readFile, lstat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PUBLIC_REGISTRY, approvedPublicRegistry } from './source.js';
import { boundedFile } from './file-read.js';
import { validateUnionReference } from './union-staging.js';

const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
const SHA = /^[a-f0-9]{64}$/;
const KEY = /^[A-Za-z0-9-]+\/package\.tgz$/;
const encode = value => JSON.stringify(value, null, 2);

/** Current install/recovery identities are separate from the rotating diagnostic log. */
export class IdentityStore {
    constructor(path, { maxBytes = 2_000_000, maxPackages = 256, maxRecoveries = 80 } = {}) {
        Object.assign(this, { path, maxBytes, maxPackages, maxRecoveries });
        this.installed = new Map(); this.recoveries = new Map(); this.warning = null; this.chain = Promise.resolve();
    }
    async load() {
        try {
            const info = await lstat(this.path);
            if (!info.isFile() || info.isSymbolicLink() || info.size > this.maxBytes) throw Error('identity-file-untrusted');
            const parsed = JSON.parse((await boundedFile(this.path, this.maxBytes)).toString('utf8'));
            if (![1,2,3].includes(parsed.schemaVersion) || !Array.isArray(parsed.installed) || !Array.isArray(parsed.recoveries)) throw Error('identity-format');
            if (parsed.installed.length > this.maxPackages || parsed.recoveries.length > this.maxRecoveries) throw Error('identity-count-limit');
            for (const item of parsed.installed) this.validateInstalled(item);
            for (const item of parsed.recoveries) this.validateRecovery(item);
            if (parsed.schemaVersion === 1 && parsed.recoveries.some(item=>['registry-spec','registry-migration'].includes(item.installMode))) throw Error('identity-format');
            if (parsed.schemaVersion !== 3 && [...parsed.installed,...parsed.recoveries.flatMap(value=>[value.previous,value.next])].some(item=>item?.runtimeGeneration?.kind==='union-dependency'))throw Error('identity-format');
            this.installed = new Map(parsed.installed.map(item => [item.name, item]));
            this.recoveries = new Map(parsed.recoveries.map(item => [item.name, item]));
        } catch (error) { if (error.code !== 'ENOENT') this.warning = 'identity-read-failed'; }
    }
    validateArchive(value) {
        if(value?.runtimeGeneration?.kind==='union-dependency'){validateUnionReference(value);return;}
        if (!value || !NAME.test(value.name ?? '') || !VERSION.test(value.version ?? '') || value.origin !== PUBLIC_REGISTRY
            || !KEY.test(value.archiveKey ?? '') || !SHA.test(value.sha256 ?? '') || !SHA.test(value.originalSha256 ?? '')
            || typeof value.integrity !== 'string' || !value.integrity.startsWith('sha512-')) throw Error('identity-archive-invalid');
        if (!value.manifest || value.manifest.name !== value.name || value.manifest.version !== value.version || !Array.isArray(value.rows) || value.rows.length > 200) throw Error('identity-archive-manifest');
    }
    validateInstalled(value) { this.validateArchive(value); }
    validateRecovery(value) {
        if (!value || !NAME.test(value.name ?? '') || typeof value.id !== 'string' || value.id.length > 128 || typeof value.failedBatchId !== 'string' || value.failedBatchId.length > 128
            || !VERSION.test(value.from ?? '') || !VERSION.test(value.to ?? '') || typeof value.enabled !== 'boolean'
            || !['prepared', 'failed', 'unknown'].includes(value.status) || typeof value.expectedFingerprint !== 'string' || value.expectedFingerprint.length > 200_000) throw Error('identity-recovery-invalid');
        if (value.installMode !== undefined && !['archive','registry-spec','registry-migration','union-generation'].includes(value.installMode)) throw Error('identity-recovery-mode-invalid');
        if(value.registry!==undefined&&!approvedPublicRegistry(value.registry))throw Error('identity-recovery-mode-invalid');
        if(value.dependencyGraph!==undefined&&(!SHA.test(value.dependencyGraph.digest??'')||!Array.isArray(value.dependencyGraph.packages)||value.dependencyGraph.packages.length>64||!Array.isArray(value.dependencyGraph.edges)||value.dependencyGraph.edges.length>256))throw Error('identity-recovery-mode-invalid');
        if (value.dispatchStarted !== undefined && typeof value.dispatchStarted !== 'boolean') throw Error('identity-recovery-mode-invalid');
        if (value.installMode === 'registry-spec' && (value.previous.runtimeGeneration || value.next.runtimeGeneration)) throw Error('identity-recovery-mode-invalid');
        if(value.unionOutcomeUnknown!==undefined&&typeof value.unionOutcomeUnknown!=='boolean')throw Error('identity-recovery-mode-invalid');
        if(value.installMode==='union-generation'&&(value.name!=='dsh-union-search'||value.previous?.runtimeGeneration?.kind!=='union-dependency'||value.next?.runtimeGeneration?.kind!=='union-dependency'))throw Error('identity-recovery-mode-invalid');
        if(value.installMode!=='union-generation'&&(value.previous?.runtimeGeneration?.kind==='union-dependency'||value.next?.runtimeGeneration?.kind==='union-dependency'))throw Error('identity-recovery-mode-invalid');
        this.validateArchive(value.previous); this.validateArchive(value.next);
        if (value.previous.name !== value.name || value.next.name !== value.name || value.previous.version !== value.from || value.next.version !== value.to) throw Error('identity-recovery-target');
    }
    document(installed = this.installed, recoveries = this.recoveries) {
        const union=[...installed.values(),...[...recoveries.values()].flatMap(value=>[value.previous,value.next])].some(value=>value?.runtimeGeneration?.kind==='union-dependency');
        return { schemaVersion: union ? 3 : 2, installed: [...installed.values()], recoveries: [...recoveries.values()] };
    }
    async change(fn) {
        if(this.warning)throw Error('identity-store-unverified');
        const work = this.chain.then(async () => {
            const installed = new Map(this.installed), recoveries = new Map(this.recoveries);
            fn(installed, recoveries);
            if (installed.size > this.maxPackages || recoveries.size > this.maxRecoveries) throw Error('identity-capacity-reached');
            const payload = encode(this.document(installed, recoveries));
            if (Buffer.byteLength(payload) > this.maxBytes) throw Error('identity-byte-limit');
            const temporary = this.path + '.' + randomUUID() + '.tmp';
            try {
                await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
                await writeFile(temporary, payload, { mode: 0o600, flag: 'wx' });
                await rename(temporary, this.path);
            } catch (error) { this.warning = 'identity-write-failed';
                try { const info = await lstat(temporary); if (info.isFile() && !info.isSymbolicLink()) await unlink(temporary); } catch { /* Only our unique temporary sibling may remain. */ }
                throw error;
            }
            this.installed = installed; this.recoveries = recoveries; this.warning = null;
        });
        this.chain = work.catch(() => {}); await work;
    }
    async remember(value) { this.validateInstalled(value); await this.change(installed => installed.set(value.name, structuredClone(value))); }
    async prepare(value) { this.validateRecovery(value); await this.change((_, recoveries) => recoveries.set(value.name, structuredClone(value))); }
    async settle(name, installed, recovery) {
        if (installed) this.validateInstalled(installed); if (recovery) this.validateRecovery(recovery);
        await this.change((current, failed) => { if (installed) current.set(name, structuredClone(installed)); else current.delete(name); if (recovery) failed.set(name, structuredClone(recovery)); else failed.delete(name); });
    }
    get(name) { return this.installed.get(name); }
    recovery(name) { return this.recoveries.get(name); }
    references() { return new Set([...this.installed.values(), ...[...this.recoveries.values()].flatMap(value => [value.previous, value.next])].map(value => value.archiveKey)); }
}
