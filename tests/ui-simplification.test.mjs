import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Structural checks for the simplification recorded in docs/UI_SIMPLIFICATION_NOTES.md.
// They assert the panel's reading order, not rendered appearance: the main path answers
// "what can be updated, what do I do, what happened", and evidence sits in one collapsed
// diagnostics section.
const code = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const section = (start, end) => {
    const from = code.indexOf(start), to = code.indexOf(end, from);
    assert(from >= 0 && to > from, `Client section ${start}`);
    return code.slice(from, to);
};
const panel = () => section('    function DoctorPanel(', '    return {\n      inject:');

test('the main flow keeps only selection, progress and results', () => {
    const view = panel();
    const diagnostics = view.slice(view.indexOf("const diagnostics = h('details'"));
    assert(diagnostics.includes("'data-testid': 'pud-diagnostics'"), 'technical evidence collapses into one section');
    for (const marker of ['h(ClientSync,', 'history', 'limits']) assert(diagnostics.includes(marker), `${marker} belongs to diagnostics`);
    const main = view.slice(view.indexOf('      return h(\'div\', { className: \'pud-page\''), view.indexOf("plan ? h(ConfirmDialog"));
    assert(!main.includes("t('safety')"), 'the long safety paragraph is not part of the normal reading path');
    assert(!main.includes("t('sourcePublicOnly')"), 'source policy prose is not part of the normal reading path');
    assert(main.includes('syncProblem ? h(ClientSync'), 'the sync block appears only when it reports a real failure');
    assert(main.includes('mainList') && main.includes('results') && main.includes('progress') && main.includes('diagnostics'));
});

test('a row states its own short status and keeps evidence behind one disclosure', () => {
    const rows = section('      const pluginRows =', '      const pluginTable');
    assert(rows.includes('quickStatusText(item, t)'), 'each row names its state in one phrase');
    assert(rows.includes("'data-quick-status': quickStatus(item)"));
    assert(rows.includes("h('summary', null, t('rowDetails'))"), 'the evidence stays collapsed per row');
    assert(rows.indexOf('quickStatusText') < rows.indexOf('h(VersionState'), 'the short label comes before the evidence');
    for (const key of ['quick.available', 'quick.up-to-date', 'quick.needs-restart', 'quick.local-source', 'quick.unavailable', 'quick.not-checked']) {
        assert(code.includes(`'${key}'`), `${key} exists in both locales`);
    }
    const zh = section('    const ZH = {', '    const selectLocale');
    assert(zh.includes('需重启 DSH 后更新') && zh.includes('本地安装'), 'Chinese labels distinguish restart and local sources');
});

test('the confirmation keeps only the task policy, safety notes and the two actions', () => {
    const dialog = section('    function ConfirmDialog(', '    class PanelBoundary');
    assert(!dialog.includes('setAck('), 'no generic "I reviewed the versions" checkbox');
    assert(!dialog.includes("type: 'checkbox'"), 'no extra consent checkboxes remain');
    assert(!dialog.includes("t('confirmSafety')"), 'the long safety paragraph is not repeated in every dialog');
    assert(!dialog.includes("h('dt', null, t('taskPolicy'))"), 'the task policy is chosen in its own fieldset, not repeated as a definition');
    assert(dialog.includes("useState('wait-for-idle')"), 'waiting for idle stays the default');
    assert(!dialog.includes('pud-confirm-cancel'), 'stopping tasks needs no second checkbox');
    assert(dialog.includes("t('stopPolicyHelp')"), 'the stop option explains its impact');
    assert(dialog.includes("t('migrationSafety')"), 'a source change keeps its explanatory note');
    assert(dialog.includes("'mirrorSafety'") || dialog.includes("'publicFallbackSafety'"), 'a public mirror keeps its explanatory note');
    assert(dialog.includes("t('unionGenerationSafety')"), 'a derived generation keeps its explanatory note');
    assert(dialog.includes("className: 'pud-dialog-actions'") && dialog.includes("t('cancel')"));
    assert(dialog.indexOf("t('cancel')") < dialog.indexOf("pud-btn-primary"), 'cancel is offered before the primary action');
});
test('rollback after a refused unplug is reported in the result row', () => {
    const table = section('    function BatchTable(', '    function Record(');
    assert(table.includes("item.restoreKind === 'restart-required-removal'"));
    assert(table.includes("t('restartRollback')"));
    const zh = section('    const ZH = {', '    const selectLocale');
    assert(zh.includes('已恢复原版本'));
});

test('the scan shows a real progress bar driven by Host progress', () => {
    assert(code.includes("'data-testid': 'pud-scan-progress'"), 'the progress bar has a stable test hook');
    assert(code.includes("read('scan-progress', { id: progressId }"), 'the panel polls real scan progress');
    assert(code.includes("read('scan', { progressId }"), 'the scan carries its progress id');
    assert(code.includes("'role': 'progressbar'") || code.includes("role: 'progressbar'"), 'the bar exposes progressbar semantics');
    assert(code.includes('.pud-progress-track') && code.includes('.pud-progress-bar'), 'the bar has its own styling');
    const bar = section('      const scanBar =', '      return h(\'div\', { className: \'pud-page\' }');
    assert(bar.includes("t('scan.phase.complete')") && bar.includes("t('scanProgressLabel')"));
    assert(bar.includes("'aria-valuenow': pct"));
});
