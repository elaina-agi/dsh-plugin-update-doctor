export async function verifyUnionGeneration(service,item,reference,result,field='verification') {
    const {bundles,rows}=await service.snapshot(),bundle=bundles.find(value=>value.name===item.name);
    const root=service.unionStager?.root,expectedSource=root&&service.archiveRoot(bundle,reference);
    let source=false,bytes=false,runtime=false;
    if(bundle?.installed && bundle.version===reference.version && bundle.enabled===item.enabled && root===expectedSource){
        const {archiveKey}=await import('./source.js');source=archiveKey(root,bundle.source)===reference.archiveKey && bundle.update!=='registry';
    }
    if(source)try{await service.unionStager.verifyInstalledArchive(reference,await service.resolvePackage(item.name));bytes=true;}catch{}
    const host=service.expectedHostState(bundle,rows,reference.rows);
    if(source&&bytes&&host.verified)try{runtime=await service.verifyRunningGeneration(await service.resolvePackage(item.name),reference,{enabled:item.enabled})===true;}catch{}
    item[field]={package:{status:bytes?'verified':'failed',version:bundle?.version??null,expectedVersion:reference.version},
        source:{status:source?'verified':'failed',expectedKind:'derived-local-union-generation',kind:source?'local':bundle?.update??'unknown',officialVersionCheckEligible:false},
        host:{status:host.verified?host.status:'unknown',activeRows:host.activeRows,totalRows:host.totalRows},
        runtime:{status:runtime?(item.enabled?'verified':'disabled'):'unknown',generation:reference.runtimeGeneration.generation,executed:item.enabled===true&&runtime,originalJsUnchanged:true}};
    if(result.application==='applied'&&(!source||!bytes||!host.verified||!runtime))return {...result,observedApplication:'applied',application:'unknown',error:{code:'union-generation-state-unverified',diagnostic:'Derived source, original bytes, expected Host state and exact running generation were not all verified.'}};
    return result;
}
const complete=result=>result&&['applied','failed','cancelled','restart-required','overridden'].includes(result.application);
const unknown=(item,error)=>{item.status='unknown';item.unionOutcomeUnknown=true;return {application:'unknown',error:{code:'union-generation-outcome-unknown',diagnostic:String(error?.message??error??'Missing Host result')}};};

export async function performUnionGeneration(service,job,item,next,previous) {
    if(item.name!=='dsh-union-search'||!service.unionStager||typeof service.verifyRunningGeneration!=='function')throw Error('union-generation-unavailable');
    const current=(await service.snapshot()).bundles.find(value=>value.name===item.name);
    if(!service.unionPair(current,item.to)||service.fingerprint(current)!==item.fingerprint)throw Error('union-generation-state-changed');
    await service.unionStager.verifyBaseline(item.baseline,await service.resolvePackage(item.name),job.controller.signal);
    await service.unionStager.verify(next);await service.unionStager.verify(previous);
    const recovery=service.recoveryFor(item.name);await service.identities.prepare({...recovery,dispatchStarted:true});
    if(service.fingerprint((await service.snapshot()).bundles.find(value=>value.name===item.name))!==item.fingerprint)throw Error('union-generation-state-changed');
    job.activeInstall={name:item.name,requestId:job.id,recovery:false};
    item.unionDispatchStarted=true;let removed;try{removed=await service.manager.removeBundle(item.name);}catch(error){item.result=unknown(item,error);return;}
    if(!complete(removed)){item.result=unknown(item);return;}
    if(removed.application!=='applied'){item.result=await service.completeResult(removed);item.status=removed.application==='restart-required'?'restart-required':'failed';item.unionUntouched=service.fingerprint((await service.snapshot()).bundles.find(value=>value.name===item.name))===item.fingerprint;return;}
    if((await service.snapshot()).bundles.find(value=>value.name===item.name)?.installed){item.result=unknown(item,'External target appeared after removal');return;}
    let installed;try{installed=await service.manager.installBundle(next.archivePath,{registry:item.registry,enabled:item.enabled,saveExact:true,expected:{name:item.name,version:item.to},requestId:job.id});}catch(error){item.result=unknown(item,error);return;}
    if(!complete(installed)){item.result=unknown(item);return;}
    item.origin='derived-local-generation';item.archivePath=next.archivePath;item.originalSha256=next.originalSha256;
    item.result=await service.completeResult(await verifyUnionGeneration(service,item,item.nextReference,installed));
    item.status=item.result.application==='applied'?'updated':item.result.application==='restart-required'?'restart-required':item.result.application==='unknown'?'unknown':'failed';
    if(item.status==='unknown'){item.unionOutcomeUnknown=true;return;}
    if(item.status!=='failed')return;
    const after=(await service.snapshot()).bundles.find(value=>value.name===item.name);
    if(after?.installed){
        if(!await service.ownedTarget(item)){item.unionOutcomeUnknown=true;item.restore={application:'unknown',error:{code:'external-target-not-restored'}};return;}
        try{await service.unionStager.verifyInstalledArchive(item.nextReference,await service.resolvePackage(item.name));}catch{item.unionOutcomeUnknown=true;item.restore={application:'unknown',error:{code:'external-target-not-restored'}};return;}
        let cleanup;try{cleanup=await service.manager.removeBundle(item.name);}catch(error){item.restore=unknown(item,error);return;}
        if(!complete(cleanup)){item.restore=unknown(item);return;}
        if(cleanup.application!=='applied'){item.restore=await service.completeResult(cleanup);return;}
    }
    if((await service.snapshot()).bundles.find(value=>value.name===item.name)?.installed){item.unionOutcomeUnknown=true;item.restore={application:'unknown',error:{code:'external-target-not-restored'}};return;}
    await service.unionStager.verify(previous);job.activeInstall={name:item.name,requestId:job.id+'-restore',recovery:true};
    let restored;try{restored=await service.manager.installBundle(previous.archivePath,{registry:item.registry,enabled:item.enabled,saveExact:true,expected:{name:item.name,version:item.from},requestId:job.activeInstall.requestId});}catch(error){item.restore=unknown(item,error);return;}
    if(!complete(restored)){item.restore=unknown(item);return;}
    item.restore=await service.completeResult(await verifyUnionGeneration(service,item,item.previousReference,restored,'restoreVerification'));
    if(item.restore.application==='unknown')item.unionOutcomeUnknown=true;
}

