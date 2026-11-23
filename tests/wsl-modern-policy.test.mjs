import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { isGenerationSupported, inspectWslPatches } from '../lib/wsl-policy.js';
import { archiveEntries, generationArchive } from '../lib/generation.js';

const rows = [
 ['subprocess-wsl','dsh-plugin-wsl-env/subprocess'],['directory-picker-wsl','dsh-plugin-wsl-env/picker'],
 ['directory-picker-browse-surface','@deepseek-ai/dsh-client-ui-directory-picker-browse'],['wsl-env-client-host','dsh-plugin-wsl-env'],
 ['wsl-status','dsh-plugin-wsl-env/status'],['wsl-plugin-update','dsh-plugin-wsl-env/plugin-update'],
 ['wsl-doctor-command','dsh-plugin-wsl-env/wsl-doctor-command'],['wsl-open-in-app','dsh-plugin-wsl-env/open-in-app'],
 ['fs-routing','dsh-plugin-wsl-env/fs-routing'],['wsl-shell-env','dsh-plugin-wsl-env/shell-env'],['auto-preset','dsh-plugin-wsl-env/auto-preset'],
 ['wsl-preflight','dsh-plugin-wsl-env/preflight'],['wsl-cwd-prompt','dsh-plugin-wsl-env/cwd-prompt'],
 ['wsl-cwd-prompt-tool','dsh-plugin-wsl-env/cwd-prompt-tool'],['wsl-update-check','dsh-plugin-wsl-env/update-check'],['preset-wsl','@deepseek-ai/dsh-agent-preset'],
];
const manifest={name:'dsh-plugin-wsl-env',version:'0.28.0'};
const patch=(selected=rows)=>'- id: subprocess\n  disabled: true\n- id: fs-sandbox\n  disabled: true\n- id: directory-picker\n  disabled: true\n- id: tool-working-directory\n  disabled: true\n- id: terminal-controller\n  name: "@deepseek-ai/dsh-api-terminal-controller"\n  config:\n    shell:\n      path: wsl.exe\n- insert:\n'+selected.map(([id,name])=>`    - id: ${id}\n      name: '${name}'\n`).join('');
function tar(files){const output=[];for(const [name,body]of files){const bytes=Buffer.from(body),header=Buffer.alloc(512);header.write(name,0,100);header.write('0000644\0',100);header.write(bytes.length.toString(8).padStart(11,'0')+'\0',124);header.fill(32,148,156);header[156]=48;header.write('ustar\0',257);header.write([...header].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148);output.push(header,bytes,Buffer.alloc((512-bytes.length%512)%512));}return gzipSync(Buffer.concat([...output,Buffer.alloc(1024)]));}

test('WSL fixed archive policy admits only reviewed stable originals',()=>{
 for(const version of ['0.24.0','0.26.2','0.28.0'])assert.equal(isGenerationSupported({...manifest,version}),true);
 for(const version of ['0.27.0','0.28.1','0.29.0','0.30.0','0.28.0-beta.1','invalid'])assert.equal(isGenerationSupported({...manifest,version}),false);
 assert.equal(isGenerationSupported({name:'other',version:'0.28.0'}),false);
});

test('modern patch requires all sixteen reviewed root rows and unchanged provider suppression',()=>{
 const inspected=inspectWslPatches([patch()],manifest);assert.equal(inspected.rows.length,16);
 assert.equal(inspected.rows.find(row=>row.id==='wsl-plugin-update').name,'dsh-plugin-wsl-env/plugin-update');
 assert.throws(()=>inspectWslPatches([patch(rows.filter(([id])=>id!=='wsl-plugin-update'))],manifest),/incomplete-modern/);
 assert.throws(()=>inspectWslPatches([patch().replace('disabled: true','disabled: false')],manifest),/suppression/);
});

test('modern footprint rejects foreign added own-package row and unexpected module replacement',()=>{
 assert.throws(()=>inspectWslPatches([patch([...rows,['unreviewed','dsh-plugin-wsl-env/unreviewed']])],manifest),/unverified-modern/);
 assert.throws(()=>inspectWslPatches([patch(rows.map(([id,name])=>[id,id==='wsl-plugin-update'?'dsh-plugin-wsl-env/status':name]))],manifest),/unverified-modern/);
 assert.throws(()=>inspectWslPatches([patch().replace('path: wsl.exe','path: unsafe.exe')],manifest),/terminal/);
});

