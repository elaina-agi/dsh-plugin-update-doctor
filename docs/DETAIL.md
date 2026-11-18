# 插件在线更新 · 使用与边界

主流程：**检查全部更新 → 勾选兼容正式版 → 一键更新所选 → 选择任务政策并确认 → 逐项更新与结果**。

- 初次打开只读取安装状态，不自动查询网络；只有用户点击“检查全部更新”才查询版本。默认不勾选，每批最多 20 项。
- 确认框列出配置范围及每个原／目标版本，默认取消。任务政策默认是**等待当前任务自然结束**。
- 也可以选择**停止当前智能体任务后更新**。这不是默认动作：必须另外勾选明确同意停止当前配置所有运行中的智能体任务并清除它们的排队输入。停止前请保存工作；已经完成的工具操作不能撤销。
- 停止任务并不表示立即安全更新：宿主仍须等待已经开始的工作结束、完成包校验和加载验证。外部终端和独立 Worker 不会被杀掉。
- DSH 不自动退出或重启；替换期间暂缓新的智能体步骤，之后再继续。
- 所有 registry 目标参与版本发现。WSL 0.24.0 → 0.26.2 已验证使用独立代际路径、不摘除 bundle 来在线更新和恢复；原 JS/资源不编辑，旧资源保留。已绑定旧预设的会话可能继续旧代，新会话用新版。其他高影响目标仍按实际兼容、校验和加载结果决定，不承诺全部核心／自身插件都可热替换。
- 运行中的更新器自身需要独立更新；官方管理组件需随宿主版本管理。私有、Git 和开发链接来源不自动迁移，提供的是来源说明，不把它们误说成已安全更新。
- 更新逐项执行；失败或需宿主重启时后续项可以跳过。展开“详情／故障详情”查看安装、恢复和脱敏错误。
- “取消等待中的批次”仅取消尚未开始替换的批次，不撤销已完成更新、不终止已经执行的包操作。
- 离开面板不取消已确认的宿主操作；重新打开或刷新恢复查看。未知结果和读取超时不会标成成功。
- 文件使用检查是辅助证据，使用文件的进程不等于锁冲突原因；本插件不杀用户进程、不强制释放句柄、不提权或改 ACL。
- 版本发现复用 DSH 查询源；预下载限定公共 npm 官方源，替换使用已核验本地归档。本机诊断不上传。没有任意命令、版本豁免或脚本授权入口。

界面颜色只使用宿主语义令牌；主按钮前景跟随 `label-primary-foreground`，禁用按钮不整体降低透明度，扫描时按钮本身显示查询状态与旋转标记。

本文件不作为图像型 `meta.detail` 声明，插件详情使用 README 回退。没有浏览器控制时只能验证源码、接口绑定和静态资源，不将模拟页或静态检查称为真实 DSH 视觉验收。

---

# Plugin online updates · Usage and boundaries

Flow: **Check all updates → select compatible stable versions → Update selected → choose a task policy and confirm → inspect per-plugin results**.

The initial page reads installed state only. Version discovery is explicit, selection defaults to none, and each batch contains at most 20 targets. Confirmation lists the exact profile and versions, defaults to Cancel, and defaults to **waiting for current tasks to finish naturally**.

Users may instead choose **stop current Agent tasks, then update**. This requires a separate explicit checkbox approving cancellation of all running Agent tasks in this profile and clearing their queued input. Save work first; completed tool operations cannot be undone. The Host still waits for admitted work to settle and verifies packages and activation. External terminals and independent Workers are not killed.

DSH is not automatically closed or restarted. New Agent steps are deferred during replacement. Registry targets participate in version discovery; high-impact shared/core execution plugins receive warnings instead of category-only exclusion. Compatibility refusals, concrete archive checks and actual Host failures can still block or stop an update. **WSL 0.24.0 → 0.26.2 is verified with independent runtime-generation paths and no deselection gap, including same-process recovery.** Original JS/assets remain unchanged, and old resources are retained; existing preset-bound sessions may remain on their previous generation while new sessions use the new one. This is not a promise that every core or self-management component can be hot-replaced. The updater itself needs an independent update path; official components are managed with the Host version. Private, Git and linked development sources are not automatically migrated.

Updates are sequential. A failure or restart requirement can skip later targets. Cancelling a waiting batch only affects replacements that have not started; it neither undoes completed changes nor interrupts an already-executing package operation. Leaving the panel does not cancel the Host batch. Missing progress remains unknown rather than successful.

Details/failure details expose sanitized installation and recovery results. Read-only Windows file-use checks are auxiliary evidence, never permission to kill processes or force-close handles. Version discovery uses DSH's query source; staging is limited to the public official npm registry and replacement uses verified local archives. Local diagnostics are not uploaded.

Buttons use Host semantic tokens, including the primary foreground pair. Disabled buttons retain readable ink without whole-control opacity; the scan button displays its active query label and spinner. Without browser control, these static resource checks are not verification of the live DSH display.
