import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Evaluate actual Client predicates, event handlers and element constructors.
// A small recorder supplies Hooks state; this is not React/DOM or browser proof.
const code = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const section = (start, end) => {
  const from=code.indexOf(start),to=code.indexOf(end,from);assert(from>=0&&to>from,`Client section ${start}`);return code.slice(from,to);
};
const labels=vm.runInNewContext(`${section('    const EN =','    const githubReasonAliases =')} ({EN,ZH});`);
const t=key=>labels.ZH[key]??key;
const h=(type,props,...children)=>typeof type==='function'?type({...props,children}):{type,props:props??{},children:children.flat(Infinity).filter(value=>value!==null&&value!==undefined&&value!==false)};
const descendants=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(descendants):[value,...value.children.flatMap(descendants)];
const text=value=>typeof value==='string'||typeof value==='number'?String(value):Array.isArray(value)?value.map(text).join(''):value?.children?.map(text).join('')??'';
const runtimePrelude=`const array=value=>Array.isArray(value)?value:[];const string=value=>typeof value==='string'?value:'';const NS='pluginUpdateDoctor';const localText=(t,key,fallback)=>{const value=t(key);return value!==key&&value!==NS+'.'+key?value:fallback;};`;
const predicates=vm.runInNewContext(`${runtimePrelude}${section('    const hasVersionStates =','    const request =')} ({eligible,migrationEligible,mirrorAcknowledgementRequired,isMigration,detailSubjectCandidate,verifiedDetailRecord,mirrorPlanRows,mirrorPlanEvidence,resultStatus,informationWarnings,highImpactWarning,installedSourceLabel});`,{URL});
function dialogHarness(plan){
  const states=[],setters=[];let index=0,confirmations=[];
  const context={h,URL,t,array:value=>Array.isArray(value)?value:[],string:value=>typeof value==='string'?value:'',valueOf:(value,fallback)=>typeof value==='string'||typeof value==='number'?value:fallback,
    useState(value){const slot=index++;if(!(slot in states))states[slot]=typeof value==='function'?value():value;const set=next=>states[slot]=typeof next==='function'?next(states[slot]):next;setters[slot]=set;return[states[slot],set];},
    useRef:()=>({current:null}),useEffect:()=>{},isSelf:value=>value==='host-self-update',isRestore:value=>value==='batch-restore',isMigration:predicates.isMigration,
    mirrorAcknowledgementRequired:predicates.mirrorAcknowledgementRequired,mirrorPlanRows:predicates.mirrorPlanRows,mirrorPlanEvidence:predicates.mirrorPlanEvidence,highImpactWarning:predicates.highImpactWarning,InformationWarnings:()=>null,React:{Fragment:'fragment'},operationResultTitle:value=>value==='source-migration'?'migrationResults':value==='batch-restore'?'restoreResults':'batchResults',safeQueryOrigin:predicates.safeQueryOrigin,
    dateText:value=>value,CommitDetails:()=>null};
  // safeQueryOrigin is evaluated from the actual helper because source text must
  // never become a link or trusted URL through confirmation.
  context.safeQueryOrigin=vm.runInNewContext(`${runtimePrelude}${section('    const hasVersionStates =','    const recoveryEligible =')} safeQueryOrigin;`,{URL});
  const Confirm=vm.runInNewContext(`${section('    function ConfirmDialog(','    class PanelBoundary')} ConfirmDialog;`,context);
  const render=()=>{index=0;return Confirm({plan,t,locale:'zh',onCancel(){},onConfirm:value=>confirmations.push(value)});};
  const find=id=>descendants(render()).find(node=>node.props['data-testid']===id);
  const primary=()=>descendants(render()).find(node=>node.type==='button'&&node.props.className==='pud-btn pud-btn-primary');
  return{render,find,primary,states,setters,confirmations};
}
const basePlan={operation:'source-migration',profile:'test',expiresAt:'2099-01-01T00:00:00Z',taskPolicies:['wait-for-idle','cancel-active'],items:[{name:'owned-plugin',from:'1.0.0',to:'1.0.0',installMode:'registry-migration'}]};

