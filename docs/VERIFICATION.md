# 验证状态（v0.5.0）

## GitHub 自身升级（2026-11-20）

新增固定公开仓库／完整提交的独立自更新交接，沿用实际安装DSH **0.2.2-rc.5**公开Git `updateBundle`，不直接安装覆盖自身、不手改profile。设计见[自身升级](<SELF_UPDATE.md>)，试验方法见[GitHub隔离验证](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/GITHUB_SELF_UPDATE_PROOF.md>)。

- 离线回归覆盖固定仓库来源、main发现与完整commit绑定、Git tree/blob摘要、Git打包／锁文件／脚本控制、原文件核验、票据复查、分层结果及旧记录兼容。31项Git预检专项全部通过；完整回归 **191项通过、14项私有证据测试明确跳过、0失败**，总计205项。JS语法与差异空白检查通过。
- 实际隔离宿主成功组载入新提交、新代码可调用且Host active；失败组目标安装exit0但故意加载失败，官方恢复旧提交applied，恢复文件／来源／Host通过，升级仍为失败。两组保持管理器fiber和同PID，旧disposer不等待自身安装；自有根及listener已清理。
- GitHub接口与传输为显式fixture：由真实生成Git对象供给fixed逻辑GitHub API/raw数据；public installBundle适配器仅转换自有Git传输及该失败target来源身份，原状态／诊断结果单独保留，public updateBundle执行、包命令、生命周期与官方恢复均未替换。测试旧0.4.1复制当前代码，不能声称真实旧版已具备新功能。任务为0，无浏览器点击／模型／真实profile变更。一次重复成功组因旧fixture没有映射失败本地spec而被白名单保留为unknown；底层安装原因未完整捕获，新增原结果捕获／身份映射后复验通过，不将重跑当作修复底层故障。
- 另对公开旧提交9f6160c进行只读原文件预检：35项安装资源匹配，Git tree为 `d122bbf60f19d212b8552b178429b1f0f56ba9f8`，41个有界请求读取421016字节；三个打包控制文件通过。首次真实HTTP检查暴露小文件gzip wire Content-Length大于decoded大小的兼容缺陷；修复仅对identity响应使用该头提前拦截，解压后的流仍有精确上限，并新增gzip/br回归；真实复验通过。此项不是目标安装、全面兼容或浏览器证据。
- 中文确认框直接展示非签名Release、现有依赖源、非原子替换及安装／恢复都可能失败，并使用Git专属确认；完整新旧SHA、来源／包／Host／页面同步与恢复结果分开。UI/UX源码复核通过；**未验收v0.5.0真实DOM、深浅主题、键盘或窄屏行为**。
- 当前已安装v0.4.1未被开发代码改动；没有npm发布、live升级、用户任务取消、WSL修改或私有结果上传。首次迁移到v0.5.0需由用户通过官方管理器安装固定提交，之后更高正式版本才能使用此路径。

## 首屏渲染修复（2026-11-20）

用户在实际 GitHub 安装的 v0.4.0 面板看到本插件渲染保护提示。已安装客户端与仓库源码一致，缺陷是 `useLocale()` 和 `useClientSync()` 没有传入选择器。DSH 0.2.2-rc.5 实际 renderer 将这两个注入源绑定成必需接收 selector 的 Hook，因此首次读取就会抛错。

v0.4.1 改为稳定的显式选择器 `useLocale(selectLocale)`／`useClientSync(selectClientSync)`，不手工订阅，不改宿主 API 或主题。新增测试直接求值实际客户端的选择器声明与调用片段；旧无参写法必须失败。另对安装版 renderer 内实际纯 `memoizedSelector` 片段验证：缺 selector 精确报 `TypeError: selector is not a function`，正确选择器返回语言和同步快照。该验证未执行 React／DOM，不是模拟或真实浏览器渲染验收。

