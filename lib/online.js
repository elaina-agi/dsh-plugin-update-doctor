import { createHash } from 'node:crypto';
import { isGenerationSupported } from './wsl-policy.js';
import { publicRegistry, approvedPublicRegistry, registryOrigin, readRegistryVersions } from './source.js';
import { dependencyPolicyReasons } from './dependency-policy.js';

/** Version discovery is independent of installation admission and always scoped to the queried source. */
export function versionDiscovery(result) {
    if (result?.status !== 'listed' || !Array.isArray(result.versions)) return { versionStatus: 'error', latestVersion: null, latestPublishedVersion: null };
    const versions = result.versions;
    const malformed = versions.some(value => !value || typeof value.version !== 'string' || value.version.length > 128 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value.version)
        || !value.version.split(/[.+-]/).slice(0,3).map(Number).every(Number.isSafeInteger));
    const stable = versions.filter(value => /^\d+\.\d+\.\d+$/.test(value?.version ?? '') && !value.prerelease)
        .sort((a,b) => { const aa=a.version.split('.').map(Number),bb=b.version.split('.').map(Number); for (let i=0;i<3;i++) if(aa[i]!==bb[i]) return bb[i]-aa[i]; return 0; });
    const offered = stable.find(value => value.bundle && !value.incompatible && !value.metadataIncomplete && !value.deprecated);
    const incomplete = malformed || stable.some(value => value.metadataIncomplete) || result.queryReasons?.length > 0;
    const versionStatus = incomplete ? 'unknown' : offered ? 'available' : result.omitted > 0 ? 'unknown' : stable.length ? 'no-compatible-version' : 'up-to-date';
    return { versionStatus, latestVersion: offered?.version ?? null, latestPublishedVersion: stable[0]?.version ?? null };
}

/** Query via the official manager; discovery never grants permission to replace a package. */
export async function scanUpdates(manager, summaries, { signal, concurrency = 3, inspectWslCandidate } = {}) {
    const items = new Array(summaries.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, summaries.length)) }, async () => {
        while (next < summaries.length) {
            signal?.throwIfAborted();
            const index = next++; const bundle = summaries[index];
            const queryable = bundle.sourceKind === 'registry' || bundle.canUpdate || bundle.unionGeneration;
            if (!queryable) { items[index] = { ...bundle, canUpdate:false, latestVersion:null, latestPublishedVersion:null, status:'blocked', versionStatus:'not-checked', updateStatus:'blocked', versionChecked:false }; continue; }
            try {
                const result = await readRegistryVersions(manager, bundle.name, signal);
                const discovery = versionDiscovery(result);
                if (discovery.versionStatus === 'error') { items[index] = { ...bundle, ...discovery, canUpdate:false, updateStatus:'blocked', status:'error', versionChecked:false, reasons:[...new Set([...bundle.reasons ?? [], 'version-query-failed'])] }; continue; }
                const sourceAllowed = approvedPublicRegistry(result.registry);
                const reasons = [...bundle.reasons ?? [], ...result.queryReasons ?? [], ...sourceAllowed ? [] : [result.registry == null ? 'registry-origin-unverified' : 'registry-origin-unsupported']];
                let wslPreflight;
                if(bundle.name==='dsh-plugin-wsl-env'&&discovery.latestVersion){
                    if(!isGenerationSupported({name:bundle.name,version:discovery.latestVersion}))reasons.push('wsl-version-format-unsupported');
                    else if(sourceAllowed&&bundle.canUpdate){
                        if(typeof inspectWslCandidate!=='function')reasons.push('wsl-archive-preflight-unavailable');
                        else try{wslPreflight=await inspectWslCandidate(discovery.latestVersion,{origin:registryOrigin(result.registry),signal});if(wslPreflight?.status!=='passed'||wslPreflight.version!==discovery.latestVersion||!/^[a-f0-9]{64}$/.test(wslPreflight.originalSha256??''))throw Error('wsl-archive-preflight-failed');}
                        catch(error){if(signal?.aborted)throw error;const code=error?.code??error?.message;reasons.push(typeof code==='string'&&/^[a-z-]{1,100}$/.test(code)?code:'wsl-archive-preflight-failed');}
                    }
                }
                if (discovery.versionStatus === 'unknown') reasons.push('version-metadata-incomplete');
                const uniqueReasons = [...new Set(reasons)];
                const canUpdate = bundle.canUpdate && sourceAllowed && uniqueReasons.length === 0 && discovery.versionStatus === 'available';
                const updateStatus = canUpdate ? 'available' : uniqueReasons.length || !bundle.canUpdate ? 'blocked' : 'no-update';
                items[index] = { ...bundle, ...discovery, registry:registryOrigin(result.registry), canUpdate, versionChecked:true, updateStatus,
                    status:updateStatus === 'blocked' ? 'blocked' : discovery.versionStatus, reasons:uniqueReasons, ...(wslPreflight?{wslPreflight}: {}) };
            } catch (error) {
                if (signal?.aborted) throw error;
                items[index] = { ...bundle, latestVersion:null, latestPublishedVersion:null, canUpdate:false, status:'error', versionStatus:'error', updateStatus:'blocked', versionChecked:false,
                    reasons:[...new Set([...bundle.reasons ?? [], 'version-query-failed'])] };
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
    if (bundle.name === 'dsh-plugin-wsl-env' && !wslGeneration) reasons.push('wsl-version-format-unsupported');
    reasons.push(...dependencyPolicyReasons(manifest ?? {}));
    if (Object.keys(dependencies).some(name => /(?:node-pty|koffi|ffi-napi|better-sqlite3|electron|sharp)/.test(name))) reasons.push('native-or-shared-runtime');
    if (!wslGeneration && (bundle.overrides ?? []).some(id => /^(?:subprocess|fs-sandbox|directory-picker|agent-loop|hmr|plugin-manager|storage|session|tool-working-directory)$/.test(id))) reasons.push('core-service-takeover');
    if (bundle.name === 'dsh-plugin-update-doctor') reasons.push('self-update-blocked');
    if (!bundle.removable || bundle.availability !== 'profile' || bundle.readOnlyReason) reasons.push('management-or-shipped-bundle');
    if (bundle.update !== 'registry') reasons.push('registry-updates-only');
    if (!manifest || manifest.name !== bundle.name || manifest.version !== bundle.version) reasons.push('package-version-unverified');
    return { permitted: reasons.length === 0, reasons };
}
export function snapshotDigest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
