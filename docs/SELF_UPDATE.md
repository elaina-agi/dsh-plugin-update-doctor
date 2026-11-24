# 更新器自身升级：宿主交接设计

## 操作体验

在本面板检查更新，**单独勾选更新器**，点击更新并确认。外观沿用普通更新的等待／额外停止任务选项，但自身升级采用专门的 `host-self-update` 计划，不能与普通批次混合。

旧版本没有这个入口；第一次升级到含 npm 自更新的 v0.4.0，或含 GitHub 自更新的 v0.5.0，仍需官方插件管理器安装。尤其真实 v0.4.1 GitHub 安装不能直接用旧面板升到 v0.5.0。之后只有符合下述来源与依赖条件的安装，才可使用面板自身升级。

旧更新器只负责来源与包预检、用户确认、交接前任务协调。获准后一次调用公开 `pluginManager.updateBundle`；其后的移除、安装和宿主自动恢复由独立的官方管理器实现执行。旧插件的 disposer 不等待或取消这次 Host 安装，因此不会把自己卸载所需的 HMR 队列锁住。

这不是向根 Context 挂一个脱离插件的工作器，也不访问私有模块缓存、手改 profile 或启动外部更新程序。

## 与普通批次不同的保障

- 默认等待已有 Agent 驱动结束；停止当前活动仍需单独明确同意，并绑定确认时的 Agent 活动代次。
- **旧更新器卸载时释放自己的门禁。** 本路径不承诺在整个宿主替换期间继续暂缓新步骤。若要同等全程 admission，需要宿主提供独立的公共门禁接口。
- 自身更新使用官方 registry 或固定 Git来源的更新／恢复流程。预下载仅用于预检；Host 按 spec重新安装，不接受精确归档参数，因此不是归档替换事务或字节 CAS。官方各次移除／安装分别持锁，不是整个交接的一把事务锁。
- npm原版本必须仍可获取；Git原完整提交及仓库必须仍能下载。预检恢复能力不保证日后断网、提交删除或依赖源错误时恢复成功。
- 官方失败后的恢复与新目标结果分开记录。恢复成功不等于升级成功；新的包字节、Host 行和页面同步分别检查。

## 窄准入

仅支持 enabled/active、可移除的 profile **registry** 安装，或 v0.5.0新增的固定公开 GitHub仓库完整提交安装。file、link及内置／管理关键目标不迁移；不修改其它普通 Git插件的准入。

仅准已检查的自身 bundle 和客户端声明：单个自身 patch 行、固定 exports、Host peers和 engines不变。目标只允许固定 `yaml: 2.9.1`，当前实际 YAML也必须为2.9.1；不接受依赖图、未知生命周期脚本、新原生模块或宿主接管变化。只读原生助手固定到已审查 SHA256，普通插件的保护策略不因此放宽。

v0.5.4修复官方 npm 首选、固定公共镜像备用源被旧无fallback规则拦截的问题。原纯官方、无fallback路径保留；官方查询且原有primary/resolved/fallback仅包含 `https://registry.npmjs.org` / `https://registry.npmmirror.com` 时，作为 `public-fallback` 单独准入。镜像查询仍为 `public-mirror`。两者均完整绑定Host计划、反复核验并额外要求 `confirmPublicMirror`；不更改用户全局源，不安装临时配置助手。可能使用的镜像旧／新归档与官方同版本比较，不因镜像不一致而放行。缺包或不可核验仍拒绝；当前查询无新版只针对当前源，不静默迁移来源。Git路径使用独立规则，GitHub限流优化不在本轮内。

v0.5.1 开发修复将来源内版本发现与自身升级资格分开。无较新版本仍可明确显示来源条件不满足；`registry: null` 按公开 `manager.registries().resolved` 的查询前后稳定快照解释，未知／变化来源保持不准入，不从最后一次配置推断此前的来源。完整字节预检前后绑定与重验确认的来源计划，handoff记录写入后、dispatch前再次核验；原纯官方确认后新增备用源也拒绝，不能自动升级为已确认fallback。准备、停止任务前和等待后拒绝不完整版本候选。原schema1与镜像schema2保持可读；`public-fallback` 使用schema3绑定公开源计划与额外同意，旧schema拒绝冒充该路线，不覆写receipt。检查不是原子配置锁或CAS，不能排除外部ABA。

