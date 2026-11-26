# 验证记录与支持边界

## v0.6.14：删除镜像一致性预比对

- 预检查归档本就取自官方 npm；镜像一致性由「装后：实际落盘文件 vs 暂存官方归档」逐字节核验覆盖，因此删除 `stage()` 里的镜像元数据/整包二次比对（每插件少一次整包下载，也消除了 `./bin` 规范化一类误判）。
- 保留：镜像归档的一次精确 CDN 跳转支持、SRI/归档字节核验、装后逐字节核验、失败回滚。
- 回归 **449 项通过**；镜像用例改为断言「预检查只访问官方源」「只允许一次规范 CDN 跳转」「非规范跳转仍拒绝」。
- 限制：不再声称更新前已证明镜像与官方一致，改由装后核验保证。

## v0.6.13：镜像元数据 `./bin` 规范化

- 用户 profile 查询源为 `registry.npmmirror.com`；`dsh-trust-check`、`dsh-cost-meter` 因 `bin` 路径的 `./` 前缀在 npm 元数据里被规范化、tarball 里保留，被判 `mirror-runtime-metadata-mismatch`。
- 修复：镜像一致性比对对 `bin`/`main` 统一去掉前导 `./` 后比较；其余字段与字节/SRI/归档完整性校验不变。
- 真实包复核：`dsh-trust-check@0.2.6`、`dsh-cost-meter@1.9.94` 以镜像来源 `stage()` 通过。
- 回归 **450 项通过**（新增 1 项）。

## v0.6.12：面板显示宿主包依赖

- 行内徽标 `pud-host-dependencies-badge` + 详情 `pud-host-dependencies`，仅在 `packagePreflight.hostDependencies` 非空时渲染；文案明确「更新仍会照常尝试」。
- 回归 **449 项通过**（新增 2 项静态断言：条件渲染、双语语义不含拒绝、不引入确认勾选）。
- 限制：只反映目标包声明的 `@deepseek-ai/*` 依赖；核心行是否真被停用以 DSH 日志与装后核验为准；浏览器渲染未人工验收。

## v0.6.11：20 款实测，宿主包依赖记为警告

- 20 款真实插件：**17 款 `applied`**；3 款在官方安装阶段失败（`dsh-paste-path`、`dsh-session-fork` 为 `incompatible-version`；`dsh-file-bookmark` 把 `@deepseek-ai/dsh-tools@0.1.7-rc.2` 写成普通依赖，pnpm 提到 profile 根部后 DSH 停用了核心 `tools` 行，安装与更新都停在 `pending (waiting for service: tools)`）。
- 新增记录字段：预检查与计划里的 `hostDependencies`（目标声明的 `@deepseek-ai/*` 依赖），只记录、不拒绝，用于解释这类失败。
- 回归 **447 项通过**（新增 1 项：声明宿主包依赖仍放行并被记录）。
- 限制：`incompatible-version` 与核心行被停用属 DSH/包管理器判定；浏览器渲染未验收。

## v0.6.10：PAX / 长名头解析兼容

- 两个 tar 读取器（`readPackedContents`、`archiveEntries`）现在会跳过 PAX / GNU long-name 元数据条目（`x`/`g`/`L`/`K`），不再把它们当文件校验；链接、路径安全、大小与条目数上限不变。
- 触发案例：`dsh-session-superagent` 的归档含 PAX 头，旧版报 `unsafe-or-duplicate-archive-path` / `extended-archive-entry-unsupported`；修复后 2.0.0→2.0.2 `applied`。
- 第三轮 10 款插件：7 款 `applied`、1 款 `restart-required`（`@nanmicoder/dsh-agent-teams`）、2 款宿主判 `bundle-in-use`（`dsh-genui`、`ds-harness-remote`）。
- 回归 445 项通过。

## v0.6.9：只留「能回滚」的前提

