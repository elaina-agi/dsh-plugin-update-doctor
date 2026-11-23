import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { boundedFile } from './file-read.js';
import { archiveKey, archivePath, PUBLIC_REGISTRY } from './source.js';
import { inspectPatches } from './patch-safety.js';
import { UNION_LIMITS, UNION_RELEASE_HASHES, canAdmitUnion, canonical, unionDigest, unionHash,
    inspectUnionArchive, unionManifest, unionInventory, unionDeadline, unionPlainDirectory,
    assertUnionDependencyPolicy, unionDependencySnapshot, verifyUnionPublicSnapshot,
    verifyUnionSRI, unionSnapshotEvidence, validateUnionEvidence, unionPortableLayout,
    unionRoutedManifest, buildUnionGeneration, verifyUnionInstalledEntries, unionRangeMatches } from './union-generation.js';

export { UNION_RELEASE_HASHES } from './union-generation.js';
export const canAdmit = canAdmitUnion;
const ORIGIN=PUBLIC_REGISTRY, SOURCE='derived-local-generation-not-npm', MAX_EVIDENCE=12*1024*1024;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/, GENERATION=/^g\/[a-f0-9]{32}$/;
const fail=code=>{throw Object.assign(Error(code),{code});};
const check=(condition,code)=>{if(!condition)fail(code);};
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const boundedRecord=value=>{let text;try{text=JSON.stringify(value);}catch{fail('union-reference-invalid');}
    check(text && Buffer.byteLength(text)<=512*1024,'union-reference-bound');return value;};

/** Pure reference validator for the identity store. Reopening additionally verifies
 * all file-owned evidence/source/archive bytes; this function grants no provenance. */
