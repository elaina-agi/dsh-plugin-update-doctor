import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Execute actual pure Client helpers and element constructors with a minimal
// element recorder. This is not a React/DOM, visual, HMR or live Host test.
const code = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const from = code.indexOf(start), to = code.indexOf(end, from);
  assert(from >= 0 && to > from, `Client section exists: ${start}`);
  return code.slice(from, to);
};
const labels = vm.runInNewContext(`${section('    const EN =', '    const githubReasonAliases =')} ({ EN, ZH });`);
const elements = (type, props, ...children) => typeof type === 'function'
  ? type({ ...props, children }) : { type, props: props ?? {}, children: children.flat(Infinity).filter(value => value !== null && value !== undefined) };
const helpers = vm.runInNewContext(`
  const array = value => Array.isArray(value) ? value : [];
  const string = value => typeof value === 'string' ? value : '';
  const NS = 'pluginUpdateDoctor';
  const localText = (t, key, fallback) => {
    const translated = t(key); return typeof translated === 'string' && translated.trim().length > 0 && translated !== key && translated !== NS + '.' + key ? translated : fallback;
  };
  ${section('    const hasVersionStates =', '    const recoveryEligible =')}
  ${section('    function Badge(', '    function SourceDetails(')}
  ({ versionStates, eligible, initialVersionItem, safeQueryOrigin, versionDisplay, VersionState, VersionValue });
`, { URL, h: elements });
const t = locale => key => labels[locale][key] ?? key;
const text = element => typeof element === 'string' || typeof element === 'number' ? String(element)
  : Array.isArray(element) ? element.map(text).join('') : element?.children?.map(text).join('') ?? '';
const descendants = element => !element || typeof element !== 'object' ? [] : Array.isArray(element)
  ? element.flatMap(descendants) : [element, ...element.children.flatMap(descendants)];
const render = (item, locale = 'ZH') => helpers.VersionState({ item, t: t(locale) });
const base = { name: 'owned-plugin', version: '1.0.0', registry: 'https://registry.npmjs.org', canUpdate: false };

test('no newer version and blocked update conditions are rendered as two independent facts', () => {
  const item = { ...base, status: 'blocked', versionStatus: 'up-to-date', updateStatus: 'blocked', latestVersion: null, reasons: ['dependency-graph-update-requires-separate-review'] };
  const tree = render(item), output = text(tree);
  assert(output.includes('版本检查: 当前查询源未发现较新的正式版本'));
  assert(output.includes('在线更新: 条件不满足'));
  assert.equal(descendants(tree).find(node => node.props['data-version-status'])?.props['data-version-status'], 'up-to-date');
  assert.equal(descendants(tree).find(node => node.props['data-update-status'])?.props['data-update-status'], 'blocked');
  assert.equal(helpers.versionDisplay(item).value, '1.0.0');
  assert(text(helpers.VersionValue({ item, t: t('ZH') })).includes('当前已装版本'));
  assert.equal(helpers.eligible(item), false);
});

test('mirror no-newer result names its query scope and never claims global latest', () => {
  const item = { ...base, registry: 'https://registry.npmmirror.com/', versionStatus: 'up-to-date', updateStatus: 'blocked', status: 'blocked' };
  for (const locale of ['ZH', 'EN']) {
    const tree = render(item, locale), output = text(tree);
    assert(output.includes('https://registry.npmmirror.com'));
    assert(output.includes(t(locale)('querySourceScope')));
    assert(!output.includes('已是最新') && !output.includes('Up to date'));
    assert(descendants(tree).every(node => node.type !== 'a' && !Object.hasOwn(node.props, 'href') && !Object.hasOwn(node.props, 'dangerouslySetInnerHTML')));
  }
});

test('invalid or credential-bearing query sources are not rendered as trusted origins or links', () => {
  for (const registry of [null, '<img src=x onerror=alert(1)>', 'javascript:alert(1)', 'https://user:secret@example.test/', 'https://example.test/?token=secret', 'https://example.test/private', 'file:///private/config']) {
    const tree = render({ ...base, registry, versionStatus: 'unknown', updateStatus: 'blocked' });
    assert.equal(helpers.safeQueryOrigin(registry), '');
    assert(text(tree).includes('来源未确认'));
    assert(!text(tree).includes('secret') && !text(tree).includes('<img'));
    assert(descendants(tree).every(node => node.type !== 'a' && !Object.hasOwn(node.props, 'dangerouslySetInnerHTML')));
  }
  assert.equal(helpers.safeQueryOrigin('https://EXAMPLE.test:8443/'), 'https://example.test:8443');
});