test('migration is independent, same-version and never an ordinary selectable update',()=>{
  assert.equal(predicates.isMigration('source-migration'),true);
  assert.equal(predicates.migrationEligible({name:'owned-plugin',canMigrate:true}),true);
  for(const name of ['dsh-plugin-wsl-env','dsh-plugin-update-doctor'])assert.equal(predicates.migrationEligible({name,canMigrate:true}),false);
  assert.equal(predicates.eligible({name:'owned-plugin',canMigrate:true,canUpdate:false,latestVersion:'1.0.0',status:'available'}),false);
  const prepare=section('      const prepareMigration =','      const commit =');
  assert(prepare.includes("read('prepare-migration', { name }, 'POST'"));assert(!/\b(?:version|spec|path|registry|archivePath)\s*:/.test(prepare));
  assert(prepare.includes('checked.size')&&prepare.includes('answer.items[0].from === answer.items[0].to')&&prepare.includes("answer.items[0].installMode === 'registry-migration'"));
});

test('actual migration confirmation describes source change, defaults to wait and preserves stop consent',()=>{
  const harness=dialogHarness(basePlan),tree=harness.render();
  assert(text(tree).includes('确认从归档迁回 npm 来源'));assert(text(tree).includes('同一版本，不是升级'));
  assert(text(tree).includes('临时卸载')||text(tree).includes('暂时卸载'));assert(text(tree).includes('版本号不变'));
  assert(harness.primary().props.disabled);assert.equal(harness.states[2],'wait-for-idle');
  const ack=descendants(tree).find(node=>node.type==='input'&&node.props.type==='checkbox'&&!node.props['data-testid']);ack.props.onChange({target:{checked:true}});
  assert.equal(harness.primary().props.disabled,false);harness.primary().props.onClick();
  assert.equal(harness.confirmations[0].taskPolicy,'wait-for-idle');assert.equal(harness.confirmations[0].confirmCancel,undefined);
  harness.setters[2]('cancel-active');assert.equal(harness.primary().props.disabled,true);
  harness.find('pud-confirm-cancel').props.onChange({target:{checked:true}});assert.equal(harness.primary().props.disabled,false);
});

test('public mirror acknowledgement remains separate from ordinary operation acceptance',()=>{
  const plan={...basePlan,operation:'host-self-update',mirrorRiskRequiresAcknowledgement:true,items:[{name:'dsh-plugin-update-doctor',from:'0.5.0',to:'0.5.1',publicMirror:true,sourceMode:'public-mirror',registry:'https://registry.npmmirror.com'}]};
  const harness=dialogHarness(plan),tree=harness.render();
  assert(text(tree).includes('固定公共 npm 镜像'));assert(text(tree).includes('并非原子字节替换'));assert(text(tree).includes('https://registry.npmmirror.com'));
  assert.equal(harness.find('pud-confirm-public-mirror').props.checked,false);
  const ack=descendants(tree).find(node=>node.type==='input'&&node.props.type==='checkbox'&&!node.props['data-testid']);ack.props.onChange({target:{checked:true}});
  assert.equal(harness.primary().props.disabled,true);harness.primary().props.onClick();assert.equal(harness.confirmations[0].confirmPublicMirror,undefined,'unchecked source consent is never manufactured by handler');
  harness.find('pud-confirm-public-mirror').props.onChange({target:{checked:true}});assert.equal(harness.primary().props.disabled,false);
  harness.primary().props.onClick();assert.equal(harness.confirmations[1].confirmPublicMirror,true);
  const commit=section('      const commit =','      const cancelSelfWait =');assert(commit.includes('mirrorAcknowledgementRequired(plan) && confirmPublicMirror === true'));
});

test('ordinary mirror batch uses the same explicit source acknowledgement without self-update semantics',()=>{
  const plan={...basePlan,operation:'batch-update',items:[{name:'owned-plugin',from:'1.0.0',to:'1.1.0',registry:'https://registry.npmmirror.com',installMode:'registry-spec'}]};
  assert.equal(predicates.mirrorAcknowledgementRequired(plan),true);const harness=dialogHarness(plan),tree=harness.render();
  assert(text(tree).includes('固定公共 npm 镜像'));assert(!text(tree).includes('确认更新器自身升级'));assert(harness.find('pud-confirm-public-mirror'));
});

test('mirror confirmation projects bounded safe registry plans without links or credential text',()=>{
  const plan={...basePlan,mirrorRiskRequiresAcknowledgement:true,hostRegistryPlan:{registry:null,resolved:'https://registry.npmmirror.com',fallbackRegistries:['https://registry.npmjs.org','https://user:secret@private.invalid/?token=secret']}};
  const rows=predicates.mirrorPlanRows(plan);assert.equal(rows[0].origin,'https://registry.npmmirror.com');assert.equal(rows[3].origin,'');
  const tree=dialogHarness(plan).render();assert(text(tree).includes('准备时的宿主安装源计划证据'));assert(text(tree).includes('https://registry.npmjs.org'));
  assert(!text(tree).includes('secret'));assert(descendants(tree).every(node=>node.type!=='a'&&!node.props.href&&!node.props.dangerouslySetInnerHTML));
  assert.equal(predicates.resultStatus({installMode:'registry-migration',status:'updated'}),'migrated');
  assert.equal(predicates.resultStatus({installMode:'registry-spec',status:'updated'}),'updated');
});