test('generation packaging preserves old root and new native/resource bytes with dynamic modern exports',()=>{
 const packageManifest=version=>({...manifest,version,exports:{'.':'./lib/client-host.js','./plugin-update':'./lib/plugin-update.js','./package.json':'./package.json'},dsh:{bundle:{patch:'cordis.patch.yml'}}});
 const old=tar([['package/package.json',JSON.stringify(packageManifest('0.26.2'))],['package/cordis.patch.yml',patch(rows.filter(([id])=>id!=='wsl-plugin-update'))],['package/lib/client-host.js','export function apply(){}'],['package/lib/plugin-update.js','// retained fixture old'],['package/agent/wsl-agent.sh','old resource'],['package/agent/native/linux-x86_64/dsh-wsl-agent','old inert fixture native']]);
 const next=tar([['package/package.json',JSON.stringify(packageManifest('0.28.0'))],['package/cordis.patch.yml',patch()],['package/lib/client-host.js','export function apply(){}'],['package/lib/plugin-update.js','// modern fixture'],['package/agent/wsl-agent.sh','new resource'],['package/agent/native/linux-x86_64/dsh-wsl-agent','new inert fixture native']]);
 const value=generationArchive(next,{legacyOriginal:old,retainedOriginal:[old]});const deployed=new Map(archiveEntries(value.bytes).map(entry=>[entry.name,entry.bytes]));
 const id=createHash('sha256').update(next).digest('hex').slice(0,12),oldId=createHash('sha256').update(old).digest('hex').slice(0,12);
 assert(deployed.get(`package/g/${id}/agent/wsl-agent.sh`).equals(Buffer.from('new resource')));
 assert(deployed.get('package/agent/wsl-agent.sh').equals(Buffer.from('old resource')));
 assert(deployed.get(`package/g/${id}/agent/native/linux-x86_64/dsh-wsl-agent`).equals(Buffer.from('new inert fixture native')));
 assert(deployed.get(`package/g/${oldId}/agent/native/linux-x86_64/dsh-wsl-agent`).equals(Buffer.from('old inert fixture native')));
 assert(value.moduleAliases.some(([before,after])=>before==='dsh-plugin-wsl-env/plugin-update'&&after===`dsh-plugin-wsl-env/_g/${id}/plugin-update`));
 assert(deployed.get('package/cordis.patch.yml').toString().includes(`dsh-plugin-wsl-env/_g/${id}/plugin-update`));
 assert(deployed.get('package/cordis.patch.yml').toString().includes("name: 'dsh-plugin-wsl-env'"));
});

test('three-generation package keeps earliest root distinct from previous source version',()=>{
 const manifestFor=version=>({...manifest,version,exports:{'.':'./lib/client-host.js','./plugin-update':'./lib/plugin-update.js','./package.json':'./package.json'},dsh:{bundle:{patch:'cordis.patch.yml'}}});
 const archive=(version,text)=>tar([['package/package.json',JSON.stringify(manifestFor(version))],['package/cordis.patch.yml',patch(version==='0.28.0'?rows:rows.filter(([id])=>id!=='wsl-plugin-update'))],['package/lib/client-host.js','export function apply(){}'],['package/lib/plugin-update.js','// '+text],['package/agent/wsl-agent.sh',text],['package/agent/native/linux-x86_64/dsh-wsl-agent','native-'+text]]);
 const v24=archive('0.24.0','oldest-root'),v26=archive('0.26.2','prior-generation'),v28=archive('0.28.0','latest-generation');
 const next=generationArchive(v28,{legacyOriginal:v24,retainedOriginal:[v24,v26]});
 const rollback=generationArchive(v26,{legacyOriginal:v24,retainedOriginal:[v24,v28]});
 for(const deployedPackage of [next,rollback]){
  const deployed=new Map(archiveEntries(deployedPackage.bytes).map(entry=>[entry.name,entry.bytes]));
  assert(deployed.get('package/agent/wsl-agent.sh').equals(Buffer.from('oldest-root')));
  for(const [original,text]of [[v24,'oldest-root'],[v26,'prior-generation'],[v28,'latest-generation']]){
   const id=createHash('sha256').update(original).digest('hex').slice(0,12);
   assert(deployed.get(`package/g/${id}/agent/wsl-agent.sh`).equals(Buffer.from(text)));
  }
 }
});
