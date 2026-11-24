# 验证记录与支持边界

## 2026-11-24：公开npm、自身升级与默认公共fallback修复

- 用户公开发布0.5.3：48文件、201,051字节、SHA256 `a05a5594af5d440e8ef3ac286f3efed8cad22dd116a03423352d1d08512887f6`。该包区别于下方旧本地47文件归档，未覆盖旧归档。
- 用户从原npm0.5.0面板确认0.5.3，01:26:27–01:26:45（Asia/Shanghai），记录applied、late Host结果、新实例verifiedApplied、Host1/1active、48文件逐字节一致。实际选择cancel-active，不能当作自然等待路线的真人验收。临时官方源／无fallback条件和pnpm单字段源已恢复，临时助手已移除。
- 0.5.4修复官方首选+公共镜像fallback仍被拦截，新增public-fallback、完整来源绑定、额外同意和schema3，不要求更改全局配置。旧纯官方确认后的计划变化仍停止。
- 原版rc.5owned-profile生产coordinator/HTTP/Host正常交接及目标激活失败自动恢复通过，原manager与PID不变、旧门禁释放、新/恢复实例读取结果；逻辑公开源和实际loopback下载通过显式adapter，非真实网络fallback证明。零Agent任务，非浏览器认证/点击/主题/第二设备验收。
- 真实npmmirror归档下载会302至 `cdn.npmmirror.com`。此前全拒重定向实际误拦，0.5.4只允许精确包／版本路径单跳并继续官方摘要比对；真实公共0.5.3归档只读校验通过（48文件，SHA256与公开npm一致）。任意host/query/credentials/path别名／第二跳和损坏CDN字节仍被回归拒绝。不是镜像自更新或网络fallback执行验收。
- 本次0.5.4验证限源码、原包只读检查和自有隔离Host；真实镜像升级全过程、未来版本自身交接和第二设备尚未验证。GitHub限流优化不在本轮内。下方均为各自历史检查点。


## v0.5.3实际安装与用户升级确认（2026-11-23）

- 官方管理器安装更新器0.5.3，applied、Host1/1active，47个已装文件与195,747字节最终归档一致；归档SHA256为`3c87818b189c3544e46e3b29a706d5df05beeae4963311c9a8c8eb219bd4063d`。
- 打包时完整回归358项：344通过、14明确跳过、0失败；27项归档JS语法及36条包内Markdown链接核验通过。
- 安装后文档收尾新增1项当前状态／运行要求／历史边界回归；本轮源码回归359项：345通过、14明确跳过、0失败。包内链接按当前仓库预期资源再次检查通过；新文档尚未纳入既有0.5.3归档，因此不把此次计数称为新的归档验收。
- 用户随后在真实面板确认WSL **0.26.2→0.29.0**。操作记录为2026-11-23 **22:12:13–22:12:29（Asia/Shanghai）**，完成结果applied、包命令exit0、generationVerified=true；当前资源核验通过，Host **16/16active**，没有触发旧版恢复。
- 中文深色列表截图确认0.5.3及WSL候选可选；截图不证明全部对话框、英文、其他主题、键盘、窄屏和实际发行版功能。日志与当前Host事实证明安装/加载成功，不证明所有已有会话已换代。
- 本机源码与归档检查未发现写死用户名、开发目录、端口或PID；第二台设备尚未实测。.NET Framework4.x助手依赖及其他条件见[运行要求](<WINDOWS_REQUIREMENTS.md>)。
- 本轮文档补记**未修改功能、未重新打包或覆盖上述已验收归档、未重装或再次更新用户插件**。下方旧记录保留各自当时状态，不改写成最新代码已复跑。

## WSL新版准入修复

不再单凭固定版本名单拒绝候选，改为检查公开原包和完整现代声明契约；schema4保存root／retained原包身份及独立证明，离线完整重建，未知结果在更新／恢复各入口拒绝重发。原版rc.5隔离0.24-root保留、0.26.2→0.29.0完整生产HTTP确认更新和预准备旧包恢复通过，Host15→16→15active，全部原包资源核验。最终回归、最新生产快照及本机更新器安装结果见交付验收记录。详情见[WSL结构准入](<WSL_STRUCTURAL_0_5_3.md>)。下方0.5.2及更早记录为历史，不冒充最新代码复验；开发实验未更新用户WSL/Union，之后用户本人执行的真实WSL升级另记上方。