npmmirror真实归档会302到CDN：仅允许registry精确包URL单跳到 `https://cdn.npmmirror.com/packages/dsh-plugin-update-doctor/<version>/dsh-plugin-update-doctor-<version>.tgz`，手动核对完整Location，禁止凭据、query/hash、异域、路径变体或第二跳，下载后核验SRI／原包声明并与官方摘要对照。元数据仍禁止重定向。2026-11-24真实公共0.5.3镜像48文件归档只读比对通过，非安装／fallback执行证明。

等待前和临近交接时重新核验目标资格、安装源、当前包状态、依赖及新旧归档。票据短时、一次性；任意包名／命令／路径输入不被接受。诊断工具只提供无票据计划，不能确认或执行。

## v0.5.0 固定 GitHub路径

- 仓库固定 `elaina-agi/dsh-plugin-update-doctor`，当前安装必须固定小写40位提交且由宿主标为 `update: git`。允许宿主保存的同仓库HTTPS／SSH等价写法；拒绝其它仓库、私有源、凭据URL、子目录、tag／branch迁移。
- 仅在明确检查或已确认操作重验时访问固定 GitHub API与raw域名。main HEAD的包必须是更高稳定版本；**不是 Release或签名发布渠道**。不扫描历史commit寻找版本，不自动定时检查，不提供同版本不同提交升级。
- 新旧完整提交对应tree结构重新构造并核验Git SHA1；实际raw blob与Git blob SHA1对应，运行文件另存SHA256。HTTPS固定公共源是信任边界；Git SHA1不是签名或供应链审计。
- 只读取正向打包清单内有界文件。拒绝链接／submodule、路径别名、嵌套包、可影响安装的控制文件和生命周期脚本；现有固定锁文件、`.gitattributes`和`.gitignore`经核验并要求新旧保持不变。代码不在预检中执行。
- 确认框展示完整新旧提交；票据绑定版本、来源、文件及提交。确认后、停止任务前和等待后再次发现HEAD并核验固定目标；移动到同版本新提交也需重新确认。
- 交接调用一次公开 `updateBundle(name, version, { spec: fixedCommitSpec, requestId })`，不直接安装覆盖自身，也不启动外部更新工作器。宿主保存新固定提交并在失败时尝试恢复捕获的旧来源；该恢复没有目标expected校验，因此本插件另核验旧文件／来源／Host。
- **依赖源沿用宿主现有配置**，不给Git交接传registry覆盖，不修改fallback、不自动批准脚本。固定YAML和锁文件是静态准入，不保证宿主下载的依赖字节等同预检，也不宣称Git路径具备npm public-only保证。
- 缺最终结果仍未知；新实例必须同时核验实际版本、文件、固定来源和active Host才标为已验证应用。需要重启也如实显示，不自动重启。

镜像schema2与公共fallback schema3 attempt绑定所选registry、净化Host计划和额外同意；原official/Git schema1保持可读且不覆写，缺字段保持未知。Host重新下载并可能使用已确认公共fallback，预检并非精确归档事务；实际来源字段只证明npm管理身份，不是网络传输字节证明。实际隔离验证与剩余边界见[Windows支持](<WINDOWS_SUPPORT.md>)。

## 跨代结果

自有缓存的 `self-updates/<attempt-id>`保存不可覆盖的 attempt/handoff/result文件。结果是有界、白名单脱敏的官方结果；不记录用户会话或配置，不复用可能跨模块代际写冲突的普通历史快照。

启动写入使用自有排他锁，已有 pending／unknown记录阻止再次交接；不会强清锁。新实例只读旧记录，不把中断写成成功。旧调用唯一的后续工作是落盘官方已观察结果；即使面板离开，宿主管理流程不因浏览器请求取消而自动终止。

读不到最终记录、跨进程 pending、超时或写入失败均保留 unknown。不会自动重发更新。若宿主恢复也失败或更新器不能加载，需在官方管理器核对当前安装状态处理。

## 验证边界

本轮运行时为 DSH Desktop **0.2.2-rc.5 / Windows x64**；早期0.2.2-rc.3实验是历史证据。真实实验使用自有临时 profile和生成包，原包配置读取与包管理／生命周期执行是真实实现，但 registry transport与 HTTP panel身份为显式 fixture。没有真实浏览器控制、模型任务或用户 profile变更。

详见 [验证说明](<VERIFICATION.md>)和[隔离实验](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/SELF_UPDATE_PROOF.md>)。新旧客户端实际DOM、视觉和当前页面HMR仍需用户在真实DSH页面验收。