此前164项回归只覆盖静态声明和宿主生命周期，遗漏了 selector参数契约；其通过不能证明真实页面正常。修复后的干净源码测试 **152 项通过、14 项私有证据测试明确跳过、0 失败**，总计166项。实际renderer完整字节SHA256为 `6facb89754f0d21af91491a32646be87ff1b4a25891e44cce1732b02b0fe123b`；纯选择器片段647字节，SHA256为 `09aeeb2d1a69d8d4dd33c9f8cba84e0e4b8480a8bac47350cf1cb7b0addbb57e`。修复后的真实页面需用户重新安装 v0.4.1 并刷新验收。此次不直接修改已安装插件、不读取浏览器凭据、不改profile或WSL。

## v0.4.0 自更新交接（2026-11-20）

当前安装的 DSH Desktop 为 **0.2.2-rc.5 / Windows x64**。v0.4.0 新增独立的宿主自更新交接，详见[设计](<SELF_UPDATE.md>)和[真实隔离实验](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/SELF_UPDATE_PROOF.md>)。

- 成功组：实际旧更新器卸载后，独立官方管理器安装新版，实际新代码与Host行active；新实例读取旧实例写下的结果，文件摘要核验通过。
- 失败组：明确故意抛错的目标安装exit0但activation失败，官方自动恢复旧版applied；旧代码实际可用、恢复文件摘要核验通过；目标失败从未被恢复成功覆盖。
- 同版本文件改动控制：历史官方applied保留，但独立文件核验失败，不显示已验证升级成功。旧disposer没有等待自身安装的五秒循环。
- 使用真正安装的AppBoot/Cordis/Loader/HMR/PluginManager和安装后的production代码。生成的版本与registry transport、panel-shaped HTTP request为显式fixture，并非公开npm发布／真实用户点击。任务数为0，不证明真实取消任务或浏览器HMR/DOM。测试根、进程和listener已清理。
- 本机回归 **164 项通过**；不含私有结果的干净源码 **150 项通过、14 项明确跳过、0 失败**。JS语法检查通过。实际安装包包含新增的三项self模块和使用说明，原始实验结果、tests和缓存不进入包。
- 静态UI/UX审查已完成：自身交接不再误显示普通批次的全程门禁进度文案，常见来源／依赖拒绝原因提供中英文可行动说明。没有真实浏览器控制，视觉与实际点击仍未验收。
- 开发验证没有更新用户当前profile、WSL或任务，也没有安装／刷新用户live更新器或发布npm。源码提交和GitHub推送作为用户另行确认的发布步骤执行。
- 自更新仅准公共npm registry、Host无fallback、固定依赖与助手。旧门禁在卸载时结束，不能承诺整个宿主替换全程冻结新任务。

## v0.3.0 历史验证

v0.3.0改进和新增实验见[设计与验证](<V0_3_DESIGN.md>)。该轮刷新过更新器，但没有再次更新用户WSL。下列WSL与早期模块对照为历史真实实验证据，不代表当前每项都重跑。


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
- 仅对已验证 WSL .24/.26.2摘要应用代际例外，未验证未来版本仍需再次测试。宿主管理核心和其他不支持源仍需独立更新；更新器自身仅走本轮窄准入宿主交接，不承诺所有插件无限制在线替换。
- 无浏览器控制，未读取cookie/token绕过认证，不能声称已看过最新界面或所有客户端同步结果。用户提供的旧截图确认面板已显示；新配色和确认选择需用户查看。
- 取消任务只经用户界面额外确认；开发实验没有停止真实用户任务。真实 WSL 更新由用户本人在面板确认执行，开发 agent 没有代为签票、降级或再次更新现有 WSL。
- 不改宿主内核、用户配置、WSL distro配置，不执行强制解锁/提权。异常或外部卸载更新器时保留未知结果，不保证官方不可取消步骤已停止。

原始结果 JSON包含本机路径，只保留在已忽略实验结果里，不进入安装包。模拟分支回归、保留证据测试与真实宿主实验证据分开标注。