- 删除的拒绝：安装期脚本（`preinstall/install/postinstall`）、依赖里的 `git:`/`http:` 来源、依赖里的宿主运行时包（`@deepseek-ai/*`、`electron`、`node-pty` 等）、相对已安装版本**新增**核心行接线（改为 `coreWiring: true` 证据）、声明里的原生依赖（`sharp` 等）。
- 依据：pnpm 默认不执行依赖的构建脚本，DSH 管理器读取 `pendingBuilds` / `allowBuilds`，需用户显式批准；宿主运行时依赖由官方管理器自己的「是否改动其它直接依赖」检查兜底（`unexpected-package`）。
- 保留的前提：公开源 + 精确版本 + 归档字节/SRI、可核验的回滚归档、自身包独立流程、非 profile 管理包。
- 回归 **445 项通过**（串行，含新增的「已安装树含原生文件仍拒」）。原先断言「原生依赖 / 核心接线 / 安装脚本被拒」的用例改为断言「被记录且可继续」。
- 唯一保留的例外（实测得出）：已安装树里已有被宿主加载的原生二进制时仍拒绝。`dsh-meme` 在放开后更新触发 `[ERR_PNPM_EPERM]`（无法重命名被锁的 `@img/sharp-win32-x64`），插件被卸载且回滚写不回，属「回滚救不回来」。
- 已知代价：若新 patch 导致宿主无法启动，回滚代码没有运行机会，只能下次启动后用官方管理器手动处理。
- 限制：面板不再替用户判断风险；浏览器渲染/点击未验收；确认票据由测试代签。

## v0.6.8：按「少拦、装完看事实、坏了回滚」砍掉静态形状门槛

- 删除的形状类拒绝：patch 行名必须属于自己的包、行 id 前缀像核心服务、group 行与嵌套子行、包内相对模块路径、`bundledDependencies`、归档含原生库或 `node_modules`、依赖树含原生文件。这些都改为**记录**。
- 装后「依赖版本范围不符」按用户决定降级为**警告并继续**；装后核验不再因为依赖树不可读/范围去重而判失败，判据只剩「精确版本 + 归档字节 + Host 行 active」。
- patch 解析器现在只做结构校验：id 唯一、路径安全、YAML 合法、大小/深度有界、override 形状受限；核心行只在「相对已安装版本**新增**」时按能力差异拦截。
- 保留的门槛（回滚救不回来）：公开源 + 精确版本 + 归档字节/SRI、可核验的回滚归档、`preinstall/install/postinstall`、`git:`/`http:` 依赖来源、宿主运行时依赖（`@deepseek-ai/*`、`electron`、`node-pty` 等）、新增核心行接线、自身/宿主管理包。
- 纸面审计 24 款真实插件的最新 patch：**23 款解析通过**；仅 `ds-harness-remote` 因依赖含非注册表来源仍被拒绝（安装期会执行代码）。
- 真实重跑：`dsh-mnemon` 0.5.54→0.5.55 与 `dsh-mobile` 0.8.16→0.9.0 现在都能通过检查并进入官方更新，但**官方管理器自己撤销**并以 `unexpected-package` 返回（它会新增/改变另一个直接依赖）；面板如实记失败，旧版本保留。
- `dsh-remote`：打包依赖不再预拒，安装副本的 `node_modules` 子树由包管理器托管、不参与逐字节比对；其余条目仍逐字节核验（实测它在安装后被解析到最新 1.x，面板报 `state-changed` / `no-update`，属安装源解析而非策略拒绝）。
- 回归 **445 项通过**（串行），0 失败。
- 限制：`git:`/`http:` 依赖与安装脚本仍拒绝（执行代码）；官方管理器的撤销无法绕过；浏览器渲染未验收。

## v0.6.7：十款真实插件第二轮实测与四处误伤修复

