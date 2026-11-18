const LOCK = /sharing violation|being used by another process|EBUSY|ERROR_SHARING_VIOLATION|共享冲突|另一个进程.*使用/i;
const PERMISSION = /EACCES|EPERM|access.*denied|permission.*denied|拒绝访问/i;

export function classify({ bundle, result, record, locks } = {}) {
    const latest = result ?? record?.result ?? record?.event;
    if (locks?.status === 'checked' && locks.files?.some(file => file.probe === 'sharing-violation'))
        return finding('file-sharing-conflict', 'File sharing conflict observed', 'An exclusive metadata probe was refused. Listed processes use related files, but that does not establish which process caused the conflict.', ['Review the listed processes; close them manually if appropriate.', 'Do not force-close handles or kill DSH during active tasks.']);
    if (latest?.application === 'restart-required') return finding('restart-required', 'Restart required', latest.restartReason ?? 'The Host requested a restart.', ['Finish active work, then restart DSH.', 'Recheck disk version and runtime state after restarting.']);
    const error = latest?.error;
    const output = [error?.diagnostic, latest?.packageResult?.output].filter(Boolean).join('\n');
    if (error?.code === 'incompatible-version') return finding('incompatible-version', 'Version incompatible', 'The plugin declares unsupported DSH requirements.', ['Choose a supported version. No version exemptions are granted by this plugin.']);
    if (latest?.stage === 'enable' && latest.application === 'failed') return finding('activation-failed', 'Installed, but Host activation failed', output || 'Only an error code was retained; the exact exception is unavailable.', ['Package download success is not activation success.', 'Review the complete captured diagnostic and current runtime state.', 'If a restart fixes it, investigate module replacement/lifecycle rather than assuming file locking.']);
    if (LOCK.test(output)) return finding('possible-file-conflict', 'Possible file sharing conflict', output, ['Run the read-only file-use check for evidence.']);
    if (PERMISSION.test(output)) return finding('permission-failed', 'Filesystem permission or file-use failure', output, ['Permission errors alone do not prove a lock.', 'Run the file-use check; do not change ACLs automatically.']);
    if (latest?.application === 'failed') return finding('operation-failed', 'Plugin management operation failed', output || error?.code || 'No detailed exception was retained.', ['Review stage and diagnostics before retrying.']);
    if (bundle?.state === 'active') return finding('active', 'Host entries are active', 'All enabled declared Host rows are active. This does not verify the plugin’s functional behavior or browser synchronization.', ['Use the plugin itself to verify its functionality.']);
    if (bundle?.state === 'missing') return finding('package-missing', 'Package unavailable', 'The manager cannot locate the package or bundle metadata.', ['Use the official plugin installer or a recorded recovery target.']);
    if (bundle?.state === 'inactive' || bundle?.state === 'partial') return finding('runtime-inactive', 'Some Host entries are inactive', 'Saved enabled state and runtime active state differ.', ['Review disabled rows and Host diagnostics.', 'A restart may be necessary, but is not proof of a file lock.']);
    return finding('unknown', 'Insufficient evidence', 'No complete operation result or runtime evidence establishes the cause.', ['Use this panel’s update entry to capture complete returned diagnostics.', 'Existing official-button events contain only whitelisted error codes.']);
}
function finding(code, title, detail, nextSteps) { return { code, title, detail, nextSteps }; }

export function bundleState(bundle, rows = []) {
    const declared = bundle.rows ?? [];
    const byId = new Map(rows.map(row => [row.entryId, row]));
    const observations = declared.map(row => {
        const live = row.entryId ? byId.get(row.entryId) : undefined;
        return { id: row.rowId, entryId: row.entryId, enabled: live?.enabled ?? null, phase: live?.fiberPhase ?? null };
    });
    const enabled = observations.filter(row => row.enabled === true);
    const activeRows = enabled.filter(row => row.phase === 'active').length;
    const missing = bundle.availability === 'missing' || !!bundle.error;
    const state = missing ? 'missing' : !bundle.enabled ? 'inactive' : enabled.length === 0 ? 'unknown'
        : activeRows === enabled.length ? 'active' : activeRows > 0 ? 'partial' : 'inactive';
    return { state, activeRows, totalRows: enabled.length, rows: observations };
}