## Union完整依赖代际：0.5.2阶段记录、本版保留路线

本轮仅更新插件工作区，未改DSH／Node／Electron或Union原始JS。原型公开24→25、坏目标恢复、连续五代均在原版rc.5通过；26依赖／2249文件核对公共原包。生产独立UnionStager／DoctorService／HTTP确认／默认TaskGate好／明确拒绝恢复组在冻结模块副本中通过，源／文件／Host／真实Loader namespace／advance_fetch功能与持久lineage分别核验。来源变为本地代际，不伪造npm；额外确认、schema3、旧代上限及未知结果拒绝。

最终归档、当前回归和本机安装状态以交付验收记录为准，更新器安装不自动更新Union或WSL。早期旧0.5.1风险拦截不算修复，常规npm/HMR失败事实不变。新限定路线不是底层热加载修复，也不推广未审查版本。说明见[Union代际范围](<UNION_GENERATION_0_5_2.md>)。

以下0.5.1验收是历史记录，不代表0.5.2候选包／浏览器／所有生产故障已完成。


## v0.5.1历史发布范围与当时验收状态

**本页记录更新器本身的验证。修改Union Search或Node／Electron的独立研究，不属于本插件修复、支持能力或发布验收。** 以下为0.5.1打包时的历史记录：当时仅安装更新器不能完整解决Union Search安全无重启更新，常规HMR路径只做风险拦截。0.5.2新增插件内完整依赖代际路线见上方，不修补宿主。

- 当阶段v0.5.1只做隔离测试，新界面浏览器验证不完整；后续用户安装与升级是独立证据。
- 2026-11-23发布步骤1／2测试：完整回归315项，301通过、14明确跳过、0失败。新增7项覆盖合法停用状态、迁移身份保留和Union恢复资格；不是浏览器验收。
- 已制作实际v0.5.1候选归档并核验40项资源、29条实际Markdown包内链接、22项JavaScript语法、manifest／locale JSON、MIT许可证及固定助手摘要。此前dry-run计数30是预览检查器计数，不代表正式tar内实际链接计数；安装文档不带研究、测试、日志或配置。
- 候选归档在未修改的DSH Desktop 0.2.2-rc.5／Electron 44.7.0／Node 24.21.0自有临时profile中安装applied、warnings为空，全部已装包文件与归档逐byte一致，Host一行active；实际Client graph与资源200供给通过，但未执行浏览器DOM。
- 普通npm／限定JS依赖更新成功、故意激活失败后原版Host自动恢复、固定镜像额外确认、整体与单行停用状态保留均通过；普通包与registry传输为明确自有fixture，生产index／HTTP／service从原始候选包加载，无代码hook／Host补丁。使用共享Connection dispatcher和自有owner Peer，不是浏览器Cookie／真实点击证明。
- 同版本归档迁移好／拒绝组、公开WSL0.26.2→0.28.0代际及旧版恢复、真实自有Agent自然结束／新步骤门禁，另以归档冻结生产模块复验。WSL原始资源及0.24-root／三代归档字节独立核验；Agent为维护工作，不调用模型、不取消用户任务。
- 仍待验收：真实用户升级／迁移／自身交接、公共旧版→新版SELF升级、新界面的DOM、主题、键盘及窄屏交互。普通更新成功不等于全部社区包／依赖都支持；Union Search当前HMR路径仍不支持安全无重启更新。
- [发布说明草稿](<RELEASE_NOTES_0_5_1.md>)列出用户可用范围；[发布审查清单](<RELEASE_REVIEW_0_5_1.md>)列出待办。任何已知拒绝、未知或需重启都不能标为成功。

## Windows剩余能力与真实隔离验证（2026-11-22）

本轮新增旧普通归档独立迁移、固定公共镜像额外确认、限定不变JS依赖图、新版WSL及官方详情扩展；详细方法和限制见[Windows支持](<WINDOWS_SUPPORT.md>)。

