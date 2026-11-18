# 验证状态（v0.3.0）

v0.3.0改进和新增实验见[设计与验证](<V0_3_DESIGN.md>)。本轮只刷新更新器；用户WSL不再次更新。下列WSL与早期模块对照为历史真实实验证据，不代表当前每项都重跑。


- 桌面桥接误拦修复：安装版真实 Connection dispatcher和 HTTP bridge（仅去除 TypeScript类型注解）下，正常物理 Origin＋内部 `dsh.internal` URL准备请求返回200；未认证401、跨站403、无面板标记403、非 owner403。更新调用0，停止任务0。测试身份为自有内存 fixture，不读取用户凭据。
- v0.2.1 后用户在真实 desktop 面板完成 WSL **0.24.0 → 0.26.2** 更新；插件自有日志记录 `outcome: applied`、`generationVerified: true`、目标版本精确匹配且无新增 activation warnings。用户选择了额外确认的停止政策，但实际 `requestedAgents: 0`，没有任务被取消。日志是实际结果证据，不等于浏览器 DOM／所有 WSL 会话功能验收。
- JSON和面板自定义头是防简单跨站请求的标记，不是身份或点击证明。真实鉴权仍由 DSH Connection、确认票据及额外停止任务同意提供；不声称防止已认证恶意同源代码或 XSS。


目标：DeepSeek Harness Desktop **0.2.2-rc.3 / Windows x64**。

## 已验证

- 修正用户真实截图中的主按钮白底白字：主背景与 `label-primary-foreground` 配对；禁用不使用整控件透明度，查询中标签和旋转标记可见。静态 token 检查通过，真实新截图仍由用户查看。
- 更新确认提供默认等待和额外同意停止当前活动。取消绑定到确认时 Agent 活动代次；新活动不被旧确认取消。包校验、状态和共享冲突检查前置，取消失败不虚报队列清空。
- 普通测试插件在真实 DSH 同进程更新、失败恢复通过；真实 Agent 维护／pre-step 门禁通过，没有网络模型调用。
- 完整官方 base + web +真实 WSL：0.24.0 冷启动14/14 active；官方移除后重装更新真实复现基础 fs/subprocess 重复注册，原位安装原包真实复现旧 ESM 导出缓存错误。不是已证实的文件锁。
- 生产代际包装路径：真实同 PID 0.24.0 → 0.26.2 全15 Host行 active、公开再应用 applied；旧版恢复全14 active，裸包客户端锚点仍 active，FS `resolve`／`processPath` 与子进程服务可访问。
- 滚动资源保留路径：同一隔离宿主进程内，0.24.0 → 0.26.2 直接 applied、15 active；回滚原版本直接 applied、14 active。旧根资源和新代资源均按原包字节保留。测试的 agent shell脚本两版本摘要恰好相同，不能仅用它证明不同代码版本；生成单元测试另检查不同字节资源。
- 最新单元／编排与本机保留证据回归 **109 项通过**；干净源码快照 **97 项通过、12 项证据断言明确跳过、0 失败**。包含精确来源／归档、批量恢复、历史字节预算、Agent销毁等待环、证据读取与页面状态静态检查。保留证据断言不等于重跑全部历史宿主实验。
- 原包 SHA512、固定已验证原包 SHA256与派生包 SHA256分别核验。新包代码和素材不编辑，仅 manifest和自身模块声明映射到独立代际目录；滚动包保留旧代 exports与资源。
- 只读 Windows 使用检测查询进程与共享冲突，不杀用户进程；不足样本返回 unknown。

## 社区插件对照（2026-11-17）

- **下班倒计时 `1.2.0 → 1.2.1`：官方和 Doctor 通用路径均成功，不是新增故障修复案例。** 每条路径独立临时 profile／新进程，真实 installed PluginManager 与 production `DoctorService.runBatch` 进行对照。
- 冷启动和更新后所有已启用 Host rows active；精确新版本、新客户端原包 SHA256、实际 ClientModules graph revision 和供给的新版 no-drag CSS均核验。自定义配置内容和磁盘字节保留，更新后 HTTP 设置接口仍可读写，未取消任务。测试根目录已清理。
- 详情与复现：[下班倒计时对照](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/COUNTDOWN_PROOF.md>)。未控制浏览器，不能将客户端资源供给等同于真实 Electron 拖拽/HMR 渲染验收。
- **自有模块新增导出控制组：官方 updateBundle 和生产通用 runBatch 均载入 `new-export-1.1.0`，没有复现旧 ESM 缓存故障。** 独立新进程冷启动新版同样有效。这个简单导出变化不能当作 WSL 故障的充分条件，也不能证明已修复第二款社区插件。详情：[模块导出对照](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/MODULE_CACHE_PROOF.md>)。

## 公开源码与打包检查（2026-11-18）

- 私有结果不随源码上传；缺失时仅对应证据断言跳过。JSON 损坏、非对象、关键字段缺失与其它读取失败仍使测试失败。
- 实际打包 31 个文件，包含 MIT、运行模块、文档、语言资源、图标及只读原生助手；不含实验原始结果、测试、日志、依赖缓存或本地 Git 历史。
- 独立临时 profile 通过官方 profile package-operation API 新安装该 `.tgz`，不是 workspace 链接。实际 Host 1/1 active、ClientModules 能供给 v0.3.0 新代码、包内原生探针返回 checked。包 store/cache 位于自有根且已核验，测试根已清理。
- 打包安装验证使用 fixture readiness 与独立测试 HTTP carrier；没有浏览器控制，不等于实际 GitHub 网络安装或真实界面渲染验收。未触碰用户 profile、WSL 或任务。

## 边界

- 这些真实试验没有运行真实 WSL模型任务或发行版命令连续性测试；已有会话可保留旧 preset revision，不保证全部已有会话立即换代。新会话使用新代。不能调用仅适用于空白会话的 recompose API 绕过已有会话锁。
- 仅对已验证 WSL .24/.26.2摘要应用代际例外，未验证未来版本仍需再次测试。宿主核心/更新器自身/其他不支持源仍需独立更新，不承诺所有插件无限制在线替换。
- 无浏览器控制，未读取cookie/token绕过认证，不能声称已看过最新界面或所有客户端同步结果。用户提供的旧截图确认面板已显示；新配色和确认选择需用户查看。
- 取消任务只经用户界面额外确认；开发实验没有停止真实用户任务。真实 WSL 更新由用户本人在面板确认执行，开发 agent 没有代为签票、降级或再次更新现有 WSL。
- 不改宿主内核、用户配置、WSL distro配置，不执行强制解锁/提权。异常或外部卸载更新器时保留未知结果，不保证官方不可取消步骤已停止。

原始结果 JSON包含本机路径，只保留在已忽略实验结果里，不进入安装包。模拟分支回归、保留证据测试与真实宿主实验证据分开标注。