export function validateUnionReference(reference) {
    boundedRecord(reference);const r=reference?.runtimeGeneration;
    check(reference?.name==='dsh-union-search' && Object.hasOwn(UNION_RELEASE_HASHES,reference.version)
        && reference.origin===ORIGIN && reference.originalRegistry===PUBLIC_REGISTRY
        && reference.installMode==='union-generation' && reference.originalSha256===UNION_RELEASE_HASHES[reference.version]
        && SHA.test(reference.sha256) && /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(reference.integrity??''),'union-reference-identity');
    check(r?.kind==='union-dependency' && r.source===SOURCE && GENERATION.test(r.generation??'')
        && Array.isArray(r.moduleAliases) && r.moduleAliases.length===0 && r.originalRuntimeBytesPreserved===true
        && r.legacyRootResourcesPreserved===true,'union-reference-generation');
    check(UUID.test(r.stageKey??'') && reference.archiveKey===r.stageKey+'/package.tgz'
        && r.evidenceKey===r.stageKey+'/union-evidence.json' && SHA.test(r.evidenceSha256??''),'union-reference-stage-key');
    check(Object.hasOwn(UNION_RELEASE_HASHES,r.rootOriginalVersion) && r.rootOriginalSha256===UNION_RELEASE_HASHES[r.rootOriginalVersion]
        && SHA.test(r.inventoryDigest??'') && SHA.test(r.layoutDigest??''),'union-reference-root');
    const d=r.dependencyEvidence;
    check(d && SHA.test(d.digest??'') && SHA.test(d.publicProofDigest??'') && SHA.test(d.topDigest??'')
        && d.layoutDigest===r.layoutDigest && Number.isSafeInteger(d.packageCount) && d.packageCount>=0 && d.packageCount<=UNION_LIMITS.packages
        && Number.isSafeInteger(d.fileCount) && d.fileCount>=0 && d.fileCount<=UNION_LIMITS.dependencyFiles,'union-reference-dependencies');
    check(Array.isArray(r.retained) && r.retained.length<=UNION_LIMITS.oldGenerations,'union-retention-limit');
    const seen=new Set([r.generation]);
    for(const old of r.retained) {
        check(GENERATION.test(old?.generation??'') && !seen.has(old.generation) && Object.hasOwn(UNION_RELEASE_HASHES,old.version)
            && old.originalSha256===UNION_RELEASE_HASHES[old.version] && SHA.test(old.dependencyDigest??'')
            && SHA.test(old.layoutDigest??'') && SHA.test(old.inventoryDigest??''),'union-reference-retained');seen.add(old.generation);
    }
    check(reference.manifest?.name===reference.name && reference.manifest?.version===reference.version
        && Array.isArray(reference.rows) && reference.rows.length>0 && reference.rows.length<=64
        && Array.isArray(reference.overrides) && reference.overrides.length===0,'union-reference-metadata');
    return reference;
}
function sourceFootprint(bytes,version) {
    check(unionHash(bytes)===UNION_RELEASE_HASHES[version],'union-archive-requires-new-review');
    const entries=inspectUnionArchive(bytes),manifest=unionManifest(entries);
    check(manifest.name==='dsh-union-search'&&manifest.version===version,'union-source-identity');
    assertUnionDependencyPolicy(manifest,{root:true});
    check(!entries.some(e=>e.name.split('/')[1]==='g'||e.name.split('/').includes('node_modules')),'union-source-layout');
    const patches=typeof manifest.dsh?.bundle?.patch==='string'?[manifest.dsh.bundle.patch]:manifest.dsh?.bundle?.patch;
    check(Array.isArray(patches)&&patches.length>0&&patches.length<=8,'union-source-patches');
    const texts=patches.map(file=>{
        check(typeof file==='string' && /^(?:\.\/)?[A-Za-z0-9._/-]+$/.test(file) && !file.replace(/^\.\//,'').split('/').some(part=>!part||part==='.'||part==='..'),'union-source-patches');
        const entry=entries.find(e=>e.name==='package/'+file.replace(/^\.\//,''));check(entry && entry.bytes.length<=256*1024,'union-source-patches');return entry.bytes.toString('utf8');
    });
    return {entries,manifest,rows:inspectPatches(texts,manifest.name),overrides:[]};
}
function retainedRecord(record) {
    return {generation:record.generation,version:record.version,originalSha256:record.originalSha256,
        dependencyDigest:record.dependencies.graphDigest,layoutDigest:record.dependencies.layoutDigest,inventoryDigest:record.inventoryDigest};
}
function runtimeRecord(document,evidenceSha256) {
    const active=document.generations.find(g=>g.generation===document.generation),e=active.dependencies;
    return {kind:'union-dependency',source:SOURCE,generation:document.generation,moduleAliases:[],
        originalRuntimeBytesPreserved:true,legacyRootResourcesPreserved:true,
        stageKey:document.stageKey,evidenceKey:document.stageKey+'/union-evidence.json',evidenceSha256,
        rootOriginalSha256:document.rootOriginalSha256,rootOriginalVersion:document.rootOriginalVersion,
        retained:document.generations.filter(g=>g.generation!==document.generation).map(retainedRecord),
        dependencyEvidence:{digest:e.graphDigest,publicProofDigest:e.proof.digest,topDigest:unionDigest(e.graph.top),
            layoutDigest:e.layoutDigest,packageCount:e.graph.packages.length,fileCount:e.fileCount},
        layoutDigest:e.layoutDigest,inventoryDigest:document.inventoryDigest};
}
/** Independent Union source/generation stager. RegistryStager remains the canonical
 * original-byte fetch/cache authority. This module never writes a Host/profile file. */
export class UnionGenerationStager {
    constructor(root,{registryStager,fetcher=fetch}={}) {
        check(registryStager && typeof registryStager.stage==='function' && typeof registryStager.reference==='function'
            && typeof registryStager.reopen==='function','union-registry-stager-required');
        this.root=resolve(root);this.registryStager=registryStager;this.fetcher=fetcher;
    }
    canAdmit(name,from,to) {return canAdmit(name,from,to);}
    async _canonical(version,signal) {
        check(Object.hasOwn(UNION_RELEASE_HASHES,version),'union-version-not-reviewed');signal.throwIfAborted();
        const original=await this.registryStager.stage('dsh-union-search',version,{signal,origin:PUBLIC_REGISTRY});
        check(original.origin===PUBLIC_REGISTRY && original.version===version && original.name==='dsh-union-search'
            && original.runtimeGeneration==null && original.originalSha256===UNION_RELEASE_HASHES[version]
            && original.sha256===original.originalSha256,'union-canonical-source-required');
        await this.registryStager.verify(original);
        await unionPlainDirectory(dirname(original.sourceArchivePath));
        const bytes=await boundedFile(original.sourceArchivePath,UNION_LIMITS.compressed);verifyUnionSRI(bytes,original.integrity);
        const footprint=sourceFootprint(bytes,version);
        check(same(original.manifest,footprint.manifest)&&same(original.rows,footprint.rows),'union-source-metadata');
        return {original,bytes,...footprint};
    }
    async stagePair({name,from,to,packageDirectory,knownReference,signal}={}) {
        check(canAdmit(name,from,to),'union-version-not-reviewed');signal=unionDeadline(signal,180000);
        // Both canonical originals and the failed-target recovery are prepared BEFORE
        // any caller is permitted to invoke remove/install through the public Host.
        const old=await this._canonical(from,signal),nextSource=await this._canonical(to,signal);
        check(same(old.manifest.dependencies??{},nextSource.manifest.dependencies??{}),'union-declaration-changed');
        let baseline,rootSource=old,retained=[],snapshotDirectory=packageDirectory,known;
        if(knownReference) {
            validateUnionReference(knownReference);check(knownReference.version===from,'union-current-version-mismatch');
            known=await this._read(knownReference,signal);await verifyUnionInstalledEntries(known.entries,packageDirectory,{signal});
            baseline={kind:'union',reference:this.reference(known.staged)};
            rootSource=await this._sourceFromDocument(known,known.document.rootOriginalVersion,signal);
            retained=known.document.generations.map(record=>({record,entries:known.entries.filter(e=>e.name.startsWith('package/'+record.generation+'/'))}));
            snapshotDirectory=join(packageDirectory,knownReference.runtimeGeneration.generation);
        } else {
            await verifyUnionInstalledEntries(old.entries,packageDirectory,{signal});
            baseline={kind:'public',reference:this.registryStager.reference(old.original)};
        }
        // The recovery additionally retains next's resources. Refuse exhaustion now,
        // not after removal; never silently drop an old loaded generation.
        check(retained.length+1<=UNION_LIMITS.oldGenerations,'union-retention-limit');
        const snapshot=await unionDependencySnapshot(snapshotDirectory,old.manifest,{signal});
        const proof=await verifyUnionPublicSnapshot(snapshot,{fetcher:this.fetcher,signal});
        const dependencies=unionSnapshotEvidence(snapshot,proof);
        baseline.dependencyEvidence={digest:dependencies.graphDigest,layoutDigest:dependencies.layoutDigest};
        if(known) {
            const active=known.document.generations.find(g=>g.generation===knownReference.runtimeGeneration.generation);
            check(active.dependencies.graphDigest===dependencies.graphDigest && active.dependencies.layoutDigest===dependencies.layoutDigest,'union-current-dependency-changed');
        }
        const sourceMap=new Map([[from,old],[to,nextSource],[rootSource.manifest.version,rootSource]]);
        const publicArchives=new Map(snapshot.publicArchives??[]);
        if(known) {
            for(const [hash,bytes] of known.publicArchives)publicArchives.set(hash,bytes);
            for(const source of known.document.sources)if(!sourceMap.has(source.version))sourceMap.set(source.version,await this._sourceFromDocument(known,source.version,signal));
        }
        const next=await this._persist(nextSource,snapshot,dependencies,rootSource,retained,sourceMap,signal,publicArchives);
        const nextRead=await this._read(this.reference(next),signal),nextRecord=nextRead.document.generations.find(g=>g.generation===next.runtimeGeneration.generation);
        const previous=await this._persist(old,snapshot,dependencies,rootSource,[...retained,{record:nextRecord,
            entries:nextRead.entries.filter(e=>e.name.startsWith('package/'+nextRecord.generation+'/'))}],sourceMap,signal,publicArchives);
        check(previous.runtimeGeneration.generation!==next.runtimeGeneration.generation
            && (!knownReference || previous.runtimeGeneration.generation!==knownReference.runtimeGeneration.generation),'union-recovery-token-reused');
        return {next,previous,baseline};
    }
    async _sourceFromDocument(read,version,signal) {
        signal.throwIfAborted();const info=read.document.sources.find(s=>s.version===version);check(info,'union-owned-source-missing');
        const bytes=await boundedFile(join(dirname(read.staged.archivePath),'source-'+version+'.tgz'),UNION_LIMITS.compressed);
        verifyUnionSRI(bytes,info.integrity);check(unionHash(bytes)===info.sha256,'union-owned-source-changed');
        return {bytes,integrity:info.integrity,...sourceFootprint(bytes,version)};
    }
    async _persist(source,snapshot,dependencies,rootSource,retained,sourceMap,signal,publicArchives=snapshot.publicArchives) {
        signal.throwIfAborted();check(retained.length<=UNION_LIMITS.oldGenerations,'union-retention-limit');
        await mkdir(this.root,{recursive:true,mode:0o700});await unionPlainDirectory(this.root);
        const stageKey=randomUUID(),directory=join(this.root,stageKey);await mkdir(directory,{mode:0o700});
        const generation='g/'+randomUUID().replaceAll('-','');
        const built=buildUnionGeneration(source.bytes,snapshot,{rootBytes:rootSource.bytes,generation,
            retained:retained.map(old=>({generation:old.record.generation,entries:old.entries}))});
        const activeEntries=inspectUnionArchive(built.bytes).filter(e=>e.name.startsWith('package/'+generation+'/'));
        const active={generation,version:source.manifest.version,originalSha256:unionHash(source.bytes),
            dependencies,inventoryDigest:unionDigest(unionInventory(activeEntries))};
        const sources=[...sourceMap].map(([version,s])=>({version,sha256:unionHash(s.bytes),integrity:s.original?.integrity??s.integrity})).sort((a,b)=>a.version.localeCompare(b.version));
        const document={schemaVersion:1,stageKey,generation,rootOriginalVersion:rootSource.manifest.version,
            rootOriginalSha256:unionHash(rootSource.bytes),inventoryDigest:built.inventoryDigest,
            generations:[active,...retained.map(old=>old.record)],sources};
        const evidenceBytes=Buffer.from(JSON.stringify(document));check(evidenceBytes.length<=MAX_EVIDENCE,'union-evidence-bound');
        const archive=join(directory,'package.tgz'),sourcePath=join(directory,'source-package.tgz');
        const neededProofs=new Map(document.generations.flatMap(g=>g.dependencies.proof.packages).map(p=>[p.sha256,p]));
        check(neededProofs.size<=UNION_LIMITS.packages*2,'union-public-source-bound');let publicBytes=0;
        for(const [hash,proof] of neededProofs) {
            const bytes=publicArchives?.get(hash);check(bytes&&unionHash(bytes)===hash,'union-public-source-missing');
            verifyUnionSRI(bytes,proof.integrity);publicBytes+=bytes.length;check(publicBytes<=UNION_LIMITS.archive,'union-public-source-bound');
            await writeFile(join(directory,'dependency-'+hash+'.tgz'),bytes,{mode:0o600,flag:'wx'});
        }
        for(const [version,s] of sourceMap)await writeFile(join(directory,'source-'+version+'.tgz'),s.bytes,{mode:0o600,flag:'wx'});
        await writeFile(sourcePath,source.bytes,{mode:0o600,flag:'wx'});
        await writeFile(join(directory,'union-evidence.json'),evidenceBytes,{mode:0o600,flag:'wx'});
        await writeFile(archive,built.bytes,{mode:0o600,flag:'wx'});signal.throwIfAborted();
        const staged={name:source.manifest.name,version:source.manifest.version,origin:ORIGIN,originalRegistry:PUBLIC_REGISTRY,
            installMode:'union-generation',archivePath:archive,sourceArchivePath:sourcePath,manifest:source.manifest,rows:source.rows,overrides:[],
            originalSha256:unionHash(source.bytes),sha256:built.sha256,integrity:source.original?.integrity??source.integrity,
            size:built.bytes.length,runtimeGeneration:runtimeRecord(document,unionHash(evidenceBytes))};
        await this.verify(staged,signal);return staged;
    }
    reference(staged) {
        const key=archiveKey(this.root,staged.archivePath);check(key,'union-untrusted-archive-reference');
        return validateUnionReference({name:staged.name,version:staged.version,origin:ORIGIN,originalRegistry:staged.originalRegistry,
            installMode:'union-generation',archiveKey:key,sha256:staged.sha256,originalSha256:staged.originalSha256,
            integrity:staged.integrity,manifest:staged.manifest,rows:staged.rows,overrides:staged.overrides??[],runtimeGeneration:staged.runtimeGeneration});
    }
    async _read(reference,signal) {
        validateUnionReference(reference);signal=unionDeadline(signal);signal.throwIfAborted();
        const path=archivePath(this.root,reference.archiveKey),directory=dirname(path);
        await unionPlainDirectory(this.root);await unionPlainDirectory(directory);
        check(basename(directory)===reference.runtimeGeneration.stageKey,'union-stage-key');
        const bytes=await boundedFile(path,UNION_LIMITS.compressed);check(unionHash(bytes)===reference.sha256,'union-staged-package-changed');
        const entries=inspectUnionArchive(bytes),evidenceBytes=await boundedFile(join(directory,'union-evidence.json'),MAX_EVIDENCE);
        check(unionHash(evidenceBytes)===reference.runtimeGeneration.evidenceSha256,'union-evidence-changed');
        let document;try{document=JSON.parse(evidenceBytes.toString('utf8'));}catch{fail('union-evidence-invalid');}
        check(document?.schemaVersion===1 && document.stageKey===reference.runtimeGeneration.stageKey && document.generation===reference.runtimeGeneration.generation
            && Array.isArray(document.generations) && document.generations.length>=1 && document.generations.length<=UNION_LIMITS.oldGenerations+1
            && Array.isArray(document.sources) && document.sources.length>=1 && document.sources.length<=2,'union-evidence-document');
        check(same(runtimeRecord(document,unionHash(evidenceBytes)),reference.runtimeGeneration),'union-generation-evidence-changed');
        const originals=new Map();
        for(const source of document.sources) {
            signal.throwIfAborted();check(Object.hasOwn(UNION_RELEASE_HASHES,source.version)&&source.sha256===UNION_RELEASE_HASHES[source.version]
                && !originals.has(source.version),'union-owned-source-identity');
            const sourceBytes=await boundedFile(join(directory,'source-'+source.version+'.tgz'),UNION_LIMITS.compressed);
            verifyUnionSRI(sourceBytes,source.integrity);const footprint=sourceFootprint(sourceBytes,source.version);originals.set(source.version,{...footprint,bytes:sourceBytes});
        }
        const source=originals.get(reference.version),root=originals.get(document.rootOriginalVersion);
        check(source && root && unionHash(root.bytes)===document.rootOriginalSha256,'union-root-source-changed');
        const ownSource=await boundedFile(join(directory,'source-package.tgz'),UNION_LIMITS.compressed);
        verifyUnionSRI(ownSource,reference.integrity);check(ownSource.equals(source.bytes),'union-source-package-changed');
        check(same(source.manifest,reference.manifest)&&same(source.rows,reference.rows)&&same(source.overrides,reference.overrides),'union-identity-metadata-changed');
        const expected=[...root.entries.map(e=>e.name==='package/package.json'?{...e,bytes:Buffer.from(JSON.stringify(unionRoutedManifest(source.manifest,document.generation),null,2))}:e)];
        const tokens=new Set(),publicArchives=new Map(),publicInventory=new Map();let publicSourceBytes=0;
        for(const record of document.generations) {
            signal.throwIfAborted();check(GENERATION.test(record.generation??'')&&!tokens.has(record.generation),'union-retained-token');tokens.add(record.generation);
            const original=originals.get(record.version);check(original && record.originalSha256===UNION_RELEASE_HASHES[record.version],'union-retained-original');
            validateUnionEvidence(record.dependencies);
            for(const proof of record.dependencies.proof.packages) {
                let archive=publicArchives.get(proof.sha256);
                if(!archive) {
                    check(publicArchives.size<UNION_LIMITS.packages*2,'union-public-source-bound');
                    archive=await boundedFile(join(directory,'dependency-'+proof.sha256+'.tgz'),16*1024*1024);
                    publicSourceBytes+=archive.length;check(publicSourceBytes<=UNION_LIMITS.archive,'union-public-source-bound');
                    check(unionHash(archive)===proof.sha256,'union-public-source-changed');
                    const publicEntries=inspectUnionArchive(archive),publicManifest=unionManifest(publicEntries);
                    assertUnionDependencyPolicy(publicManifest);
                    check(publicManifest.name===proof.name&&publicManifest.version===proof.version
                        && !publicEntries.some(e=>e.name.split('/').includes('node_modules')),'union-public-source-identity');
                    publicInventory.set(proof.sha256,unionInventory(publicEntries.map(e=>({...e,name:e.name.slice(8)}))));
                    publicArchives.set(proof.sha256,archive);
                }
                verifyUnionSRI(archive,proof.integrity);
                const inventory=publicInventory.get(proof.sha256);
                check(proof.files===inventory.length&&proof.inventoryDigest===unionDigest(inventory),'union-public-source-inventory');
            }
            check(same(original.manifest.dependencies??{},record.dependencies.graph.declaration),'union-root-top-proof-binding');
            const prefix='package/'+record.generation+'/',generationEntries=entries.filter(e=>e.name.startsWith(prefix));
            check(unionDigest(unionInventory(generationEntries))===record.inventoryDigest,'union-generation-inventory-changed');
            const files=new Map(generationEntries.map(e=>[e.name.slice(prefix.length),e.bytes]));
            const packages=record.dependencies.graph.packages.map(pkg=>{
                const location=record.dependencies.graph.layout.find(row=>row.key===pkg.name+'@'+pkg.version);check(location,'union-layout-package');
                const pkgFiles=pkg.files.map(([name,hash,size])=>{
                    const bytes=files.get(location.path+'/'+name);check(bytes&&bytes.length===size&&unionHash(bytes)===hash,'union-dependency-inventory-changed');return {name,bytes};
                });
                const manifest=unionManifest(pkgFiles.map(f=>({...f,name:'package/'+f.name})));assertUnionDependencyPolicy(manifest);
                check(manifest.name===pkg.name&&manifest.version===pkg.version,'union-dependency-identity');
                check(same(Object.keys(manifest.dependencies??{}).sort(),pkg.edges.map(e=>e.name).sort()),'union-dependency-edges-changed');
                for(const edge of pkg.edges) {
                    check(manifest.dependencies[edge.name]===edge.range,'union-dependency-range');
                    if(edge.external)check(edge.name==='@deepseek-ai/schemastery','union-external-runtime');
                    else {const target=record.dependencies.graph.packages.find(p=>p.name+'@'+p.version===edge.target);
                        check(target&&target.name===edge.name&&unionRangeMatches(target.version,edge.range),'union-dependency-range');}
                }
                return {...pkg,key:pkg.name+'@'+pkg.version,files:pkgFiles,manifest};
            });
            const top=record.dependencies.graph.top;
            check(same(Object.keys(original.manifest.dependencies??{}).sort(),top.map(e=>e.name).sort()),'union-root-top-proof-binding');
            for(const edge of top) {
                check(original.manifest.dependencies[edge.name]===edge.range,'union-root-top-proof-binding');
                if(edge.external)check(edge.name==='@deepseek-ai/schemastery','union-external-runtime');
                else {const target=packages.find(p=>p.key===edge.target);check(target&&target.name===edge.name&&unionRangeMatches(target.version,edge.range),'union-root-top-proof-binding');}
            }
            const reconstructed=unionPortableLayout({packages,top});
            check(same(reconstructed.layout,record.dependencies.graph.layout)&&reconstructed.layoutDigest===record.dependencies.layoutDigest
                && same(unionInventory(reconstructed.portableFiles),record.dependencies.portableInventory),'union-layout-changed');
            expected.push(...original.entries.map(e=>({...e,name:prefix+e.name.slice(8)})),
                ...reconstructed.portableFiles.map(e=>({...e,name:prefix+e.name})));
        }
        check(tokens.has(document.generation) && expected.length===entries.length
            && same(unionInventory(expected),unionInventory(entries)) && document.inventoryDigest===unionDigest(unionInventory(entries)),'union-full-inventory-changed');
        const staged={...reference,archivePath:path,sourceArchivePath:join(directory,'source-package.tgz'),size:bytes.length};
        return {staged,entries,document,publicArchives};
    }
    async reopen(reference,signal) {return (await this._read(reference,signal)).staged;}
    async verify(staged,signal) {await this._read(this.reference(staged),signal);return {verified:true,sha256:staged.sha256};}
    async verifyInstalledArchive(reference,packageDirectory,{signal}={}) {
        const read=await this._read(reference,signal);return verifyUnionInstalledEntries(read.entries,packageDirectory,{signal});
    }
    async verifyBaseline(baseline,packageDirectory,signal) {
        signal=unionDeadline(signal,60000);check(baseline?.kind==='public'||baseline?.kind==='union','union-baseline-invalid');
        check(SHA.test(baseline.dependencyEvidence?.digest??'')&&SHA.test(baseline.dependencyEvidence?.layoutDigest??''),'union-baseline-dependencies');
        if(baseline.kind==='union') {
            const verified=await this.verifyInstalledArchive(baseline.reference,packageDirectory,{signal});
            const snapshot=await unionDependencySnapshot(join(packageDirectory,baseline.reference.runtimeGeneration.generation),baseline.reference.manifest,{signal});
            check(snapshot.digest===baseline.dependencyEvidence.digest&&snapshot.layoutDigest===baseline.dependencyEvidence.layoutDigest,'union-baseline-dependency-changed');
            return verified;
        }
        const ref=baseline.reference;check(ref?.name==='dsh-union-search'&&Object.hasOwn(UNION_RELEASE_HASHES,ref.version)
            && ref.origin===PUBLIC_REGISTRY&&ref.runtimeGeneration==null&&ref.originalSha256===UNION_RELEASE_HASHES[ref.version]
            && ref.sha256===ref.originalSha256,'union-baseline-source');
        const staged=await this.registryStager.reopen(ref);signal.throwIfAborted();await unionPlainDirectory(dirname(staged.sourceArchivePath));
        const bytes=await boundedFile(staged.sourceArchivePath,UNION_LIMITS.compressed);verifyUnionSRI(bytes,ref.integrity);
        const source=sourceFootprint(bytes,ref.version);
        const verified=await verifyUnionInstalledEntries(source.entries,packageDirectory,{signal});
        const snapshot=await unionDependencySnapshot(packageDirectory,source.manifest,{signal});
        check(snapshot.digest===baseline.dependencyEvidence.digest&&snapshot.layoutDigest===baseline.dependencyEvidence.layoutDigest,'union-baseline-dependency-changed');
        return verified;
    }
    /** Manual recovery must supply a positively verified currently installed union
     * reference. Unknown or partially installed failures cannot be guessed safe. */
    async prepareRecovery(reference,{knownCurrentReference,packageDirectory,signal}={}) {
        validateUnionReference(reference);check(knownCurrentReference&&packageDirectory,'union-recovery-current-reference-required');
        validateUnionReference(knownCurrentReference);signal=unionDeadline(signal,180000);
        const current=await this._read(knownCurrentReference,signal);
        await verifyUnionInstalledEntries(current.entries,packageDirectory,{signal});
        const target=await this._canonical(reference.version,signal),root=await this._sourceFromDocument(current,current.document.rootOriginalVersion,signal);
        check(same(target.manifest.dependencies??{},unionManifest(current.entries.filter(e=>e.name.startsWith('package/'+knownCurrentReference.runtimeGeneration.generation+'/'))
            .map(e=>({...e,name:'package/'+e.name.slice(('package/'+knownCurrentReference.runtimeGeneration.generation+'/').length)}))).dependencies??{}),'union-declaration-changed');
        const snapshot=await unionDependencySnapshot(join(packageDirectory,knownCurrentReference.runtimeGeneration.generation),target.manifest,{signal});
        const proof=await verifyUnionPublicSnapshot(snapshot,{fetcher:this.fetcher,signal}),dependencies=unionSnapshotEvidence(snapshot,proof);
        check(current.document.generations.length<=UNION_LIMITS.oldGenerations,'union-retention-limit');
        const sources=new Map([[target.manifest.version,target],[root.manifest.version,root]]);
        for(const source of current.document.sources)if(!sources.has(source.version))sources.set(source.version,await this._sourceFromDocument(current,source.version,signal));
        const publicArchives=new Map([...current.publicArchives,...(snapshot.publicArchives??[])]);
        return this._persist(target,snapshot,dependencies,root,current.document.generations.map(record=>({record,
            entries:current.entries.filter(e=>e.name.startsWith('package/'+record.generation+'/'))})),sources,signal,publicArchives);
    }
}