- 环境同 0.6.6（DSH 0.2.2-rc.5、Electron 44.7.0、Node 24.21.0、Windows x64）：自有临时 `DSH_HOME`/profile/pnpm store；每款插件先用公开 `installBundle('<包>@<旧版本>')` 装入，再走只读检查 → 票据 → 官方 `updateBundle` → 独立核对版本、来源、Host 行与依赖树。
- 覆盖 10 款（分两组各 5 款、各自独立 profile）：`dsh-free-search` 0.9.86→0.9.88、`dsh-whale-widget` 0.4.0→0.4.2、`dsh-agent-compare` 3.2.0→3.3.0、`dsh-m` 0.12.24→0.12.26、`dsh-perm-gate` 5.7.0→5.7.2、`meow-memory` 0.33.1→0.33.3、`@michengai/dsh-archive-manager` 1.4.1→1.5.0、`@michengai/dsh-skills-manager` 1.5.3→1.5.5、`@liustack/modsearch` 5.10.15→5.10.17、`@tencent-connect/dsh-qqbot` 0.5.3→0.5.5。四处修复后全部 `applied`，安装后与更新后 Host 行均 active。
- 修复 A：插入行 id 与核心行 id 改为**精确**比对，`agent-compare` 这类命名行不再被 `agent-*` 前缀误判为接管。
- 修复 B：`prepare` 不再算安装脚本（`dsh-m` 的构建钩子）；只拦 `preinstall`/`install`/`postinstall`。
- 修复 C：`dependencyGraph: null` 在恢复记录校验中不再触发 `TypeError`（`dsh-qqbot` 曾因此整批中断为 `unknown`）。
- 修复 D：部分版本范围按 node-semver 语义判定（`^0.12`、`^1.2`、`~1.2`、`>1.2`、`<=1.2` 等），`qrcode-terminal ^0.12` 不再误报 `dependency-version-range-mismatch`。
- 装后核验失败现在带具体原因（首个字节不符的相对路径，或具体依赖范围错误），不再只有一句 `installed-state-mismatch`。
- 回归 **444 项通过**（串行），0 失败；新增 3 项（命名行、`prepare`、范围语义），修正 2 条按错误语义写死的旧断言。
- 打包：72 个文件，摘要记录在 `artifacts/release-0.6.7/archive-verification.json`（不写进文档以免自引用）。
- 限制：10 款仍是样本，GitHub 直装、私有源、镜像与隔离代际路线不在本轮；`dsh-perm-gate` 自身激活时报 `HMR transactions cannot be nested`（其自身播种逻辑与宿主限制），运行结果未受影响；浏览器渲染/点击/窄屏未验收；确认票据由 runner 代签。

## v0.6.6：真实社区插件实测与三处修复

