# v0.6.6：真实社区插件实测，修掉三类「正常插件更新被挡」

这一版不是凭想象改的：我在自有临时环境里挑 5 款真实发布版本的社区插件，先装旧版，再让面板的普通更新通道升级，然后把暴露的问题修掉。

## 实测结果

保留 3 次完整运行：

| 插件 | 版本 | 结果 |
| --- | --- | --- |
| `dsh-unlag` | 1.17.9 → 1.17.11 | 3/3 成功（旧版发布本身损坏，更新把它修好） |
| `dsh-claude-style` | 0.22.0 → 0.22.2 | 2/3 成功 |
| `dsh-soul-md` | 0.12.3 → 0.12.5 | 3/3 成功 |
| `dsh-trust-check` | 0.2.4 → 0.2.6 | 3/3 成功 |
| `dsh-free-search` | 0.9.86 → 0.9.88 | 0/3：都卡在 npm 侧网络 |

4 次未成功全部是外部网络（`ERR_PNPM_META_FETCH_FAIL`、元数据查询中断）；旧版本始终保留且 active，面板没有把它显示成成功。

详细证据与断言见[真实社区插件在线更新对照](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/REAL_PLUGIN_UPGRADE_PROOF.md>)。

## 修复 1：patch 里带 override 的插件不会再被永久挡住

有插件在自己的 bundle patch 里顺带改写核心行（`dsh-unlag` 改的是 `hmr` 的 `base`/`root`）。旧实现两处都挡：

- `onlineSafety` 看到**已安装**版本带核心行 override 就判 `core-service-takeover`；
- 标准通道的 patch 解析只接受纯 `insert`，遇到 override 条目整包拒绝。

于是「官方能装能更，我们面板永远不行」，且与版本无关。现在只有**新版本相对已安装版本新增或改动了核心服务接线**才算接管（`id`、`disabled`、`config` 全等才放行，`config` 里的 `!!js` 按原文比对）；插件自己的行和其它非核心行不经过这道门。装后核验、失败自动回滚不变。

## 修复 2：网络抖动不再被说成「你的选择变了」

准备阶段若版本查询失败或归档下载中断，旧代码抛 `version-not-admitted`（"选择已变化或不是最新版本"）或裸 `TypeError: terminated`。现在分别报 `version-query-failed` 与 `preflight-network-failed`，带 `preflight.causeKind=network`；检查阶段的版本查询中断会把该行标成可重试，而不是策略拒绝。

`networkPreflightError` 改为沿 `cause` 链识别：下载错误会被包装成策略文案，旧实现只看最外层消息，所以漏判。

## 修复 3：元数据中断不再被说成「来源未经验证」

查询源时 `listVersions` 若因网络返回 `refused/network`，旧代码报 `registry-origin-unverified`（"已安装的查询源必须是已批准的公开 npm"），把断网说成来源问题。现在同样归入可重试的 `version-query-failed` / `preflight-network-failed`。

## 还测了什么

- **先安装、再立即更新**：`dsh-cost-meter` 1.9.90→1.9.92、`deep-view` 0.1.0→0.1.2 都是装好后马上被识别为可更新并成功；`dsh-meme` 安装成功但更新被 `native-or-shared-runtime` 拒绝——它把 `sharp` 作为可选依赖，原生库被宿主加载后无法在运行中替换（本轮清理阶段实测到删除会卡住，进程退出后才成功），这条拒绝是必要的。
- **一次确认批量三件**：`dsh-claude-style` 0.22.0→0.22.3、`dsh-soul-md` 0.12.3→0.12.5、`dsh-trust-check` 0.2.4→0.2.6 同一张票据全部成功，默认等待、一次尝试完成，更新后复检全部是最新。

## 验证

- 回归 **441 项通过**（Node 24 串行），0 失败；新增 8 项覆盖 override 解析、能力比对与三类可重试失败。
- 真实插件矩阵：3 次运行共 11/15 次升级成功，含一次「坏安装 → 好版本」的修复；失败项均为 npm 网络，旧版保留。
- 打包：72 个文件；自有临时 profile 安装该 `.tgz` 的冒烟通过（Host 激活、Client 资源、原生助手探针均 true）。档案摘要见仓库 `artifacts/release-0.6.6/archive-verification.json`，不写进文档以免自引用。

## 限制

- 只覆盖公开 npm 上 5 款真实插件；GitHub 直装、私有源、镜像、native 依赖与隔离代际不在本轮实测。
- 没有浏览器控制，客户端页面的渲染、点击、窄屏与键盘操作未验收。
- 确认票据由测试代签（与面板按计划自动附带标志等价），不是真人点击。
- 本轮 npm 侧持续抖动，`dsh-free-search` 与第三轮的 `dsh-claude-style` 失败属网络而非策略；不代表它们不能更新。
