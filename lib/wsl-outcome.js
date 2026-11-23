import {archiveKey} from './source.js';
export const completeWslReply=value=>value&&['applied','failed','cancelled','restart-required','overridden'].includes(value.application);
export function unknownWsl(item,error){item.status='unknown';item.wslOutcomeUnknown=true;return {application:'unknown',error:{code:'wsl-generation-outcome-unknown',diagnostic:String(error?.message??error??'Incomplete Host reply')}};}
export async function persistWslOutcome(service,job,item,bundle,recovery){
    const unknown=async()=>{await service.identities.settle(item.name,null,{...recovery,status:'unknown',expectedFingerprint:service.fingerprint(bundle)});delete item.recoveryId;delete item.restoreVersion;};
    if(item.wslOutcomeUnknown||item.status==='unknown'){await unknown();return;}
    if(['preparing','waiting','skipped'].includes(item.status)&&!item.wslDispatchStarted){await service.identities.settle(item.name,service.lineageOf(bundle),job.record.operation==='batch-restore'?{...recovery,status:'failed',dispatchStarted:false}:null);delete item.recoveryId;delete item.restoreVersion;return;}
    const key=archiveKey(service.stager.root,bundle?.source),reference=[item.nextReference,item.previousReference].find(value=>value?.version===bundle?.version&&value.archiveKey===key);
    let verified=null;if(reference)try{await service.stager.verifyInstalledArchive(reference,await service.resolvePackage(item.name));verified=reference;}catch{}
    const success=['updated','restored'].includes(item.status)||item.restore?.application==='applied'&&item.restoreVerification?.package.status==='verified';
    if(success){if(!verified){item.result={...item.result,observedApplication:item.result?.application,application:'unknown'};unknownWsl(item,'Installed WSL identity changed after outcome verification');await unknown();return;}await service.identities.settle(item.name,verified,null);delete item.recoveryId;delete item.restoreVersion;return;}
    const ours=!bundle?.installed||verified||service.fingerprint(bundle)===item.fingerprint;
    await service.identities.settle(item.name,verified,ours?{...recovery,status:'failed',expectedFingerprint:service.fingerprint(bundle)}:null);
    if(ours){item.recoveryId=recovery.id;item.restoreVersion=recovery.from;}else{delete item.recoveryId;delete item.restoreVersion;}
}
