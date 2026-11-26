# 真实社区插件在线更新对照（2026-11-26）

## 结论

在自有临时环境里挑 5 款**真实发布版本**的社区插件，先安装旧版，再让面板的普通更新通道（标准通道）升级：

| 插件 | 版本 | 保留的 3 次运行 |
| --- | --- | --- |
| `dsh-unlag` | 1.17.9 → 1.17.11 | 3/3 成功（旧版发布本身损坏，更新把它修好） |
| `dsh-claude-style` | 0.22.0 → 0.22.2 | 2/3 成功 |
| `dsh-soul-md` | 0.12.3 → 0.12.5 | 3/3 成功（依赖树 3 包 / 40 文件核验） |
| `dsh-trust-check` | 0.2.4 → 0.2.6 | 3/3 成功（依赖树 2 包 / 43 文件核验） |
| `dsh-free-search` | 0.9.86 → 0.9.88 | 0/3：全部卡在 npm 侧网络 |

未成功的 4 次里，失败原因都是**外部网络**（`ERR_PNPM_META_FETCH_FAIL … fetch failed`、元数据查询中断），不是策略拒绝：旧版本始终保留在磁盘且 Host 行为 active，面板从未把它显示成成功。

这一轮同时暴露并修掉了三个真实缺陷（0.6.6），其中第一个属于「正常插件永远不能在面板里更新」的整类问题。

## 环境与方法

- 当前安装的 DSH **0.2.2-rc.5**、Electron **44.7.0**、Node **24.21.0**、Windows x64。
- 每条路径都在新的 Electron 子进程与新临时 `DSH_HOME` 中运行；profile 依赖锁定到**精确旧版本**（如 `dsh-unlag@1.17.9`），从公开 npm 安装。
- 使用真实 AppBoot、Cordis、Loader、HMR、官方 `pluginManager`（含 `updateBundle`）、真实 `TaskGate`、`RegistryStager` 与本机原生只读锁探针；服务由**与已安装插件相同的 `lib/service.js`** 实例化，没有 mock manager。
- 每个插件的流程就是面板的流程：`scan`（只读预检查，含新旧归档字节核验）→ `prepareBatch`（票据）→ `commit(ticket)` → 轮询操作结果 → 用官方 `listBundles` / `listPlugins` 独立核对版本、来源与 Host 行。
- pnpm store/cache 置于同一自有临时根并核验；不启动替代 GUI，不触碰用户 profile、WSL、Union 或任何任务。

## 实测明细

| 检查 | unlag | claude-style | soul-md | trust-check | free-search |
| --- | --- | --- | --- | --- | --- |
| 只读预检查通过 | 通过 | 通过 | 通过 | 通过 | 通过 |
| 计划模式 | `registry-spec` | `registry-spec` | `registry-spec` | `registry-spec` | `registry-spec` |
| 安装后版本精确 | 1.17.11 | 0.22.2 | 0.12.5 | 0.2.6 | — |
| 来源仍为 npm 规格 | 是 | 是 | 是 | 是 | 是（旧版） |
| Host 行 active | 1/1 | 1/1 | 1/1 | 1/1 | 1/1（旧版） |
| 依赖树核验 | 0 包 | 0 包 | 3 包 | 2 包 | — |

`dsh-unlag` 值得单独说明：它的旧版 1.17.9 发布本身是坏的，Host 冷启动即报

```text
dsh-unlag (dsh-unlag): failed to import: SyntaxError: Unexpected token ')'
```

`node --check package/index.js` 也能在 3244 行复现同样的语法错误；1.17.11 的 `index.js` / `client.js` 均通过语法检查。这是一次**把坏安装升成好安装**的真实案例，而旧实现恰好在这种插件上永久拒绝更新。

`dsh-free-search` 的失败形态有两种，都发生在官方交接阶段：

- `failed`：`ERR_PNPM_META_FETCH_FAIL  GET https://registry.npmjs.org/dsh-free-search: fetch failed`；
- `unknown`：批量在后续只读复核时被网络中断打断，条目记为 `skipped`，整体结果不判成功。

两种情况下磁盘上都是 0.9.86、来源仍是 `dsh-free-search@0.9.86`、Host 行 active。第三轮里 `dsh-claude-style` 也遇到同样的元数据中断（`registry-origin-unverified`），这正是下面第 3 个缺陷的触发点。

## 本轮发现并修复的缺陷（0.6.6）

### 1. patch 里带 override 的插件永远不能在面板更新

