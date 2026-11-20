# GitHub 自更新隔离验证（v0.5.0）

## 环境与方法

2026-11-20，使用实际安装的 DSH Desktop **0.2.2-rc.5**、Electron 44.7.0、Node 24.21.0和 pnpm 11.28.5，在两个独立自有临时 profile中验证成功及失败恢复。

运行的是当前 production 更新器、DoctorService、GitHub预检、SelfUpdateCoordinator、SelfUpdateStore和TaskGate，以及实际 AppBoot/Cordis/Loader/HMR/PluginManager。生成包复制这些代码，并加只用于测试的代码标记；失败组在目标apply处故意抛错。

## 已观察结果

- 成功组：实际官方管理器卸载旧包，安装固定新Git提交；新代码可调用，预期Host条目active，文件摘要与来源提交核验通过，新实例读取独立结果记录。
- 失败组：目标包安装命令exit0但加载故意失败；官方管理器自动恢复旧Git提交，旧代码实际可调用，恢复文件、来源和Host核验通过；升级结果仍失败，恢复结果单独为applied。
- 两组旧更新器disposer都返回，不等待自身Host安装；旧TaskGate在卸载时释放。管理器fiber和进程PID均未更换。
- 临时Git仓库、profile、包store/cache及loopback服务经边界核验后清理，没有修改用户profile、WSL或停止用户任务。

## 显式fixture与不能推断的结论

- 测试旧包标为0.4.1但复制了当前production Git功能，才能发起试验；**真实未修改的v0.4.1没有GitHub自更新入口**，首次升级仍需官方管理器。
- GitHub API/ref/commit/tree/raw回复来自真实生成的Git对象，但通过fixture fetch适配器提供，不是真实GitHub发布或认证证据。
- public `updateBundle`未替换。public `installBundle`只用保留receiver的适配器把固定逻辑GitHubspec换成自有HTTP Git仓库，若失败返回的target恰好为该fixture spec，则只将来源身份映射回原逻辑spec，状态／错误／包输出不改，完整原结果单独保留；public `listBundles`将实际fixture来源映射回逻辑GitHub提交。实际包管理命令、卸载／加载／失败／自动恢复结果没有强制成功或模拟。
- 一次重复成功组出现目标未加载、旧版被恢复，但旧fixture适配器没有映射失败的本地Git spec，production白名单正确将结果保留为unknown；底层安装原因未被完整捕获，不能判为文件锁或声称已修复。新增原结果捕获及同一传输身份映射后复验成功；生产来源白名单未放宽，不自动重发未知操作。
- 宿主真实Git reachability检查通过fixture自有Git URL配置访问自有仓库；不使用用户Git凭据或修改全局Git设置。
- HTTP确认使用内存panel-shaped Request，不证明真实Connection登录或浏览器点击。任务数为0，无模型网络调用；Client listener/module delivery关闭，不证明新面板DOM、深浅主题、键盘交互或HMR。
- 预检文件树不是安装字节CAS，宿主仍自行下载spec；官方各次操作分别持锁，外部操作可介入。旧门禁在卸载时结束，不是替换全程任务冻结。

## 复现

在有安装版DSH运行环境的独立源码目录，使用安装的ASAR-aware Electron runtime，以 `ELECTRON_RUN_AS_NODE=1`和 `--expose-internals`运行 `experiments/github-self-update-proof-runner.mjs`；参数为 `update-good`或 `bad-rollback`，随后传入pnpm脚本绝对路径。Windows GUI-subsystem进程需要重定向输出并显式等待退出。

原始结果包含自有临时目录，仅存本机已忽略文件；不要上传原始结果或用户配置。普通测试是离线回归，不会自行运行本宿主试验。
