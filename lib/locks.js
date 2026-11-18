import { spawn } from 'node:child_process';
import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELPER_PATH = fileURLToPath(new URL('../native/win-x64/lock-probe.exe', import.meta.url));
const EXTENSIONS = new Set(['.js', '.dll', '.node', '.exe', '.json']);
const EXCLUDED = new Set(['docs', 'screenshots', 'node_modules', '.git']);
const MAX_DIRECTORIES = 256;
const MAX_ENTRIES = 4096;
const MAX_DEPTH = 16;
const MAX_OUTPUT = 256 * 1024;
const LIMITATIONS = [
  'This is a bounded, point-in-time read-only sample, not a recursive lock census.',
  'Restart Manager lists file users, not the process proven to cause a sharing violation.',
  'PID and startTime must be considered together; process names are never grounds to kill a process.',
  'Unlisted processes, permission failures, sharing-mode changes and file replacement remain possible.',
];

const abortError = () => Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' });
const isInside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};
const clampCount = value => Number.isInteger(value) ? Math.max(0, Math.min(64, value)) : 64;
const safeMessage = error => error?.code === 'ABORT_ERR' ? 'The diagnostic was cancelled.'
  : error?.code === 'TIMEOUT' ? 'The diagnostic exceeded its timeout.'
    : 'The read-only diagnostic could not complete; no target process or file was changed.';

/** Validate ancestors before traversal. Symlinks/junctions are never traversed intentionally. */
async function checkedDirectory(directory, { signal } = {}) {
  if (signal?.aborted) throw abortError();
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) {
    throw Object.assign(new Error('Absolute package directory required'), { code: 'INVALID_ROOT' });
  }
  // Device / UNC locations are not local Restart Manager resources for this helper.
  if (process.platform === 'win32' && (!/^[a-z]:\\/i.test(directory) || directory.startsWith('\\\\'))) {
    throw Object.assign(new Error('Local package directory required'), { code: 'INVALID_ROOT' });
  }
  const root = path.resolve(directory);
  let current = path.parse(root).root;
  const parts = root.slice(current.length).split(path.sep).filter(Boolean);
  for (const part of [null, ...parts]) {
    if (part !== null) current = path.join(current, part);
    if (signal?.aborted) throw abortError();
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw Object.assign(new Error('Non-ordinary directory excluded'), { code: 'REPARSE_ROOT' });
    }
  }
  // Do not accept a root that resolves differently after ancestor checks.
  const actual = await realpath(root);
  if (path.relative(root, actual) !== '') {
    throw Object.assign(new Error('Package directory identity changed'), { code: 'REPARSE_ROOT' });
  }
  return root;
}

