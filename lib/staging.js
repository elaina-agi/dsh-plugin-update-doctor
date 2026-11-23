import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, lstat, realpath } from 'node:fs/promises';
import { join, basename, dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { inspectPatches } from './patch-safety.js';
import { archiveEntries, generationArchive } from './generation.js';
import { isGenerationSupported, inspectWslPatches } from './wsl-policy.js';
import { PUBLIC_REGISTRY, PUBLIC_MIRROR, approvedPublicRegistry, registryOrigin, archiveKey, archivePath } from './source.js';
import { dependencyPolicyReasons } from './dependency-policy.js';
import { boundedFile } from './file-read.js';

const MAX_ARCHIVE = 64 * 1024 * 1024;
const MAX_CONTENT = 256 * 1024 * 1024;
const abortSignal = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000);

/** Stage registry bytes before touching the installed version. Never executes staged code. */
export class RegistryStager {
    constructor(root, { fetcher = fetch, registry = 'https://registry.npmjs.org', compatibility = () => undefined } = {}) { this.root = root; this.fetcher = fetcher; this.registry = registry; this.compatibility = compatibility; this.verifiedWslOriginals=new Map(); }
    async listVersions(name, current, signal) {
        if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name)) throw new Error('invalid-registry-package');
        if (registryOrigin(this.registry) !== PUBLIC_REGISTRY) throw new Error('registry-origin-unsupported');
        const parts = value => /^\d+\.\d+\.\d+$/.test(value ?? '') ? value.split('.').map(Number) : [];
        const currentParts = parts(current);
        if (currentParts.length !== 3 || !currentParts.every(Number.isSafeInteger)) throw new Error('invalid-installed-version');
        signal?.throwIfAborted();
        const response = await this.fetcher(new URL(encodeURIComponent(name), PUBLIC_REGISTRY + '/'), {
            signal: abortSignal(signal), redirect: 'error', credentials: 'omit', headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error('registry-versions-unavailable');
        const data = JSON.parse((await boundedBody(response, 10 * 1024 * 1024)).toString('utf8'));
        if (!data || data.name !== name || !data.versions || typeof data.versions !== 'object' || Array.isArray(data.versions)
            || !Object.hasOwn(data.versions,current)) throw new Error('registry-versions-invalid');
        const compare = (a,b) => { const aa=parts(a),bb=parts(b); for(let i=0;i<3;i++) if(aa[i]!==bb[i]) return aa[i]-bb[i]; return 0; };
        const newer = [];
        for (const [version, manifest] of Object.entries(data.versions)) {
            const numbers = parts(version);
            if (!numbers.length) continue;
            if (!numbers.every(Number.isSafeInteger) || !manifest || typeof manifest !== 'object' || Array.isArray(manifest)
                || manifest.name !== name || manifest.version !== version) throw new Error('registry-version-identity-invalid');
            if (compare(version,current) > 0) newer.push(manifest);
        }
        newer.sort((a,b)=>compare(b.version,a.version));
        const versions = newer.slice(0,20).map(manifest => {
            const patch = manifest.dsh?.bundle?.patch;
            const bundle = typeof patch === 'string' && !!patch || Array.isArray(patch) && patch.length > 0 && patch.every(value => typeof value === 'string' && !!value);
            return { version:manifest.version, bundle, prerelease:false, deprecated:manifest.deprecated,
                incompatible:this.compatibility(manifest), metadataIncomplete: !bundle };
        });
        // Missing custom metadata cannot turn a visible newer version into "up to date".
        return { status:'listed', installed:current, versions, omitted:newer.length-versions.length, registry:PUBLIC_REGISTRY };
    }
    async stage(name, version, { signal, origin = PUBLIC_REGISTRY } = {}) {
        if (!approvedPublicRegistry(origin) || registryOrigin(this.registry) !== PUBLIC_REGISTRY) throw new Error('registry-origin-unsupported');
        if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name) || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version)) throw new Error('invalid-staging-target');
        const url = new URL(encodeURIComponent(name) + '/' + encodeURIComponent(version), this.registry.endsWith('/') ? this.registry : this.registry + '/');
        if (url.protocol !== 'https:') throw new Error('insecure-registry');
        const metadata = await this.fetcher(url, { signal: abortSignal(signal), redirect: 'error' });
        if (!metadata.ok) throw new Error('registry-metadata-unavailable');
        const text = await boundedBody(metadata, 2 * 1024 * 1024);
        const manifest = JSON.parse(text.toString('utf8'));
        if (manifest.name !== name || manifest.version !== version || !manifest.dsh?.bundle?.patch) throw new Error('unexpected-staged-package');
        const tarball = new URL(manifest.dist?.tarball ?? '');
        // Only same-registry HTTPS resources; do not forward cookies or discover private URLs.
        if (tarball.protocol !== 'https:' || tarball.origin !== url.origin || tarball.username || tarball.password || tarball.search || tarball.hash
            || tarball.pathname!==`/${name}/-/${name.split('/').at(-1)}-${version}.tgz`) throw new Error('untrusted-tarball-origin');
        const fetched = await this.fetcher(tarball, { signal: abortSignal(signal), redirect: 'error' });
        if (!fetched.ok) throw new Error('archive-unavailable');
        const bytes = await boundedBody(fetched, MAX_ARCHIVE);
        verifyIntegrity(bytes, manifest.dist.integrity);
        const originalSha256 = createHash('sha256').update(bytes).digest('hex');
        const generationAllowed = name === 'dsh-plugin-wsl-env';
        let contents;
        if (generationAllowed) {
            const entries=archiveEntries(bytes); const manifestEntry=entries.find(entry=>entry.name==='package/package.json');
            if(!manifestEntry)throw new Error('packed-manifest-missing');
            contents={manifest:JSON.parse(manifestEntry.bytes.toString('utf8')),files:new Map(entries.map(entry=>[entry.name,entry.bytes]))};
        } else contents = readPackedContents(bytes);
        const packed = contents.manifest;
        if (generationAllowed && !isGenerationSupported(packed)) throw new Error('wsl-version-not-yet-verified');
        if (generationAllowed) {
            const knownDigests={'0.28.0':'c137376aba2b3973690ecef93baed9e4de79a22825ab5a50e92ae9ad2881e694','0.24.0':'1d03208d3e58596d155b052c8a0e9eab7a539ac45def89ad53052fa1746104b7','0.26.2':'0761e085453faa1b32ef8b44e8099bc938b62662b11b74e23f7946f4ef75fe98'};
            if(knownDigests[version]!==originalSha256) throw new Error('wsl-archive-requires-new-review');
            this.verifiedWslOriginals.set(originalSha256,Buffer.from(bytes));
        }
        if (this.compatibility(packed)) throw new Error('staged-version-incompatible');
        if (origin === PUBLIC_MIRROR) {
            const mirroredMetadata=await this.fetcher(`${PUBLIC_MIRROR}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,{signal:abortSignal(signal),redirect:'error',credentials:'omit'});
            if(!mirroredMetadata.ok)throw new Error('mirror-version-unavailable');
            const mirrorManifest=JSON.parse((await boundedBody(mirroredMetadata,2*1024*1024)).toString('utf8'));
            if(mirrorManifest.name!==name||mirrorManifest.version!==version)throw new Error('mirror-version-identity-mismatch');
            const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
            for(const key of ['name','version','type','main','exports','imports','dsh','engines','dependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','scripts','overrides','resolutions','pnpm','bundledDependencies','bundleDependencies','bin','gypfile','packageManager','os','cpu','libc'])if(JSON.stringify(canonical(mirrorManifest[key]))!==JSON.stringify(canonical(packed[key])))throw new Error('mirror-runtime-metadata-mismatch');
            const mirrorURL=new URL(mirrorManifest.dist?.tarball??'');
            if(!approvedPublicRegistry(mirrorURL.origin)||mirrorURL.username||mirrorURL.password||mirrorURL.search||mirrorURL.hash||mirrorURL.pathname!==`/${name}/-/${name.split('/').at(-1)}-${version}.tgz`)throw new Error('mirror-tarball-origin-unsupported');
            const mirrorResponse=await this.fetcher(mirrorURL,{signal:abortSignal(signal),redirect:'error',credentials:'omit'});if(!mirrorResponse.ok)throw new Error('mirror-archive-unavailable');
            const mirrorBytes=await boundedBody(mirrorResponse,MAX_ARCHIVE);verifyIntegrity(mirrorBytes,mirrorManifest.dist.integrity);
            if(createHash('sha256').update(mirrorBytes).digest('hex')!==originalSha256)throw new Error('mirror-archive-mismatch');
        }
        if (packed.dsh.bundle.platforms && !packed.dsh.bundle.platforms.includes(process.platform)) throw new Error('staged-platform-unsupported');
        const patches = typeof packed.dsh?.bundle?.patch === 'string' ? [packed.dsh.bundle.patch] : packed.dsh?.bundle?.patch;
        if (!Array.isArray(patches) || !patches.length || patches.length > 8) throw new Error('invalid-bundle-patch-list');
        const patchTexts = patches.map(file => {
            if (typeof file !== 'string' || file.startsWith('/') || file.includes('\\\\') || file.split('/').includes('..')) throw new Error('unsafe-bundle-patch-path');
            const value = contents.files.get('package/' + file.replace(/^\.\//, ''));
            if (!value) throw new Error('bundle-patch-missing');
            return value.toString('utf8');
        });
        const footprint = generationAllowed ? inspectWslPatches(patchTexts,packed) : { rows:inspectPatches(patchTexts,name), overrides:[] };
        const rows = footprint.rows;
        if (packed.name !== name || packed.version !== version || !packed.dsh?.bundle?.patch) throw new Error('archive-manifest-mismatch');
        const dependencyReasons=dependencyPolicyReasons(packed);if(dependencyReasons.length)throw new Error(dependencyReasons[0]);
        const scripts = packed.scripts ?? {};
        if (['preinstall', 'install', 'postinstall', 'prepare'].some(key => typeof scripts[key] === 'string' && scripts[key].trim())) throw new Error('package-install-scripts-require-separate-review');
        const directory = join(this.root, randomUUID()); await mkdir(directory, { recursive: true, mode: 0o700 });
        const sourceArchivePath=join(directory,'source-package.tgz');await writeFile(sourceArchivePath,bytes,{mode:0o600});
        const transformed=generationAllowed ? generationArchive(bytes) : null;
        const installBytes=transformed?.bytes ?? bytes;
        const archivePath = join(directory, 'package.tgz'); await writeFile(archivePath, installBytes, { mode: 0o600 });
        return { name, version, origin: PUBLIC_REGISTRY, queryRegistry:registryOrigin(origin), archivePath, sourceArchivePath, manifest: packed, rows, overrides:footprint.overrides,
            runtimeGeneration: transformed ? { generation:transformed.generation, moduleAliases:transformed.moduleAliases, originalRuntimeBytesPreserved:true } : null,
            originalSha256, sha256: createHash('sha256').update(installBytes).digest('hex'), integrity: manifest.dist.integrity, size: installBytes.length };
    }
    async preserveGenerationPair(next, previous, deployedReference) {
        if(!next.runtimeGeneration || !previous.runtimeGeneration)return;
        const latest=await boundedFile(next.sourceArchivePath,MAX_ARCHIVE),legacy=await boundedFile(previous.sourceArchivePath,MAX_ARCHIVE);
        if(createHash('sha256').update(latest).digest('hex')!==next.originalSha256||createHash('sha256').update(legacy).digest('hex')!==previous.originalSha256)throw new Error('verified-source-archive-changed');
        verifyIntegrity(latest,next.integrity);verifyIntegrity(legacy,previous.integrity);
        const originals=new Map([[next.originalSha256,latest],[previous.originalSha256,legacy]]);
        let rootOriginal=legacy;
        if(deployedReference){
            const deployed=await this.reopen(deployedReference),installed=await boundedFile(deployed.archivePath,MAX_CONTENT);
            const deployedEntries=new Map(archiveEntries(installed).map(entry=>[entry.name,entry.bytes]));
            const reviewed={'0.24.0':'1d03208d3e58596d155b052c8a0e9eab7a539ac45def89ad53052fa1746104b7','0.26.2':'0761e085453faa1b32ef8b44e8099bc938b62662b11b74e23f7946f4ef75fe98','0.28.0':'c137376aba2b3973690ecef93baed9e4de79a22825ab5a50e92ae9ad2881e694'};
            for(const [version,digest]of Object.entries(reviewed))if([...deployedEntries.keys()].some(path=>path.startsWith('package/g/'+digest.slice(0,12)+'/'))||version==='0.24.0'){
                if(!originals.has(digest))originals.set(digest,await this.reviewedWslOriginal(version,digest));
            }
            const deployedManifest=JSON.parse(deployedEntries.get('package/package.json').toString('utf8'));
            const patchPaths=new Set((Array.isArray(deployedManifest.dsh.bundle.patch)?deployedManifest.dsh.bundle.patch:[deployedManifest.dsh.bundle.patch]).map(path=>'package/'+path.replace(/^\.\//,'')));
            const matches=[...originals.values()].filter(bytes=>archiveEntries(bytes).filter(entry=>entry.name!=='package/package.json'&&!patchPaths.has(entry.name)).every(entry=>deployedEntries.get(entry.name)?.equals(entry.bytes)));
            if(!matches.length)throw Error('wsl-root-generation-unverified');rootOriginal=matches[0];
            await this.verifyWslGenerationInventory(deployed.sourceArchivePath,deployedReference,installed);
        }
        for(const [staged,source]of [[next,latest],[previous,legacy]]){
            const transformed=generationArchive(source,{legacyOriginal:rootOriginal,retainedOriginal:[...originals.values()]});
            await writeFile(staged.archivePath,transformed.bytes,{mode:0o600});staged.sha256=createHash('sha256').update(transformed.bytes).digest('hex');
            staged.runtimeGeneration={generation:transformed.generation,moduleAliases:transformed.moduleAliases,originalRuntimeBytesPreserved:true,legacyRootResourcesPreserved:true,
                rootOriginalSha256:createHash('sha256').update(rootOriginal).digest('hex'),retainedOriginalSha256:[...originals.keys()].sort()};
        }
    }
    async reviewedWslOriginal(version,digest) {
        const cached=this.verifiedWslOriginals.get(digest);
        if(cached&&createHash('sha256').update(cached).digest('hex')===digest)return Buffer.from(cached);
        const fetched=await this.stage('dsh-plugin-wsl-env',version),bytes=await boundedFile(fetched.sourceArchivePath,MAX_ARCHIVE);
        if(createHash('sha256').update(bytes).digest('hex')!==digest)throw Error('unverified-retained-wsl-original');return bytes;
    }
    async verifyWslGenerationInventory(sourcePath,reference,installed) {
        const source=await boundedFile(sourcePath,MAX_ARCHIVE),deployed=new Map(archiveEntries(installed).map(entry=>[entry.name,entry.bytes]));
        // Always use the source belonging to this deployed reference, not a newer prepared source.
        if(createHash('sha256').update(source).digest('hex')!==reference.originalSha256)throw Error('verified-source-archive-changed');
        const reviewed={'0.24.0':'1d03208d3e58596d155b052c8a0e9eab7a539ac45def89ad53052fa1746104b7','0.26.2':'0761e085453faa1b32ef8b44e8099bc938b62662b11b74e23f7946f4ef75fe98','0.28.0':'c137376aba2b3973690ecef93baed9e4de79a22825ab5a50e92ae9ad2881e694'};
        const originals=new Map([[createHash('sha256').update(source).digest('hex'),source]]),ids=new Set([...deployed.keys()].filter(path=>path.startsWith('package/g/')).map(path=>path.split('/')[2]));
        for(const id of ids){const pair=Object.entries(reviewed).find(([,digest])=>digest.slice(0,12)===id);if(!pair)throw Error('unverified-retained-wsl-original');if(!originals.has(pair[1]))originals.set(pair[1],await this.reviewedWslOriginal(pair[0],pair[1]));}
        if(!originals.has(reviewed['0.24.0']))originals.set(reviewed['0.24.0'],await this.reviewedWslOriginal('0.24.0',reviewed['0.24.0']));
        const manifest=JSON.parse(deployed.get('package/package.json').toString('utf8')),patchPaths=new Set((Array.isArray(manifest.dsh.bundle.patch)?manifest.dsh.bundle.patch:[manifest.dsh.bundle.patch]).map(path=>'package/'+path.replace(/^\.\//,'')));
        const legacy=[...originals.values()].find(bytes=>archiveEntries(bytes).filter(entry=>entry.name!=='package/package.json'&&!patchPaths.has(entry.name)).every(entry=>deployed.get(entry.name)?.equals(entry.bytes)));
        if(!legacy)throw Error('wsl-root-generation-unverified');
        const retained=[...originals].filter(([digest])=>ids.has(digest.slice(0,12))).map(([,bytes])=>bytes);
        const transformed=generationArchive(source,{legacyOriginal:legacy,retainedOriginal:retained}),expected=new Map(archiveEntries(transformed.bytes).map(entry=>[entry.name,entry.bytes]));
        const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
        const same=(path,left,right)=>path==='package/package.json'?JSON.stringify(canonical(JSON.parse(left.toString('utf8'))))===JSON.stringify(canonical(JSON.parse(right.toString('utf8')))):left.equals(right);
        if(expected.size!==deployed.size||[...expected].some(([path,bytes])=>!deployed.get(path)||!same(path,bytes,deployed.get(path))))throw Error('retained-wsl-inventory-changed');
        const rootSha=createHash('sha256').update(legacy).digest('hex'),retainedSha=retained.map(bytes=>createHash('sha256').update(bytes).digest('hex')).sort();
        if(reference.runtimeGeneration?.rootOriginalSha256&&reference.runtimeGeneration.rootOriginalSha256!==rootSha)throw Error('identity-generation-changed');
        if(reference.runtimeGeneration?.retainedOriginalSha256&&JSON.stringify(reference.runtimeGeneration.retainedOriginalSha256)!==JSON.stringify(retainedSha))throw Error('identity-generation-changed');
        return {rootOriginalSha256:rootSha,retainedOriginalSha256:retainedSha};
    }
    async verifyInstalledArchive(reference,packageDirectory) {
        const staged=await this.reopen(reference),bytes=await boundedFile(staged.archivePath,MAX_CONTENT),entries=archiveEntries(bytes);
        const rootInfo=await lstat(packageDirectory);if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw Error('installed-original-unverified');
        const root=await realpath(packageDirectory);
        for(const entry of entries){let path=root;for(const part of entry.name.slice(8).split('/')){path=join(path,part);const info=await lstat(path);if(info.isSymbolicLink()||!info.isDirectory()&&!info.isFile())throw Error('installed-generation-unverified');}
            if(!(await boundedFile(path,MAX_CONTENT)).equals(entry.bytes))throw Error('installed-generation-unverified');}
        return {verified:true,files:entries.length};
    }
    async verifyInstalledOriginal(staged, packageDirectory) {
        const rootInfo=await lstat(packageDirectory);
        if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw new Error('installed-original-unverified');
        const root = await realpath(packageDirectory);
        const entries = archiveEntries(await boundedFile(staged.sourceArchivePath, MAX_ARCHIVE));
        for (const entry of entries) {
            const parts = entry.name.slice('package/'.length).split('/');
            let path = root;
            for (const part of parts) {
                path = join(path, part); const info = await lstat(path);
                if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory()) throw new Error('installed-original-unverified');
            }
            const bytes = await boundedFile(path, MAX_CONTENT);
            if (!bytes.equals(entry.bytes)) throw new Error('installed-original-unverified');
        }
    }
    async adoptLegacy(name, version, filename, expectedOriginalSha256) {
        const key = archiveKey(this.root, filename);
        if (!key) throw new Error('untrusted-archive-reference');
        const installedPath = archivePath(this.root, key), sourcePath = join(dirname(installedPath), 'source-package.tgz');
        for (const path of [sourcePath, installedPath]) {
            const info = await lstat(path);
            if (!info.isFile() || info.isSymbolicLink() || info.size > (path === sourcePath ? MAX_ARCHIVE : MAX_CONTENT)) throw new Error('staged-package-untrusted');
        }
        const bytes = await boundedFile(sourcePath, MAX_ARCHIVE), installed = await boundedFile(installedPath, MAX_CONTENT);
        const originalSha256 = createHash('sha256').update(bytes).digest('hex');
        if (name === 'dsh-plugin-wsl-env') {
            const known = { '0.28.0':'c137376aba2b3973690ecef93baed9e4de79a22825ab5a50e92ae9ad2881e694', '0.24.0':'1d03208d3e58596d155b052c8a0e9eab7a539ac45def89ad53052fa1746104b7', '0.26.2':'0761e085453faa1b32ef8b44e8099bc938b62662b11b74e23f7946f4ef75fe98' };
            if (known[version] !== originalSha256 || expectedOriginalSha256 !== originalSha256) throw new Error('wsl-archive-requires-new-review');
        } else { if (!bytes.equals(installed)) throw new Error('source-identity-unverified'); readPackedContents(bytes); }
        const entries = archiveEntries(bytes), manifest = JSON.parse(entries.find(entry => entry.name === 'package/package.json').bytes.toString('utf8'));
        if (manifest.name !== name || manifest.version !== version) throw new Error('archive-manifest-mismatch');
        const files = typeof manifest.dsh.bundle.patch === 'string' ? [manifest.dsh.bundle.patch] : manifest.dsh.bundle.patch;
        const texts = files.map(file => entries.find(entry => entry.name === 'package/' + file.replace(/^\.\//, '')).bytes.toString('utf8'));
        const footprint = name === 'dsh-plugin-wsl-env' ? inspectWslPatches(texts, manifest) : { rows: inspectPatches(texts, name), overrides: [] };
        const transform = name === 'dsh-plugin-wsl-env' ? generationArchive(bytes) : null;
        if (transform) {
            const deployed = new Map(archiveEntries(installed).map(entry => [entry.name, entry.bytes]));
            for (const entry of entries) {
                const copied = deployed.get('package/' + transform.generation + '/' + entry.name.slice(8));
                if (!copied?.equals(entry.bytes)) throw new Error('legacy-generation-runtime-changed');
            }
            const deployedManifest = JSON.parse(deployed.get('package/package.json').toString('utf8'));
            for (const [name, value] of Object.entries(transform.manifest.exports)) if (JSON.stringify(deployedManifest.exports?.[name]) !== JSON.stringify(value)) throw new Error('legacy-generation-exports-changed');
            for (const file of transform.changedPatchFiles) if (!deployed.get(file)?.equals(archiveEntries(transform.bytes).find(entry => entry.name === file).bytes)) throw new Error('legacy-generation-patch-changed');
        }
        const staged = { name, version, origin: PUBLIC_REGISTRY, archivePath: installedPath, sourceArchivePath: sourcePath, manifest, ...footprint,
            originalSha256, sha256: createHash('sha256').update(installed).digest('hex'), integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64'),
            runtimeGeneration: transform ? { generation: transform.generation, moduleAliases: transform.moduleAliases, originalRuntimeBytesPreserved: true } : null };
        await this.verify(staged); return this.reference(staged);
    }
    reference(staged) {
        const key = archiveKey(this.root, staged.archivePath);
        if (!key || staged.origin !== PUBLIC_REGISTRY) throw new Error('source-identity-unverified');
        return { name: staged.name, version: staged.version, origin: PUBLIC_REGISTRY, archiveKey: key,
            sha256: staged.sha256, originalSha256: staged.originalSha256, integrity: staged.integrity,
            manifest: staged.manifest, rows: staged.rows, overrides: staged.overrides ?? [], runtimeGeneration: staged.runtimeGeneration ?? null };
    }
    async reopen(reference) {
        if (reference.origin !== PUBLIC_REGISTRY) throw new Error('registry-origin-unsupported');
        const path = archivePath(this.root, reference.archiveKey);
        const staged = { ...reference, archivePath: path, sourceArchivePath: join(dirname(path), 'source-package.tgz') };
        await this.verify(staged);
        const sourceInfo = await lstat(staged.sourceArchivePath);
        if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size > MAX_ARCHIVE) throw new Error('verified-source-archive-untrusted');
        const source = await boundedFile(staged.sourceArchivePath, MAX_ARCHIVE);
        verifyIntegrity(source, reference.integrity);
        if (createHash('sha256').update(source).digest('hex') !== reference.originalSha256) throw new Error('verified-source-archive-changed');
        const entries = archiveEntries(source), metadata = entries.find(entry => entry.name === 'package/package.json');
        if (!metadata) throw new Error('packed-manifest-missing');
        const manifest = JSON.parse(metadata.bytes.toString('utf8'));
        const files = typeof manifest.dsh?.bundle?.patch === 'string' ? [manifest.dsh.bundle.patch] : manifest.dsh?.bundle?.patch;
        if (!Array.isArray(files) || !files.length || files.length > 8) throw new Error('invalid-bundle-patch-list');
        const texts = files.map(file => {
            if (typeof file !== 'string' || file.split('/').includes('..')) throw new Error('unsafe-bundle-patch-path');
            const entry = entries.find(value => value.name === 'package/' + file.replace(/^\.\//, ''));
            if (!entry) throw new Error('bundle-patch-missing'); return entry.bytes.toString('utf8');
        });
        const wsl = manifest.name === 'dsh-plugin-wsl-env';
        if (!wsl) { readPackedContents(source); if (reference.runtimeGeneration != null) throw new Error('identity-generation-changed'); }
        const footprint = wsl ? inspectWslPatches(texts, manifest) : { rows: inspectPatches(texts, manifest.name), overrides: [] };
        if (JSON.stringify(manifest) !== JSON.stringify(reference.manifest) || JSON.stringify(footprint.rows) !== JSON.stringify(reference.rows) || JSON.stringify(footprint.overrides) !== JSON.stringify(reference.overrides)) throw new Error('identity-metadata-changed');
        if (dependencyPolicyReasons(manifest).length) throw new Error('staged-package-policy-changed');
        if (this.compatibility(manifest)) throw new Error('staged-version-incompatible');
        if (manifest.name !== reference.name || manifest.version !== reference.version) throw new Error('archive-manifest-mismatch');
        const install = await boundedFile(staged.archivePath, MAX_CONTENT);
        if (!wsl && !source.equals(install)) throw new Error('source-identity-unverified');
        if (wsl) {
            await this.verifyWslGenerationInventory(staged.sourceArchivePath,reference,install);
            const verified = await this.adoptLegacy(reference.name, reference.version, staged.archivePath, reference.originalSha256);
            if (JSON.stringify(verified.runtimeGeneration?.moduleAliases) !== JSON.stringify(reference.runtimeGeneration?.moduleAliases) || verified.runtimeGeneration?.generation !== reference.runtimeGeneration?.generation) throw new Error('identity-generation-changed');
        }
        return staged;
    }
    async verify(staged) {
        const key = archiveKey(this.root, staged.archivePath);
        if (!key) throw new Error('untrusted-archive-reference');
        const root = resolve(this.root), directory = dirname(resolve(staged.archivePath));
        for (const path of [root, directory, resolve(staged.archivePath)]) {
            const info = await lstat(path);
            if (info.isSymbolicLink() || (path === resolve(staged.archivePath) ? !info.isFile() || info.size > MAX_CONTENT : !info.isDirectory())) throw new Error('staged-package-untrusted');
            if (await realpath(path) !== path) throw new Error('staged-package-untrusted');
        }
        const bytes = await boundedFile(staged.archivePath, MAX_CONTENT);
        if (createHash('sha256').update(bytes).digest('hex') !== staged.sha256) throw new Error('staged-package-changed');
    }
}
async function boundedBody(response, maximum) {
    const parts = []; let length = 0;
    if (!response.body) throw new Error('empty-response');
    const reader = response.body.getReader();
    try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > maximum) throw new Error('download-size-limit'); parts.push(Buffer.from(value)); } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return Buffer.concat(parts);
}
function verifyIntegrity(bytes, integrity) {
    if (typeof integrity !== 'string') throw new Error('integrity-missing');
    const hashes = integrity.split(/\s+/).filter(value => value.startsWith('sha512-'));
    const expected = createHash('sha512').update(bytes).digest('base64');
    if (!hashes.some(value => value.slice(7).split('?')[0] === expected)) throw new Error('integrity-mismatch');
}
export function readPackedManifest(compressed) { return readPackedContents(compressed).manifest; }
export function readPackedContents(compressed) {
    const data = gunzipSync(compressed, { maxOutputLength: MAX_CONTENT });
    let found; let offset = 0; const files = new Map(), paths = new Set();
    while (offset + 512 <= data.length) {
        const header = data.subarray(offset, offset + 512); if (header.every(byte => byte === 0)) break;
        const prefix = header.subarray(345,500).toString('utf8').split('\0')[0];
        if (prefix) throw new Error('prefixed-archive-entry-unsupported');
        const checksumText = header.subarray(148,156).toString('ascii').replace(/\0/g,'').trim();
        const checksum = [...header].reduce((sum,byte,index)=>sum + (index>=148&&index<156 ? 32 : byte),0);
        if (!/^[0-7]+$/.test(checksumText) || parseInt(checksumText,8)!==checksum) throw new Error('invalid-tar-checksum');
        const name = header.subarray(0,100).toString('utf8').split('\0')[0];
        const sizeString = header.subarray(124,136).toString('ascii').replace(/\0/g,'').trim();
        if (!/^[0-7]+$/.test(sizeString)) throw new Error('invalid-tar-size');
        const size = parseInt(sizeString,8); const type = header[156];
        if (size > MAX_CONTENT || offset + 512 + size > data.length) throw new Error('invalid-tar-range');
        if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) throw new Error('unsafe-archive-path');
        if (/(?:\.(?:node|dll|exe|so|dylib)|binding\.gyp)$/i.test(name) || name.split('/').includes('node_modules')) throw new Error('native-or-vendored-archive-unsupported');
        if (type === 49 || type === 50) throw new Error('archive-links-unsupported');
        if (![0,48,53].includes(type)) throw new Error('extended-archive-entry-unsupported');
        if (paths.has(name)) throw new Error('duplicate-archive-path');
        paths.add(name);
        if ([0,48].includes(type) && (name.endsWith('.yml') || name.endsWith('.yaml') || name === 'package/package.json')) {
            if (size > 256_000) throw new Error('archive-config-size-limit');
            files.set(name, data.subarray(offset + 512, offset + 512 + size));
        }
        if (name === 'package/package.json') {
            if (found || size > 256_000 || ![0,48].includes(type)) throw new Error('invalid-packed-manifest');
            found = JSON.parse(data.subarray(offset + 512, offset + 512 + size).toString('utf8'));
        }
        offset += 512 + Math.ceil(size/512)*512;
    }
    if (!found) throw new Error('packed-manifest-missing');
    return { manifest: found, files };
}