- 普通来源保持实际rc.5成功／故意失败恢复均通过，npm规格及官方版本查询资格保持；这是在修正实验Ready信号与整体时限之后的新运行，不把之前取消组计为成功。
- 公共镜像SELF好／坏组通过，缺额外ack拒绝、单次Host交接、新旧文件／YAML／Host及来源核验；逻辑mirror/official来源与loopback传输为显式fixture，部分并行变更文件hash不匹配不当已验证快照。
- 一项纯ESM依赖普通更新和故意失败恢复通过，真实依赖边关系／包文件digest不变；旧file同版本迁移成功及一次明确测试install拒绝后恢复通过。不是任意依赖声明变化均可更新，也不证明全部依赖源provenance。
- WSL0.26.2→0.28.0通过，15→16active并可恢复15active；保留0.24-root和三代资源749项逐byte核验。最终productionstager+HTTPprepare/commit+batch路径实际通过；坏新增条目fixture自动恢复通过。无用户WSL发行版或模型任务，不能保证所有既有会话强制换代。
- Union公开0.10.24→25：新版cold安装通过，HMR更新和恢复均导入失败；依赖包和旧恢复字节一致。无HMR冷旧基线更新返回真实restart-required，新磁盘与源正常；没有合法公开HMR原位npm安装API。因此当前HMR的Union更新/迁移明确阻止，非HMR路径保留，不用私有缓存或别名绕过。
- 新UI使用公开详情slot与layout导航，初始不自动联网；身份确认后只读版本检查，由用户去更新器确认。镜像计划未提供时如实说明未绑定，不把延迟警告误作core风险。没有真实浏览器控制，DOM/主题/键盘/窄屏尚未验收。
- 当前完整离线回归 **289项通过、14项私有证据测试明确跳过、0失败**，共303项；新镜像／迁移／依赖／WSL专项与实际Client纯helper回归均通过，不当作真实DOM。
- 全部自建实验任务输出已收集，自有临时根已清理；原始JSON/log留忽略目录不上传。未改用户profile/实际安装/用户缓存、未停止真实任务。Mac未扩展。

## 普通 npm 来源保持修复（2026-11-22）

- 原普通批次安装预检本地归档，保存来源会变成file，官方Versions入口因此消失。本轮对实际registry安装使用公开 `pluginManager.updateBundle(name, exactVersion, { registry, requestId })`，一次交接给官方更新及自动恢复，不由Doctor再次自动恢复。新安装保留精确npm规格并独立核验`update: registry`／版本／来源规格／已装原文件字节和预期Host条目；旧文件与WSL代际路径不静默迁移。
- 预下载包仍有完整来源／integrity／manifest／patch和新旧字节校验，但只是预检证据。Host按规格再次下载、沿用现有fallback和依赖传输；不能宣称精确归档事务、供应链全public-only或原子替换。普通npm确认框显式说明这些边界。更新器自身的独立public-only／无fallback政策不变。
- Host目标和自动旧版恢复独立保存，实际读取可能已是恢复后的旧版，不能捏造“中间已装新版”的文件证据。Host applied但字节／来源核验失败不会标成功，也不会自动删除同版本外部目标。未知结果、不完整结果或核验异常阻止同包再次更新／恢复，不能用新扫描清掉未知。
- 只对已知失败且当前身份匹配记录的registry目标提供单独确认旧版本恢复，使用 `name@oldVersion` 而不是本地归档，重新查旧公共归档并比较摘要。丢失安装／删除结果仍未知。身份记录新写schema2、双读旧schema1；旧更新器不会把新记录误读成旧归档恢复，但旧版自身缺少完整读失败门禁，**不支持降级旧更新器继续管理新记录**。新代码读／写失败明确拒绝继续更新或覆盖记录；SELF receipt格式未变。
- 离线回归 **243项通过、14项私有证据测试跳过、0失败**，共257项。包括此前242项和本轮15项来源保持／Host恢复／旧格式／未知结果／UI语义测试；桩编排不是实际pnpm安装证据。
- 本阶段曾尝试实际rc.5宿主隔离实验但未在合理时限内返回，主动取消并清理，未计成功；后续修正Ready信号后已运行新的成功／失败恢复对照，见上方Windows剩余验证。新UI真实DOM仍未验收。
- 该阶段没有扩展镜像/依赖/WSL，后续已经新增受限支持和真实实验（见上方Windows剩余验证）；Mac仍未支持。用户旧file来源不会自动迁移，需新开发版独立迁移流程确认。

## 版本发现与状态修复（2026-11-22）

