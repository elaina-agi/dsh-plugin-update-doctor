# v0.6.1：隔离代际的依赖闭包下载

0.6.0 把普通通道放宽了，但隔离代际（Union 这类卸载重装会复用旧依赖加载状态的插件）仍有一个洞：新版本声明了已安装闭包满足不了的依赖范围时，只能报 `dependency-closure-requires-download`。0.6.1 把这一半接上。

## 做了什么

**只下载缺的部分。** 先复用已经核验过的安装闭包，再逐条比较新声明：满足的范围保留现有副本，满足不了的范围才从公开 npm 解析、下载。

**按 npm 的语义放置。** 依赖按 owner 解析，不同 owner 需要不同大版本时各自嵌套一份（例如 `node_modules/a/node_modules/x`），不再把“同一包两个大版本”判成冲突。放置路径就是代际里最终使用的路径。

**下载前后都绑定。** 只读扫描只给出 `download-required`（闭包摘要＋包数），不写任何文件；准备阶段才下载，逐个校验发布 SRI、`package.json` 身份与依赖策略（拒绝安装脚本、原生约束、可选依赖、非法来源），并把摘要写进计划。用户确认时能看到包数和体积。

**篡改在准备阶段就停。** 依赖归档与发布 SRI 不一致时返回 `dependency-closure-integrity`，profile 保持旧版本，不产生 stage、不进入卸载。

**代际证据按源绑定。** 合并后的目录重新做完整快照；每个 source 的声明摘要分别记录（旧记录继续兼容共享摘要），`_read` 仍按完整 inventory 与逐包公开证明重开代际。装后照旧要求官方管理器 applied、安装字节一致、Host 行激活、运行命名空间精确匹配；失败恢复走同一条已验证路径。

## 自有 Host 证明

`artifacts/union-closure-0.6.0/host-result.json`，判定 `closure-download-and-recovery-verified`：

- 基线：真实 npm Union `0.11.0`（官方管理器安装）。
- 候选：同一公开原包加版本号与一个真实依赖 `is-number@^7.0.0` 的 `0.11.1`（npm 没有这个发行版，属于合成清单）。
- scan：`download-required`，闭包 1 个包。
- 篡改：准备阶段被 `dependency-closure-integrity` 拒绝，profile 仍为 `0.11.0`。
- 目标失败：注入一次安装拒绝 → 旧代际恢复 applied，恢复代际运行命名空间 verified。
- 重试：updated，package/source/host/runtime 全部 verified，1/1 行 active；新代际里真实的 `advance_fetch` 字段提取与 markdown 都通过。

## 限制

- 候选版本是合成的，不是已发布版本；完整发布到 npm 的版本级端到端证明仍未做。
- 依赖自身声明安装脚本、原生约束或可选依赖时仍拒绝。真实 cheerio 闭包里存在这类包，因此设计上优先复用已安装副本，而不是每次重解析整棵树。
- 解析深度 ≤5、仅稳定版、最多 64 个新包；共享 profile 的包管理器也会按同一声明安装根依赖。
- 浏览器视觉／键盘／窄屏与第二台设备仍未验收。

## 安装

在 DSH 面板卸载当前版本后，用「添加插件」选择
`artifacts/release-0.6.1/dsh-plugin-update-doctor-0.6.1.tgz`。