- 环境：DSH 0.2.2-rc.5、Electron 44.7.0、Node 24.21.0、Windows x64；自有临时 `DSH_HOME`/profile、精确旧版本、真实 AppBoot/Cordis/Loader/HMR/`pluginManager`/`TaskGate`/`RegistryStager` 与原生只读锁探针，没有 mock manager，未触碰用户 profile、WSL、Union 或任务。
- 矩阵（保留 3 次运行）：`dsh-unlag` 1.17.9→1.17.11 与 `dsh-soul-md` 0.12.3→0.12.5、`dsh-trust-check` 0.2.4→0.2.6 均 3/3 `applied`，`dsh-claude-style` 0.22.0→0.22.2 为 2/3；成功项的安装后版本精确、来源仍为 npm 规格、Host 行 1/1 active，依赖树分别 0/0/3/2 包核验。`dsh-free-search` 0.9.86→0.9.88 三次都停在官方交接前的 npm 网络（一次 `ERR_PNPM_META_FETCH_FAIL`，一次批量被打断记为 `unknown/skipped`，一次元数据查询中断），旧版 0.9.86 始终保留且 active，从未显示为成功。
- 附加场景（安装后立即更新）：用公开 `installBundle('<包>@<旧版本>')` 在空 profile 装好再检查更新——`dsh-cost-meter` 1.9.90→1.9.92（依赖 2 包/850 文件）与 `deep-view` 0.1.0→0.1.2 均 `applied`；`dsh-meme` 0.1.84 安装成功但更新被 `native-or-shared-runtime` 拒绝（optional `sharp`），其 `libvips-42.dll` 等被 Host 加载后临时目录删除会卡住，本次由 30 秒上限兜住并记录、进程退出后才删除——原生二进制不宜热替换的实证。
- 附加场景（批量）：同一票据一次更新三件（`dsh-claude-style` 0.22.0→0.22.3、`dsh-soul-md` 0.12.3→0.12.5、`dsh-trust-check` 0.2.4→0.2.6）全部 `applied`，`wait-for-idle`、一次尝试完成，更新后复检全部 `up-to-date`；目标 0.22.3 为当天新发布版本，说明检查用实时版本而非缓存。
- `dsh-unlag` 的旧版 1.17.9 发布本身损坏（Host 冷启动 `SyntaxError: Unexpected token ')'`，`node --check` 在 index.js:3244 复现）；1.17.11 的 index/client 均通过语法检查。这是真实「坏安装升成好安装」的对照，也是本轮策略缺陷的触发点。
- 修复 A：标准通道不再把「已安装版本自己改过核心行」当作永久拒绝；改为比较新旧归档的 override（`id`/`disabled`/`config` 全等，`!!js` 按原文），只有新增或改动核心服务接线才判 `core-service-takeover`。patch 解析新增 override 记录（`inspectPatchEntries`），插入行的保护不变。
- 修复 B：准备阶段的版本查询失败改报 `version-query-failed`，归档下载中断改报 `preflight-network-failed`（`causeKind=network`），不再伪装成「选择已变化」；`networkPreflightError` 沿 `cause` 链识别被包装的传输错误。
- 修复 C：查询源时 `listVersions` 因网络返回 `refused/network` 不再报 `registry-origin-unverified`，同归可重试类别；检查阶段版本查询中断的行在面板标为可重试。
- 回归：441 项通过（串行），0 失败（新增 8 项：override 解析、核心能力比对、三类可重试失败与查询失败可重试行）。
- 打包：72 个文件；自有临时 profile 冒烟通过（Host 激活／Client 资源／原生探针／清理均 true）。摘要记录在 `artifacts/release-0.6.6/archive-verification.json`，不写进文档以免自引用。
- 限制：仅公开 npm 5 款真实插件与这些版本对；浏览器渲染/点击/窄屏/键盘未验收；确认票据由 runner 代签；本轮 npm 侧存在持续连接抖动，3 次运行共 11/15 次成功，未成功项均为网络而非策略。详细证据见[真实社区插件在线更新对照](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/REAL_PLUGIN_UPGRADE_PROOF.md>)。

## v0.6.5：确认弹窗去勾选与检查进度条

- 回归：433 项通过（Node 24 串行），0 失败。
- 确认弹窗：删除公共镜像、公共备用源、完整依赖代际、来源迁移四个勾选框及勾选文案；只保留插件列表、说明、任务处理选项和取消/确认。服务端显式确认未放宽，面板按对应计划自动附带 `confirmPublicMirror` / `confirmUnionGeneration` / `confirmMigration`。
- 进度：Host 端 `scanProgressOf` 记录 `phase/current/done/total`，`GET ?action=scan-progress` 轮询；面板渲染 `progressbar`（阶段、当前插件、完成数/总数、百分比），完成后收起。
- 测试：检查期间读到 preflight/current，完成后 complete 且 done=total；未知 id 400；弹窗无 checkbox；三类计划自动附带确认标志；进度条样式与 aria 语义断言。
- 限制：进度仅覆盖面板自身检查；浏览器视觉/键盘/窄屏仍未真实验收。

