import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Static Client source and pure predicate checks only. These do not emulate
// React/DOM or assert live browser rendering or Host mutation outcomes.
const code = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const section = (start, end) => code.slice(code.indexOf(start), code.indexOf(end, code.indexOf(start)));

test('recovery readiness requires Host eligibility, recorded version and recovery identity', () => {
    const source = section('    const recoveryEligible =', '    const request =');
    const { recoveryEligible, isRestore, boundedLogs } = vm.runInNewContext(`const string=value=>typeof value==='string'?value:''; const array=value=>Array.isArray(value)?value:[]; ${source} ({recoveryEligible,isRestore,boundedLogs});`);
    const ready = { canRestore: true, restoreVersion: '1.0.0', recoveryId: 'recorded-recovery' };
    assert.equal(recoveryEligible(ready), true);
    for (const invalid of [null, {}, { ...ready, canRestore: false }, { ...ready, restoreVersion: null }, { ...ready, recoveryId: null }]) assert.equal(recoveryEligible(invalid), false);
    assert.equal(isRestore('batch-restore'), true);
    assert.equal(isRestore('batch-update'), false);
    const chunks = boundedLogs(Array.from({ length: 100 }, (_, i) => ({ name: `plugin-${i}`, stream: 'stdout', text: 'x'.repeat(4000) })));
    assert.equal(chunks.length, 60);
    assert.equal(chunks[0].name, 'plugin-40');
    assert(chunks.every(chunk => chunk.text.length === 1000));
});

test('manual restore prepares by name only and never supplies an arbitrary version or archive', () => {
    const restore = section('      const prepareRestore =', '      const prepareMigration =');
    assert(restore.includes("read('prepare-restore', { name }, 'POST'"));
    assert(restore.includes('isRestore(answer.operation)'));
    assert(restore.includes('answer.items[0].name === name'));
    assert(restore.includes('string(answer.items[0].recoveryId)'));
    assert(!/\b(?:version|path|spec|archivePath)\s*:/.test(restore));
    assert(code.includes("'data-testid': 'pud-restore'"));
    assert(code.includes("'data-testid': 'pud-detail-restore'"));
    assert(code.includes('item.recoveryId === recovery.recoveryId'));
    assert(code.includes('Object.hasOwn(item, key) ? item[key] : current[key]'));
    assert(code.includes('recoveryEligible(item) && !scannedItems.some('));
});

test('restore confirmation has distinct semantics while retaining expiry, cancel focus and stop consent', () => {
    const dialog = section('    function ConfirmDialog(', '    class PanelBoundary');
    assert(dialog.includes("t(restoring ? 'confirmRestoreTitle' : 'confirmTitle')"));
    assert(dialog.includes("t(restoring ? 'confirmRestoreImpact' : 'confirmImpact')"));
    assert(dialog.includes("t(restoring ? 'acknowledgeRestore' : 'acknowledge')"));
    assert(dialog.includes("'confirmRestoreStop' : 'confirmRestoreWait'"));
    assert(dialog.includes("useState('wait-for-idle')"));
    assert(dialog.includes('cancel.current?.focus()'));
    assert(dialog.includes('now >= Date.parse(plan.expiresAt)'));
    assert(dialog.includes("taskPolicy === 'cancel-active' && !confirmCancel"));
    assert(dialog.includes("t('stopConsent')"));
    assert(dialog.includes('valueOf(item.from,') && !dialog.includes('item.from ?? item.version'));
});

test('package, Host and current page state stay separate and missing verification remains unknown', () => {
    const verification = section('    function Verification(', '    function ClientSync(');
    assert(verification.includes("string(pack?.status) || 'unknown'"));
    assert(verification.includes("string(host?.status) || 'unknown'"));
    assert(verification.includes("prefix: 'package'"));
    assert(verification.includes("prefix: 'host'"));
    const sync = section('    function ClientSync(', '    function BatchTable(');
    assert(sync.includes("'clientSyncUnknown'"));
    assert(sync.includes("'clientSyncFailed'"));
    assert(sync.includes("'clientSyncIdle'"));
    assert(sync.includes('await retryClient()'));
    assert(sync.includes('failures.slice(0, 20)'));
    assert(!sync.includes('prepare-restore') && !sync.includes("read('commit'"));
    assert(code.includes('hooks: { locale: scope.locale, clientSync: scope.modules.entries.state }'));
    assert(code.includes('retryClient: () => scope.modules.entries.retry()'));
    assert(code.includes("inject: ['slots', 'modules']"));
    assert(!code.includes('useSyncExternalStore'));
    assert(!code.includes('DoctorPanel({ ctx })'));
    assert(!code.includes("require('@deepseek-ai/dsh-client-ui-primitives')"));
});

test('GitHub self confirmation shows complete pins, sends offered commit only and keeps verification separate', () => {
    const prepare = section('      const prepare =', '      const prepareRestore =');
    assert(prepare.includes('commit: selfSelected.latestCommit')); assert(!/\b(?:spec|url|repository)\s*:/.test(prepare));
    const commitDetails = section('    function CommitDetails(', '    function Verification(');
    assert(commitDetails.includes("'pud-github-commits'")); assert(commitDetails.includes('value.fromCommit ?? value.currentCommit')); assert(commitDetails.includes('value.toCommit ?? value.latestCommit')); assert(!commitDetails.includes('slice('));
    const dialog = section('    function ConfirmDialog(', '    class PanelBoundary');
    assert(dialog.includes('h(CommitDetails, { value: item, t })'));
    assert(dialog.includes("'data-testid': 'pud-github-safety'")); assert(dialog.includes("t('githubConfirmSafety')")); assert(dialog.includes("githubUpdating ? t('acknowledgeGithubSelf')"));
    assert(code.includes("verification.source.expectedKind === 'registry' || verification.source.kind === 'registry' ? 'registryCheck' : 'sourceCheck'")); assert(code.includes('h(CommitDetails, { value: selfState.attempt, t })'));
    assert(code.includes('GitHub main HEAD · not a release')); assert(code.includes('GitHub 主分支 HEAD · 非 Release'));
    assert(code.includes("useLocale(selectLocale)")); assert(code.includes("useClientSync(selectClientSync)"));
});

test('source refusal labels, bounded progress and v0.5.4 retain Host theme presentation', () => {
    for (const reason of ['registry-origin-unsupported', 'registry-origin-unverified', 'source-identity-unverified', 'recovery-source-changed', 'recovery-archive-unavailable', 'state-changed']) assert(code.includes(`'reason.${reason}'`));
    for (const status of ['restored', 'recovery-required']) assert(code.includes(`'status.${status}'`));
    assert(code.includes('const installProgress = operation?.installProgress'));
    assert(code.includes('const logChunks = boundedLogs('));
    assert(code.includes('raw.length > 24000'));
    assert(code.includes("'v0.5.4'"));
    assert(code.includes('new formal steps wait'));
    assert(code.includes('不冻结智能体创建、提示／工具组装、维护操作'));
    assert(code.includes('--dsw-alias-label-primary-foreground'));
    assert(!/@import\s|https:\/\/fonts\./.test(code));
});
