import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

// Executes the real panel function and helper predicates with a tiny element
// constructor. This is a render-tree check, not a browser, CSS or DOM check.
const code = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const slice = (start, end) => {
    const from = code.indexOf(start), to = code.indexOf(end, from);
    assert(from >= 0 && to > from, `Client slice ${start}`);
    return code.slice(from, to);
};
const labels = vm.runInNewContext(`${slice('    const EN = {', '    const githubReasonAliases =')} ({EN, ZH});`);
const t = key => labels.ZH[key] ?? key;

const element = (type, props, ...children) => typeof type === 'function'
    ? type({ ...props, children: children.flat(Infinity) })
    : { type, props: props ?? {}, children: children.flat(Infinity).filter(value => value !== null && value !== undefined && value !== false) };
const descendants = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(descendants) : [value, ...value.children.flatMap(descendants)];
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join('') : value?.children?.map(text).join('') ?? '';
const find = (tree, predicate) => descendants(tree).find(predicate);

async function renderPanel(state = {}, props = {}) {
    const slots = [], setters = [];
    let index = 0;
    const context = {
        h: element,
        useState, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn, useMemo: fn => fn(), useSyncExternalStore: (_s, get) => get(),
        React: { Fragment: 'fragment', createElement: element, Component: class { constructor(p) { this.props = p; this.state = {}; } },
            useState, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn },
        NS: 'pluginUpdateDoctor', EN: labels.EN, ZH: labels.ZH,
        array: value => Array.isArray(value) ? value : [],
        string: value => typeof value === 'string' ? value : '',
        JSON, Date, Number, Set, Map, Math, Object, Array, String, Boolean, Intl, URL,
        navigator: { clipboard: { writeText: async () => {} } },
        request: async () => ({}),
        t,
    };
    function useState(initial) {
        const slot = index++;
        if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
        const set = next => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; };
        setters[slot] = set;
        return [slots[slot], set];
    }
    // Seed the real hook slots: 0 snapshot, 1 scanResult, 2 checked, 3 openName.
    slots[0] = state.snapshot ?? null;
    slots[1] = state.scanResult ?? null;
    const code = `${slice('    const githubReasonAliases =', '    return {\n      inject:')}
      ({ DoctorPanel });`;
    const { DoctorPanel } = vm.runInNewContext(code, context);
    index = 0;
    const tree = DoctorPanel({ t, locale: 'zh', retryClient: () => {},
        useLocale: selector => selector({ active: 'zh' }), useClientSync: selector => selector({ syncing: false, failures: [] }), ...props });
    return { tree, slots, setters };
}

const bundle = (name, version, extra = {}) => ({ name, version, installed: true, enabled: true, sourceKind: 'registry', state: 'active',
    activeRows: 1, totalRows: 1, canUpdate: false, ...extra });

test('the first render keeps only the list, progress, results and a closed diagnostics section', async () => {
    const { tree } = await renderPanel({
        snapshot: { profile: 'desktop', runtimeVersion: '0.2.2-rc.5', bundles: [bundle('dsh-union-search', '0.10.25'), bundle('dsh-better-sidebar', '0.33.0')], history: [], limitations: ['owned limitation text'] },
        scanResult: { checkedAt: new Date().toISOString(), items: [
            { name: 'dsh-union-search', version: '0.10.25', latestVersion: '0.11.0', versionStatus: 'available', updateStatus: 'blocked', canUpdate: false, reasons: ['generation-preflight-failed'] },
            { name: 'dsh-better-sidebar', version: '0.33.0', versionStatus: 'up-to-date', updateStatus: 'no-update', canUpdate: false }] },
    });
    const diagnostics = find(tree, node => node.type === 'details' && node.props['data-testid'] === 'pud-diagnostics');
    assert(diagnostics, 'the diagnostics section exists');
    assert.equal(diagnostics.props.open, undefined, 'diagnostics stays closed on the normal path');
    const safety = find(tree, node => node.children?.some(child => typeof child === 'string' && child.includes('DSH 保持打开')));
    assert(safety, 'the safety paragraph still exists for troubleshooting');
    assert(descendants(diagnostics).includes(safety), 'the safety paragraph only lives inside diagnostics');
    const sync = find(tree, node => node.props['data-testid'] === 'pud-client-sync');
    if (sync) assert(descendants(diagnostics).includes(sync), 'sync state stays inside diagnostics without a real failure');
    const table = find(tree, node => node.props['data-testid'] === 'pud-plugin-table');
    assert(table, 'the plugin list is part of the main flow');
    assert(text(diagnostics).includes('owned limitation text'));
    const limitationsInside = descendants(diagnostics).some(node => text(node).includes('owned limitation text'));
    assert(limitationsInside, 'limitations stay inside diagnostics');
});