/** Bounded ordinary-file candidates; exported so traversal policy can be regression tested. */
export async function collectProbeFiles(packageDir, { signal, maxFiles = 64 } = {}) {
  const root = await checkedDirectory(packageDir, { signal });
  const limit = clampCount(maxFiles);
  const files = [];
  const limitations = [];
  const issues = [];
  let directories = 0;
  let entries = 0;
  let truncated = false;
  const stack = [{ directory: root, depth: 0 }];
  const seen = new Set();
  if (limit === 0) return { root, files, limitations: ['File sampling is disabled by a zero limit.'], issues, truncated: true, directories: 0, entries: 0 };
  while (stack.length && !truncated) {
    if (signal?.aborted) throw abortError();
    const { directory, depth } = stack.pop();
    if (++directories > MAX_DIRECTORIES) { truncated = true; break; }
    if (!isInside(root, directory)) throw Object.assign(new Error('Traversal outside package'), { code: 'OUTSIDE_ROOT' });
    await checkedDirectory(directory, { signal });
    let handle;
    try {
      handle = await opendir(directory);
      for await (const entry of handle) {
        if (signal?.aborted) throw abortError();
        if (++entries > MAX_ENTRIES) { truncated = true; break; }
        const absolute = path.join(directory, entry.name);
        if (!isInside(root, absolute)) continue;
        const relative = path.relative(root, absolute);
        let stat;
        try { stat = await lstat(absolute); }
        catch (error) { issues.push({ path: relative, code: error?.code ?? 'UNKNOWN' }); continue; }
        if (stat.isSymbolicLink()) {
          limitations.push('A symbolic link or junction was excluded.');
          continue;
        }
        if (stat.isDirectory()) {
          if (!EXCLUDED.has(entry.name.toLowerCase())) {
            if (depth < MAX_DEPTH) stack.push({ directory: absolute, depth: depth + 1 });
            else limitations.push('A directory exceeded the maximum scan depth and was excluded.');
          }
          continue;
        }
        if (!stat.isFile() || !EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        if (files.length >= limit) { truncated = true; break; }
        // Recheck the path chain and target immediately before admitting it. The native
        // helper repeats checks and pins names, because JS cannot hold relative directory handles.
        await checkedDirectory(path.dirname(absolute), { signal });
        const confirmed = await lstat(absolute);
        if (!confirmed.isFile() || confirmed.isSymbolicLink()) continue;
        if (!seen.has(absolute)) { seen.add(absolute); files.push(absolute); }
      }
    } catch (error) {
      if (error?.code === 'ABORT_ERR' || error?.code === 'REPARSE_ROOT' || error?.code === 'OUTSIDE_ROOT') throw error;
      issues.push({ path: path.relative(root, directory) || '.', code: error?.code ?? 'UNKNOWN' });
    }
  }
  if (truncated) limitations.push(`Only the first ${limit} eligible files within bounded traversal were sampled.`);
  if (issues.length) limitations.push('Some package paths could not be inspected; the sample is incomplete.');
  return { root, files, limitations: [...new Set(limitations)], issues, truncated, directories, entries };
}

/** Execute only the package-owned helper, never a caller-provided command or shell string. */
export function runNativeProbe(input, { signal, timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timeout = Number.isFinite(timeoutMs) ? Math.max(100, Math.min(30000, timeoutMs)) : 10000;
    const child = spawn(HELPER_PATH, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let outputBytes = 0;
    let settled = false;
    let failure;
    let timer;
    const stopOwnedHelper = error => {
      if (settled || failure) return;
      failure = error;
      // Terminate ONLY the helper spawned here; never any PID returned by Restart Manager.
      child.kill();
    };
    const onAbort = () => stopOwnedHelper(abortError());
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT) stopOwnedHelper(Object.assign(new Error('Output limit'), { code: 'OUTPUT_LIMIT' }));
      else stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', chunk => {
      outputBytes += chunk.length;
      // Unknown stderr may contain machine paths; never copy it into returned diagnostics.
      if (outputBytes > MAX_OUTPUT) stopOwnedHelper(Object.assign(new Error('Output limit'), { code: 'OUTPUT_LIMIT' }));
    });
    child.on('error', error => {
      if (settled) return;
      settled = true; cleanup(); reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true; cleanup();
      if (failure) reject(failure);
      else if (code !== 0) reject(Object.assign(new Error('Native helper failed'), { code: 'HELPER_FAILED' }));
      else {
        try { resolve(JSON.parse(stdout.trim())); }
        catch { reject(Object.assign(new Error('Invalid helper output'), { code: 'INVALID_OUTPUT' })); }
      }
    });
    child.stdin.on('error', error => stopOwnedHelper(error));
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => stopOwnedHelper(Object.assign(new Error('Timed out'), { code: 'TIMEOUT' })), timeout);
    if (signal?.aborted) onAbort();
    child.stdin.end(JSON.stringify(input));
  });
}