## v0.6.4：检查提速与网络失败区分

- 回归：430 项通过（串行），0 失败。
- 复用：`RegistryStager.inspectPackage`／`inspectWslCandidate` 对同一「来源｜包｜版本」的只读检查在 10 分钟内复用已验证的公开归档，重复的「检查全部更新」不再重复下载旧包；复用前仍核对 npm 元数据里的 integrity 是否一致，发布内容变了立即失效。
- Union 公开证明缓存：`UnionGenerationStager` 在同一进程里复用已验证的公开依赖证明，第二次预检查不再重复 26 个请求。
- 并行：旧、新两个公开原包同时检查；扫描内最多两个只读预检查并行。
- 网络失败：`fetch failed／ECONNRESET／超时` 在面板上显示为「更新前检查失败，可重试」并附重试提示，不再显示成「暂不支持在线更新」这类策略拒绝；策略拒绝与网络失败的错误码完全分开。
- 实测：本机 npmmirror 源第二次全量检查从约 50 秒降到约 13 秒；真实 npm 源从约 90 秒降到约 35 秒。

## v0.6.3：失败详情保留与剪贴板兜底

- 回归：426 项通过（串行），0 失败。
- 失败详情：新增独立的 `failures.json`（最多 10 条、每条诊断 16,000 字、文件 ≤192KB），在批次结束时写入终态失败/未知项；不占 `history.json` 的滚动预算，重启后报告仍带消息、步骤、恢复结果与核验状态。写盘失败只置警告，不改变结果。
- 报告：新增 `failures` 字段；客户端复制时把当前面板错误（`client.lastError`）并入报告，准备阶段被拒也能带走错误码和消息。
- 剪贴板兜底：复制失败时报告 JSON 以只读 `<pre>` 展开显示（`pud-report-json`），可选中手动复制，不再出现“请选择可见 JSON”却无可选内容的情况。
- 脱敏与边界：失败详情同样经过脱敏器；单条大于预算时截断并标记；测试覆盖 5 条写满 3 条的上限、重载、路径/凭据脱敏和文件大小。
- 限制：浏览器剪贴板与视觉仍未真实验收；失败详情不含浏览器控制台或宿主内部堆栈。

## v0.6.2：可复制的诊断报告

- 回归：425 项通过（串行），0 失败。
- 报告：`schema: dsh-plugin-update-doctor/report/v1`，包含更新器/DSH/Node/Electron/平台、profile、插件摘要、分类结论与建议、最近操作（阶段、错误码、脱敏诊断、步骤、恢复与装后核验）、重启交接和安装器日志摘录。
- 脱敏：fixture 注入 profile 路径与 `password=hidden` 的失败记录后，报告保留错误码与消息，但不含原路径或凭据；HTTP `GET ?action=report` 返回同一结构，非法插件名 400。
- 边界：最多 6 个操作、每项 60 步、诊断 8,000 字、安装器日志 24,000 字、整份 ≤200KB；超长输入带 `<report-truncated>` 标记。
- UI：工具栏「复制诊断报告」、失败行「复制错误报告」、详情页同名按钮由渲染树测试覆盖。浏览器剪贴板与视觉仍未真实验收。
- 限制：历史压缩后旧记录可能只剩错误码（报告标 `truncated`）；报告不含浏览器控制台或宿主内部完整堆栈。

## v0.6.1：隔离代际的依赖闭包下载

