import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectProbeFiles, probeLocks, runNativeProbe } from '../lib/locks.js';

const helper = fileURLToPath(new URL('../native/win-x64/lock-probe.exe', import.meta.url));
const holderSource = fileURLToPath(new URL('../native/tests/HoldFile.cs', import.meta.url));
const compiler = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const owned = async fn => {
  const directory = await mkdtemp(path.join(tmpdir(), 'dsh-lock-probe-test-'));
  try { return await fn(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
};
const availableReply = input => ({ status: 'checked', files: input.files.map(file => ({ path: file, probe: 'available', win32Code: 0 })), processes: [], limitations: [] });

function command(executable, args, { input = '', timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Owned test process timeout')); }, timeout);
    child.stdout.on('data', value => stdout += value.toString('utf8'));
    child.stderr.on('data', value => stderr += value.toString('utf8'));
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}

async function startHolder(executable, file) {
  const child = spawn(executable, [file], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const exited = new Promise(resolve => child.on('close', code => resolve(code)));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Owned holder not ready')), 10000);
    child.stdout.once('data', data => { clearTimeout(timer); assert.match(data.toString(), /ready/); resolve(); });
    child.once('error', reject);
    child.once('close', code => { clearTimeout(timer); if(code!==0) reject(new Error('Holder failed: '+code)); });
  });
  return { child, close: async () => { child.stdin.end('\n'); assert.equal(await exited, 0); } };
}

test('bounded traversal admits eligible files only and excludes docs and dependencies', () => owned(async directory => {
  await mkdir(path.join(directory, 'lib'));
  await mkdir(path.join(directory, 'docs'));
  await mkdir(path.join(directory, 'node_modules'));
  await writeFile(path.join(directory, 'package.json'), '{}');
  await writeFile(path.join(directory, 'lib', 'index.js'), '// test');
  await writeFile(path.join(directory, 'docs', 'secret.json'), '{}');
  await writeFile(path.join(directory, 'node_modules', 'dependency.js'), '// excluded');
  await writeFile(path.join(directory, 'notes.txt'), 'excluded');
  const result = await collectProbeFiles(directory);
  assert.deepEqual(result.files.map(x => path.relative(directory,x)).sort(), ['lib/index.js'.replace('/',path.sep), 'package.json'].sort());
  const reply = await probeLocks(directory, { runner: async input => availableReply(input) });
  assert.equal(reply.status, 'checked');
  assert.equal(reply.evidence, 'none-observed');
  assert.ok(reply.files.every(x=>!path.isAbsolute(x.path)));
}));

test('maxFiles is capped and incompleteness remains unknown', () => owned(async directory => {
  for(let i=0;i<70;i++)await writeFile(path.join(directory, i+'.js'), '//');
  const scan = await collectProbeFiles(directory, {maxFiles:999});
  assert.equal(scan.files.length,64); assert.equal(scan.truncated,true);
  const reply=await probeLocks(directory,{maxFiles:3,runner:async input=>availableReply(input)});
  assert.equal(reply.files.length,3);assert.equal(reply.sample.truncated,true);assert.equal(reply.evidence,'unknown');
}));

test('pre-cancelled scan never calls runner', () => owned(async directory => {
  await writeFile(path.join(directory,'file.js'),'//');
  const abort=new AbortController();abort.abort();let called=false;
  const reply=await probeLocks(directory,{signal:abort.signal,runner:async()=>{called=true;}});
  assert.equal(reply.status,'failed');assert.equal(reply.reason,'cancelled');assert.equal(called,false);
}));

test('timeout and access errors have explicit unknown outcomes', () => owned(async directory => {
  await writeFile(path.join(directory,'file.js'),'//');
  const timed=await probeLocks(directory,{runner:async()=>{throw Object.assign(new Error('no path leak'),{code:'TIMEOUT'});}});
  assert.equal(timed.status,'failed');assert.equal(timed.reason,'timeout');assert.equal(timed.evidence,'unknown');
  const denied=await probeLocks(directory,{runner:async input=>({...availableReply(input),files:input.files.map(file=>({path:file,probe:'access-denied',win32Code:5}))})});
  assert.equal(denied.files[0].probe,'access-denied');assert.equal(denied.evidence,'unknown');
}));

test('reply path boundary and malformed output are rejected', () => owned(async directory => {
  await writeFile(path.join(directory,'file.js'),'//');
  const reply=await probeLocks(directory,{runner:async()=>({status:'checked',files:[{path:path.join(tmpdir(),'outside.js'),probe:'available'}],processes:[]})});
  assert.equal(reply.status,'failed');assert.equal(reply.files.length,0);
  const malformed=await probeLocks(directory,{runner:async()=>({status:'checked'})});
  assert.equal(malformed.status,'failed');
}));

test('missing files, incomplete replies and process metadata never authorize actions', () => owned(async directory => {
  await writeFile(path.join(directory,'file.js'),'//');
  const reply=await probeLocks(directory,{runner:async input=>({status:'checked',files:input.files.map(file=>({path:file,probe:'missing',win32Code:2})),processes:[{pid:42,name:'test\nprocess',startTime:'2026-01-01T00:00:00.000Z',applicationType:'console',restartable:true}],limitations:['RM not proof']})});
  assert.equal(reply.evidence,'unknown');assert.equal(reply.processes[0].name,'testprocess');assert.equal(reply.processes[0].pid,42);
  assert.ok(reply.limitations.some(x=>x.includes('never grounds')));
}));

test('symlink/junction paths never escape package scope', () => owned(async directory => {
  const outside=await mkdtemp(path.join(tmpdir(),'dsh-lock-probe-outside-'));
  try{
    await writeFile(path.join(outside,'outside.js'),'//');
    await symlink(outside,path.join(directory,'link'),process.platform==='win32'?'junction':'dir');
    await writeFile(path.join(directory,'inside.js'),'//');
    const scan=await collectProbeFiles(directory);
    assert.deepEqual(scan.files,[path.join(directory,'inside.js')]);
    const reply=await probeLocks(path.join(directory,'link'),{runner:async input=>availableReply(input)});
    assert.equal(reply.status,'failed');
    await access(path.join(outside,'outside.js'));
  }finally{await rm(outside,{recursive:true,force:true});}
}));

test('helper remains package-relative when working directory changes', {skip:process.platform!=='win32'}, () => owned(async directory => {
  await writeFile(path.join(directory,'file.js'),'//');
  const previous=process.cwd();
  try{process.chdir(tmpdir());const reply=await probeLocks(directory);assert.ok(['checked','failed'].includes(reply.status));assert.notEqual(reply.status,'unsupported');}
  finally{process.chdir(previous);}
}));

test('native ordinary, missing, invalid and non-followed junction inputs are read-only', {skip:process.platform!=='win32'}, () => owned(async directory => {
  const file=path.join(directory,'ordinary.js');await writeFile(file,'// unchanged');
  const ordinary=await runNativeProbe({files:[file]});
  assert.equal(ordinary.files[0].probe,'available');
  const missing=await runNativeProbe({files:[path.join(directory,'missing.js')]});
  assert.equal(missing.files[0].probe,'missing');
  const invalid=await command(helper,[],{input:JSON.stringify({files:['relative.js']})});
  assert.equal(JSON.parse(invalid.stdout).status,'failed');
  const tooMany=await command(helper,[],{input:JSON.stringify({files:Array(65).fill(file)})});
  assert.equal(JSON.parse(tooMany.stdout).status,'failed');
  const linked=path.join(directory,'link');await symlink(directory,linked,'junction');
  const reparse=await runNativeProbe({files:[path.join(linked,'ordinary.js')]});
  assert.equal(reparse.files[0].probe,'unknown');
}));

test('native exclusive sharing evidence and RM PID identity do not stop holder', {skip:process.platform!=='win32'}, () => owned(async directory => {
  const executable=path.join(directory,'hold-file.exe');
  const build=await command(compiler,['/nologo','/target:exe','/platform:x64','/debug-', '/out:'+executable,holderSource]);
  assert.equal(build.code,0,build.stderr);
  const file=path.join(directory,'locked.js');await writeFile(file,'// owned');
  const holder=await startHolder(executable,file);
  try{
    const reply=await runNativeProbe({files:[file]});
    assert.equal(reply.files[0].probe,'sharing-violation');
    assert.equal(reply.files[0].win32Code,32);
    assert.equal(holder.child.exitCode,null);
    assert.equal(reply.status,'checked',JSON.stringify(reply.limitations));
    const process=reply.processes.find(x=>x.pid===holder.child.pid);
    assert.ok(process,'Restart Manager must name test holder PID');assert.ok(Number.isFinite(Date.parse(process.startTime)));
  }finally{await holder.close();}
}));