test('undisclosed ordinary mirror fallback plan is not presented as complete or confirmed',()=>{
  const plan={...basePlan,operation:'batch-update',mirrorRiskRequiresAcknowledgement:true,items:[{name:'owned-plugin',registry:'https://registry.npmmirror.com',hostRegistryTransport:{fallbackConfigured:true}}]};
  const evidence=predicates.mirrorPlanEvidence(plan);assert.equal(evidence.complete,false);assert.equal(evidence.fallbackLabel,'mirrorFallbackConfigured');
  const tree=dialogHarness(plan).render();assert(text(tree).includes('未提供或绑定完整宿主安装源计划'));assert(text(tree).includes('准备时观察到宿主已配置备用来源'));
  assert(text(tree).includes('这不表示确认未披露的传输计划'));assert(!text(tree).includes('准备时的宿主安装源计划证据'));
});

test('mirror delay and other information warnings never manufacture a core-service impact finding',()=>{
  const item={name:'owned-plugin',infoWarnings:['public-mirror-may-lag']};assert.equal(predicates.highImpactWarning(item),false);
  assert.equal(predicates.highImpactWarning({...item,highImpact:true}),true);
  const InformationWarnings=vm.runInNewContext(`${section('    function InformationWarnings(','    function VersionValue(')} InformationWarnings;`,{h,informationWarnings:predicates.informationWarnings,localText:(translate,key,fallback)=>translate(key)!==key?translate(key):fallback});
  const tree=InformationWarnings({item,t});assert(text(tree).includes('公共镜像可能落后于官方 npm'));assert(!text(tree).includes('高影响'));
  assert.equal(predicates.installedSourceLabel({doctorArchive:true,sourceKind:'registry'}),'archiveSourceIdentity');assert(labels.ZH.archiveSourceIdentity.includes('本地归档'));
  assert(labels.ZH['reason.dependency-graph-changed'].includes('单独审查'));assert(labels.ZH['reason.dependency-not-resolved'].includes('官方管理器'));
});

test('official detail extension inspects only eligible subjects and verified Doctor records',()=>{
  const subject={kind:'bundle',pkg:{name:'owned-plugin',version:'1.0.0',installed:true,source:'file:C:/owned/package.tgz'}};
  assert.equal(predicates.detailSubjectCandidate(subject),true);
  assert.equal(predicates.detailSubjectCandidate({...subject,pkg:{...subject.pkg,source:'owned-plugin@1.0.0'}}),false);
  assert.equal(predicates.detailSubjectCandidate({...subject,kind:'row'}),false);
  assert.equal(predicates.verifiedDetailRecord(subject,{bundles:[{name:'owned-plugin',version:'1.0.0',installed:true,doctorArchive:false}]}),null);
  assert.equal(predicates.verifiedDetailRecord(subject,{bundles:[{name:'owned-plugin',version:'2.0.0',installed:true,doctorArchive:true}]}),null);
  assert.equal(predicates.verifiedDetailRecord(subject,{bundles:[{name:'owned-plugin',version:'1.0.0',installed:true,doctorArchive:true}]}).name,'owned-plugin');
  const component=section('    function DetailArchiveCheck(','    function Finding(');
  assert(component.indexOf("request('list'")<component.indexOf("request('scan'"));assert(component.includes('verifiedDetailRecord(subject, snapshot)'));
  assert(!component.includes("'POST'")&&!component.includes('prepare-migration')&&!component.includes("request('commit'"));
  assert(!component.slice(component.indexOf('useEffect('),component.indexOf('const check =')).includes('request('),'no automatic version query');
  assert(component.includes('current.current?.abort()'));
});

test('official section uses public slot and layout navigation without DOM or route injection',()=>{
  const registration=section("          scope.slots.inject('plugins.detail.section'","          scope.slots.inject('main'");
  assert(registration.includes("name: 'plugins.detail.section'"));assert(registration.includes("scope.get('layout')"));assert(registration.includes('layout.selectPanel(PANEL_ID)'));
  assert(!registration.includes('location')&&!registration.includes('document')&&!registration.includes('updateBundle'));
  assert(labels.ZH.detailDoctorHelp.includes('不是宿主内置 Versions 列表'));assert(labels.ZH.detailDoctorManual.includes('不能安装或迁移'));
});
