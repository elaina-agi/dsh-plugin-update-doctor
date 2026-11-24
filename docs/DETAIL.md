# 插件在线更新 · 使用与边界

> **v0.5.4 · Windows x64 · 独立第三方插件。** 支持符合条件的在线更新和独立自身升级。官方npm／固定公共镜像与备用源计划经过原包比对、计划绑定和额外确认，不更改全局源配置；npmmirror下载只允许精确同包同版本路径单跳固定CDN。真实用户结果、隔离测试与未覆盖范围见[验证记录](<VERIFICATION.md>)。

## 使用流程

**检查全部更新 → 勾选符合条件的兼容正式版 → 一键更新所选 → 核对并确认 → 查看逐项结果。**

- 初次打开只读取安装状态，不自动查版本、不自动勾选。每批最多20项。
- “版本检查”和“在线更新条件”分别显示；发现新版不等于可以安全更新。检查结果只针对显示的查询源。
- 确认默认取消；更新前默认**等待当前任务自然结束**。
- 若选择停止当前智能体活动，必须额外明确同意，并知晓排队输入会清除、已完成工具副作用不能撤销。之后仍等待已经开始的工作结束；外部终端／独立 Worker 不会被杀掉。
- DSH 不自动退出或重启。普通批次替换期间暂缓新步骤；更新器自身升级不与普通批次混合，其旧门禁在卸载时释放。
- 逐项执行，失败或需重启时停止／跳过后续项。目标失败与旧版恢复分别记录；恢复成功不等于升级成功。
- 开始替换前可取消等待。离开面板不取消已确认的宿主管理操作；未知结果不自动重发。

## 当前限定支持

- **普通 npm 插件**：兼容正式版、来源与归档预检通过后，使用官方精确版本更新，保留npm来源和官方后续版本资格；核验实际文件及Host激活。
- **旧普通 Doctor 归档**：只对匹配记录、身份和字节核验通过的安装，经独立确认从npm重装同版本；不是升级或任意本地来源迁移。自身、WSL、Git／链接来源不适用。
- **JS依赖**：限声明不变、实际解析图及文件可核验、无原生依赖或安装生命周期脚本的已审查路径，不承诺所有带依赖插件均支持热更新。
- **公共镜像**：限固定 `registry.npmmirror.com` 的已审查路径，与官方同版本归档比对，额外确认来源风险，不偷偷修改Host配置。普通更新和自身升级的来源规则分别核验。
- **WSL**：新版不再仅限固定版本名单，需公开原包／完整现代声明契约检查；已隔离验证 `0.26.2 → 0.29.0` 的生产代际更新和预准备旧包恢复；本机用户随后在真实面板完成升级，日志applied、代际与资源核验通过，Host16/16active，保留旧资源。来源仍为本地归档，不伪装npm，也不恢复内置Versions资格；已有会话可能保留旧预设，真实发行版任务连续性未全面验收。
- **更新器自身**：单独核对并确认官方Host交接。npm官方、固定公共镜像、固定公开GitHub完整提交各有独立限制；GitHub主分支HEAD不是签名Release。安装和恢复均可能失败。
- **官方详情扩展**：由本更新器提供独立归档检查和打开面板入口，仅只读检查／导航，不替代内置Versions，不直接安装。

WSL 准入、schema4、原包证明及未知结果保护见[结构准入说明](<WSL_STRUCTURAL_0_5_3.md>)；未来版本未实测不等于已证实不能更新，也不意味着无条件放行。

## Union Search：限定完整依赖代际，常规npm热更新仍不支持

原版DSH rc.5常规Union npm/HMR加载及旧版恢复实测失败；旧0.5.1只做风险拦截，不是热更新修复。

自0.5.2起新增、本版保留的已审查 `0.10.24 → 0.10.25` 完整HTML依赖代际归档。原始插件JS及依赖字节不改，DSH保持打开，用公共管理器短暂卸载／安装，预先准备fresh恢复路径；原型及生产限定隔离验证通过。

**安装会成为更新器管理的本地归档，不是npm来源、内置Versions资格不保留，须额外明确确认。** 未审查版本／来源、缺失或未知结果仍拒绝；手动恢复须当前已装代际可核验且重新生成fresh路径。超过旧代保留上限提前拒绝，不静默删除旧资源。

这不是修好宿主热加载器，也不保证全部插件支持。不会改DSH／Node／Electron、注入debugger、强清缓存或自动重启。旧0.5.1包不含此路线。详见[Union代际说明](<UNION_GENERATION_0_5_2.md>)。

## 安全与验证边界

- 本插件仅Windows x64；不承诺所有Windows插件或所有DSH版本均可无重启更新。
- Host会按安装源及现有fallback重新下载目标／依赖。准备归档是核验证据，**不是原子替换或安装同一份字节的保证**。
- 记录未知、读取失败或实际状态变化时拒绝同包重发／恢复，不覆盖外部安装。
- 文件使用检查只提供辅助证据，不杀进程、不强制释放句柄、不提权、不改ACL，不批准脚本或版本豁免。
- 本机诊断不上传，分享前仍须人工检查脱敏内容。
- 0.5.4来源修复完整回归368项通过；真实镜像原包只读比对、隔离Host正常更新及目标失败后恢复通过。本机真实npm0.5.0→0.5.3自身升级和WSL升级已核验；**第二台设备、实际发行版任务连续性、真实镜像升级全过程、全部主题／英文／键盘／窄屏交互尚未全面验收**。源码检查与Client资源供给不是完整视觉验收。
- 运行要求为Windows x64、DSH插件运行Node≥24及受支持Host服务；只读文件使用助手需要.NET Framework4.x和执行许可。详情见[Windows运行要求](<WINDOWS_REQUIREMENTS.md>)。诊断不可用／未知不代表没有文件占用。