`dsh-unlag` 的 bundle patch 除插入自己那一行外，还改写核心 `hmr` 行：

```yaml
- id: hmr
  disabled: false
  config:
    base: !!js 'process.getBuiltinModule("node:url").pathToFileURL(process.cwd()).href'
    root: []
```

旧实现两处都挡：

1. `onlineSafety` 只要发现**已安装**版本带核心行 override，就直接判 `core-service-takeover`；
2. 标准通道的 patch 解析只接受纯 `insert`，遇到 override 条目整包拒绝（`existing-row-override-unsupported`）。

结果是「官方能装、官方能更新，我们的面板永远说不行」，且与具体版本无关。

现在改成**能力比对**：只有「新版本相对已安装版本**新增或改动**核心服务接线」才判 `core-service-takeover`；新旧一致（`id`、`disabled`、`config` 全等，`config` 里 `!!js` 按原文比对）照常走标准通道。插件自己的行与其它非核心行不经过这道门。装后核验与自动回滚不变。

### 2. 网络抖动被报成「你的选择变了」

准备阶段若版本查询或归档下载中断，旧代码抛 `version-not-admitted`（「选择已变化或不是最新版本」）或裸 `TypeError: terminated`。现在：

- 版本查询失败 → `version-query-failed`，带 `preflight.causeKind=network`；
- 归档下载中断 → `preflight-network-failed`，`phase: archive`；
- 检查阶段的版本查询中断 → 该行标为可重试，而不是策略拒绝。

`networkPreflightError` 也改为沿 `cause` 链识别：下载错误会被包装成策略文案，旧实现只看最外层消息，所以漏判。

### 3. 元数据中断被说成「来源未经验证」

`sourceFor` 在查询源时如果 `listVersions` 因网络返回 `refused/network`，旧代码报 `registry-origin-unverified`（「已安装的查询源必须是已批准的公开 npm」），把网络故障说成了来源问题。现在同样归入可重试的 `version-query-failed` / `preflight-network-failed`。

## 附加场景一：先安装，再立刻更新

用面板同样的公开操作（`pluginManager.installBundle('<包>@<精确旧版本>')`）在空 profile 里装好，再马上跑只读检查与更新：

| 插件 | 安装 | 安装后检查 | 更新 |
| --- | --- | --- | --- |
| `dsh-cost-meter` | 1.9.90 `applied`，行 active | 可更新 | **1.9.92 `applied`**（依赖树 2 包 / 850 文件核验） |
| `deep-view` | 0.1.0 `applied`，行 active | 可更新 | **0.1.2 `applied`** |
| `dsh-meme` | 0.1.84 `applied`，行 active | **拒绝**：`native-or-shared-runtime` | 未执行 |

`dsh-meme` 的拒绝不是误判：它把 `sharp` 声明为 `optionalDependencies`，安装后 `@img/sharp-win32-x64` 的三个原生库（含 `libvips-42.dll`）会被 Host 进程加载。本次测试的收尾阶段实测到：只要这些 DLL 还被进程映射，删除临时目录就会失败/卡住（清理被 30 秒上限兜住并记录，进程退出后才删掉）。原生二进制无法在运行中的宿主里安全替换，正是这条拒绝存在的理由——它可以由官方管理器安装，但不能由在线更新器热替换。

## 附加场景二：一次确认，批量三件

同一张票据里同时更新三个插件，默认「等待任务结束」：

| 插件 | 版本 | 结果 |
| --- | --- | --- |
| `dsh-claude-style` | 0.22.0 → **0.22.3** | `applied`，行 1/1 active |
| `dsh-soul-md` | 0.12.3 → 0.12.5 | `applied`，依赖 3 包 / 40 文件 |
| `dsh-trust-check` | 0.2.4 → 0.2.6 | `applied`，依赖 2 包 / 43 文件 |

批量结果 `outcome: applied`，`taskPolicy: wait-for-idle`，一次尝试即完成；更新后再次检查全部为 `up-to-date`，三行都 active。`dsh-claude-style` 的目标版本在这次运行里是 **0.22.3**（当天发布的新版本），说明检查用的是实时发布版本，而不是缓存。

两个附加场景的原始结果分别在 `artifacts/real-plugin-install-update/evidence.json` 与 `artifacts/real-plugin-batch/evidence.json`。

## 第三轮：10 款插件（0.6.7）

第二轮按「先装旧版 → 面板检查 → 更新」跑了 10 款，分两组、各自独立临时 profile：

