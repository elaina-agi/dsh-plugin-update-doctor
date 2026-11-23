# Windows支持扩展与公共API边界

## 当前0.5.3与本机状态

- 本机更新器0.5.3已安装激活；用户在真实面板完成WSL0.26.2→0.29.0，日志applied、包和代际核验通过，当前16/16Host行active。
- WSL新候选按公开原包/现代声明契约和实际身份检查，不再仅限固定版本名单；旧根/全部保留原包证明、schema4及未知结果保护见[WSL结构准入](<WSL_STRUCTURAL_0_5_3.md>)。
- Union常规npm/HMR限制不变；**自0.5.2起另有已审查0.10.24→0.10.25完整依赖本地代际路线**，不是仅靠风险拦截，也不是修改宿主。来源转本地、额外确认、fresh恢复及未知/未审查目标拒绝见[Union代际](<UNION_GENERATION_0_5_2.md>)。
- Windows x64、Node≥24、宿主服务和.NET Framework4.x检测助手等条件见[运行要求](<WINDOWS_REQUIREMENTS.md>)；没有写死本机路径，不代表第二台设备已验证。
- 本页下方保留的是0.5.1阶段的普通来源/镜像/WSL0.28实验和常规Union故障事实，**不是当前0.5.3全部行为清单**，没有重新执行所有历史实验。

## 0.5.1阶段已实现的路径（历史）

- 普通 registry 更新使用公开 `pluginManager.updateBundle`，保留精确 npm 安装规格和官方后续 Versions 资格。
- 更新器支持固定 npm 官方源及固定公共镜像 `https://registry.npmmirror.com`。镜像旧／新归档必须与官方同版本归档摘要及运行声明一致；需额外用户确认，绑定来源和已披露宿主计划，不修改 profile 配置。官方原有严格无 fallback 路径仍独立保留。
- 旧普通 Doctor 归档可在无待处理结果、身份与已装字节核验通过后，独立确认**同版本来源迁移**。不接受任意 file/git、自身或 WSL迁移；失败尝试恢复原记录归档，未知不重发。
- 不再仅因普通插件声明 dependencies 就拒绝。支持不变、可解析、无原生／安装生命周期脚本的 JS 依赖集合；对实际安装依赖包版本、边关系与全文件摘要在准备、替换前及替换后核验。只实现严格 semver 子集，不能解析的范围拒绝。
- WSL精确增加已审查 `0.28.0` 及原归档SHA256。已有部署归档、实际安装的全文件、根旧资源、保留代际、exports/patch分别核验，并重建已知原包组合；不接受未知代际。查询与预检不执行包代码。
- 官方插件详情通过公开 `plugins.detail.section` 提供**由更新器提供的独立归档版本检查**和打开更新面板入口。不会改宿主 `update` 字段或伪造内置 Versions。

## 0.5.1阶段实际隔离验证（历史）

均使用已安装 DSH Desktop **0.2.2-rc.5** 的 AppBoot/Cordis/Loader/HMR/PluginManager，自有临时profile/store/cache，禁止模型、用户发行版和真实用户任务；原始结果含本地路径，仅留在忽略目录。

### 普通 npm 与纯 ESM 依赖

- 无依赖正常更新和故意激活失败自动恢复，各自同进程通过；新旧来源保持 npm，官方 Versions查询仍可用。
- 一项纯 ESM依赖、声明不变：新旧实际依赖版本／边关系／文件摘要一致，更新 Host active、代码标记有效、来源 registry。故意目标加载失败由 Host恢复旧版，升级仍为失败。
- 旧 file来源同版本迁移通过，npm来源和官方 Versions资格恢复；一次测试安装拒绝为明确fixture、没有包命令执行，迁移恢复原归档 applied，原代码及身份恢复。不是声称真实npm网络故障。

- 最后冻结核心后复跑上述四组，六项 production源码摘要与当前源码全部一致；各mode自有环境清理，成功／失败不靠重写结果。新旧图与来源的证据只限定这组纯ESMfixture和来源迁移，不扩大为所有社区依赖。

入口脚本（仓库开发材料，不随插件安装）：`experiments/registry-preservation-proof-runner.mjs`、`experiments/migration-deps-proof-runner.mjs`。

### 公共镜像自身交接

复制当前production代码的旧／新fixture、固定镜像／官方逻辑元数据及owned loopback传输映射。Host公共操作和真实包管理／卸载／激活／恢复不替换。好组单次交接到新版本、包／来源／YAML2.9.1／Host核验；坏组故意目标apply抛错，Host恢复旧版，失败保留。缺 `confirmPublicMirror`拒绝。每组保持同PID；旧disposer约1ms且不等待自身替换；临时根清理。