test('incompatible published version is visible but is never a selectable prepare target', () => {
  const item = { ...base, canUpdate: true, status: 'available', versionStatus: 'no-compatible-version', updateStatus: 'no-update', latestVersion: null, latestPublishedVersion: '2.0.0' };
  assert(text(render(item)).includes('已发现新版，但没有可选的正式版更新候选'));
  assert(text(render(item)).includes('在线更新: 无可选新版'));
  const value = text(helpers.VersionValue({ item, t: t('ZH') }));
  assert(value.includes('2.0.0') && value.includes('没有可选正式版候选'));
  assert(value.includes('不兼容、已弃用或未声明插件包'), 'This status does not assert that all newer packages are incompatible');
  assert.equal(helpers.eligible(item), false);
});

test('compatible unverified newer version remains visible while online replacement stays blocked', () => {
  const item = { ...base, canUpdate: true, status: 'available', versionStatus: 'available', updateStatus: 'blocked', latestVersion: '2.0.0', latestPublishedVersion: '2.0.0', reasons: ['wsl-version-not-yet-verified'] };
  const output = text(render(item));
  assert(output.includes('发现较新的兼容正式版') && output.includes('条件不满足'));
  assert.equal(helpers.versionDisplay(item).value, '2.0.0');
  assert.equal(helpers.eligible(item), false);
});

test('unknown and error version checks never display an installed version as latest', () => {
  for (const versionStatus of ['unknown', 'error']) {
    const item = { ...base, versionStatus, updateStatus: 'blocked' };
    assert.equal(helpers.versionDisplay(item).value, '');
    assert.equal(helpers.eligible(item), false);
    assert(!text(render(item)).includes('当前查询源未发现较新的正式版本'));
  }
  const item = { ...base, versionStatus: 'unknown', updateStatus: 'blocked', latestPublishedVersion: '2.0.0' };
  const output = text(helpers.VersionValue({ item, t: t('ZH') }));
  assert(output.includes('2.0.0') && output.includes('更新候选仍未确定'));
});

test('new eligibility contract requires both available states, a candidate and Host permission', () => {
  const ready = { ...base, canUpdate: true, versionStatus: 'available', updateStatus: 'available', latestVersion: '2.0.0', status: 'blocked' };
  assert.equal(helpers.eligible(ready), true, 'new fields are authoritative over the old composite status');
  for (const invalid of [null, {}, { ...ready, canUpdate: false }, { ...ready, latestVersion: null }, { ...ready, versionStatus: 'up-to-date' }, { ...ready, versionStatus: 'unknown' }, { ...ready, updateStatus: 'blocked' }, { ...ready, updateStatus: undefined }, { ...ready, versionStatus: undefined }]) assert.equal(helpers.eligible(invalid), false);
  assert.equal(helpers.versionStates({ ...ready, versionStatus: 'invalid', updateStatus: 'invalid' }).version, 'unknown');
  assert.equal(helpers.versionStates({ ...ready, versionStatus: 'invalid', updateStatus: 'invalid' }).update, 'blocked');
});

test('old scan results retain their original selection rule without inventing no-newer evidence', () => {
  const legacy = { ...base, canUpdate: true, status: 'available', latestVersion: '2.0.0' };
  assert.equal(helpers.eligible(legacy), true);
  assert.equal(helpers.eligible({ ...legacy, status: 'blocked' }), false);
  assert.equal(helpers.versionStates({ ...base, status: 'blocked', reasons: ['registry-origin-unverified'] }).version, 'unknown');
  assert.equal(helpers.versionStates({ ...base, status: 'up-to-date' }).version, 'up-to-date');
});