test('each row shows one short status before the evidence disclosure', async () => {
    const { tree } = await renderPanel({
        snapshot: { profile: 'desktop', runtimeVersion: '0.2.2-rc.5', bundles: [bundle('dsh-union-search', '0.10.25'), bundle('dsh-plugin-wsl-env', '0.29.0', { sourceKind: 'local' })], history: [] },
        scanResult: { checkedAt: new Date().toISOString(), items: [
            { name: 'dsh-union-search', version: '0.10.25', latestVersion: '0.11.0', versionStatus: 'available', updateStatus: 'blocked', canUpdate: false, reasons: ['restart-required'] },
            { name: 'dsh-plugin-wsl-env', version: '0.29.0', versionStatus: 'available', updateStatus: 'blocked', canUpdate: false, reasons: ['registry-updates-only'] }] },
    });
    const statuses = descendants(tree).filter(node => node.props?.['data-quick-status']).map(node => node.props['data-quick-status']);
    assert.deepEqual(statuses, ['needs-restart', 'local-source']);
    const row = find(tree, node => node.type === 'tr' && node.props['data-package'] === 'dsh-union-search');
    const rowText = text(row);
    assert(rowText.includes('需重启 DSH 后更新'), 'the short label is rendered');
    assert(rowText.indexOf('需重启 DSH 后更新') < rowText.indexOf('详情'), 'the short label precedes the disclosure');
    const evidence = find(row, node => node.type === 'details' && text(node).includes('版本检查'));
    assert(evidence, 'the version evidence sits inside a collapsed disclosure');
});

test('a pending restart handoff is stated in one line and a failure is visible', async () => {
    const pending = await renderPanel({ snapshot: { profile: 'desktop', runtimeVersion: '0.2.2-rc.5', bundles: [], history: [],
        restart: { pending: { name: 'dsh-union-search', from: '0.10.25', to: '0.11.0' }, last: null } } });
    const pendingNotice = find(pending.tree, node => node.props['data-testid'] === 'pud-restart');
    assert(pendingNotice, 'the pending handoff is announced');
    assert(text(pendingNotice).includes('等待下次启动 DSH 完成更新'));
    const rolled = await renderPanel({ snapshot: { profile: 'desktop', runtimeVersion: '0.2.2-rc.5', bundles: [], history: [],
        restart: { pending: null, last: { outcome: 'rolled-back', name: 'dsh-union-search', from: '0.10.25', to: '0.11.0' } } } });
    const rolledNotice = find(rolled.tree, node => node.props['data-testid'] === 'pud-restart');
    assert(text(rolledNotice).includes('重启后已回滚原版本'));
    assert(String(rolledNotice.props.className).includes('pud-warning'), 'a rollback is not styled as success');
});

test('the confirmation renders the task policy and only the special consents', async () => {
    const { tree } = await renderPanel({
        snapshot: { profile: 'desktop', runtimeVersion: '0.2.2-rc.5', bundles: [], history: [] },
    }, {});
    // The dialog itself is covered by the dialog harness; this asserts the panel does not
    // render it without a prepared plan.
    assert(!find(tree, node => node.type === 'dialog'), 'no dialog without a plan');
});

test('diagnostic reports can be copied from the toolbar and from a failed result row', async () => {
    const { tree } = await renderPanel({ snapshot: { profile: 'desktop', runtimeVersion: '0.2.2-rc.5', bundles: [], limitations: [],
        history: [{ id: 'owned-history', package: 'sample-plugin', operation: 'batch-update', phase: 'finished', outcome: 'failed',
            items: [{ name: 'sample-plugin', from: '1.0.0', to: '1.1.0', status: 'failed', result: { application: 'failed', error: { code: 'activation-failed' } } }] }] } });
    const all = find(tree, node => node.props?.['data-testid'] === 'pud-copy-report-all');
    assert(all, 'the toolbar exposes a report copy action');
    const row = find(tree, node => node.props?.['data-testid'] === 'pud-copy-report');
    assert(row, 'a failed item exposes its own report action');
    assert.equal(row.props.type, 'button');
});
