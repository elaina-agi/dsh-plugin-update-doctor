# v0.6.7：又测 10 款真实插件，修掉三处「把正常插件挡掉／搞崩」的误伤

这一版来自你要求的第二轮实测：10 款社区插件，各自先从公开 npm 装一份旧版本，再让面板走普通通道升级。跑完暴露了三个问题，全部是我们自己的误判，与插件无关。

## 实测覆盖（10 款，两组各 5 款，各自独立临时 profile）

| 插件 | 版本 | 结果 |
| --- | --- | --- |
| `dsh-free-search` | 0.9.86 → 0.9.88 | 成功（上一轮它三次都卡在网络，这次通了） |
| `dsh-whale-widget` | 0.4.0 → 0.4.2 | 成功 |
| `dsh-agent-compare` | 3.2.0 → 3.3.0 | 修掉误伤后成功 |
| `dsh-m` | 0.12.24 → 0.12.26 | 修掉误伤后成功 |
| `dsh-perm-gate` | 5.7.0 → 5.7.2 | 成功 |
| `meow-memory` | 0.33.1 → 0.33.3 | 成功 |
| `@michengai/dsh-archive-manager` | 1.4.1 → 1.5.0 | 成功 |
| `@michengai/dsh-skills-manager` | 1.5.3 → 1.5.5 | 成功（依赖 1 包 / 17 文件） |
| `@liustack/modsearch` | 5.10.15 → 5.10.17 | 成功（依赖 2 包 / 224 文件） |
| `@tencent-connect/dsh-qqbot` | 0.5.3 → 0.5.5 | 修掉崩溃与版本范围误判后成功 |

10 款插件的安装全部由官方 `installBundle` 完成，安装后 Host 行都是 active；升级后版本精确、来源仍是 npm 规格、行仍 active。

## 修复 1：`agent-*` / `session-*` 这类命名行被误判成核心服务接管

`dsh-agent-compare` 的 bundle patch 插入的行 id 是 `agent-compare`。旧的保护规则按**前缀**匹配核心行（`agent`、`session`、`storage`…），于是把它整包拒了（`protected-or-duplicate-row`）。

改成**精确匹配**核心行 id：插件自己的命名行（`agent-compare`、`session-notes`）不再被当成接管；真正的核心行 id（`agent`、`agent-loop`、`hmr`、`subprocess`…）照旧拒绝，插入重复 id 也照旧拒绝。运行时的 `row-id-collision` 检查不受影响。

## 修复 2：`prepare` 构建脚本被当成安装脚本

`dsh-m` 的 `package.json` 里有 `prepare: "npm run build"`。旧规则把 `prepare` 也算作安装期脚本，于是永远不让在线更新（`package-install-scripts-require-separate-review`）。

事实上 npm/pnpm 对**注册表 tarball** 只执行 `preinstall` / `install` / `postinstall`，`prepare` 只在本地源码安装和 git 依赖时运行，装在用户机器上根本不会执行。现在只拦那三个真正会执行代码的钩子；`prepare` 不再阻拦（自更新的源码路径仍按自己的规则检查）。

## 修复 3：依赖图不可用时，恢复记录校验把自己搞崩

`@tencent-connect/dsh-qqbot` 升级时，我们的批量直接抛 `TypeError: Cannot read properties of null (reading 'digest')`，该项被跳过后整批变成 `unknown`。

原因：当已安装依赖树无法检查时，计划里的 `dependencyGraph` 是 `null`；恢复记录校验写的是 `value.dependencyGraph !== undefined`，`null` 通过了存在性判断，紧接着读 `.digest` 就炸了。现在 `null` 与 `undefined` 一样被视为「没有依赖图证据」，恢复记录可以正常保存，后续的依赖图比对仍按「有证据才比对」处理。

## 修复 4：合法的两段式版本范围被当成「依赖版本不符」

`@tencent-connect/dsh-qqbot` 的依赖链里，`qqbot-connector` 声明 `qrcode-terminal: ^0.12`，实际装的是 `0.12.0`——完全符合范围。但我们的范围判断只接受三段式（`^0.12.0`），遇到 `^0.12` 这种两段式直接判不符，于是装后核验失败、更新被记成 failed。

现在按 node-semver 的语义处理部分版本：`^0.12` → `>=0.12.0 <0.13.0`、`^1.2` → `>=1.2.0 <2.0.0`、`~1.2` → `>=1.2.0 <1.3.0`、`>1.2` → `>=1.3.0`、`<=1.2` → `<1.3.0` 等，并补了 15 条范围用例。

顺手补上「核验失败时到底哪一步失败」：装后核验不再只给一句 `registry-installed-state-mismatch`，而是带上具体原因（例如第一个字节不符的相对路径，或 `dependency-version-range-mismatch`）。

## 验证

- 回归 **444 项通过**（Node 24 串行），新增 3 项：命名行不再算接管、`prepare` 不算安装脚本、部分版本范围匹配；另修正了 2 条旧断言（它们断言的是错误的 semver 语义）。
- 修复 3 的回归在恢复记录的持久化测试里（`dependencyGraph: null` 可正常写入并重读）。
- 打包与冒烟见 `artifacts/release-0.6.7/`。

## 限制

- 10 款仍只是公开 npm 生态的一小部分；GitHub 直装、私有源、镜像、隔离代际路线不在本轮。
- `dsh-perm-gate` 在自己的激活日志里报了 `HMR transactions cannot be nested`（它自己往 settings 播种时的宿主限制），我们的流程未受影响，但这不是我们能替它修的。
- 没有浏览器控制，客户端渲染/点击/窄屏未验收；确认票据由测试代签。
- 不保证「安装成功」就等于插件功能可用：Host 行 active 是我们能独立核验的上限。