- 修复 Doctor 已校验归档来源的版本查询使用 npm 精简元数据的问题。该格式不包含自定义 `dsh.bundle`；旧逻辑会过滤掉 WSL 新版并误报“已是最新”。改读完整 JSON，校验包名、版本键／manifest 身份和当前版本存在；缺元数据、查询失败、窗口遗漏不能证明没有新版。
- 扫描输出分离 `versionStatus`（来源内发现结果）与 `updateStatus`／`canUpdate`（在线替换资格）。无较新版本可以和依赖／来源限制同时展示；发现不兼容、弃用或未验证新版，不等于允许更新。面板在同一状态格分别显示两项，并以纯文本说明查询源范围，不宣称镜像结果代表全部来源。
- 正确解释 Host 的 `registry: null`：通过公开 `manager.registries().resolved` 的查询前后稳定快照确认真实来源；显式来源不被覆盖，未知／变化来源仍拒绝。镜像／私有来源不转为官方 npm，也不修改用户 registry／fallback 配置。公开查询结果不透传原始 attempts、凭据 URL或私有错误详情。
- 普通批次停止任务前补来源重验；npm 自身交接在完整字节预检后及 handoff 写入后、实际 dispatch 前再次检查 public-only／无 fallback 来源计划。准备、停止任务前、等待后均要求完整可选候选；缺结果仍未知，不能自动重发。首尾快照与重复检查不是原子 CAS，不能排除外部并发 ABA。
- 完整离线回归 **228 项通过、14 项私有证据测试明确跳过、0 失败**，共242项（包含UI实际纯 helper／元素构建回归，不是 React／DOM 测试）。新增37项回归覆盖完整／缺失元数据、源解析和变更、双轴状态、弃用候选、SELF票据／任务／handoff安全。原回归191通过；新增37通过。
- 独立显式启用的只读公共网络测试运行 **1项通过**：修复后的查询发现 WSL `0.27.0`、`0.28.0`，显示候选 `0.28.0` 并保持 `canUpdate: false`／`wsl-version-not-yet-verified`。该测试的兼容检查为明确 stub，**不是新版WSL真实Host兼容、安装或升级证据**。复验脚本为仓库开发材料 `experiments/public-discovery-check.mjs`（不随安装包提供），需显式设置 `DSH_PUBLIC_DISCOVERY_CHECK=1` 并以 Node 24+ 运行，不属于默认离线回归。
- JS入口与全部lib语法、manifest／locale JSON和差异空白检查通过。独立安全源码复核与UI/UX源码复核完成，修正“无兼容候选”和“没有任何新版”的过宽表述：弃用／非bundle也可无候选，预发布不纳入正式版范围。UI纯元素测试不作为视觉验收；原生助手摘要、依赖锁和平台声明保持不变。
- 该版本发现修复阶段没有扩更多WSL/依赖；后续受限支持和实际实验见上方Windows剩余验证。用户安装仍未修改；无真实浏览器控制，DOM/深浅主题/键盘/窄屏仍未验收。

## npm 公开发布核验（2026-11-21）

