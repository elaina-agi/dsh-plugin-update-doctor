import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const section = (start, end) => code.slice(code.indexOf(start), code.indexOf(end, code.indexOf(start)));

test('self-update uses a separate exact-version preparation and does not mix with normal batch targets', () => {
    const prepare = section('      const prepare =', '      const prepareRestore =');
    assert(prepare.includes("item.mode === 'host-self-update'"));
    assert(prepare.includes('selfSelected && selected.length !== 1'));
    assert(prepare.includes("read('prepare-self-update', { version: selfSelected.latestVersion,"));
    assert(prepare.includes("selfSelected.sourceKind === 'git' ? { commit: selfSelected.latestCommit } : {}"));
    assert(!prepare.includes('spec:') && !prepare.includes('archivePath:'));
    assert(code.includes('normalAvailable.slice(0, 20)'));
    assert(code.includes("item.mode === 'host-self-update') { setChecked(new Set([item.name]))"));
});

test('self confirmation explains independent Host execution and release of the old gate, with default wait and separate stop consent', () => {
    const dialog = section('    function ConfirmDialog(', '    class PanelBoundary');
    assert(dialog.includes('selfUpdating = isSelf(plan.operation)'));
    assert(dialog.includes("t('confirmSelfTitle')"));
    assert(dialog.includes("t('confirmSelfImpact')"));
    assert(dialog.includes("t('acknowledgeSelf')"));
    assert(dialog.includes("useState('wait-for-idle')"));
    assert(dialog.includes('cancel.current?.focus()'));
    assert(dialog.includes("taskPolicy === 'cancel-active' && !confirmCancel"));
    assert(dialog.includes("t(selfUpdating ? 'selfGateHelp' : 'waitPolicyHelp')"));
    assert(code.includes('旧更新器卸载时释放门禁'));
});

test('new panel reads self receipts separately and never resends lost updates or automatically polls unknown outcomes', () => {
    const load = section('      const load =', '      useEffect(() => { setPending');
    assert(load.includes("['waiting', 'handed-off'].includes(answer.selfUpdate.phase)"));
    const poll = section('        if (!selfOperationId) return;', '      const refresh =');
    assert(poll.includes("request('self-operation'"));
    assert(poll.includes('15 * 60 * 1000'));
    assert(poll.includes('terminalPhase(answer.phase)'));
    assert(!poll.includes("read('commit'"));
    assert(!poll.includes('updateBundle') && !poll.includes('prepare-self-update'));
    assert(code.includes('const progress = !selfPending && normalBusy || pollNotice'));
    assert(code.includes("selfState?.result?.result?.application"));
    assert(code.includes('selfState.result.restore.application'));
    assert(code.includes("selfState.phase === 'waiting' ? h('button'"));
});
