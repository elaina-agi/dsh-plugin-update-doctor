# v0.5.7：不可热卸载时回滚原版本，并按记录简化面板

日期：2026-11-25（Asia/Shanghai）

## 这次的起因

真实用户 profile 里更新 Union Search `0.10.25 → 0.11.0` 时，官方删除返回：

```
application: 'restart-required'
changed: true
restartReason: 'unmanaged-plugin'
```

`changed: true` 表示磁盘已经改了：包被移除，但运行中的 Host 仍执行旧代码（该插件在 Loader 条目之外运行，无法热卸载）。0.5.6 的隔离路线只在 `applied` 时继续，于是停在删除之后——**包不在磁盘上、没有装回、也没有新代际**。这是更新器自己的半完成状态，不是被更新插件的问题。

## 修了什么

1. **删除返回 `restart-required` 且磁盘已变时，立即回滚原版本**（`lib/union-service.js`、`lib/service.js`）：
   - 用准备阶段暂存的原版本归档重装，并核对安装字节；核对失败保持 `unknown`，不声明已恢复。
   - 结果行标记 `restart-required`，并记录 `restoreKind: restart-required-removal`；面板直接说明「这个配置范围无法在运行时替换，已恢复原版本」。
   - 批量恢复路线（`performUnionRecovery`）同样处理，回滚对象是当前已安装的那份归档。
   - `changed: false` 的 `restart-required` 不触发回滚：磁盘没变，仅表示需要重启生效。
2. **面板按 `docs/UI_SIMPLIFICATION_NOTES.md` 简化**：
   - 主流程只保留：勾选与版本、进度、每项结果、诊断入口。
   - 「本页面插件同步」「更新器自身升级证据」「最近更新证据」「限制与安全边界」合并进一个默认折叠的「诊断与历史记录」区块；只有页面同步确实失败、或自身升级正在进行时才回到主流程。
   - 每行只显示一句短状态（可更新／已是最新／需重启 DSH 后更新／本地安装／无兼容正式版／暂不支持在线更新），原包、来源、宿主条目等证据收进该行的「详情」。
   - 确认弹窗只保留所选插件与版本、「更新前任务处理」以及底部取消／确认；不再有通用「我已核对版本」勾选。改变安装来源、公共镜像、派生代际三类特殊影响各自保留独立确认；选择停止任务时按钮写明停止语义。

## 验证

- 完整回归：**400 项通过、0 失败、0 跳过**（Node 24.21.0，串行）。
- 新增 `tests/restart-rollback.test.mjs`：回滚重装、字节核验失败保持 unknown、回执缺失保持 unknown、重启生效型回执不宣称热加载。
- `tests/union-service.test.mjs`：`restart-required` 后只出现 `remove → install(旧归档)`，目标代际从未安装；`changed: false` 时不回滚。
- 新增 `tests/ui-simplification.test.mjs`：主流程不再直接陈列证据区块、行内短状态先于证据、确认弹窗无通用勾选且三类特殊确认仍在。

## 未验证

- 真实用户 profile 中「不可热卸载」的插件再次更新时的回滚实跑（本轮先由记录与单元覆盖，未在真实 profile 复现同一次删除）。
- 重启式更新路线（暂存双闭包 → 改盘 → 重启 → 开机核验 → 失败回滚）尚未实现。
- 面板简化后的浏览器视觉、窄屏、键盘操作未做页面验收；结构断言不等于看到的效果。

## 未做

未修改 DSH 内核/Node/Electron、未改用户 profile 或全局源、未执行 npm 发布、未提交或推送 Git。