- 回归：421 项通过（串行），0 失败。
- 设计：先复用**已核验的安装闭包**，只解析新声明满足不了的范围；缺失包从公开 npm 下载，按 npm 的 owner/嵌套语义放置，不同大版本并列而不是判冲突。下载前只读 admission 为 `download-required`（含闭包摘要与包数），准备阶段才下载并逐个校验发布 SRI，计划与执行用同一摘要绑定。
- 代际：合并后的目录重新做完整快照；代际 schema 2 的依赖证据逐包绑定公开证明；`_read` 改为逐源核对 `contractDigest`（新记录逐源保存，旧记录继续兼容共享摘要），并保留完整 inventory 校验。
- 篡改：准备阶段提供被篡改的依赖归档时返回 `dependency-closure-integrity`，profile 仍是旧版本，不产生 stage 或安装动作。
- 自有 Host 证明（`artifacts/union-closure-0.6.0/host-result.json`，判定 `closure-download-and-recovery-verified`）：真实 npm Union `0.11.0` 为基线；候选 `0.11.1` 是同一公开原包加版本号与一个真实依赖声明（`is-number@^7.0.0`，npm 无此发行版）。scan 为 `download-required`、闭包 1 个包；篡改准备被拒且 profile 未变；注入一次目标安装拒绝后，旧代际恢复 applied、恢复代际运行命名空间 verified；再次准备并提交 updated，package/source/host/runtime 全部 verified，1/1 行 active，新代际里真实的 `advance_fetch` 字段提取与 markdown 均通过。
- 限制：候选清单是合成的（不是已发布版本）；依赖自身声明安装脚本、原生约束或可选依赖时仍拒绝（真实 cheerio 闭包里存在这类包，因此设计上优先复用已安装副本而不是重新解析整棵树）；解析深度 ≤5、仅稳定版、最多 64 个新包。

## v0.6.0：标准通道只要求公开源＋目标字节＋回滚归档

- 回归：417 项通过（串行），0 失败。
- 标准通道：普通更新不再预拒绝 peer 图、依赖声明或预设差异。预检只核验公开源、目标归档字节（SRI＋SHA256）和旧版本归档；准备与替换前重验；装后按新清单核验实际解析树（容错记录无法解析的浏览器内置／平台可选依赖）、拒绝原生字节与非法来源，并核验 Host 行。不通过即回滚已暂存原版本。
- 删除的“审查”闸门：`peer-graph-change`、`dependency-graph-changed`（声明变化）、Better Sidebar `0.32.1 → 0.33.0` 固定原包对、WSL 结构摘要 `e820e82c…` 与 `!!js` 表达式审查、WSL 现代行集合 `MODERN_ROWS`、Union 宿主声明摘要一致要求与 `0.10.24 → 0.10.25` 特例。
- 保留的拒绝：核心服务接管、安装脚本、原生／共享运行时依赖、宿主运行时依赖、自更新隔离、管理包与只读包、非法 / 私有来源、`.node` 等原生字节。
- 声明式 `!!js`：普通插件 patch 以自定义 YAML 标签解析为惰性数据（不执行），行 id/name 仍做受保护与同包校验；隔离代际路线仍只接受静态单行声明。
- 真实原包只读复核：`dsh-better-sidebar` `0.32.1`（SHA256 `cd0a88c0…`，32 个声明依赖）与 `0.33.0`（`90d003cf…`，2 个依赖）均通过通用路径 `RegistryStager.inspectPackage`，行集合仍为 `better-sidebar`；不再依赖版本对登记。`dsh-plugin-wsl-env` `0.29.1` 真实原包通过新 `inspectWslCandidate`，结构摘要仍为 `e820e82c…`。
- 真实 profile 只读复算：本机已装 4 个 bundle 的容错依赖树核验全部通过——sidebar 0.33.0（2 包 / 252 文件）、doctor 0.5.11（1 / 233）、WSL 0.29.1（0 / 0）、Union 0.11.0（29 / 2289），无未解析项，声明无拒绝原因。
- 后续：闭包下载与自有 Host 证明已在 0.6.1 接入（见上）；仍缺完整发布到 npm 的版本级端到端证明、浏览器视觉／键盘／窄屏与第二台设备验收。
- 说明：历史 0.5.9／0.5.11 条目里关于声明审查与固定版本对的描述只代表当时的版本。

## v0.5.11：隔离路线接受“闭包已满足”的依赖范围变化