本文件作为使用说明，不声明图像型 `meta.detail`；插件详情使用README回退。详见[历史更新说明](<RELEASE_NOTES_0_5_1.md>)和[验证记录](<VERIFICATION.md>)。

---

# Plugin online updates · Usage and boundaries

> **v0.5.4 · Windows x64 · Independent third-party plugin.** Supports eligible online updates and separate self-update. Official npm, the fixed public mirror and public fallback plans require archive comparison, plan binding and additional consent without changing global registry settings. npmmirror permits one exact package/version redirect to its fixed CDN. User results, isolated tests and verification limits are recorded separately in [Verification](<VERIFICATION.md>).

**Check all updates → select eligible compatible stable releases → Update selected → review and confirm → inspect per-plugin results.**

The initial page reads installed state without querying versions or selecting targets. Each batch has at most20 targets. Version discovery and update eligibility are separate and scoped to the displayed source. Confirmation defaults to Cancel and waiting for current tasks to finish naturally. Stopping current Agent activities requires additional consent; queued input is cleared and completed side effects cannot be undone. External terminals and independent Workers are never killed.

DSH is not automatically closed or restarted. New steps are deferred during ordinary replacement. Self-update is separate; its old gate ends on unload. Updates are sequential, and a failure or restart requirement stops/skips later targets. Target failure and restoration are separate outcomes. Leaving the panel does not cancel the Host operation; unknown outcomes are not resent.

## Narrow supported paths

- Normal npm updates use the public exact-version Host updater and verify saved source, installed bytes and activation. They preserve npm identity and future built-in version eligibility.
- Only identified, byte-verified older Doctor archives may migrate back to npm at the **same version**, after independent confirmation. Arbitrary local, Git, linked, self and WSL installations are not migrated.
- JS dependency support is limited to reviewed unchanged declarations and verified installed graphs/files without native dependencies or install lifecycle scripts. It is not universal dependency hot-reload support.
- Fixed public-mirror paths require canonical archive comparison and additional source-risk consent. Host registry configuration is not silently changed; normal and self-update policies differ.
- WSL candidates use public archive/modern declaration contract inspection instead of a fixed version allowlist. Production `0.26.2 → 0.29.0` generation update and preprepared old-package restoration passed in an owned isolated Host. The subsequent user-confirmed local upgrade also passed, with applied logs, resource/generation checks and 16/16 active Host rows. Old resources remain, source remains a local archive, and built-in Versions identity is not falsified. Existing sessions may retain old presets; real distro task continuity is not fully verified.
- Self-update is confirmed separately under its npm, fixed public-mirror or fixed full-commit GitHub policy. GitHub main HEAD is not a signed Release; installation and restoration may fail.
- The detail-page extension is a separate Doctor-owned archive check/navigation entry, not built-in Versions or an installer.

## Union Search: reviewed complete-dependency generations, not a Host reload fix

The stock npm/HMR target and original-version restoration failed; v0.5.1 only blocked that risk, which is not a fix. Since v0.5.2, this plugin includes a separate reviewed `0.10.24 → 0.10.25` local generation path. Original JS and dependency bytes remain unchanged; the stock manager temporarily unloads/reinstalls the plugin while DSH stays open. Target and distinct fresh recovery archives are prepared before replacement.

**The installation becomes a Doctor-owned local archive, not npm; built-in Versions eligibility is not preserved and additional source acknowledgement is required.** Unreviewed versions, unknown outcomes and unverifiable current generations remain blocked. Recovery uses fresh paths, and retained-generation exhaustion refuses before mutation. This neither patches DSH/Node/Electron nor promises universal no-restart updates. The older v0.5.1 package does not include this route; updater installation does not automatically update Union or WSL. See [Union generation scope](<UNION_GENERATION_0_5_2.md>).

## Limits

Windows x64 only. Host refetch/fallback and dependency transport mean prepared archives are evidence, not an atomic exact-byte installation. File-use checks never authorize process termination, forced unlocking, elevation, script approval or version exemptions. Local diagnostics are not uploaded. Source regressions, candidate archive resource checks and owned isolated stock Host installation/limited flows have passed. The user-confirmed local WSL upgrade passed and supplied screenshots confirm the Chinese dark panel/list; a second physical device, distro task continuity, other themes, English, keyboard and narrow-screen interactions remain unverified. The x64 file-use helper requires .NET Framework 4.x and execution permission; unavailable diagnostics do not establish absence of locks. See [Windows requirements](<WINDOWS_REQUIREMENTS.md>). README remains the plugin detail fallback; no image-only `meta.detail` is declared.