function normalizeReply(reply, scan) {
  if (!reply || !['checked', 'unsupported', 'failed'].includes(reply.status) || !Array.isArray(reply.files) || !Array.isArray(reply.processes)) {
    throw Object.assign(new Error('Malformed helper output'), { code: 'INVALID_OUTPUT' });
  }
  const allowed = new Set(scan.files);
  const accepted = new Set(['available', 'sharing-violation', 'access-denied', 'missing', 'unknown']);
  const reported = new Set();
  const files = reply.files.map(item => {
    if (!item || !allowed.has(item.path) || !accepted.has(item.probe) || reported.has(item.path)) throw Object.assign(new Error('Unexpected helper path'), { code: 'INVALID_OUTPUT' });
    reported.add(item.path);
    return { path: path.relative(scan.root, item.path), probe: item.probe,
      win32Code: Number.isInteger(item.win32Code) && item.win32Code >= 0 ? item.win32Code : 0 };
  });
  const processes = reply.processes.slice(0, 512).map(item => ({
    pid: Number.isInteger(item?.pid) && item.pid > 0 ? item.pid : null,
    name: typeof item?.name === 'string' ? item.name.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 256) : 'Unknown',
    startTime: typeof item?.startTime === 'string' && Number.isFinite(Date.parse(item.startTime)) ? item.startTime : null,
    applicationType: ['main-window', 'other-window', 'service', 'explorer', 'console', 'critical', 'unknown'].includes(item?.applicationType) ? item.applicationType : 'unknown',
    restartable: item?.restartable === true,
  })).filter(item => item.pid !== null);
  const violations = files.some(item => item.probe === 'sharing-violation');
  const incomplete = scan.truncated || scan.issues.length > 0 || files.length !== scan.files.length || files.some(item => !['available', 'sharing-violation'].includes(item.probe));
  return { status: reply.status, evidence: violations ? 'sharing-violation' : reply.status === 'checked' && !incomplete && files.length ? 'none-observed' : 'unknown',
    files, processes, limitations: [...new Set([...LIMITATIONS, ...scan.limitations,
      ...Array.isArray(reply.limitations) ? reply.limitations.filter(x => typeof x === 'string').map(x => x.slice(0, 1000)) : []])],
    sample: { examined: files.length, truncated: scan.truncated, issues: scan.issues } };
}

/** packageDir must already be located and trusted by the host; no arbitrary process operation exists. */
export async function probeLocks(packageDir, { signal, timeoutMs = 10000, maxFiles = 64, runner = runNativeProbe } = {}) {
  const base = { evidence: 'unknown', files: [], processes: [], limitations: LIMITATIONS };
  if (process.platform !== 'win32' && runner === runNativeProbe) {
    return { ...base, status: 'unsupported', limitations: [...LIMITATIONS, 'Read-only Windows file-use diagnostics are unavailable on this platform.'] };
  }
  try {
    const scan = await collectProbeFiles(packageDir, { signal, maxFiles });
    if (signal?.aborted) throw abortError();
    if (!scan.files.length) return { ...base, status: 'checked', limitations: [...LIMITATIONS, ...scan.limitations, 'No eligible ordinary files were sampled.'], sample: { examined: 0, truncated: scan.truncated, issues: scan.issues } };
    if (runner === runNativeProbe) {
      await checkedDirectory(path.dirname(HELPER_PATH), { signal });
      const helper = await lstat(HELPER_PATH);
      if (!helper.isFile() || helper.isSymbolicLink()) throw Object.assign(new Error('Helper unavailable'), { code: 'ENOENT' });
    }
    const reply = await runner({ files: scan.files }, { signal, timeoutMs });
    return normalizeReply(reply, scan);
  } catch (error) {
    return { ...base, status: error?.code === 'ENOENT' && runner === runNativeProbe ? 'unsupported' : 'failed',
      limitations: [...LIMITATIONS, safeMessage(error)], reason: error?.code === 'ABORT_ERR' ? 'cancelled' : error?.code === 'TIMEOUT' ? 'timeout' : 'unavailable' };
  }
}
