# v0.3.0 设计改进与验证

> 历史设计与实验记录。v0.5.1 开发修复对普通npm更新改为官方精确版本规格，保留registry身份；新旧归档是预检证据，不再宣称安装同一份本地归档。WSL代际及旧归档恢复例外保留，详细现状见[验证说明](<VERIFICATION.md>)。

## 本次修复

- Agent 维护占位响应该 Agent 自身取消／销毁信号，只释放该 Agent 的占位，不提前打开全局正式步骤门禁。
- 公共 npm 来源、精确版本、原始 SHA512/SHA256、安装归档 SHA256 绑定到确认计划。私有源、镜像或来源未验证时拒绝，不静默换源。首次更新还检查已安装原包与公共归档文件字节一致。
- 新旧包在用户确认前准备；运行前重新核验来源、状态与归档。持久引用重新读取源包，核验实际 manifest、patch、安装脚本／native 策略及 WSL 代际，不把身份文件中的策略描述当作权威。
- 批次结果按包投影供诊断查询；失败恢复使用独立身份记录和精确旧包。面板以包名准备恢复，单独确认，不能指定任意版本、来源或文件。诊断工具永不出票或执行恢复。
- 安装身份／失败恢复记录与80条／2MB诊断历史分开。日志按完整UTF-8 envelope字节压缩和淘汰，保留每项版本与结果；截断和I/O失败分别可见。已完成jobs只保留有界历史快照。
- 包安装、Host激活、当前页面同步独立显示；使用现有 ClientModules 状态和页面重试，安装进度／日志使用官方事件。
- 外部目标出现在remove后或失败清理前会停止，不主动删除／回滚覆盖可观察的外部目标。移除与安装仍是两个Host操作，**不是原子事务**。

## 安装状态

已通过公开管理器同选择重新应用更新器，返回 `application: applied`、无warnings。实时诊断返回更新器v0.3.0、Host 1/1 active；WSL仍0.26.2、15/15 active，独立安装身份迁移已验证且无persistenceWarning。未再次安装／更新WSL，也未停止真实任务。客户端新增资源已可由Host提供，用户需刷新现有页面查看；没有浏览器工具，不能声称已验收真实DOM。现有GUI的未认证HTTP检查返回鉴权拒绝；未读取cookie/token或绕过登录，也不把该拒绝误报为插件加载失败。最终本机回归109项通过；公开源码快照97项通过、12项私有证据断言明确跳过、0失败。

## 实验证据

### Agent 销毁等待环

[真实对照](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/AGENT_DISPOSAL_PROOF.md>)：旧占位控制组在销毁取消后仍等待；修复后真实PluginManager移除／安装applied，目标Agent销毁完成，其他Agent和正式步骤仍等待。零模型／用户任务。该实验直接驱动生产TaskGate，不是全批次面板测试。

### 当前版本普通插件更新

[下班倒计时对照](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/COUNTDOWN_PROOF.md>)已用v0.3.0的精确来源与归档准备重新运行。官方和Doctor均成功；新版客户端供给、Host active、自定义配置文件字节保留与设置接口读写均核验。它是兼容性证据，**不是新增官方失败修复案例**。

### 失败后单独确认恢复

[runner](<https://github.com/elaina-agi/dsh-plugin-update-doctor/blob/main/experiments/recovery-v3-proof-runner.mjs>)的本机结果未公开：真实installed AppBoot/Cordis/Loader/HMR/PluginManager加载自有坏版本返回失败；一次自动旧版恢复失败是明确注入的package-operation拒绝，未伪称npm故障。旋转90条日志后恢复资格仍在；仅包名的prepare-restore＋单独confirmation后，真实旧版安装applied，原代码实际可调用且Host row active，始终在同一隔离宿主进程内。测试HTTP handler收到自有panel-shaped Request，不冒充真实Connection登录／浏览器交互证据。

## 测试边界

- 单元／编排测试验证否定分支，真实宿主实验验证安装和生命周期，保留结果断言不等于重跑实验。
- 无浏览器控制，未验证新版面板实际DOM、截图或页面同步交互；未读取cookie／token绕过认证。
- 现有Agent任务协调与新正式步骤暂缓不冻结创建、工具解析、提示组装、维护回调或独立Worker。完整更早的admission和原子替换需要Host公共接口。
- 仍仅指定WSL版本／摘要例外；没有推广代际重包装至任意插件，也不强制已有WSL会话换代。
- 归档缓存仍不自动回收：已安装依赖和失败恢复可能引用它。宁可保留，不能删除被引用归档；未来回收需要独立引用生存期设计。
- 未修改DSH主源码／用户profile文件，不更新用户WSL、不停止真实用户任务。仅在回归与审查后刷新更新器本身。