export async function performUnionRecovery(service,job,item,staged,current,recovery){
    if(item.name!=='dsh-union-search'||recovery.status!=='failed'||recovery.id!==item.recoveryId||service.fingerprint(current)!==item.fingerprint)throw Error('union-generation-recovery-state-changed');
    if(!current?.installed||!item.currentReference)throw Error('union-generation-recovery-unavailable');
    await service.unionStager.verifyInstalledArchive(item.currentReference,await service.resolvePackage(item.name));await service.unionStager.verify(staged);
    await service.identities.prepare({...recovery,status:'prepared',dispatchStarted:true});
    if(service.fingerprint((await service.snapshot()).bundles.find(value=>value.name===item.name))!==item.fingerprint)throw Error('union-generation-recovery-state-changed');
    item.unionDispatchStarted=true;let removed;try{removed=await service.manager.removeBundle(item.name);}catch(error){item.result=unknown(item,error);return;}
    if(!complete(removed)){item.result=unknown(item);return;}if(removed.application!=='applied'){item.result=await service.completeResult(removed);item.status=removed.application==='restart-required'?'restart-required':'failed';item.unionUntouched=service.fingerprint((await service.snapshot()).bundles.find(value=>value.name===item.name))===item.fingerprint;return;}
    if((await service.snapshot()).bundles.find(value=>value.name===item.name)?.installed){item.result=unknown(item,'External target appeared');return;}
    job.activeInstall={name:item.name,requestId:job.id,recovery:true};let result;try{result=await service.manager.installBundle(staged.archivePath,{registry:item.registry,enabled:item.enabled,saveExact:true,expected:{name:item.name,version:item.to},requestId:job.id});}catch(error){item.result=unknown(item,error);return;}
    if(!complete(result)){item.result=unknown(item);return;}item.result=await service.completeResult(await verifyUnionGeneration(service,item,item.nextReference,result));item.status=item.result.application==='applied'?'restored':item.result.application==='restart-required'?'restart-required':item.result.application==='unknown'?'unknown':'failed';if(item.status==='unknown')item.unionOutcomeUnknown=true;
}

export async function persistUnionOutcome(service,job,item,bundle,recovery) {
    const {archiveKey}=await import('./source.js');
    if(item.unionOutcomeUnknown||item.status==='unknown'){await service.identities.settle(item.name,null,{...recovery,status:'unknown',expectedFingerprint:service.fingerprint(bundle)});delete item.recoveryId;delete item.restoreVersion;return;}
    if(['preparing','waiting','skipped'].includes(item.status)||item.unionUntouched){await service.identities.settle(item.name,service.lineageOf(bundle),job.record.operation==='batch-restore'?{...recovery,status:'failed',dispatchStarted:false}:null);delete item.recoveryId;delete item.restoreVersion;return;}
    const reference=[item.nextReference,item.previousReference].find(value=>value?.version===bundle?.version&&archiveKey(service.unionStager.root,bundle.source)===value.archiveKey);
    let installed=null;if(reference)try{await service.unionStager.verifyInstalledArchive(reference,await service.resolvePackage(item.name));installed=reference;}catch{}
    const runtimeVerified=verification=>verification?.runtime.status==='verified'||item.enabled===false&&verification?.runtime.status==='disabled';
    const restored=item.status==='restored'||item.restore?.application==='applied'&&item.restoreVerification?.package.status==='verified'&&runtimeVerified(item.restoreVerification);
    const succeeded=item.status==='updated'&&item.verification?.package.status==='verified'&&runtimeVerified(item.verification)||restored;
    if(succeeded&&installed){await service.identities.settle(item.name,installed,null);delete item.recoveryId;delete item.restoreVersion;return;}
    const ours=!bundle?.installed||installed||service.fingerprint(bundle)===item.fingerprint;
    await service.identities.settle(item.name,installed,ours?{...recovery,status:'failed',expectedFingerprint:service.fingerprint(bundle)}:null);
    if(ours){item.recoveryId=recovery.id;item.restoreVersion=recovery.from;}else{delete item.recoveryId;delete item.restoreVersion;}
}
