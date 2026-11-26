# v0.6.10：两处归档解析兼容性修复

这版只修解析，不动准入策略。

## 修了什么

1. **PAX / GNU long-name 头**：有些包用 PAX 扩展头存放超长路径或时间戳（`dsh-session-superagent` 就是）。我们的两个 tar 读取器都把这类元数据条目当成普通文件，于是报 `unsafe-or-duplicate-archive-path` / `extended-archive-entry-unsupported`，更新被拦。现在两个读取器都能正确跳过 `x`/`g`/`L`/`K` 条目，继续读真正的文件。
2. `readPackedContents` 与 `archiveEntries` 的行为保持一致：链接仍拒绝，路径安全仍校验。

## 实测评测

第三轮 10 款插件的结论（详见 [真实社区插件在线更新对照](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/REAL_PLUGIN_UPGRADE_PROOF.md>)）：

- 7 款直接 `applied`：`ds-bot`、`dsh-bili-scroll`、`@suifei/dsh-ai-team`、`dsh-mcp-connector`、`dsh-connect-workbuddy`、`dsh-plugin-wallpaper-engine`、`dsh-session-superagent`（本版修复后）。
- 1 款 `restart-required`：`@nanmicoder/dsh-agent-teams` 已装成 0.1.31，Host 行需要重启后才会 active。
- 2 款被官方管理器判定 `bundle-in-use`：`dsh-genui`、`ds-harness-remote`。它们运行中占着资源（harness-remote 还会拉起子进程），官方管理器拒绝在运行中移除；面板如实显示该错误码。

## 验证

- 回归 **445 项通过**（Node 24 串行）。
- 打包与冒烟随版本产出，见 `artifacts/release-0.6.10/`。

## 限制

- `bundle-in-use` 属宿主侧判定，我们无法绕过；更新这类插件需要先停用或重启后再更新。
- 浏览器渲染/点击未验收；确认票据由测试代签。