- 回归：412 项通过（串行）。
- 判定：`requireIsolatedTransition` 不再要求依赖声明逐字节相等；范围变化时逐个核对已安装副本版本是否满足新范围（`unionRangeMatches`）。满足 → 继续用现有闭包；不满足或出现新依赖 → `dependency-closure-requires-download`。
- 依据：代际里放的是**已核验的已安装副本**，只要它们满足新根声明，语义上仍然正确；真正需要下载新依赖的情况仍拒绝，等闭包下载器。
- 未做：从 npm 下载新依赖并组装新闭包（这是这条路线剩余的另一半）。

## v0.5.10：停止任务不再要求第二次勾选

- 回归：411 项通过（串行）。
- 交互：确认弹窗中「停止当前智能体任务后更新」选项自身即为同意，主按钮写作「确认停止任务并更新」；不再额外渲染停止同意勾选框。
- 协议：客户端选择停止时向宿主发送 `confirmCancel: true`，服务端 `commitBatch` 仍要求它在 `cancel-active` 下为真，未放宽校验。
- 真实结果：本机 profile 已通过 0.5.9 路线把 WSL 从 0.29.0 更新到 0.29.1，记录为 `updated`、包核验 verified、宿主 16/16 active。

## v0.5.9：WSL 声明审查拆层

- 回归：411 项通过（串行）。
- 结构层钉死：插入行 id/名称集合与核心覆盖项（含顺序无关）摘要 `e820e82c…`；改动即 `wsl-structure-changed`。
- 表达式层：`!!js` 表达式按 sha256 审查，已登记 `75439e47…`（`!ctx.get('profileContext')`）与 `1850a687…`（预设技能目录）；出现未登记表达式即 `wsl-declaration-review-required`，并把摘要带进面板。
- 内容层：配置数据变化放行，面板用与 0.29.0 基线的差异（changed/added/removed 项 id）说明本次改了什么。
- 模块来源：预设内只允许 `dsh-plugin-wsl-env`、`@deepseek-ai/*`、`cordis:*`，其余 `wsl-foreign-preset-module`。
- 实测对照：0.29.0 与 0.29.1 结构摘要一致；0.29.1 新增的 `tool-office` 属官方包、布尔值属数据，唯一新增表达式已审查 → 0.29.1 进入可更新状态。
- 未验证：真实 profile 上完成 0.29.1 更新；浏览器渲染。

## v0.5.8：重启式更新交接与渲染树检查

- 回归：411 项通过（串行）。
- 自有 Host 三段式证明（`artifacts/restart-handoff/`）：prepare 安装 0.10.25 → update 在管理器边界注入真实删除后的 `restart-required` → 目标 0.11.0 写盘并记录待核验（`success-update-result.json`）→ 新进程核验字节、宿主条目与精确运行命名空间，判定 applied（`success-resume-result.json`）。
- 回滚证明：同一流程中破坏目标入口文件，新进程核验失败 → 回滚 0.10.25、字节核验通过（`rollback-resume-result.json`）。
- 未复现：干净自有 profile 中同一更新就地 applied（`update-result.json`，verdict `not-reproduced`），说明真实 profile 的 `unmanaged-plugin` 触发条件仍未确定。
- 渲染树：`tests/ui-render.test.mjs` 执行真实面板函数，断言主流程只含列表/进度/结果/诊断入口、诊断默认折叠、行内短状态先于证据、重启提示。仍非浏览器、CSS、窄屏或键盘验收。

## v0.5.7：不可热卸载回滚与面板简化

