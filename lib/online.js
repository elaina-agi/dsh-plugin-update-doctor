import { createHash } from 'node:crypto';
import { isGenerationSupported } from './wsl-policy.js';
import { PUBLIC_REGISTRY, publicRegistry } from './source.js';

/** Query via the official manager; candidate versions are compatible nondeprecated stable bundles. */
export async function scanUpdates(manager, summaries, { signal, concurrency = 3 } = {}) {
    const items = new Array(summaries.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, summaries.length)) }, async () => {
        while (next < summaries.length) {
            signal?.throwIfAborted();
            const index = next++; const bundle = summaries[index];
            const queryable = bundle.sourceKind === 'registry' || bundle.canUpdate;
            if (!queryable) { items[index] = { ...bundle, latestVersion: null, status: 'blocked', versionChecked:false }; continue; }
            try {
                const result = await manager.listVersions(bundle.name, undefined, signal);
                if (result.status !== 'listed') { items[index] = { ...bundle, latestVersion: null, canUpdate: false, status: 'error', reasons: [result.problem ?? 'version-query-failed'] }; continue; }
                const offered = result.versions.find(version => !version.prerelease && !version.version.includes('-') && version.bundle && !version.incompatible && !version.deprecated);
                const sourceAllowed = publicRegistry(result.registry);
                const reasons = [...bundle.reasons ?? [], ...sourceAllowed ? [] : [result.registry == null ? 'registry-origin-unverified' : 'registry-origin-unsupported']];
                items[index] = { ...bundle, latestVersion: offered?.version ?? null, registry: sourceAllowed ? PUBLIC_REGISTRY : null,
                    canUpdate: bundle.canUpdate && sourceAllowed && !!offered, versionChecked: true,
                    status: !bundle.canUpdate || !sourceAllowed ? 'blocked' : offered ? 'available' : result.omitted > 0 ? 'unknown' : 'up-to-date',
                    reasons: bundle.canUpdate && sourceAllowed && !offered ? (result.omitted > 0 ? ['compatible-version-window-incomplete'] : []) : reasons };
            } catch (error) {
                if (signal?.aborted) throw error;
                items[index] = { ...bundle, latestVersion: null, canUpdate: false, status: 'error', reasons: ['version-query-failed'] };
            }
        }
    }));
    return items;
}

/** Deliberately blocks changes capable of replacing the Host or this manager's runtime dependencies. */
export function onlineSafety(bundle, manifest) {
    const reasons = [];
    const dependencies = { ...manifest?.dependencies, ...manifest?.optionalDependencies };
    const wslGeneration = isGenerationSupported(manifest);
    if (bundle.name === 'dsh-plugin-wsl-env' && !wslGeneration) reasons.push('wsl-version-not-yet-verified');
    if (Object.keys(dependencies).length) reasons.push('dependency-graph-update-requires-separate-review');
    if (Object.keys(dependencies).some(name => name.startsWith('@deepseek-ai/') || name === 'dsh-plugin-update-doctor')) reasons.push('host-runtime-dependencies');
    if (Object.keys(dependencies).some(name => /(?:node-pty|koffi|ffi-napi|better-sqlite3|electron|sharp)/.test(name))) reasons.push('native-or-shared-runtime');
    if (!wslGeneration && (bundle.overrides ?? []).some(id => /^(?:subprocess|fs-sandbox|directory-picker|agent-loop|hmr|plugin-manager|storage|session|tool-working-directory)$/.test(id))) reasons.push('core-service-takeover');
    if (bundle.name === 'dsh-plugin-update-doctor') reasons.push('self-update-blocked');
    if (!bundle.removable || bundle.availability !== 'profile' || bundle.readOnlyReason) reasons.push('management-or-shipped-bundle');
    if (bundle.update !== 'registry') reasons.push('registry-updates-only');
    if (!manifest || manifest.name !== bundle.name || manifest.version !== bundle.version) reasons.push('package-version-unverified');
    return { permitted: reasons.length === 0, reasons };
}
export function snapshotDigest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