| 插件 | 版本 | 结果 |
| --- | --- | --- |
| `dsh-free-search` | 0.9.86 → 0.9.88 | 成功（上一轮三次都卡在网络，这次通了） |
| `dsh-whale-widget` | 0.4.0 → 0.4.2 | 成功 |
| `dsh-agent-compare` | 3.2.0 → 3.3.0 | 先被 `protected-or-duplicate-row` 误拒，修复后成功 |
| `dsh-m` | 0.12.24 → 0.12.26 | 先被 `package-install-scripts-require-separate-review` 误拒，修复后成功 |
| `dsh-perm-gate` | 5.7.0 → 5.7.2 | 成功 |
| `meow-memory` | 0.33.1 → 0.33.3 | 成功 |
| `@michengai/dsh-archive-manager` | 1.4.1 → 1.5.0 | 成功 |
| `@michengai/dsh-skills-manager` | 1.5.3 → 1.5.5 | 成功（依赖 1 包 / 17 文件） |
| `@liustack/modsearch` | 5.10.15 → 5.10.17 | 成功（依赖 2 包 / 224 文件） |
| `@tencent-connect/dsh-qqbot` | 0.5.3 → 0.5.5 | 先崩于 `null.digest`、后误报 `dependency-version-range-mismatch`，两处修复后成功（依赖 34 包 / 611 文件） |

四处修复：

1. 插入行 id 与核心行 id 精确比对（原来是前缀匹配，`agent-compare` 被当成 `agent` 服务的接管）。
2. `prepare` 不再算安装脚本：npm/pnpm 对注册表 tarball 只执行 `preinstall`/`install`/`postinstall`。
3. 恢复记录校验接受 `dependencyGraph: null`（依赖树不可检查时的正常值），不再抛 `TypeError` 中断整批。
4. 部分版本范围按 node-semver 判定：`^0.12`、`^1.2`、`~1.2`、`>1.2`、`<=1.2` 等不再被误判为依赖版本不符。

`dsh-perm-gate` 在自身激活日志里报 `HMR transactions cannot be nested`（它往 settings 播种时与宿主限制冲突），安装与升级流程未受影响，属插件自身行为。

原始结果：`artifacts/real-plugin-install-update/evidence-a.json`、`evidence-b.json`、`evidence-qqbot.json`。

## 第四轮：再 10 款（0.6.9 / 0.6.10）

0.6.9 放开静态门槛后，又选了 10 款没测过的插件，同样先装旧版再升级：

| 插件 | 版本 | 结果 |
| --- | --- | --- |
| `dsh-session-superagent` | 2.0.0 → 2.0.2 | 先被 PAX 头挡住（`extended-archive-entry-unsupported`），0.6.10 修复后 `applied` |
| `@nanmicoder/dsh-agent-teams` | 0.1.29 → 0.1.31 | `restart-required`：已装成 0.1.31，Host 行需重启后 active（首次安装在 `expected` 校验上被判 `operation-error`） |
| `dsh-genui` | 0.3.2 → 0.3.4 | `bundle-in-use`：官方管理器判定插件正在使用中，拒绝在运行中移除 |
| `ds-harness-remote` | 0.6.6 → 0.6.8 | `bundle-in-use`（它会拉起 ACP/远程服务子进程，占用包文件） |
| `ds-bot` | 0.3.8 → 0.3.10 | `applied`；依赖图超出检查上限，记 `dependency-graph-limit` 警告后继续 |
| `dsh-bili-scroll` | 2.5.1 → 2.5.3 | `applied` |
| `@suifei/dsh-ai-team` | 0.4.142 → 0.4.144 | `applied` |
| `dsh-mcp-connector` | 0.2.119 → 0.2.121 | `applied` |
| `dsh-connect-workbuddy` | 5.31.6 → 5.31.8 | `applied` |
| `dsh-plugin-wallpaper-engine` | 1.4.1 → 1.4.3 | `applied`（10 个依赖，含 `x11`/`webwallgl`） |

两种非 `applied` 的结果都不再是我们的门：

- `restart-required` 是官方管理器给出的正常结果，意思是「文件已换好，下次启动才生效」；
- `bundle-in-use` 是官方管理器拒绝在插件运行中移除它，需要在面板里先停用、或重启后再更新。

原始结果：`artifacts/real-plugin-install-update/evidence-ten-a.json`、`evidence-ten-b.json`、`evidence-superagent.json`。

## 第五轮：再用 10 款（0.6.10）

