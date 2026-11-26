# v0.5.8：重启式更新交接

日期：2026-11-25（Asia/Shanghai）

## 这次的起因

0.5.7 在宿主拒绝就地卸载（`restart-required` + `changed: true`）时会回滚原版本，保证不留下“已删除未安装”。但这只止血：**这类插件仍然永远更新不了**。

0.5.8 把它变成一条真正的更新路线。

## 做了什么

**重启式交接（restart handoff）**

1. 删除返回 `restart-required` 且磁盘已变时，不再回滚，而是继续把**已核验的目标**写到盘上（Union 走隔离代际归档，普通插件走暂存归档），核对安装字节，然后写一条有界的 `restart-pending.json`。
2. 目标写盘或字节核验失败 → 立刻用暂存原版本回滚（沿用 0.5.7 的 `restoreAfterRemoval`），不留半状态。
3. 下次启动 4 秒后，更新器读取待核验记录并核验三件事：安装字节与暂存目标一致、期望的宿主条目活跃、Union 还要精确运行命名空间匹配。
   - 通过 → 记为 `applied`，清理待核验记录，面板显示「重启后已完成」。
   - 失败 → 用暂存原版本回滚，再次要求重启，面板显示「重启后已回滚原版本」。
   - 核验或回滚无法确定 → 记为 `unknown` 并保留一次重试；达到上限后停止并显示未知，绝不标成功。
4. 面板主流程只用一行说明待核验、已完成或已回滚。

**新增**

- `lib/restart-lane.js`：待核验记录的读写（schema 校验、长度与字段白名单、原子重命名）、目标核验、回滚、`resumePendingRestart`。
- `lib/service.js`：两条路线接入交接；`list()` 返回 `restart` 状态；新增 `recordRestartHandoff`。
- `index.js`：启动后一次性恢复待核验项，失败不影响插件自身加载。
- `client.js`：一行重启状态提示。
- 测试：`tests/restart-lane.test.mjs`（6 项）、`tests/ui-render.test.mjs`（4 项），Union 路线两条交接/回滚断言。

## 验证

- 完整回归：**411 项通过、0 失败、0 跳过**（Node 24.21.0，串行）。
- **自有 Host 三段式证明**（`artifacts/restart-handoff/`，每次都是全新 Electron 进程）：
  - `success-*`：prepare 安装 0.10.25 → update 在管理器边界注入“真实删除后返回 `restart-required`” → 目标 0.11.0 写盘 + 待核验记录（`handoff-recorded`）→ 新进程核验通过，判定 **applied**，磁盘 0.11.0。
  - `rollback-*`：同一流程，在新进程启动前破坏目标入口文件 → 核验失败 → **回滚 0.10.25**，回滚字节核验通过。
  - `update-result.json`（无注入）：干净自有 profile 里同一更新**就地 applied**，未复现真实 profile 的 `unmanaged-plugin`。说明触发条件还没找到，交接路径目前靠管理器边界注入证明。
- 渲染树检查：`tests/ui-render.test.mjs` 执行真实面板函数，断言主流程只含列表/进度/结果/诊断入口、诊断默认折叠、行内短状态先于证据、重启提示按结果着色。

## 未验证

- **真实 profile 的 `unmanaged-plugin` 触发条件未确定**：干净自有 profile 复现不出，真实 profile 出现过两次（Union 一次）。这决定这条路线在真实环境的进入频率。
- 浏览器视觉、CSS、窄屏、键盘操作仍未做页面验收。渲染树断言不是 DOM 像素。
- 真实用户 profile 上完整走一次「交接 → 重启 → 核验/回滚」。
- 回滚后再次更新（第二次交接）在同一 profile 的连续行为。

## 未做

未修改 DSH 内核/Node/Electron、未改用户 profile 或全局源、未执行 npm 发布、未提交或推送。