- 对精确公共[版本接口](<https://registry.npmjs.org/dsh-plugin-update-doctor/0.5.0>)与[安装包](<https://registry.npmjs.org/dsh-plugin-update-doctor/-/dsh-plugin-update-doctor-0.5.0.tgz>)进行只读核验，下载返回HTTP200；这是固定版本输入，不是当前latest声明。
- 下载归档为 **122,671 字节**，SHA256 为 `e06a9b565aa38974b98db92ee83cf73146eed729aaef15a392c2603342babc15`，与发布前已审查归档一致；SHA1 和完整 SHA512 integrity 均与公开元数据相符。完整发布标识见[发布与隐私说明](<PUBLICATION.md>)。
- 通过 DSH 官方插件管理器添加 `dsh-plugin-update-doctor@0.5.0` 即可使用 npm 来源。此核验是公共下载与归档一致性证据，**不是一次真实 npm 来源的 DSH 安装、未来自身升级或浏览器交互验收**。
- 用户此前已通过官方管理器安装固定 GitHub 提交的 v0.5.0；npm 发布不改变现有来源。本次仅更新仓库文档，不修改用户 profile／已安装代码、不重新打包或覆盖已发布版本。安装指引以[仓库 README](<https://github.com/elaina-agi/dsh-plugin-update-doctor#readme>)。

## GitHub 自身升级（2026-11-20）

新增固定公开仓库／完整提交的独立自更新交接，沿用实际安装DSH **0.2.2-rc.5**公开Git `updateBundle`，不直接安装覆盖自身、不手改profile。设计见[自身升级](<SELF_UPDATE.md>)，试验方法见[GitHub隔离验证](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/GITHUB_SELF_UPDATE_PROOF.md>)。

- 离线回归覆盖固定仓库来源、main发现与完整commit绑定、Git tree/blob摘要、Git打包／锁文件／脚本控制、原文件核验、票据复查、分层结果及旧记录兼容。31项Git预检专项全部通过；完整回归 **191项通过、14项私有证据测试明确跳过、0失败**，总计205项。JS语法与差异空白检查通过。
- 实际隔离宿主成功组载入新提交、新代码可调用且Host active；失败组目标安装exit0但故意加载失败，官方恢复旧提交applied，恢复文件／来源／Host通过，升级仍为失败。两组保持管理器fiber和同PID，旧disposer不等待自身安装；自有根及listener已清理。
- GitHub接口与传输为显式fixture：由真实生成Git对象供给fixed逻辑GitHub API/raw数据；public installBundle适配器仅转换自有Git传输及该失败target来源身份，原状态／诊断结果单独保留，public updateBundle执行、包命令、生命周期与官方恢复均未替换。测试旧0.4.1复制当前代码，不能声称真实旧版已具备新功能。任务为0，无浏览器点击／模型／真实profile变更。一次重复成功组因旧fixture没有映射失败本地spec而被白名单保留为unknown；底层安装原因未完整捕获，新增原结果捕获／身份映射后复验通过，不将重跑当作修复底层故障。
- 另对公开旧提交9f6160c进行只读原文件预检：35项安装资源匹配，Git tree为 `d122bbf60f19d212b8552b178429b1f0f56ba9f8`，41个有界请求读取421016字节；三个打包控制文件通过。首次真实HTTP检查暴露小文件gzip wire Content-Length大于decoded大小的兼容缺陷；修复仅对identity响应使用该头提前拦截，解压后的流仍有精确上限，并新增gzip/br回归；真实复验通过。此项不是目标安装、全面兼容或浏览器证据。
- 中文确认框直接展示非签名Release、现有依赖源、非原子替换及安装／恢复都可能失败，并使用Git专属确认；完整新旧SHA、来源／包／Host／页面同步与恢复结果分开。UI/UX源码复核通过；**未验收v0.5.0真实DOM、深浅主题、键盘或窄屏行为**。
- 在该轮开发验证时，用户已安装的v0.4.1未被开发代码改动；该轮没有npm发布、live升级、用户任务取消、WSL修改或私有结果上传。旧GitHub v0.4.1没有新增自更新入口，首次升级需由用户通过官方管理器完成；后续固定版本归档核验见上方2026-11-21记录。只有符合来源与预检条件的更高正式版本才能使用对应自身升级路径。

## 首屏渲染修复（2026-11-20）

用户在实际 GitHub 安装的 v0.4.0 面板看到本插件渲染保护提示。已安装客户端与仓库源码一致，缺陷是 `useLocale()` 和 `useClientSync()` 没有传入选择器。DSH 0.2.2-rc.5 实际 renderer 将这两个注入源绑定成必需接收 selector 的 Hook，因此首次读取就会抛错。

v0.4.1 改为稳定的显式选择器 `useLocale(selectLocale)`／`useClientSync(selectClientSync)`，不手工订阅，不改宿主 API 或主题。新增测试直接求值实际客户端的选择器声明与调用片段；旧无参写法必须失败。另对安装版 renderer 内实际纯 `memoizedSelector` 片段验证：缺 selector 精确报 `TypeError: selector is not a function`，正确选择器返回语言和同步快照。该验证未执行 React／DOM，不是模拟或真实浏览器渲染验收。

此前164项回归只覆盖静态声明和宿主生命周期，遗漏了 selector参数契约；其通过不能证明真实页面正常。修复后的干净源码测试 **152 项通过、14 项私有证据测试明确跳过、0 失败**，总计166项。实际renderer完整字节SHA256为 `6facb89754f0d21af91491a32646be87ff1b4a25891e44cce1732b02b0fe123b`；纯选择器片段647字节，SHA256为 `09aeeb2d1a69d8d4dd33c9f8cba84e0e4b8480a8bac47350cf1cb7b0addbb57e`。修复后的真实页面需用户重新安装 v0.4.1 并刷新验收。此次不直接修改已安装插件、不读取浏览器凭据、不改profile或WSL。

## v0.4.0 自更新交接（2026-11-20）

当前安装的 DSH Desktop 为 **0.2.2-rc.5 / Windows x64**。v0.4.0 新增独立的宿主自更新交接，详见[设计](<SELF_UPDATE.md>)和[真实隔离实验](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/SELF_UPDATE_PROOF.md>)。

- 成功组：实际旧更新器卸载后，独立官方管理器安装新版，实际新代码与Host行active；新实例读取旧实例写下的结果，文件摘要核验通过。
- 失败组：明确故意抛错的目标安装exit0但activation失败，官方自动恢复旧版applied；旧代码实际可用、恢复文件摘要核验通过；目标失败从未被恢复成功覆盖。
- 同版本文件改动控制：历史官方applied保留，但独立文件核验失败，不显示已验证升级成功。旧disposer没有等待自身安装的五秒循环。
- 使用真正安装的AppBoot/Cordis/Loader/HMR/PluginManager和安装后的production代码。生成的版本与registry transport、panel-shaped HTTP request为显式fixture，并非公开npm发布／真实用户点击。任务数为0，不证明真实取消任务或浏览器HMR/DOM。测试根、进程和listener已清理。
- 本机回归 **164 项通过**；不含私有结果的干净源码 **150 项通过、14 项明确跳过、0 失败**。JS语法检查通过。实际安装包包含新增的三项self模块和使用说明，原始实验结果、tests和缓存不进入包。
- 静态UI/UX审查已完成：自身交接不再误显示普通批次的全程门禁进度文案，常见来源／依赖拒绝原因提供中英文可行动说明。没有真实浏览器控制，视觉与实际点击仍未验收。
- 开发验证没有更新用户当前profile、WSL或任务，也没有安装／刷新用户live更新器或发布npm。源码提交和GitHub推送作为用户另行确认的发布步骤执行。
- 自更新仅准公共npm registry、Host无fallback、固定依赖与助手。旧门禁在卸载时结束，不能承诺整个宿主替换全程冻结新任务。

## v0.3.0 历史验证

v0.3.0改进和新增实验见[设计与验证](<V0_3_DESIGN.md>)。该轮刷新过更新器，但没有再次更新用户WSL。下列WSL与早期模块对照为历史真实实验证据，不代表当前每项都重跑。


- 桌面桥接误拦修复：安装版真实 Connection dispatcher和 HTTP bridge（仅去除 TypeScript类型注解）下，正常物理 Origin＋内部 `dsh.internal` URL准备请求返回200；未认证401、跨站403、无面板标记403、非 owner403。更新调用0，停止任务0。测试身份为自有内存 fixture，不读取用户凭据。
- v0.2.1 后用户在真实 desktop 面板完成 WSL **0.24.0 → 0.26.2** 更新；插件自有日志记录 `outcome: applied`、`generationVerified: true`、目标版本精确匹配且无新增 activation warnings。用户选择了额外确认的停止政策，但实际 `requestedAgents: 0`，没有任务被取消。日志是实际结果证据，不等于浏览器 DOM／所有 WSL 会话功能验收。
- JSON和面板自定义头是防简单跨站请求的标记，不是身份或点击证明。真实鉴权仍由 DSH Connection、确认票据及额外停止任务同意提供；不声称防止已认证恶意同源代码或 XSS。


目标：DeepSeek Harness Desktop **0.2.2-rc.3 / Windows x64**。

## 已验证

- 修正用户真实截图中的主按钮白底白字：主背景与 `label-primary-foreground` 配对；禁用不使用整控件透明度，查询中标签和旋转标记可见。静态 token 检查通过，真实新截图仍由用户查看。
- 更新确认提供默认等待和额外同意停止当前活动。取消绑定到确认时 Agent 活动代次；新活动不被旧确认取消。包校验、状态和共享冲突检查前置，取消失败不虚报队列清空。
- 普通测试插件在真实 DSH 同进程更新、失败恢复通过；真实 Agent 维护／pre-step 门禁通过，没有网络模型调用。
- 完整官方 base + web +真实 WSL：0.24.0 冷启动14/14 active；官方移除后重装更新真实复现基础 fs/subprocess 重复注册，原位安装原包真实复现旧 ESM 导出缓存错误。不是已证实的文件锁。
- 生产代际包装路径：真实同 PID 0.24.0 → 0.26.2 全15 Host行 active、公开再应用 applied；旧版恢复全14 active，裸包客户端锚点仍 active，FS `resolve`／`processPath` 与子进程服务可访问。
- 滚动资源保留路径：同一隔离宿主进程内，0.24.0 → 0.26.2 直接 applied、15 active；回滚原版本直接 applied、14 active。旧根资源和新代资源均按原包字节保留。测试的 agent shell脚本两版本摘要恰好相同，不能仅用它证明不同代码版本；生成单元测试另检查不同字节资源。
- 最新单元／编排与本机保留证据回归 **109 项通过**；干净源码快照 **97 项通过、12 项证据断言明确跳过、0 失败**。包含精确来源／归档、批量恢复、历史字节预算、Agent销毁等待环、证据读取与页面状态静态检查。保留证据断言不等于重跑全部历史宿主实验。
- 原包 SHA512、固定已验证原包 SHA256与派生包 SHA256分别核验。新包代码和素材不编辑，仅 manifest和自身模块声明映射到独立代际目录；滚动包保留旧代 exports与资源。
- 只读 Windows 使用检测查询进程与共享冲突，不杀用户进程；不足样本返回 unknown。

## 社区插件对照（2026-11-17）

- **下班倒计时 `1.2.0 → 1.2.1`：官方和 Doctor 通用路径均成功，不是新增故障修复案例。** 每条路径独立临时 profile／新进程，真实 installed PluginManager 与 production `DoctorService.runBatch` 进行对照。
- 冷启动和更新后所有已启用 Host rows active；精确新版本、新客户端原包 SHA256、实际 ClientModules graph revision 和供给的新版 no-drag CSS均核验。自定义配置内容和磁盘字节保留，更新后 HTTP 设置接口仍可读写，未取消任务。测试根目录已清理。
- 详情与复现：[下班倒计时对照](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/COUNTDOWN_PROOF.md>)。未控制浏览器，不能将客户端资源供给等同于真实 Electron 拖拽/HMR 渲染验收。
- **自有模块新增导出控制组：官方 updateBundle 和生产通用 runBatch 均载入 `new-export-1.1.0`，没有复现旧 ESM 缓存故障。** 独立新进程冷启动新版同样有效。这个简单导出变化不能当作 WSL 故障的充分条件，也不能证明已修复第二款社区插件。详情：[模块导出对照](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/MODULE_CACHE_PROOF.md>)。

## 公开源码与打包检查（2026-11-18）

- 私有结果不随源码上传；缺失时仅对应证据断言跳过。JSON 损坏、非对象、关键字段缺失与其它读取失败仍使测试失败。
- 实际打包 31 个文件，包含 MIT、运行模块、文档、语言资源、图标及只读原生助手；不含实验原始结果、测试、日志、依赖缓存或本地 Git 历史。
- 独立临时 profile 通过官方 profile package-operation API 新安装该 `.tgz`，不是 workspace 链接。实际 Host 1/1 active、ClientModules 能供给 v0.3.0 新代码、包内原生探针返回 checked。包 store/cache 位于自有根且已核验，测试根已清理。
- 打包安装验证使用 fixture readiness 与独立测试 HTTP carrier；没有浏览器控制，不等于实际 GitHub 网络安装或真实界面渲染验收。未触碰用户 profile、WSL 或任务。

## 边界

- 这些真实试验没有运行真实 WSL模型任务或发行版命令连续性测试；已有会话可保留旧 preset revision，不保证全部已有会话立即换代。新会话使用新代。不能调用仅适用于空白会话的 recompose API 绕过已有会话锁。
- 此项描述早期WSL .24/.26.2精确摘要例外；0.5.3新候选已经改用公开原包与现代声明契约检查，上方有独立记录。未来版本的实际执行仍不能被宣称已实测。宿主管理核心和其他不支持源仍需独立更新；更新器自身仅走本轮窄准入宿主交接，不承诺所有插件无限制在线替换。
- 没有主动浏览器控制，未读取cookie/token绕过认证；用户提供的0.5.3截图只确认中文深色列表等可见内容，不能扩大为所有客户端同步、对话框、配色或键盘验收。
- 取消任务只经用户界面额外确认；开发实验没有停止真实用户任务。真实 WSL 更新由用户本人在面板确认执行，开发 agent 没有代为签票、降级或再次更新现有 WSL。
- 不改宿主内核、用户配置、WSL distro配置，不执行强制解锁/提权。异常或外部卸载更新器时保留未知结果，不保证官方不可取消步骤已停止。

原始结果 JSON包含本机路径，只保留在已忽略实验结果里，不进入安装包。模拟分支回归、保留证据测试与真实宿主实验证据分开标注。