- 回归：400 项通过（串行 `--test-concurrency=1`）。
- 回滚：官方删除返回 `restart-required` + `changed: true` 时，路线只出现 `remove → install(旧归档)`，目标代际从未安装，安装字节核验通过；字节核验失败或回执缺失保持 `unknown`，不声明恢复。
- 面板：主流程不再直接陈列证据区块，行内先给一句短状态，确认弹窗不再有通用勾选；三类特殊确认（来源改变、公共镜像、派生代际）与停止任务确认保留。以上为结构断言。
- 未验证：真实 profile 中同一次“删除后回滚”的实跑；面板简化后的浏览器视觉与键盘操作。

## v0.5.6：依赖隔离结构化准入与官方常规更新对照

- 先在原版 DSH Desktop 0.2.2-rc.5 的隔离配置中直接使用**官方常规更新**（未装本更新器）：版本列表提供 `0.11.0`、包命令退出 0，但同进程加载报 `TypeError: Cannot read properties of undefined (reading 'Element')`；官方自动恢复旧版也以同一导入错误失败。两版 `lib/index.js` SHA256 相同，说明问题不在根包字节或版本兼容声明。**全新进程首次安装 `0.11.0` 时官方 applied、1/1 active 且 `advance_fetch` 功能通过**，把可观察范围收窄到同进程替换。原始记录见本地产物 `artifacts/union-stock-update-0110/`，不随安装包发布。
- 同一隔离环境改用生产 `DoctorService`／`UnionGenerationStager`／参照真实 Loader 的命名空间校验器：`0.10.25 → 0.11.0` 的结构化预检与更新通过，官方 applied、安装字节一致、Host 1/1 active，且 Loader 实际运行新代际模块；本地回环 HTML 上的 `advance_fetch` 字段提取与 Markdown 通过。随后注入一次目标安装拒绝：目标记为失败，旧代恢复 applied 并通过字节与实际运行核验。两轮都没有版本白名单参与。
- 实验中使用了公开 npm 原包、真实包命令与真实官方管理器；两版根包与每个依赖副本均与公开归档比对。注入拒绝发生在管理器边界，不是公开缺陷；依赖闭包证据来自自有隔离配置，**不是用户实际安装、真实搜索引擎、浏览器渲染或第二台设备验收**。
- 回归覆盖：结构化路线选择（后续正式版无需新增名单、降级/预发布拒绝）、宿主声明变化与依赖声明变化拒绝、动态声明拒绝、不相关包拒绝、代际参考记录防伪、旧 schema 读取、完成条件必须包含实际运行命名空间。未修改真实 profile、宿主内核或全局源。

## v0.5.5：普通插件预检与 Better Sidebar

- 两个公开 Better Sidebar 原包均通过真实 npmmirror 的只读预检及官方 npm 逐字节摘要比对。`0.32.1` SHA256 `cd0a88c0da237622a83d465ed824f17c39c74e7edf2609c14cf21c813d70c517`；`0.33.0` SHA256 `90d003cfc2c411295faef5ae7e3b1585c1473bbd059887b16308f364a96ab5d6`。
- 原版 DSH Desktop 0.2.2-rc.5 使用自有临时 profile：侧边栏从 npm 规格 `0.32.1 → 0.33.0`，正式更新流程验证文件、保留的 Host 依赖、npm 来源及 1/1 active 行；官方版本检查仍可用。另一轮在目标安装入口故意返回拒绝，真实官方流程恢复 `0.32.1`，不把恢复写成更新成功。每次仅一次交接。
- 隔离实验使用实际公开侧边栏包、生产预检与 HTTP 处理代码、原版管理器和真实包命令；根包安装传输走自有 loopback 适配器，预检镜像跳转是夹具。故意拒绝不是新版加载故障。没有真实用户点击、浏览器渲染、在途模型任务或两台设备验收；真实镜像只读验证不是镜像安装全过程证明。
- 回归覆盖精确单跳及跨域／二跳拒绝、SRI／官方摘要、版本发现与预检失败分开、同源确认、选定包复查、任意依赖变化拒绝，以及侧边栏固定原包与依赖变化、原生加速包拒绝。未修改真实 profile、宿主内核或全局源。

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