test('initial updater row offers independent checking without the obsolete static self refusal', () => {
  const original = { ...base, name: 'dsh-plugin-update-doctor', canUpdate: true, latestVersion: '2.0.0', latestPublishedVersion: '2.0.0', reasons: ['self-update-blocked', 'self-update-outcome-unknown'] };
  const item = helpers.initialVersionItem(original);
  assert.equal(item.versionStatus, 'not-checked'); assert.equal(item.updateStatus, 'not-checked');
  assert.equal(item.mode, 'host-self-update'); assert.equal(item.latestVersion, null); assert.equal(item.latestPublishedVersion, null);
  assert.equal(helpers.eligible(item), false);
  assert(!item.reasons.includes('self-update-blocked')); assert(item.reasons.includes('self-update-outcome-unknown'));
  assert(original.reasons.includes('self-update-blocked'), 'input snapshot is not mutated');
  assert(text(render(item)).includes('版本检查: 尚未检查') && text(render(item)).includes('在线更新: 尚未检查'));
  assert(!descendants(render(item)).some(node => node.props['data-testid'] === 'pud-query-source'));
  assert.equal(helpers.versionDisplay(item).label, 'notChecked');
  assert(section('      const pluginRows =', '      const pluginTable =').includes("? t('selfCheckHelp')"));
  assert(t('ZH')('selfCheckHelp').includes('支持独立检查'));
});

test('Git self version result uses the fixed main-head query scope, not npm or global latest', () => {
  const item = { ...base, sourceKind: 'git', mode: 'host-self-update', registry: null, versionStatus: 'up-to-date', updateStatus: 'no-update' };
  const output = text(render(item));
  assert(output.includes('固定 GitHub 仓库') && output.includes('非 Release'));
  assert(!output.includes('来源未确认'));
});

test('registry source verification failure uses npm semantics even when actual source is not registry', () => {
  const Verification = vm.runInNewContext(`${section('    function Verification(', '    function ClientSync(')} Verification;`, { h: elements, React: { Fragment: 'fragment' }, string: value => typeof value === 'string' ? value : '', Badge: props => elements('span', {}, props.prefix + ':' + props.value) });
  const tree=Verification({ verification:{ package:{status:'failed'},host:{status:'unknown'},source:{status:'failed',expectedKind:'registry',kind:'unknown',officialVersionCheckEligible:false} },t:t('ZH') });
  assert(text(tree).includes('npm 来源与官方更新资格'));assert(text(tree).includes('registryCheck:failed'));assert(!text(tree).includes('sourceCheck:failed'));
});

test('table uses independent state constructors while checkbox and prepare retain eligible candidates only', () => {
  const rows = section('      const pluginRows =', '      const pluginTable =');
  assert(rows.includes('h(VersionState, { item, t })') && rows.includes('h(VersionValue, { item, t })'));
  assert(rows.includes('disabled: !eligible(item) || !!pending || busy'));
  assert(code.includes('baseItems.filter(item => checked.has(item.name) && eligible(item))'));
  const prepare = section('      const prepare =', '      const prepareRestore =');
  assert(prepare.includes('version: selfSelected.latestVersion') && prepare.includes('version: item.latestVersion'));
  assert(!prepare.includes('latestPublishedVersion'));
  assert(t('ZH')('reason.host-runtime-dependencies').includes('这不是已确认会替换宿主'));
  assert.equal(t('ZH')('taskPolicy'), '更新前任务处理');
});

test('download preflight refusal keeps the discovered version and names the failed step', () => {
  const item = { ...base, versionStatus: 'available', updateStatus: 'blocked', latestVersion: '2.0.0',
    packagePreflight: { status: 'failed', code: 'package-archive-fetch-failed', phase: 'archive' } };
  for (const locale of ['ZH', 'EN']) {
    const output = text(render(item, locale));
    assert(output.includes(t(locale)('version.available')));
    assert(output.includes(t(locale)('reason.package-archive-fetch-failed')));
    assert(!output.includes(t(locale)('update.available')));
  }
  assert.equal(helpers.eligible(item), false);
  const ready = { ...item, canUpdate: true, updateStatus: 'available', packagePreflight: { status: 'passed' } };
  assert(text(render(ready)).includes('安装包预检通过，可继续确认'));
});

test('request failure shows a localized actionable heading and keeps technical codes inside details', () => {
  const issue = { code: 'package-archive-fetch-failed', diagnostic: 'Package archive download failed.' };
  const tree = vm.runInNewContext(`
    ${section('      const errorText =', '      const detailBundle =')}
    ${section('      const failure =', '      const history =')}
    failure;
  `, { error: issue, t: t('ZH'), h: elements,
    string: value => typeof value === 'string' ? value : '',
    localText: (translator, key, fallback) => translator(key) === key ? fallback : translator(key) });
  assert.equal(tree.props.role, 'alert');
  assert(text(tree.children[0]).includes('下载更新包失败'));
  assert(!text(tree.children[0]).includes(issue.code));
  const detail = tree.children.find(node => node.type === 'details');
  assert(detail && text(detail).includes(issue.code)); assert(!detail.props.open);
});
