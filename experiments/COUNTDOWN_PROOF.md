# 下班倒计时在线更新隔离对照

## 结论

**`dsh-offwork-countdown@1.2.0 → 1.2.1` 的官方更新和 Doctor 通用更新均成功。** 这是配置保留与客户端资源更新的兼容性证据，**不是「官方失败、Doctor 修复成功」案例**。不要让用户为了复现报错而安装它。

本次未修改 Doctor 生产代码、用户 Desktop profile、已安装 WSL 或 GUI；未取消用户任务。

## 环境与方法

- 使用当前安装的 DSH **0.2.2-rc.3**、Electron **44.7.0**、Node **24.21.0**。
- 每条路径分别启动新 Electron 子进程和唯一临时 DSH_HOME/profile，完整加载官方 base/web Host 层。pnpm store 置于同一自有临时目录，使用复制导入；已核验实际 pnpm 输出，不能仅写配置就宣称隔离。
- 早期轮次仅写 `.npmrc` 的 store 设置被 pnpm 11 忽略；最终改用 workspace YAML 的 `storeDir` / `cacheDir` / `packageImportMethod`，确认日志指向自有临时 store 后重新完成两条路径。早期结果不被描述成全缓存隔离。
- 真实 AppBoot、Cordis、Loader、HMR、PluginManager、WebServer 和 ClientModules，没有用 mock manager 代替更新。
- 基线由官方 profile package-operation API 安装 npm 原版 `1.2.0`，没有复制用户 profile。
- 官方路径调用真实 `pluginManager.updateBundle(name, '1.2.1')`。
- Doctor 路径内部驱动生产 `DoctorService.runBatch`，包含 RegistryStager 下载/完整性检查、TaskGate 默认等待、真实 Windows native 只读锁采样、官方 remove/install、完整结果记录。
- 内部调用仅针对自有临时 fixture，不授予 agent 工具生产确认票据，也不替代真实用户面板授权。
- WebServer 只作为自动化测试自有 HTTP carrier 使用；禁用 Web shell、浏览器打开、客户端 HMR watcher 和模型/遥测入口，不启动替代 GUI。
- 所有已启用 Host rows 在冷启动与更新后均要求 active；每条路径在同一 PID 内完成。

## 实测断言

| 检查 | 官方 | Doctor 通用路径 |
| --- | --- | --- |
| 精确目标版本 `1.2.1`、bundle enabled | 通过 | 通过 |
| 目标 Host row enabled + active | 通过 | 通过 |
| 客户端磁盘代码与 npm 原版新包一致 | 通过 | 通过 |
| 实际 ClientModules graph revision 改变 | 通过 | 通过 |
| 实际提供的 revisioned client bundle 含新版 no-drag CSS | 通过 | 通过 |
| 配置 HTTP GET 内容和磁盘文件字节原样保留 | 通过 | 通过 |
| 更新后的 HTTP POST/GET 可继续写读配置 | 通过 | 通过 |
| 不重启测试 Host、不取消 Agent 任务 | 通过 | 通过 |

测试配置包括自定义上下班时间、提醒日、颜色、拖拽位置、提醒窗口和打卡标记，不只检查默认配置。

## 精确代码变化

这组版本的 Host 与 patch 不变。Client 的变化是增加 Electron `no-drag` 样式，让浮窗覆盖原生窗口拖拽区域时仍能点击/拖动：

```css
.dsh-offwork-pill,.dsh-offwork-panel{-webkit-app-region:no-drag;app-region:no-drag}
```

| 原版文件/归档 | SHA256 |
| --- | --- |
| 旧客户端原版 | `2d67345bd94ed14a56867a54cea93a1ca6e3680ed1e7090318c3dcd9d639a541` |
| 新客户端原版 | `275e7095da618c1a18180d2427f852fc9a23e83a4dba8925ee358d04c5a096e4` |
| 两版宿主代码 | `c4ed45ef90c3280c9359c9f4c99f04bd807da71cd26d4e68bdeecb18f242cd4c` |
| 旧 npm tarball | `6eea57378f51190baa2d222f03871a8446bdd2fe85a380bf15585a860592b28b` |
| 新 npm tarball | `90aa476540c46cc62ef0559576f2c657c7dcbd8f42408ba0a2194e2fba0cab34` |

归档通过 RegistryStager SHA512 npm integrity 校验。Doctor 没有改写这个普通插件的运行时代码或模块名称。

## 复现与证据

在已配置当前安装运行时环境的 PowerShell 中执行：

```powershell
./experiments/run-countdown-proof.ps1
```

入口：[runner](<countdown-proof-runner.mjs>)、[PowerShell wrapper](<run-countdown-proof.ps1>)。

完整输出仅在实验执行机器保留，分别为 `countdown-official-proof-result.json` 和 `countdown-doctor-proof-result.json`。JSON 含临时机器路径，已被 git/package 忽略，不进入公开仓库或附件。公开摘要并不替代原始结果；运行上述 runner 后才能在本机得到新的结果。

## 验证边界

- 没有浏览器控制工具；未执行客户端 React 渲染、真实拖动、截图或已打开页面 HMR。因此只确认 **Host 功能和新客户端资源供给**，不能声称真实 Electron 拖动交互已验收。
- 这个版本对没有 Host 导出变化、native modules、依赖迁移或核心服务替换，不能推导所有社区插件可无重启更新。
- 目前可证明故障修复优势的社区实证仍是已验证的 WSL 指定版本对；普通插件兼容性成功与故障修复成功分开记录。
- 清理前校验唯一临时根目录的绝对路径/realpath/普通目录身份，再删除；超时或清理失败不被解释成成功。