0.6.10 的代码与打包件逐文件核验一致（35 个 JS 文件 SHA256 全同），本轮直接测这份代码。

| 插件 | 版本 | 结果 |
| --- | --- | --- |
| `dsh-plugin-smooth-stream` | 1.6.5 → 1.6.7 | `applied` |
| `dsh-plugin-message-history` | 1.0.4 → 1.0.6 | `applied` |
| `dsh-shell-progress` | 0.8.1 → 0.9.1 | `applied`（3 个依赖） |
| `dsh-mermaid-panel` | 0.1.4 → 0.1.6 | `applied` |
| `dsh-message-rewind` | 1.3.2 → 1.4.1 | `applied` |
| `dsh-inline-branches` | 1.0.2 → 1.0.4 | `applied` |
| `dsh-everything` | 1.3.1 → 1.4.1 | `applied` |
| `dsh-thinking-lang` | 1.0.7 → 1.0.9 | `applied`（首轮安装遇到一次瞬时失败，单独复跑安装并更新成功） |
| `dsh-session-fork` | 0.2.0 | 装不上：官方判 `incompatible-version`——它声明的 peer 依赖是 DSH `0.1.0-rc.7` 系列（`dsh-llm`/`dsh-compaction`/`dsh-token-meter`/`dsh-agent-presets`/`dsh-session-title`/`dsh-storage-domain`），与当前 0.2.2 不匹配 |
| `dsh-agent-toolkit` | 0.4.14 | 装不上：pnpm `[ERR_PNPM_IGNORED_BUILDS]`——依赖 `protobufjs` 的构建脚本未批准（可在 profile 里 `pnpm approve-builds`） |

结论：**8 款更新成功**；`dsh-session-fork` 与 `dsh-agent-toolkit` 是**安装旧版**时被官方管理器/pnpm 拒绝（分别是 peer 版本不兼容、依赖构建脚本未批准），与更新器无关；本轮没有任何一次由我们的准入拦下。

原始结果：`artifacts/real-plugin-install-update/evidence-eleven-a.json`、`evidence-eleven-b.json`。

## 复现

在已配置当前安装运行时环境的 PowerShell 中执行：

```powershell
pwsh -NoProfile -File ./experiments/run-real-plugin-upgrade.ps1          # 已安装旧版的逐个更新
pwsh -NoProfile -File ./experiments/run-real-plugin-install-update.ps1   # 先安装再立即更新
pwsh -NoProfile -File ./experiments/run-real-plugin-batch-update.ps1      # 一次确认批量三件
```

入口：[逐个更新](<real-plugin-upgrade-runner.mjs>) / [安装后更新](<real-plugin-install-update-runner.mjs>) / [批量更新](<real-plugin-batch-update-runner.mjs>)，各有同名 PowerShell wrapper。

「安装后更新」支持用环境变量指定目标与证据名，便于分组跑：

```powershell
$env:DSH_TEST_TARGETS='[{"name":"dsh-m","from":"0.12.24"}]'
$env:DSH_TEST_OUTPUT='evidence-a.json'
pwsh -NoProfile -File ./experiments/run-real-plugin-install-update.ps1
```脚本创建自有临时 `DSH_HOME`、profile、pnpm store，结束后核验并删除；证据写到 `artifacts/real-plugin-upgrade/evidence.json`，本轮保留的另外两次为同目录的 `evidence-run-2026-11-26a.json`、`evidence-run-2026-11-26c.json`（含本机临时路径，属本机诊断证据，不随包发布）。

runner 对可重试错误会用同一精确版本重试两次，模拟用户重试；失败仍如实记录。

## 验证边界

- 只覆盖公开 npm 上 5 款真实插件；GitHub 直装、私有源、镜像回退、native 依赖与隔离代际路线不在本轮范围。
- 没有浏览器控制：客户端面板的渲染、点击、窄屏与键盘未验收；「Host 行 active + 客户端资源可供给」不等于界面已人工确认。
- 只证明这些版本对的普通通道行为，不能推导所有社区插件；`dsh-free-search` 三次未成功是 npm 侧网络所致，不构成它不能更新的证明。
- 更新由 runner 驱动真实的 `prepareBatch`/`commit` 流程，确认票据由测试代签（与面板按计划自动附带标志等价），不是真人点击。
- 本轮 npm 侧存在持续抖动（同一时段多次元数据/归档请求中断），因此本机结果不代表稳定网络下的成功率。
- 清理前核验临时根目录的 realpath 与普通目录身份，再删除；超时或失败不被解释为成功。