该证明不是已经发布的真实旧 `0.5.0` 含镜像功能，也不是现场公共镜像网络安装。并行编辑造成部分client/service/staging摘要不同，原始结果有productionFilesSha256；不能把未匹配文件算作同一快照已验证。

入口脚本（仓库开发材料，不随插件安装）：`experiments/mirror-self-proof-runner.mjs`。

### 新版 WSL 与历史根资源

- 原public归档 `0.28.0` SHA256：`c137376aba2b3973690ecef93baed9e4de79a22825ab5a50e92ae9ad2881e694`；版本清单、peer键和值、无依赖、客户端声明已审查，新增 `wsl-plugin-update` 是第16个Host条目。
- 冷0.26.2基线15active→0.28.0 16active→恢复0.26.2 15active，同PID。
- 复刻原0.24-root部署形态：准备、更新及恢复保留0.24根和24/26/28各自资源；每次749项文件字节核验。
- 最终实际 production RegistryStager＋HTTP prepare-batch票据＋commit/runBatch 完整路径通过，同PID，旧／新资源及Host逐项核验；另坏新条目衍生fixture触发实际恢复分支，目标失败、恢复applied分开。
- 两次前置fixture准备尝试失败保留，未算通过；最终新cold归档基线通过。首轮故意改bareanchor未触发失败，不将其原因写成已确定Host故障。

- 冻结核心后再次完整复验：同PID28448，116.418秒，service/staging/wsl-policy/generation前后摘要不变并与最终源码一致；缓存优化仅需4次元数据／3次归档fixture读取，仍严格核验。更新16active、回退15active及两次749项检查通过，临时根清理。不是现场网络可用性证明。

入口脚本（仓库开发材料，不随插件安装）：`experiments/wsl-modern-proof-runner.mjs`。传输提供工作区已核验public归档副本，而非现场网络持续可用性；没有真实WSL模型或发行版任务连续性、浏览器交互证明。

## 常规Union npm/HMR故障记录（历史，故障不因新路线而消失）

公开 `0.10.24 → 0.10.25`：

- 新进程冷安装 `0.10.25` applied，Host 1/1 active；包16文件与公开归档一致。
- HMR官方更新：pnpm exit0，但加载 `TypeError: Cannot read properties of undefined (reading 'Element')`；自动恢复旧版也出现同导入错误。
- 前后29依赖包、2289文件、约14.55MB完全一致；这不是发现依赖版本被替换的证据。circular dependency警告与冷热差异支持运行时重载问题，但没有证明私有缓存内部精确根因。
- 无HMR、先冷旧基线：更新正确返回 `restart-required/no-hmr`，磁盘新包／来源／依赖字节一致；旧运行行不是新版代码证据。独立cold新版本证明包可加载。

DSH公开管理器在HMR下拒绝重复安装已知registry包；关闭bundle不解除它，官方更新仍先移除再安装。未发现合法公共原位npm覆盖入口，不用别名、未知tarball、私有cache或底层profile写操作绕过。因此当时0.5.1的HMR配置中Union更新／来源迁移／恢复被具体标为 `dependency-runtime-reload-unverified`，而不是对所有JS依赖一概拒绝。非HMR真实重启路径保留，但不会自动改用户HMR或强制重启。

入口脚本（仓库开发材料，不随插件安装）：`experiments/union-dependency-proof-runner.mjs`。

### 0.5.1对此问题的处理（历史）

当时0.5.1在原版DSH HMR环境中拒绝Union更新、来源迁移和恢复；版本扫描不因拒绝替换而假称没有新版。**拒绝是风险拦截，不是修复。仅安装本更新器无法完整解决该问题。**

此前对Union自身或Node／Electron的独立研究，涉及修改第三方插件或底层运行时，不属于本插件发布功能，也不是原版DSH下的插件验收。本更新器不部署这些补丁、不注入debugger、不强清缓存、不自动重启。需要单独冷启动／重启处理时由用户另行确认和验收；没有保证所有旧版均能热恢复。

## 历史实验保留边界

- WSL保存来源仍为代际本地归档；公开详情扩展解决可发现性与操作衔接，**不等于宿主内置Versions认可registry身份**。关闭或卸载更新器后该扩展不在，未来需宿主来源扩展接口。
- 已装依赖图摘要证明当时已声明dependencies的文件/解析关系，不覆盖完整peer解析身份、不证明全部依赖都来自公共npm或运行模块缓存已换代；root peer声明另行比较，Host再次下载也可能重新解析，所以后验失败不能冒充成功。
- 独立检查与重复状态重验不是原子CAS，外部管理／CLI仍可并发；不保证恢复成功。
- 上述历史开发实验未修改用户profile／安装／缓存，不自动批准脚本或豁免；没有扩展Mac。其当时的UI未验收状态不覆盖用户后来提供的0.5.3中文深色截图和实际WSL升级，其他未验证范围见上方当前状态。
