/* DSH browser bundle: explicit scan, default-unchecked batch selection and user-confirmed online updates. */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-update-doctor',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;
    const NS = 'pluginUpdateDoctor';
    const PANEL_ID = 'plugin-update-doctor';
    const API = '/api/plugin-update-doctor';
    const EN = {
      panel: 'Plugin online updates', title: 'Plugin online updates', intro: 'Check all installed plugins for their latest compatible stable releases, select updates, then follow each result without closing DSH.',
      profile: 'Profile', runtime: 'DSH version', refresh: 'Refresh installed state', scan: 'Check all updates', scanning: 'Checking published versions…', loading: 'Reading current state…',
      scanHint: 'Version checks run only when you click Check all updates. Nothing is selected automatically and this check changes no plugin.',
      safety: 'DSH stays open. Ordinary managed plugins update only after current tasks finish naturally; no task is force-cancelled. WSL/core-service takeovers and unsafe native/shared-runtime targets are not supported by this conservative first version.',
      installed: 'Installed plugins', package: 'Plugin', currentVersion: 'Current version', latestVersion: 'Latest compatible stable', status: 'Status', actions: 'Details', select: 'Select',
      selectAll: 'Select all available', clearSelection: 'Clear selection', selectedCount: 'Selected', availableCount: 'Available', updateSelected: 'Update selected',
      notChecked: 'Not checked', empty: 'No installed profile plugins were returned.', noAvailable: 'No safely offered compatible stable updates were found.', uncheckedHint: 'Run the version check before selecting updates.',
      'status.not-checked': 'Not checked', 'status.up-to-date': 'Up to date', 'status.available': 'Update available', 'status.blocked': 'Blocked', 'status.error': 'Check failed',
      'quick.not-checked': 'Not checked', 'quick.check-failed': 'Version check failed', 'quick.available': 'Update available', 'quick.up-to-date': 'Up to date',
      'quick.needs-restart': 'Needs a DSH restart', 'quick.local-source': 'Local install', 'quick.no-compatible': 'No compatible release',
      'quick.preflight-failed': 'Update pre-check failed; retry', preflightRetryHint: 'The read-only pre-check hit a network error, so this row is not a policy refusal. Click Check all updates to retry.',
      hostDependenciesBadge: '⚠ Host-package dependency', hostDependenciesWarning: 'This package declares Host packages as ordinary dependencies ({list}); the package manager may place them at the profile root and the Host may disable the matching core row. The update is still attempted.',
      'quick.unavailable': 'Not updatable here', 'quick.recovery-required': 'Recovery available',
      rowDetails: 'Details', diagnostics: 'Diagnostics and history',
      copyReport: 'Copy error report', copyReportAll: 'Copy diagnostics report', reportCopied: 'Diagnostic report copied to the clipboard', reportFailed: 'Could not copy automatically. Select the JSON below and copy it manually.', showReport: 'Report JSON (select and copy)', reportHint: 'Paste this JSON with your feedback; it contains versions, error codes and sanitized messages, not your files.',
      'reason.wsl-declaration-review-required': 'The new version adds a declaration expression that has not been reviewed.', 'reason.wsl-structure-changed': 'The new version changes the rows or core overrides this plugin declares.', 'reason.wsl-foreign-preset-module': 'The new version loads a module outside this plugin or the shipped DSH packages.',
      restartPending: 'Waiting for the next DSH start to finish this update', restartApplied: 'Finished after the restart', restartRolledBack: 'Rolled back after the restart', restartUnknown: 'The restart verification could not be confirmed', diagnosticNote: 'Troubleshooting evidence only; sanitized and never uploaded.',
      restartRollback: 'This profile cannot replace the plugin while DSH runs. The previous version was restored; update it after a DSH restart or with the official plugin manager.',
      'status.waiting': 'Waiting', 'status.preparing': 'Preparing', 'status.updating': 'Updating', 'status.updated': 'Updated', 'status.failed': 'Failed', 'status.skipped': 'Skipped', 'status.restart-required': 'Host restart required', 'status.unknown': 'Unknown',
      'state.active': 'Host rows active', 'state.inactive': 'Inactive', 'state.partial': 'Partially active', 'state.missing': 'Package unavailable', 'state.unknown': 'Unknown',
      'source.registry': 'Registry', 'source.git': 'Git', 'source.local': 'Local / linked', 'source.other': 'Other / protected',
      reasonTitle: 'Why this target is unavailable', 'reason.self-update-blocked': 'This updater cannot replace itself while it runs.', 'reason.management-or-shipped-bundle': 'Shipped or management-critical bundles are protected.',
      'reason.registry-updates-only': 'This version checks registry-installed plugins; Git and linked packages are not changed.', 'reason.not-profile-installed': 'Not installed as a profile dependency.',
      'reason.recorded-recovery-only': 'Only a previously recorded failed update has a recovery target.', 'reason.host-dependency': 'Shared Host dependency changes require a Host restart.', 'reason.restart-required': 'The Host cannot replace this target online.',
      'reason.incompatible-version': 'The published target is incompatible with this DSH version.', 'reason.no-compatible-stable-version': 'No newer compatible stable version was offered.', 'reason.wsl-online-not-supported': 'WSL environment hot replacement is not supported by this first version.',
      noValue: 'Not available', unknown: 'Unknown', lastChecked: 'Last version check', taskPolicy: 'Task policy', batchLimit: 'Up to 20 targets can be confirmed in one batch. More updates can be selected after the current batch finishes.', selectFirstBatch: 'Select first 20 available', activeTasks: 'Current running Agent tasks',
      'reason.online-update-gate-unavailable': 'The required safe-task gate or staging support is unavailable; no updates are allowed.', 'reason.host-runtime-dependencies': 'This target can replace Host runtime dependencies and is blocked.', 'reason.native-or-shared-runtime': 'Native or shared runtime dependencies cannot be safely replaced by this online updater.', 'reason.native-payload-not-hot-replaceable': 'This plugin loads native binaries; the Host keeps them locked, so neither the update nor a rollback can replace them. Update it with the official manager.', 'reason.core-service-takeover': 'The new version changes how a core Host service (HMR, storage, subprocess, session, ...) is wired compared with the installed version; that capability change needs the official manager.', 'reason.package-version-unverified': 'The installed package identity or version could not be verified.', 'reason.version-query-failed': 'Published versions could not be queried.',
      waiting: 'Waiting for current tasks to finish naturally', waitingDetail: 'Current tasks continue without cancellation. The Host waits until all active Agent tasks naturally finish, then defers new requests/steps while replacing eligible managed plugins.',
      staging: 'Preparing target files', stagingDetail: 'Target and previous package files are being downloaded and checked before any installed plugin is stopped. Current tasks continue; the batch will then wait for them to finish naturally.',
      running: 'Updating selected plugins', runningDetail: 'Updates run one at a time. This panel never force-cancels tasks or restarts DSH. If an update fails, later targets may be skipped to protect shared services.',
      continuing: 'Leaving this panel does not cancel a confirmed Host batch. Reopen the panel or refresh state to recover progress.', cancelWait: 'Cancel waiting batch', cancelWaitHelp: 'Only a batch that has not started updating can be cancelled here. Completed updates cannot be undone by this action.',
      cancelledWait: 'Cancellation requested. Rechecking the actual Host state…', finished: 'Batch completed', finishedDetail: 'Check each row, including skipped or restart-required targets. A successful package install is not sufficient evidence of successful Host activation.',
      phase: 'Batch phase', 'phase.waiting': 'Waiting', 'phase.running': 'Running', 'phase.finished': 'Finished', 'phase.unknown': 'Unknown', 'phase.interrupted': 'Interrupted',
      steps: 'Observed steps', batchResults: 'Per-plugin results', resultDetails: 'Result and recovery details', noResults: 'No per-plugin results have been retained yet.',
      'step.checking': 'Checking compatibility', 'step.waiting-for-idle': 'Waiting for safe idle', 'step.preparing': 'Preparing target files', 'step.removing': 'Stopping / removing old version', 'step.installing': 'Installing target', 'step.restoring': 'Restoring previous version', 'step.updating': 'Updating target', 'step.verifying': 'Verifying Host activation',
      pollLost: 'Progress could not be read. The batch may still be waiting or running; no success, failure or rollback is inferred.', pollLimit: 'Automatic progress checks stopped after 15 minutes. The Host batch was not cancelled. Refresh state to continue checking.', checkProgress: 'Check progress again', unknownOperation: 'The recorded outcome is unknown. Recheck installed state before retrying.',
      externalBusy: 'Another plugin-manager operation is running. Wait for it to settle before starting a new batch.',
      confirmTitle: 'Confirm selected online updates', confirm: 'Confirm and queue updates', cancel: 'Cancel',
      confirmImpact: 'Review every plugin and version below. The change affects all sessions in this profile. The Host waits for all current Agent tasks to finish naturally, then defers new requests/steps during the update. It does not force-cancel tasks.',
      confirmSafety: 'DSH will not be closed or restarted. This does not promise uninterrupted replacement of a running WSL environment or shared Host service: unsafe targets are blocked or reported as restart-required, not force-applied.',
      acknowledge: 'I reviewed the selected versions and accept the wait-for-idle task policy and profile-wide impact.', expires: 'Confirmation expires', expired: 'This confirmation expired. Cancel and check the current state again.',
      diagnosis: 'Diagnosis', diagnose: 'Recheck diagnosis', closeDetails: 'Close details', rows: 'Active / enabled Host rows', source: 'Source', hostState: 'Current Host state',
      locks: 'Check file use', lockIntro: 'A bounded read-only file sample and Windows process-use check. Related file users are not automatically proven to cause a lock.', lockUnknown: 'File-use evidence is incomplete or unsupported. This does not mean there are no locks.', lockChecked: 'Read-only sample checked',
      processes: 'Related file users', files: 'Sampled files', noProcesses: 'No related process was reported for this sample. Unchecked files or processes may still matter.', pid: 'PID', application: 'Application', startTime: 'Process start time',
      history: 'Recent update evidence', noHistory: 'No retained operation records yet.', officialHistory: 'Official-button events retain whitelisted status/error codes only, not the complete exception.', ownHistory: 'This panel retained the sanitized management result.',
      detail: 'Sanitized source details', copy: 'Copy sanitized JSON', copied: 'Copied', copyFailed: 'Clipboard access failed. Select and copy the visible JSON instead.', stage: 'Last stage', outcome: 'Outcome', from: 'From', to: 'To', time: 'Time', recoveryOutcome: 'Previous-version recovery result',
      'outcome.applied': 'Applied', 'outcome.failed': 'Failed', 'outcome.restart-required': 'Host restart required', 'outcome.cancelled': 'Cancelled', 'outcome.overridden': 'Overridden', 'outcome.unknown': 'Unknown',
      'stage.install': 'Package installation', 'stage.enable': 'Host activation', 'stage.remove': 'Removal',
      'class.file-sharing-conflict': 'File sharing conflict observed', 'class.possible-file-conflict': 'Possible file sharing conflict', 'class.permission-failed': 'Permission or file-use failure', 'class.activation-failed': 'Installed, but Host activation failed', 'class.restart-required': 'Host restart required', 'class.incompatible-version': 'Version incompatible',
      'class.operation-failed': 'Management operation failed', 'class.active': 'Host rows active', 'class.package-missing': 'Package unavailable', 'class.runtime-inactive': 'Some Host rows are inactive', 'class.unknown': 'Insufficient evidence',
      activationHelp: 'An activation failure is not proof of a Windows file lock. Read the retained first failure and recovery results.', conflictHelp: 'Review file-use evidence. This panel does not close processes or force-release handles.', restartHelp: 'This target needs a Host restart and cannot meet the online-update policy. DSH is not restarted automatically.',
      activeHelp: 'Host active state does not verify the target plugin’s full functionality or browser synchronization.', unknownHelp: 'No complete diagnostic establishes the exact cause. Unknown results are never labelled updated.',
      requestFailed: 'The request did not complete.', transportFailed: 'The Host could not be reached or returned an invalid answer. No update outcome is inferred.', timeout: 'The read exceeded its deadline. Retry the check; this is not proof that an update failed.',
      stale: 'The prepared versions or confirmation changed or expired. Refresh and review again.', renderFailed: 'The update panel could not render. Refresh the page; no operation is automatically retried.', persistence: 'History persistence warning', limitations: 'Limits and safety boundaries',
    };
    const ZH = {
      panel: '插件在线更新', title: '插件在线更新', intro: '检查全部已安装插件的最新兼容正式版，勾选后批量更新；不退出 DSH，逐项查看实际结果。',
      profile: '配置范围', runtime: 'DSH 版本', refresh: '刷新安装状态', scan: '检查全部更新', scanning: '正在查询发布版本…', loading: '正在读取当前状态…',
      scanHint: '只有点击“检查全部更新”才查询发布版本。不会自动勾选，检查本身不修改插件。',
      safety: 'DSH 保持打开。普通受管插件等当前任务自然结束后才更新，不强制取消任务；保守的第一版不支持 WSL / 核心服务接管及不安全的原生、共享运行时目标。',
      installed: '已安装插件', package: '插件', currentVersion: '当前版本', latestVersion: '最新兼容正式版', status: '状态', actions: '详情', select: '勾选',
      selectAll: '全选可更新项', clearSelection: '取消全选', selectedCount: '已选择', availableCount: '可更新', updateSelected: '一键更新所选',
      notChecked: '尚未检查', empty: '未返回已安装的配置插件。', noAvailable: '未找到可安全提供的兼容正式版更新。', uncheckedHint: '请先检查更新，再选择插件。',
      'status.not-checked': '尚未检查', 'status.up-to-date': '已是最新', 'status.available': '可更新', 'status.blocked': '已阻止', 'status.error': '检查失败',
      'quick.not-checked': '尚未检查', 'quick.check-failed': '版本检查失败', 'quick.available': '可更新', 'quick.up-to-date': '已是最新',
      'quick.needs-restart': '需重启 DSH 后更新', 'quick.local-source': '本地安装', 'quick.no-compatible': '无兼容正式版',
      'quick.preflight-failed': '更新前检查失败，可重试', preflightRetryHint: '只读预检查遇到网络错误，不是策略拒绝；点「检查全部更新」即会重试。',
      hostDependenciesBadge: '⚠ 宿主包依赖', hostDependenciesWarning: '该插件把宿主包（{list}）声明成普通依赖：包管理器可能把它安装到 profile 根部，宿主可能因此停用对应的核心行。更新仍会照常尝试。',
      'quick.unavailable': '暂不支持在线更新', 'quick.recovery-required': '可恢复旧版',
      rowDetails: '详情', diagnostics: '诊断与历史记录',
      copyReport: '复制错误报告', copyReportAll: '复制诊断报告', reportCopied: '诊断报告已复制到剪贴板', reportFailed: '无法自动复制，请选中下面的 JSON 手动复制。', showReport: '报告 JSON（可选中复制）', reportHint: '反馈时请附上这段 JSON；它包含版本、错误码和脱敏消息，不包含你的文件。',
      'reason.wsl-declaration-review-required': '新版本新增了尚未审查的声明表达式。', 'reason.wsl-structure-changed': '新版本改动了这个插件声明的行或核心覆盖项。', 'reason.wsl-foreign-preset-module': '新版本加载了本插件和 DSH 自带包以外的模块。',
      restartPending: '等待下次启动 DSH 完成更新', restartApplied: '重启后已完成', restartRolledBack: '重启后已回滚原版本', restartUnknown: '重启后核验未能确定', diagnosticNote: '仅供排障的技术证据，已脱敏且不会上传。',
      restartRollback: '这个配置范围无法在 DSH 运行时替换该插件。已恢复原版本；请在重启 DSH 后或用官方插件管理器更新。',
      'status.waiting': '等待中', 'status.preparing': '准备中', 'status.updating': '更新中', 'status.updated': '已更新', 'status.failed': '失败', 'status.skipped': '已跳过', 'status.restart-required': '需重启宿主', 'status.unknown': '未知',
      'state.active': '宿主条目活跃', 'state.inactive': '未活跃', 'state.partial': '部分活跃', 'state.missing': '包不可用', 'state.unknown': '未知',
      'source.registry': '安装源', 'source.git': 'Git', 'source.local': '本地 / 链接', 'source.other': '其他 / 受保护',
      reasonTitle: '此目标不可更新的原因', 'reason.self-update-blocked': '更新器运行时不能替换自身。', 'reason.management-or-shipped-bundle': '内置或管理关键插件受到保护。',
      'reason.registry-updates-only': '此版本检查安装源插件，不修改 Git 或本地链接来源。', 'reason.not-profile-installed': '不是此配置的已安装依赖。',
      'reason.recorded-recovery-only': '只有此前记录的失败更新可提供恢复目标。', 'reason.host-dependency': '共享宿主依赖变化需要重启宿主。', 'reason.restart-required': '宿主不能在线替换此目标。',
      'reason.incompatible-version': '发布目标与当前 DSH 不兼容。', 'reason.no-compatible-stable-version': '未提供更高的兼容正式版本。', 'reason.wsl-online-not-supported': '第一版不支持 WSL 执行环境热替换。',
      noValue: '未提供', unknown: '未知', lastChecked: '上次版本检查', taskPolicy: '任务政策', batchLimit: '每批最多确认 20 个目标；本批结束后可继续选择其余更新。', selectFirstBatch: '选择前 20 个可更新项', activeTasks: '当前运行中的智能体任务',
      'reason.online-update-gate-unavailable': '安全任务门禁或预备安装支持不可用，禁止执行更新。', 'reason.host-runtime-dependencies': '此目标可能替换宿主运行时依赖，已阻止。', 'reason.native-or-shared-runtime': '原生或共享运行时依赖不能由此在线更新器安全替换。', 'reason.native-payload-not-hot-replaceable': '该插件加载了原生二进制，宿主占用期间既不能替换也不能回滚，请用官方管理器更新。', 'reason.core-service-takeover': '新版本相对已安装版本改动了宿主核心服务（HMR、存储、子进程、会话等）的接线方式，该能力变化请用官方管理器更新。', 'reason.package-version-unverified': '无法核验已安装包的身份或版本。', 'reason.version-query-failed': '无法查询发布版本。',
      waiting: '等待当前任务自然结束', waitingDetail: '当前任务继续，不会被取消。宿主等待所有活动智能体任务自然结束后，在替换符合条件的受管插件期间暂缓新请求和步骤。',
      staging: '正在准备目标文件', stagingDetail: '停止已安装插件之前，先下载并校验目标及旧版文件。当前任务继续；准备完成后批次等待任务自然结束。',
      running: '正在更新所选插件', runningDetail: '逐个更新，不强制取消任务、不重启 DSH。某项失败时可能跳过后续目标，保护共享服务。',
      continuing: '离开面板不会取消已确认的宿主批次；重新打开或刷新状态可恢复查看进展。', cancelWait: '取消等待中的批次', cancelWaitHelp: '只能取消尚未开始更新的批次；此操作不能撤销已完成的更新。',
      cancelledWait: '已请求取消，正在重新核对宿主实际状态…', finished: '批次已结束', finishedDetail: '请逐项查看失败、跳过和需重启目标。安装命令成功不等于宿主加载成功。',
      phase: '批次阶段', 'phase.waiting': '等待中', 'phase.running': '运行中', 'phase.finished': '已结束', 'phase.unknown': '未知', 'phase.interrupted': '已中断',
      steps: '已观察步骤', batchResults: '逐项更新结果', resultDetails: '结果与恢复详情', noResults: '暂无保留的逐项结果。',
      'step.checking': '检查兼容性', 'step.waiting-for-idle': '等待安全空闲', 'step.preparing': '准备目标文件', 'step.removing': '停止 / 移除旧版', 'step.installing': '安装目标版本', 'step.restoring': '恢复旧版', 'step.updating': '更新目标', 'step.verifying': '验证宿主加载',
      pollLost: '暂时无法读取进展，批次可能仍在等待或运行；不能据此认定成功、失败或回滚。', pollLimit: '自动进展检查达到 15 分钟上限，宿主批次未被取消；刷新状态可继续查看。', checkProgress: '重新检查进展', unknownOperation: '记录中的结果未知，请先核对安装状态，不要直接重试。',
      externalBusy: '其他插件管理操作正在执行，请等待结束后再开始新批次。',
      confirmTitle: '确认所选在线更新', confirm: '确认并排队更新', cancel: '取消',
      confirmImpact: '请核对下面每个插件与版本。变更影响该配置的所有会话；宿主等待所有当前智能体任务自然结束后，更新期间暂缓新请求和步骤，不强制取消任务。',
      confirmSafety: '不会关闭或重启 DSH，但不承诺运行中的 WSL 环境或共享宿主服务能无间断替换；不安全的目标会被阻止或标为需重启，不会强行应用。',
      acknowledge: '我已核对所选版本，并理解等待安全空闲的任务政策及整个配置的影响。', expires: '确认有效期至', expired: '确认已过期，请取消后重新检查当前状态。',
      diagnosis: '诊断', diagnose: '重新诊断', closeDetails: '收起详情', rows: '活跃 / 已启用宿主条目', source: '来源', hostState: '当前宿主状态',
      locks: '检查文件占用', lockIntro: '有界、只读的文件抽样与 Windows 进程使用检查；相关文件使用者不一定就是占用原因。', lockUnknown: '占用证据不完整或检查不受支持，不能据此判断“没有占用”。', lockChecked: '已完成只读抽样',
      processes: '相关文件使用进程', files: '抽样文件', noProcesses: '本次抽样未报告相关进程，未检查的文件或进程仍可能存在。', pid: 'PID', application: '应用', startTime: '进程启动时间',
      history: '最近更新证据', noHistory: '暂无保留的操作记录。', officialHistory: '官方按钮事件仅保留允许保存的状态和错误码，没有完整异常。', ownHistory: '本面板保留了脱敏管理结果。',
      detail: '脱敏原始详情', copy: '复制脱敏 JSON', copied: '已复制', copyFailed: '无法访问剪贴板，请选择可见 JSON 手动复制。', stage: '最后执行环节', outcome: '结果', from: '原版本', to: '目标版本', time: '时间', recoveryOutcome: '旧版恢复结果',
      'outcome.applied': '已应用', 'outcome.failed': '失败', 'outcome.restart-required': '需重启宿主', 'outcome.cancelled': '已取消', 'outcome.overridden': '被覆盖', 'outcome.unknown': '未知',
      'stage.install': '包安装', 'stage.enable': '宿主加载', 'stage.remove': '移除',
      'class.file-sharing-conflict': '已观察到文件共享冲突', 'class.possible-file-conflict': '可能存在文件共享冲突', 'class.permission-failed': '权限或文件使用失败', 'class.activation-failed': '已安装，但宿主加载失败', 'class.restart-required': '需重启宿主', 'class.incompatible-version': '版本不兼容',
      'class.operation-failed': '管理操作失败', 'class.active': '宿主条目活跃', 'class.package-missing': '包不可用', 'class.runtime-inactive': '部分宿主条目未活跃', 'class.unknown': '证据不足',
      activationHelp: '加载失败不证明是 Windows 文件锁，请查看保留的首次失败与恢复结果。', conflictHelp: '核对文件使用证据；本面板不关闭进程、不强制释放句柄。', restartHelp: '此目标需要重启宿主，无法满足在线更新政策；本面板不会自动重启 DSH。',
      activeHelp: '宿主活跃状态不证明目标插件全部功能或浏览器同步正常。', unknownHelp: '没有完整诊断可以确定原因，未知结果不会标为已更新。',
      requestFailed: '请求未完成。', transportFailed: '无法连接宿主或未返回有效结果，不能据此推断更新结果。', timeout: '读取超过时限，请重试检查；这不代表更新失败。',
      stale: '准备时的版本已变化或确认已过期，请刷新后重新核对。', renderFailed: '更新面板未能渲染，请刷新页面；不会自动重试任何操作。', persistence: '记录保存警告', limitations: '检查限制与安全边界',
    };
    Object.assign(EN, {
      scanProgressLabel: 'Checking {name} ({done}/{total})',
      'scan.phase.versions': 'Querying published versions…',
      'scan.phase.preflight': 'Verifying update packages',
      'scan.phase.complete': 'Check complete',
    },
    { 'reason.preflight-network-failed': 'The read-only pre-check hit a network error before any policy decision; retry the check.', 'reason.dependency-graph-update-requires-separate-review':'This plugin has dependencies requiring separate review before online replacement.', 'reason.core-service-takeover':'The new version rewires a core Host service compared with the installed version; use the official manager for that change.', progressUnknown:'Progress is unknown', progressUnknownDetail:'The last observation is retained; check current state rather than assuming the operation is still running.' });
    Object.assign(ZH, {
      scanProgressLabel: '正在检查 {name}（{done}/{total}）',
      'scan.phase.versions': '正在查询发布版本…',
      'scan.phase.preflight': '正在核对更新包',
      'scan.phase.complete': '检查完成',
    },
    { 'reason.preflight-network-failed': '只读预检查在作出任何判定前遇到网络错误，请重新检查。', 'reason.dependency-graph-update-requires-separate-review':'此插件包含依赖图，需单独审查后才能在线替换。', 'reason.core-service-takeover':'新版本相对已安装版本改动了宿主核心服务接线，请用官方管理器更新。', progressUnknown:'进展未知', progressUnknownDetail:'保留最后观察结果，请重新核对当前状态，不能据此认定仍在执行。' });
    Object.assign(EN, {
      dependencyClosurePlanned: 'This update must first download {packages} dependency package(s) from public npm, then prepare the generation.',
      dependencyClosureHint: 'Downloads {packages} dependency package(s) ({size}) from public npm, verifies each archive, and embeds them in the new generation.',
    });
    Object.assign(ZH, {
      dependencyClosurePlanned: '此更新需要先从公共 npm 下载 {packages} 个依赖包，之后才能准备代际。',
      dependencyClosureHint: '会从公共 npm 下载 {packages} 个依赖包（{size}），逐个校验归档后放进新的代际。',
    });
    Object.assign(EN, {
      intro: 'Check available updates for installed plugins, select compatible releases, and review each result without closing DSH.',
      noAvailable: 'No selectable updates are currently available. Review each version and source requirement below.',
      'reason.registry-updates-only': 'This version queries registry packages; Git or linked packages need an independent update path.',
      safety: 'DSH stays open. Review plugin updates and choose the task policy at confirmation: wait by default, or explicitly approve stopping current Agent tasks. High-impact updates receive warnings; compatibility and actual Host results still decide whether they can apply.',
      confirmImpact: 'Review every plugin and version below. Changes affect all sessions in this profile. Choose how current Agent tasks are handled; waiting is the default.',
      confirmSafety: 'DSH is not automatically closed or restarted. Stopping tasks is optional and requires separate explicit consent. Shared/core-service updates can still fail to reload or require a Host restart; those outcomes are reported, never called successful online updates.',
      acknowledge: 'I reviewed the selected plugin versions and the profile-wide impact.',
      waitPolicy: 'Wait for current tasks to finish naturally (Default)', waitPolicyHelp: 'Do not cancel running tasks. Update after they become idle, then resume deferred new work.',
      stopPolicy: 'Stop current Agent tasks, then update', stopPolicyHelp: 'Request cancellation only for Agent tasks running when you click Confirm; clear their queued input and wait for admitted work to settle. Tasks started later are waited for, not stopped. External terminals and independent Workers are not killed.',
      stopConsent: 'I explicitly agree to stop all running Agent tasks in this profile and clear their queued input. I have saved my work; already completed operations cannot be undone.',
      confirmWait: 'Confirm and wait for idle', confirmStop: 'Confirm stopping tasks and update', reviewing: 'Reviewing selected updates…', queuing: 'Submitting confirmed updates…',
      highImpact: 'High-impact plugin: replacement may temporarily stop shared execution or file services. This is a warning, not proof that live replacement has been verified.',
      diagnosis: 'Details / failure details', 'reason.self-update-blocked': 'The running updater needs an independent update path; it cannot replace itself.',
      'reason.management-or-shipped-bundle': 'This component is managed with the Host version or requires independent updating.',
      'reason.core-service-takeover': 'The update changes core Host service wiring compared with the installed version.',
      'reason.wsl-online-not-supported': 'WSL updates use the verified generation path; unsupported future versions require another verification.',
      runningDetail: 'Updates run sequentially using your confirmed task policy. DSH is not automatically restarted. Failure or restart-required stops later targets and retains exact recovery results.',
      'step.stopping-current-tasks': 'Stopping current Agent tasks with your explicit approval', 'step.cancelling-active': 'Requesting cancellation of current Agent tasks',
      'reason.high-impact': 'High-impact shared/core plugin: review the selected task policy and actual activation result.'
    });
    Object.assign(ZH, {
      intro: '检查已安装插件的可用更新，勾选兼容版本后批量更新；不退出 DSH，逐项查看结果。',
      noAvailable: '目前没有可选更新，请查看各项版本和安装来源要求。',
      'reason.registry-updates-only': '此版本查询安装源包；Git 或本地链接需要独立更新路径。',
      safety: 'DSH 保持打开。确认更新时选择任务政策：默认等待当前任务自然结束，也可单独明确同意停止当前智能体任务后更新。高影响目标会警告，兼容性与实际宿主结果仍决定能否应用。',
      confirmImpact: '请核对下面每个插件与版本。变更影响该配置的所有会话；请选择如何处理当前智能体任务，默认等待自然结束。',
      confirmSafety: '不会自动关闭或重启 DSH。停止任务是可选动作，必须另行明确同意。共享／核心服务更新仍可能加载失败或需要宿主重启；这些结果会如实显示，不算在线更新成功。',
      acknowledge: '我已核对所选插件版本，并理解对整个配置的影响。',
      waitPolicy: '等待当前任务自然结束（默认）', waitPolicyHelp: '不取消正在运行的任务，等任务空闲后更新，完成后继续暂缓的新工作。',
      stopPolicy: '停止当前智能体任务后更新', stopPolicyHelp: '仅请求停止点击确认时正在运行的智能体任务、清除它们的排队输入，并等待已开始的工作结束；之后新启动的任务只等待，不会停止。不会杀掉外部终端或独立 Worker。',
      stopConsent: '我明确同意停止当前配置所有运行中的智能体任务并清除排队输入。我已保存工作，已经完成的操作不能撤销。',
      confirmWait: '确认并等待空闲', confirmStop: '确认停止任务并更新', reviewing: '正在检查所选更新…', queuing: '正在提交已确认更新…',
      highImpact: '高影响插件：替换期间可能停止共享执行或文件服务。该警告不代表已验证其无间断热替换。',
      diagnosis: '详情／故障详情', 'reason.self-update-blocked': '运行中的更新器需要独立更新，不能替换自身。',
      'reason.management-or-shipped-bundle': '此组件需随宿主版本管理或独立更新。',
      'reason.core-service-takeover': '该更新改动了宿主核心服务接线（与已安装版本不同）。',
      'reason.wsl-online-not-supported': 'WSL 使用已验证的代际路径更新；未验证的未来版本需另行检查。',
      runningDetail: '按你确认的任务政策逐项更新，不自动重启 DSH。失败或需重启时暂停后续目标，保留实际恢复结果。',
      'step.stopping-current-tasks': '按你明确同意的政策停止当前智能体任务', 'step.cancelling-active': '正在请求停止当前智能体任务',
      'reason.high-impact': '高影响共享／核心插件，请核对任务政策及实际加载结果。'
    });
    Object.assign(EN, {
       'reason.wsl-version-not-yet-verified': 'This WSL version has not yet passed runtime-generation verification.',
       'reason.wsl-archive-requires-new-review': 'The WSL archive bytes differ from the verified build.',
       'reason.high-impact': 'High-impact plugin: confirm task handling and verify activation afterward.',
       safety: 'DSH stays open. Wait for current tasks by default; stopping requires separate consent. WSL candidates are checked against public archives and the generation contract, not a fixed version list. The 0.26.2 → 0.29.0 path passed isolated Host tests. Existing sessions may retain their prior presets.'
    });
    Object.assign(ZH, {
       'reason.wsl-version-not-yet-verified': '此 WSL 版本尚未通过代际更新验证。',
       'reason.wsl-archive-requires-new-review': 'WSL 归档字节与已验证构建不同，需要重新检查。',
       'reason.high-impact': '高影响插件，请确认任务处理方式并核对更新后的加载结果。',
       safety: 'DSH 保持打开：默认等待当前任务，停止任务需额外确认。WSL 新版按公开原包与代际契约检查，不再只限固定版本名单；0.26.2 → 0.29.0 已通过隔离宿主验证。已有会话可能保留旧预设。'
    });
    Object.assign(EN, {"reason.wsl-version-format-unsupported":"The WSL target is not a supported stable version identity.","reason.wsl-archive-preflight-unavailable":"The WSL archive inspector is unavailable; verify updater activation.","reason.wsl-archive-preflight-failed":"WSL archive preflight failed before any installation; review diagnostics.","reason.wsl-provider-contract-changed":"The WSL service/preset declaration differs from the generation contract; this is not a version allowlist.","reason.wsl-runtime-dependency-contract-changed":"The WSL candidate introduces a different runtime dependency contract.","reason.wsl-client-contract-changed":"The WSL Client injection contract changed.","reason.wsl-peer-contract-changed":"The WSL Host peer contract changed.","reason.wsl-export-contract-changed":"WSL exports or resource targets do not match generation packaging constraints.","reason.wsl-native-resource-contract-changed":"The WSL archive contains an unsupported native resource path; it was not installed.","reason.wsl-package-resolution-contract-changed":"WSL package resolution or install declarations changed; no installation was performed.","reason.wsl-candidate-archive-changed":"The WSL candidate digest changed after inspection; check again.","reason.wsl-retained-generation-limit":"Retained WSL generations reached the safety limit; old resources are not silently deleted.","reason.wsl-generation-outcome-unknown":"The prior WSL update/recovery outcome is unknown; do not resend or recover automatically. Inspect the official manager."});
    Object.assign(ZH, {"reason.wsl-version-format-unsupported":"WSL 目标不是支持的正式版本格式。","reason.wsl-archive-preflight-unavailable":"WSL 原包检查服务不可用，请确认更新器已加载。","reason.wsl-archive-preflight-failed":"WSL 原包预检查未通过，尚未尝试安装；请查看具体诊断。","reason.wsl-provider-contract-changed":"新版 WSL 的服务／预设声明发生变化，未通过代际契约检查。不是版本号不在名单。","reason.wsl-runtime-dependency-contract-changed":"新版 WSL 引入了不同运行依赖，需要单独核对。","reason.wsl-client-contract-changed":"新版 WSL 客户端注入声明发生变化，需要单独核对。","reason.wsl-peer-contract-changed":"新版 WSL 的宿主依赖声明发生变化，需要单独核对。","reason.wsl-export-contract-changed":"WSL 导出或对应资源不符合代际包装条件。","reason.wsl-native-resource-contract-changed":"WSL 存在未获准的原生资源路径，未执行安装。","reason.wsl-package-resolution-contract-changed":"WSL 包解析或安装声明发生变化，未执行安装。","reason.wsl-candidate-archive-changed":"检查后 WSL 原包摘要变化，请重新检查，不复用旧确认。","reason.wsl-retained-generation-limit":"保留的 WSL 旧代达到安全上限；不会自动删除仍可能使用的旧资源。","reason.wsl-generation-outcome-unknown":"上次 WSL 更新／恢复结果未知，不能自动重发或恢复，请先核对官方管理器状态。"});
    Object.assign(EN, {
      restore: 'Review previous-version recovery', recoveryTarget: 'Recorded recovery version', recoveryRequired: 'Recovery requires your review', recoveryHelp: 'Only the previous package recorded for this failed operation can be restored. Review its version and task policy; no arbitrary downgrade is accepted.',
      confirmRestoreTitle: 'Confirm recorded previous-version recovery', confirmRestoreImpact: 'Restore only the previous package from this failed operation. This affects the whole profile; waiting for current Agent tasks is the default.',
      acknowledgeRestore: 'I reviewed the recorded recovery version and understand the profile-wide impact.', confirmRestoreWait: 'Confirm recovery and wait for idle', confirmRestoreStop: 'Confirm stopping tasks and recover', restoring: 'Restoring recorded previous version', reviewingRestore: 'Checking recorded recovery…', restoreResults: 'Previous-version recovery results',
      'status.restoring': 'Restoring', 'status.restored': 'Restored', 'status.recovery-required': 'Recovery required', 'outcome.recovery-required': 'Recovery required',
      historyTruncated: 'Older or oversized diagnostic text was trimmed to the history budget; installation identities and recovery targets are retained separately.',
      packageVerification: 'Package verification', hostVerification: 'Host activation', 'package.verified': 'Package version verified', 'package.unknown': 'Package verification unknown', 'package.failed': 'Package verification failed',
      'host.active': 'Expected Host rows active', 'host.inactive': 'Host rows inactive', 'host.disabled': 'Host disabled by selection', 'host.unknown': 'Host activation unknown',
      clientSync: 'Current page plugin synchronization', clientSyncing: 'Synchronizing this page…', clientSyncFailed: 'This page has synchronization failures', clientSyncIdle: 'No current page synchronization failure reported', clientSyncUnknown: 'Current page synchronization is unknown', clientSyncRetry: 'Retry this page synchronization',
      clientSyncHelp: 'This page status is separate from package installation and Host activation. It does not verify plugin functionality, other pages, or migration of existing WSL sessions.',
      installProgress: 'Installation progress', 'install.installing': 'Package installer running', 'install.cancelling': 'Installer cancellation requested', 'install.applying': 'Applying Host composition', logDetails: 'Recent bounded installer output', logBound: 'Only a bounded tail is displayed; review the retained management result for the outcome.',
      detailTruncated: 'The detail preview is truncated; Copy sanitized JSON keeps the complete received result.',
      sourcePublicOnly: 'Automatic updates accept verified public npm package origins only. Private registries are not silently replaced by public packages.',
      'reason.registry-origin-unsupported': 'This registry origin is not supported for automatic updates.', 'reason.registry-origin-unverified': 'The registry that provided this version could not be verified.', 'reason.source-identity-unverified': 'The installed archive identity could not be verified.',
      'reason.recovery-source-changed': 'The installed source changed since this failure; check current state before recovery.', 'reason.recovery-archive-unavailable': 'The recorded recovery archive is unavailable or cannot be verified.', 'reason.state-changed': 'Plugin state changed; refresh and review again.',
      stagingDetail: 'Target and recorded previous archives are prepared and verified before replacement. Current tasks continue during preparation; the confirmed task policy runs afterward.',
      waitingDetail: 'Existing Agent drivers are coordinated; new formal steps wait during replacement. Agent creation, prompt/tool assembly, maintenance and independent workers are not frozen.',
      waitPolicyHelp: 'Do not cancel current Agent tasks. After their drivers become idle, temporarily defer new formal steps during replacement.',
      stopPolicy: 'Stop current Agent tasks before replacement', confirmSafety: 'DSH is not automatically closed or restarted. Task stopping needs separate consent. Host activation, current page synchronization and existing WSL session generations are separate observations.',
      runningDetail: 'Replacement runs sequentially under your confirmed task policy. Failure or restart-required stops later targets; recorded recovery has its own result. New formal steps wait, but setup, prompt assembly, maintenance and external workers are not globally frozen.'
    });
    Object.assign(ZH, {
      restore: '核对并恢复记录的旧版', recoveryTarget: '记录的恢复版本', recoveryRequired: '需要核对恢复', recoveryHelp: '只能恢复此次失败记录对应的旧包。请核对版本和任务政策，不接受任意降级。',
      confirmRestoreTitle: '确认恢复此次失败记录的旧版', confirmRestoreImpact: '只恢复此次失败对应的旧包。变更影响整个配置；默认等待当前智能体任务结束。',
      acknowledgeRestore: '我已核对记录的恢复版本，并理解对整个配置的影响。', confirmRestoreWait: '确认恢复并等待空闲', confirmRestoreStop: '确认停止任务并恢复', restoring: '正在恢复记录的旧版', reviewingRestore: '正在核验记录的恢复目标…', restoreResults: '旧版恢复结果',
      'status.restoring': '恢复中', 'status.restored': '已恢复', 'status.recovery-required': '需要恢复', 'outcome.recovery-required': '需要恢复',
      historyTruncated: '较旧或过大的诊断文本已按日志预算裁剪；安装身份与失败恢复目标单独保留。',
      packageVerification: '包安装核验', hostVerification: '宿主加载', 'package.verified': '包版本已核验', 'package.unknown': '包核验未知', 'package.failed': '包核验失败',
      'host.active': '预期宿主条目活跃', 'host.inactive': '宿主条目未活跃', 'host.disabled': '按选择保持禁用', 'host.unknown': '宿主加载未知',
      clientSync: '本页面插件同步', clientSyncing: '正在同步本页面…', clientSyncFailed: '本页面存在同步失败', clientSyncIdle: '当前未报告本页面同步错误', clientSyncUnknown: '本页面同步状态未知', clientSyncRetry: '重试本页面同步',
      clientSyncHelp: '本页面状态与包安装、宿主加载分开显示，不证明插件功能、其他页面或已有 WSL 会话已换代。',
      installProgress: '安装进展', 'install.installing': '包安装器运行中', 'install.cancelling': '已请求取消安装器', 'install.applying': '正在应用宿主配置', logDetails: '最近的有界安装输出', logBound: '仅显示有界尾部输出；实际结果以保留的管理结果为准。',
      detailTruncated: '详情预览已截断；“复制脱敏 JSON”保留收到的完整结果。',
      sourcePublicOnly: '自动更新仅接受已核验的公共 npm 包来源，不会把私有源静默替换为公有同名包。',
      'reason.registry-origin-unsupported': '此安装源不支持自动更新。', 'reason.registry-origin-unverified': '无法核验提供此版本的安装源。', 'reason.source-identity-unverified': '无法核验已安装归档的身份。',
      'reason.recovery-source-changed': '失败后安装来源已变化，恢复前请核对当前状态。', 'reason.recovery-archive-unavailable': '记录的恢复归档不可用或无法通过核验。', 'reason.state-changed': '插件状态已变化，请刷新后重新核对。',
      stagingDetail: '替换前准备并核验目标与记录的旧版归档。准备期间当前任务继续，之后才执行确认的任务政策。',
      waitingDetail: '协调已有智能体驱动，替换期间暂缓新正式步骤；不冻结智能体创建、提示／工具组装、维护操作或独立 Worker。',
      waitPolicyHelp: '不取消当前智能体任务；其驱动空闲后，替换期间暂缓新正式步骤。',
      stopPolicy: '替换前停止当前智能体任务', confirmSafety: '不会自动关闭或重启 DSH，停止任务必须额外同意。宿主加载、本页面同步和已有 WSL 会话代际是不同的观察结果。',
      runningDetail: '按确认的任务政策逐项替换。失败或需重启时停止后续项，记录的恢复有独立结果；暂缓新正式步骤，不保证全局冻结创建、提示组装、维护或外部 Worker。'
    });
    Object.assign(EN, {
      selfMode: 'Updater self-update · Host handoff', selfHelp: 'Select the updater separately. The official Host manager installs it and handles its own rollback; this panel may disappear and reload.',
      selfGateHelp: 'Tasks are coordinated before handoff. When the old updater unloads its gate is released; new work is not frozen throughout Host replacement.',
      confirmSelfTitle: 'Confirm updater self-update', confirmSelfImpact: 'Update this updater only. Installation and rollback are handed to the independent official Host manager, not the normal batch worker.',
      acknowledgeSelf: 'I reviewed the version and understand that the old task gate ends at unload, and missing final evidence remains unknown.', selfWait: 'Confirm, wait for idle and hand off', selfStop: 'Confirm task stopping and hand off',
      selfResult: 'Updater self-update evidence', selfHandedOff: 'Handed to the official Host manager', selfUnknown: 'Self-update result is unknown. Check installed state and the official manager; never automatically resend the update.',
      selfContinuing: 'The old panel may unload. The independent Host operation continues; the new panel reads a separate bounded result receipt. DSH is not restarted automatically.',
      'status.handed-off': 'Host handoff', 'phase.handed-off': 'Host handoff',
      'reason.self-update-registry-required': 'Self-update requires a registry installation; linked or Git sources need independent updating.',
      'reason.self-host-registry-plan-unsupported': 'The Host registry plan can fall through to another registry; self-update cannot preserve the strict public-source policy.',
      'reason.self-yaml-dependency-unsupported': 'The target must pin the already verified yaml dependency version.',
      'reason.self-registry-metadata-unavailable': 'The target or previous registry version is unavailable; Host recovery cannot be prechecked.',
      'reason.self-update-outcome-unknown': 'A previous self-update has no final evidence; inspect the official manager before another update.',
      'reason.self-update-public-origin-required': 'The version query answered from an unsupported registry. Use the official manager to review the source.',
      'reason.self-query-origin-unverified': 'The public npm query origin could not be verified.',
      'reason.self-yaml-version-unverified': 'The installed yaml dependency differs from the reviewed version; use the official manager.',
      'reason.self-installed-original-unverified': 'Installed files do not match the original registry package; self-update is refused.',
      'reason.self-update-host-not-active': 'The updater does not have its expected active Host row. Check official plugin state.',
      'reason.self-runtime-graph-changed': 'The target changes Host requirements or its runtime graph; independent updating is required.',
      'reason.self-update-handoff-unavailable': 'This Host does not provide the required independent update path.',
      'reason.self-update-separate-confirmation': 'Select the updater separately from normal plugin batches.'
    });
    Object.assign(ZH, {
      selfMode: '更新器自身升级 · 宿主交接', selfHelp: '请单独勾选更新器。安装和宿主自动恢复交给独立的官方管理器；旧面板可能消失后重新加载。',
      selfGateHelp: '交接前协调当前任务；旧更新器卸载时释放门禁，不保证宿主替换全程暂缓新任务。',
      confirmSelfTitle: '确认更新器自身升级', confirmSelfImpact: '此次只升级更新器。安装与恢复交给独立的官方宿主管理器，不走普通批次执行器。',
      acknowledgeSelf: '我已核对版本，并理解旧任务门禁在卸载时结束，缺失的最终结果仍为未知。', selfWait: '确认、等待空闲并交给宿主', selfStop: '确认停止任务并交给宿主',
      selfResult: '更新器自身升级证据', selfHandedOff: '已交给官方宿主管理器', selfUnknown: '自身升级结果未知，请核对安装状态及官方管理器；不会自动重发更新。',
      selfContinuing: '旧面板可能卸载；独立宿主操作继续，新面板读取单独的有界结果记录。不会自动重启 DSH。',
      'status.handed-off': '宿主交接', 'phase.handed-off': '宿主交接',
      'reason.self-update-registry-required': '自身升级需要安装源包；Git 或本地链接仍需独立更新。',
      'reason.self-host-registry-plan-unsupported': '宿主安装源计划可能转向其它来源，无法保持严格的公共 npm 来源政策。',
      'reason.self-yaml-dependency-unsupported': '目标必须固定到当前已验证的 yaml 依赖版本。',
      'reason.self-registry-metadata-unavailable': '目标或旧版在安装源中不可用，无法预检宿主恢复路径。',
      'reason.self-update-outcome-unknown': '上次自身升级没有最终证据，请先核对官方管理器再更新。',
      'reason.self-update-public-origin-required': '版本查询来自不支持的安装源，请在官方管理器核对来源。',
      'reason.self-query-origin-unverified': '无法核验公共 npm 查询来源。',
      'reason.self-yaml-version-unverified': '实际 yaml 依赖与已审查版本不同，请使用官方管理器。',
      'reason.self-installed-original-unverified': '已安装文件与原始安装源包不一致，已阻止自身升级。',
      'reason.self-update-host-not-active': '更新器未具有预期活跃宿主条目，请核对官方插件状态。',
      'reason.self-runtime-graph-changed': '目标改变了宿主要求或运行图，需要独立更新。',
      'reason.self-update-handoff-unavailable': '当前宿主未提供所需的独立更新接口。',
      'reason.self-update-separate-confirmation': '更新器需与普通插件批次分开勾选确认。'
    });
    Object.assign(EN, {
      sourcePublicOnly: 'Ordinary updates use verified public npm origins. This updater also supports its fixed public GitHub repository at a full commit; sources are never silently migrated.',
      githubHead: 'GitHub main HEAD · not a release', githubHeadHelp: 'The version is read from the main branch. Confirmation pins the full commit below; same-version commits and arbitrary repositories are not offered.',
      githubRepository: 'Fixed GitHub repository', fromCommit: 'Previous-version commit', toCommit: 'Target commit', sourceVerification: 'Source commit verification',
      githubConfirmSafety: 'This target is main HEAD, not a signed GitHub release. The full commit shown above is pinned, but the Host downloads it again. Dependencies follow your current Host registry settings; this is not an atomic replacement. Installation and recovery can both fail, so keep the official manager available.',
      acknowledgeGithubSelf: 'I reviewed the fixed repository and full target commit. I understand the main-branch, dependency-source and recovery risks, that the old task gate ends at unload, and missing final evidence remains unknown.',
      'sourceCheck.verified': 'Expected source commit verified', 'sourceCheck.failed': 'Source commit mismatch', 'sourceCheck.unknown': 'Source commit unknown',
      'reason.self-update-registry-required': 'Self-update requires a registry install or this repository pinned to a full commit. Local links and unpinned Git sources are not migrated.',
      'reason.self-github-source-unsupported': 'Only this updater’s fixed public GitHub repository at a full commit is supported. Reinstall a pinned version through the official manager.',
      'reason.self-github-no-newer-version': 'The main branch has no higher stable package version.',
      'reason.self-github-network': 'GitHub cannot be read. Check network access and retry the check; no update was started.',
      'reason.self-github-rate-limited': 'GitHub refused this unauthenticated check. Wait and retry; no token is requested or stored.',
      'reason.self-github-tree-unsupported': 'The commit contains unsupported files or Git tree modes; use the official manager after review.',
      'reason.self-github-pack-policy-unsupported': 'Git packaging or dependency controls changed; independent review is required.',
      'reason.self-github-object-mismatch': 'GitHub object hashes could not be verified; no update is allowed.',
      'reason.self-installed-original-unverified': 'Installed files do not match the original package or fixed GitHub commit; self-update is refused.'
    });
    Object.assign(ZH, {
      sourcePublicOnly: '普通更新使用已核验的公共 npm 来源；更新器另支持自身固定公开 GitHub 仓库的完整提交，不会静默迁移来源。',
      githubHead: 'GitHub 主分支 HEAD · 非 Release', githubHeadHelp: '版本读取自主分支；确认绑定下方完整提交号，不提供同版本提交或任意仓库更新。',
      githubRepository: '固定 GitHub 仓库', fromCommit: '原版本提交', toCommit: '目标提交', sourceVerification: '来源提交核验',
      githubConfirmSafety: '目标来自主分支 HEAD，不是签名 GitHub Release。上方所示完整提交已绑定，但宿主会再次下载；依赖沿用当前宿主安装源，并非原子替换。安装和旧提交恢复均可能失败，请保留官方管理器作为处理入口。',
      acknowledgeGithubSelf: '我已核对固定仓库和完整目标提交，理解主分支、依赖来源及恢复风险；旧门禁在卸载时结束，缺失的最终结果仍为未知。',
      'sourceCheck.verified': '预期来源提交已核验', 'sourceCheck.failed': '来源提交不符', 'sourceCheck.unknown': '来源提交未知',
      'reason.self-update-registry-required': '自身升级需要安装源包，或此仓库固定完整提交的安装；不迁移本地链接和未固定的 Git 来源。',
      'reason.self-github-source-unsupported': '仅支持更新器固定公开仓库的完整提交；请通过官方管理器安装固定提交版本。',
      'reason.self-github-no-newer-version': '主分支没有更高的正式包版本。',
      'reason.self-github-network': '无法读取 GitHub，请检查网络后重试检查；尚未开始更新。',
      'reason.self-github-rate-limited': 'GitHub 拒绝了此次无凭据查询，请稍后再试；不会索取或保存令牌。',
      'reason.self-github-tree-unsupported': '提交含不支持的文件或 Git 类型，需审查后由官方管理器处理。',
      'reason.self-github-pack-policy-unsupported': 'Git 打包或依赖控制发生变化，需要独立审查。',
      'reason.self-github-object-mismatch': '无法核验 GitHub 对象摘要，禁止更新。',
      'reason.self-installed-original-unverified': '已安装文件与原包或固定 GitHub 提交不一致，已阻止自身升级。'
    });
    Object.assign(EN, {
      latestVersion: 'Checked version', taskPolicy: 'Tasks before updating', reasonTitle: 'Online update conditions',
      versionCheck: 'Version check', onlineUpdate: 'Online update', querySource: 'Version query source',
      querySourceUnknown: 'Source not verified', querySourceScope: 'This version result applies only to this query source, not every source.',
      queryGithubSource: 'This updater’s fixed GitHub repository · main HEAD, not a release',
      'version.available': 'Newer compatible stable version found', 'version.up-to-date': 'No newer stable version found on the current query source',
      'version.no-compatible-version': 'Newer published version found, but no eligible stable update candidate', 'version.unknown': 'Could not determine whether a compatible newer version exists',
      'version.error': 'Version check failed', 'version.not-checked': 'Not checked',
      'update.available': 'Available after confirmation', 'update.blocked': 'Conditions not met', 'update.no-update': 'No selectable newer version', 'update.not-checked': 'Not checked',
      installedVersionShown: 'Installed version', compatibleVersionShown: 'Compatible update candidate', publishedVersionShown: 'Newer published version',
      notCompatibleCandidate: 'No eligible stable candidate: it may be incompatible, deprecated or not a plugin bundle', candidateUnconfirmed: 'Published version found; the update candidate remains unconfirmed',
      selfCheckHelp: 'The updater has a separate update path. Click Check all updates to review its version and source; never mix it into a normal batch.',
      'reason.self-update-blocked': 'The updater is excluded from ordinary batches; review its independent self-update path.',
      'reason.host-runtime-dependencies': 'Declares @deepseek-ai runtime dependencies; this path is not yet verified. This is not proof that it replaces the Host.',
      'reason.registry-origin-unsupported': 'This query source is not admitted for online replacement; no source is silently migrated.',
      'reason.registry-origin-unverified': 'The actual query source could not be verified; online replacement remains blocked.',
      'reason.self-update-public-origin-required': 'Self-update requires a verified public npm query source; a mirror or other source is not silently migrated.',
      'reason.self-query-origin-unverified': 'The actual public npm query source could not be verified; self-update remains blocked.',
      'reason.registry-origin-changed': 'The effective query source changed during the check. Recheck before preparing any update.',
      'reason.version-metadata-incomplete': 'Version metadata is incomplete or the lookup window omits candidates. No latest-version or safe-update conclusion is inferred.',
      registrySourceVerification:'npm source and official update eligibility',
      'registryCheck.verified':'Registry installation preserved', 'registryCheck.failed':'Registry installation not verified', 'registryCheck.unknown':'Registry source unknown',
      'reason.legacy-archive-source-requires-migration':'An older Doctor update installed this plugin from a local archive. Automatic source migration is refused; review migration with the official manager.',
      'reason.registry-update-outcome-unknown':'A registry update or recovery has no verified final result. Check the official manager; do not resend it automatically.',
      'reason.registry-handoff-unavailable':'The public Host exact-version registry update path is unavailable.',
      'reason.dependency-runtime-reload-unverified':'Safe no-restart updating is not supported on this stock Host path. This updater blocks the risk; it does not fix Host reload or automatically restart DSH.',
      'reason.identity-store-unverified':'Installation/recovery records cannot be verified. Stop management attempts and inspect the official manager; do not overwrite the records.',
      unionGenerationSafety:'This plugin cannot be reloaded in the running Host because its dependency closure is reused. The updater installs a verified complete-dependency generation under a fresh path while DSH stays open. The original code is preserved, but installation becomes a Doctor-owned local archive, not an npm installation; built-in Versions eligibility is not preserved. The plugin temporarily unloads and recovery may fail.',
      acknowledgeUnionGeneration:'I accept the derived local generation source, temporary plugin unload, and separately verified recovery risk.',
      'reason.union-version-unsupported':'This target is not a newer stable source/destination this route can inspect.',
      'reason.union-host-contract-changed':'The built generation does not match the inspected declaration. Prepare again.',
      'reason.union-declaration-changed':'The generated dependency declaration no longer matches the inspected package. Prepare again.',
      'reason.union-package-contract':'The archive does not declare the single static ESM entry this route requires.',
      'reason.union-source-identity':'The public archive identity or version does not match the requested package.',
      'reason.union-canonical-source-required':'Only a verified public original archive can be prepared.',
      'reason.union-current-version-mismatch':'The installed generation does not match its recorded version.',
      'reason.union-current-dependency-changed':'The installed dependency closure changed since it was recorded.',
      'reason.union-public-exact-inventory':'An installed dependency copy differs from its public archive bytes.',
      'reason.union-dependency-unresolved':'A declared dependency could not be resolved to an inspected copy.',
      'reason.union-retention-limit':'The retained old-generation limit was reached; nothing was silently deleted.',
      'reason.union-generation-outcome-unknown':'The generation update or recovery has no verified final outcome; do not resend it.',
      'reason.union-generation-confirmation-required':'The derived local generation source requires an additional acknowledgement.',
      unionSourceVerification:'Derived local dependency generation source', 'unionSource.verified':'Local generation source verified; built-in Versions not preserved', 'unionSource.failed':'Local generation source not verified', 'unionSource.unknown':'Local generation source unknown',
      unionRuntimeVerification:'Exact running dependency generation', 'runtime.verified':'Generation verified', 'runtime.unknown':'Running generation unverified', 'runtime.disabled':'Disabled; generation code not executed',
      unionGenerationSource:'Doctor-owned local dependency generation · original npm bytes verified',
      registryHandoffSafety:'Normal npm updates preserve registry installation through the official Host updater. Prepared archives are preflight evidence: the Host downloads again using its existing fallback settings, and installation/rollback may fail. WSL generation packages remain local archives.'
    });
    Object.assign(ZH, {
      latestVersion: '版本检查结果', taskPolicy: '更新前任务处理', reasonTitle: '在线更新条件',
      versionCheck: '版本检查', onlineUpdate: '在线更新', querySource: '版本查询源',
      querySourceUnknown: '来源未确认', querySourceScope: '版本检查结果仅针对该查询源，不代表所有来源。',
      queryGithubSource: '更新器固定 GitHub 仓库 · 主分支 HEAD，非 Release',
      'version.available': '发现较新的兼容正式版', 'version.up-to-date': '当前查询源未发现较新的正式版本',
      'version.no-compatible-version': '已发现新版，但没有可选的正式版更新候选', 'version.unknown': '未能确定是否存在兼容新版',
      'version.error': '版本检查失败', 'version.not-checked': '尚未检查',
      'update.available': '可在确认后更新', 'update.blocked': '条件不满足', 'update.no-update': '无可选新版', 'update.not-checked': '尚未检查',
      installedVersionShown: '当前已装版本', compatibleVersionShown: '兼容更新候选', publishedVersionShown: '较新发布版本',
      notCompatibleCandidate: '没有可选正式版候选：可能不兼容、已弃用或未声明插件包', candidateUnconfirmed: '已发现发布版本，更新候选仍未确定',
      selfCheckHelp: '更新器支持独立检查；点击“检查全部更新”后核对版本及来源，不与普通批次混合。',
      'reason.self-update-blocked': '更新器不参与普通批次，请核对独立的自身升级路径。',
      'reason.host-runtime-dependencies': '声明了 @deepseek-ai 范围的运行依赖，当前路径尚未验证；这不是已确认会替换宿主。',
      'reason.registry-origin-unsupported': '当前查询源未获准用于在线替换，不会静默迁移来源。',
      'reason.registry-origin-unverified': '无法核验实际版本查询源，在线替换仍被阻止。',
      'reason.self-update-public-origin-required': '自身升级要求已核验的公共 npm 查询源，不会静默迁移镜像或其它来源。',
      'reason.self-query-origin-unverified': '无法核验实际公共 npm 查询源，自身升级仍被阻止。',
      'reason.registry-origin-changed': '检查期间实际查询源发生变化，请重新检查后再准备更新。',
      'reason.version-metadata-incomplete': '版本元数据不完整或查询窗口遗漏候选，不能据此认定已是最新或可安全更新。',
      registrySourceVerification:'npm 来源与官方更新资格',
      'registryCheck.verified':'保留 npm 安装来源', 'registryCheck.failed':'npm 来源未通过核验', 'registryCheck.unknown':'npm 来源未知',
      'reason.legacy-archive-source-requires-migration':'此前的更新器将此插件安装为本地归档；不会自动迁移来源，请通过官方管理器核对迁移方式。',
      'reason.registry-update-outcome-unknown':'npm 更新或恢复没有已核验的最终结果，请核对官方管理器，不要自动重发。',
      'reason.registry-handoff-unavailable':'宿主公开的按精确版本 npm 更新路径不可用。',
      'reason.dependency-runtime-reload-unverified':'当前原版宿主的这条路径不支持安全无重启更新。本更新器只拦截风险，不修复宿主热加载，也不会自动重启 DSH。',
      'reason.identity-store-unverified':'安装／恢复记录无法核验，已停止管理操作；请核对官方管理器，不要覆盖未知记录。',
      unionGenerationSafety:'此插件在运行中的宿主里卸载再安装会复用旧依赖的加载状态，因此不能直接热替换。更新器会在 DSH 保持打开时，把已核验的完整依赖放进全新路径安装。原始代码不改，但安装来源会变为更新器管理的本地归档，不再是 npm 安装，宿主内置 Versions 资格不保留。插件会短暂卸载，恢复也可能失败。',
      acknowledgeUnionGeneration:'我接受完整依赖代际的本地归档来源、插件短暂卸载，以及分别核验的恢复风险。',
      'reason.union-version-unsupported':'该目标不是此路线可检查的更高正式版本。',
      'reason.union-host-contract-changed':'生成的代际与已检查声明不一致，请重新准备。',
      'reason.union-declaration-changed':'生成的依赖声明与已检查的包不一致，请重新准备。',
      'reason.union-package-contract':'原包不符合此路线要求的单一静态 ESM 入口声明。',
      'reason.union-source-identity':'公开原包身份或版本与请求的包不一致。',
      'reason.union-canonical-source-required':'只能准备已核验的公开原包。',
      'reason.union-current-version-mismatch':'当前已装代际与记录的版本不一致。',
      'reason.union-current-dependency-changed':'当前已装依赖闭包与记录不一致。',
      'reason.union-public-exact-inventory':'某个已装依赖副本与公开原包字节不一致。',
      'reason.union-dependency-unresolved':'声明的依赖无法解析到可检查的副本。',
      'reason.union-retention-limit':'保留的旧代已达上限；没有静默删除任何旧资源。',
      'reason.union-generation-outcome-unknown':'代际更新或恢复没有已核验的最终结果，请勿重发。',
      'reason.union-generation-confirmation-required':'完整依赖代际的本地来源需要额外确认。',
      unionSourceVerification:'完整依赖代际的本地来源核验', 'unionSource.verified':'本地代际来源已核验；内置 Versions 资格不保留', 'unionSource.failed':'本地代际来源未核验', 'unionSource.unknown':'本地代际来源未知',
      unionRuntimeVerification:'实际运行的完整依赖代际', 'runtime.verified':'已核验运行代际', 'runtime.unknown':'运行代际未核验', 'runtime.disabled':'已停用；未执行代际代码',
      unionGenerationSource:'更新器本地依赖代际 · 已核验原始 npm 字节',
      registryHandoffSafety:'普通 npm 更新通过官方管理器保留 npm 安装来源。准备的归档仅作预检证据，宿主会沿用现有 fallback 重新下载；安装和恢复均可能失败。WSL 代际包装仍使用本地归档。'
    });
    Object.assign(EN, {
      migrateSource: 'Review migration back to npm', migrationResults: 'Source migration results', migratingSource: 'Migrating source', reviewingMigration: 'Reviewing source migration…', 'status.migrated': 'Source migrated',
      confirmMigrationTitle: 'Confirm migration from archive to npm', confirmMigrationImpact: 'Reinstall this same plugin version from npm, not an upgrade. The change affects all sessions in this profile and may temporarily unload the plugin.',
      migrationSafety: 'Only a verified earlier Doctor archive installation can be migrated. The version stays the same; its saved installation source becomes an npm spec so official version checks can resume. Failed installation may require restoring the old archive. Existing settings and tasks still need review.',
      acknowledgeMigration: 'I reviewed the same version, the archive-to-npm source change, and the possible temporary unload or archive recovery.',
      confirmMigrationWait: 'Confirm migration and wait for idle', confirmMigrationStop: 'Confirm task stopping and migrate', migrationHelp: 'Migration is separate from batch updates. It changes the installation source, not the version, and requires independent confirmation.',
      publicFallbackSafety: 'Official npm is the version query source. The unchanged displayed Host plan can use public fallback registries. Potential mirror updater archives are compared with canonical npm, but the Host downloads again, so installation and recovery are not atomic byte replacements. No global registry setting is changed.',
      acknowledgePublicFallback: 'I accept this displayed public fallback plan, mirror/refetch and recovery risks without changing my source settings.',
      'info.public-fallback-may-use-mirror': 'The configured public fallback plan can use the fixed mirror; additional acknowledgement is required.',
      'reason.self-host-registry-plan-unsupported': 'The Host source plan contains a private, unknown or unsupported source; only verified official npm and the fixed public mirror are admitted.',
      mirrorSafety: 'This operation uses the fixed public npm mirror. Mirror versions can lag. Review the prepared package and canonical npm comparison evidence separately: the Host refetches using its registry plan, which is shown only when provided, not an atomic byte replacement. Installation/recovery may fail. No source configuration is silently changed.',
      acknowledgeMirror: 'I explicitly accept this public-mirror source and its displayed fallback/refetch and recovery risks.',
      mirrorRegistryPlan: 'Confirmed Host registry plan', mirrorPlanPrimary: 'Configured first source', mirrorPlanResolved: 'pnpm resolved source', mirrorPlanFallback: 'Fallback source',
      'reason.self-public-mirror-confirmation-required': 'Public-mirror self-update requires its additional source-risk acknowledgement.',
      detailDoctorTitle: 'Plugin online updates · independent check', detailDoctorHelp: 'This section is provided by the community updater, not the Host’s built-in Versions list. It can inspect Doctor-managed archive installations without pretending they are npm sources.',
      detailDoctorProbe: 'Check updater records and versions', detailDoctorOpen: 'Handle in Plugin online updates', detailDoctorManual: 'Open Plugin online updates from the left sidebar to review and confirm; this section cannot install or migrate a plugin.',
      detailDoctorUnmanaged: 'No matching Doctor-managed archive record was verified. Use the official manager to inspect this installation source.',
      detailDoctorReadOnly: 'Checking is read-only. Updating or source migration is reviewed and confirmed separately in Plugin online updates.',
      sourcePublicOnly: 'Normal updates use verified public npm sources, including explicitly confirmed public mirrors where supported. Archive provenance, source migration, and update confirmation are checked separately.'
    });
    Object.assign(ZH, {
      migrateSource: '核对迁回 npm 来源', migrationResults: '来源迁移结果', migratingSource: '正在迁移来源', reviewingMigration: '正在核对来源迁移…', 'status.migrated': '来源已迁移',
      confirmMigrationTitle: '确认从归档迁回 npm 来源', confirmMigrationImpact: '从 npm 重新安装此插件的同一版本，不是升级。变更影响当前配置的所有会话，期间可能暂时卸载插件。',
      migrationSafety: '只迁移已核验的旧更新器归档安装。版本号不变，保存来源改为 npm 规格，以恢复官方版本检查资格。安装失败可能需要恢复旧归档；仍需核对现有配置和任务影响。',
      acknowledgeMigration: '我已核对同一版本、从归档迁回 npm 的来源变化，以及临时卸载或恢复旧归档的风险。',
      confirmMigrationWait: '确认迁移并等待空闲', confirmMigrationStop: '确认停止任务并迁移', migrationHelp: '来源迁移不与批量更新混合，只改变安装来源、不升级版本，需要单独确认。',
      publicFallbackSafety: '版本查询来自官方 npm；下方原有宿主计划仍可能使用公共备用源。已核对可能使用的镜像更新器归档与官方 npm 一致，但宿主会重新下载，安装和恢复并非原子字节替换。不会改动你的全局源设置。',
      acknowledgePublicFallback: '我接受下方公共备用源计划、镜像／重新下载和恢复风险，不要求更改我的源设置。',
      'info.public-fallback-may-use-mirror': '原有公共备用源计划可能使用固定镜像，需要额外确认。',
      'reason.self-host-registry-plan-unsupported': '宿主源计划包含私有、未知或不支持的来源；仅接纳已核验的官方 npm 和固定公共镜像。',
      mirrorSafety: '本次使用固定公共 npm 镜像，镜像版本可能延迟。请分别核对准备的包和官方 npm 对照证据；宿主按其安装源计划重新下载，提供时才展示该计划，并非原子字节替换。安装和恢复可能失败，不会偷偷修改来源配置。',
      acknowledgeMirror: '我明确接受本次公共镜像来源，以及显示的 fallback、重新下载和恢复风险。',
      mirrorRegistryPlan: '已确认宿主安装源计划', mirrorPlanPrimary: '配置的首选来源', mirrorPlanResolved: 'pnpm 实际来源', mirrorPlanFallback: '备用来源',
      'reason.self-public-mirror-confirmation-required': '公共镜像自身升级需要额外确认来源风险。',
      detailDoctorTitle: '插件在线更新 · 独立检查', detailDoctorHelp: '此区由社区更新器提供，不是宿主内置 Versions 列表。它检查更新器管理的归档安装，不伪装成 npm 来源。',
      detailDoctorProbe: '检查更新器记录与版本', detailDoctorOpen: '在插件在线更新中处理', detailDoctorManual: '请从左侧打开“插件在线更新”核对并确认；此区不能安装或迁移插件。',
      detailDoctorUnmanaged: '没有核验到匹配的更新器归档记录，请通过官方管理器核对安装来源。',
      detailDoctorReadOnly: '检查只读；更新或迁移来源需要到“插件在线更新”分别核对并确认。',
      sourcePublicOnly: '普通更新使用已核验的公共 npm 来源，支持时公共镜像需明确确认；归档身份、来源迁移和更新确认分别核验。'
    });
    Object.assign(EN, {
      acknowledgeMirror: 'I explicitly accept this public-mirror source, possible Host fallback/refetch, and installation/recovery risks. This does not confirm an undisclosed transport plan.',
      mirrorRegistryPlan: 'Prepared Host registry-plan evidence', mirrorPlanUnavailable: 'No complete Host registry plan was provided or bound for this operation. The Host manages fallback and refetch; only the selected source and available observations are shown.',
      mirrorFallbackConfigured: 'Host fallback observed as configured', mirrorFallbackNotConfigured: 'No Host fallback observed at preparation', mirrorFallbackUnknown: 'Host fallback configuration was not verified',
      archiveSourceIdentity: 'Local archive · verified npm provenance',
      'info.public-mirror-may-lag': 'The public mirror may lag behind official npm; this version result applies to the mirror only.',
      'reason.dependency-graph-changed': 'The installed dependency tree changed after the read-only check. Recheck the current state before replacing.',
      'reason.dependency-source-unsupported': 'A dependency uses an unreviewed source or Host/runtime package. Use an independently reviewed installation path.',
      'reason.dependency-not-resolved': 'An installed dependency could not be located for read-only verification. Inspect the package state in the official manager before retrying.',
      'reason.dependency-graph-limit': 'The dependency graph exceeded the bounded verification budget. This is not proof of corruption; it requires separate review.',
      'reason.dependency-path-unsupported': 'A dependency contains an unsupported linked or unsafe path. Its graph cannot be verified by this update path.',
      'reason.dependency-graph-update-requires-separate-review': 'A resolved dependency declares an unsupported layout (alternate source, install scripts or an unstable version).',
      'reason.migration-not-admitted': 'Migration requires an identified earlier ordinary Doctor archive with no unresolved operation. Other sources must be reviewed in the official manager.',
      'reason.migration-state-changed': 'The archive installation changed during migration preparation. Refresh and review the same-version migration again.',
      'reason.migration-outcome-unknown': 'The migration has no verified final result. Inspect installed state and the official manager; do not automatically repeat it.'
    });
    Object.assign(ZH, {
      acknowledgeMirror: '我明确接受本次公共镜像来源、宿主可能使用 fallback 重新下载，以及安装／恢复风险；这不表示确认未披露的传输计划。',
      mirrorRegistryPlan: '准备时的宿主安装源计划证据', mirrorPlanUnavailable: '本次未提供或绑定完整宿主安装源计划。fallback 和重新下载由宿主管理；这里仅显示所选来源及已有观察，不能视为完整计划已确认。',
      mirrorFallbackConfigured: '准备时观察到宿主已配置备用来源', mirrorFallbackNotConfigured: '准备时未观察到宿主备用来源', mirrorFallbackUnknown: '宿主备用来源配置未核验',
      archiveSourceIdentity: '本地归档 · 已核验 npm 出处',
      'info.public-mirror-may-lag': '公共镜像可能落后于官方 npm；此版本结果仅针对镜像来源。',
      'reason.dependency-graph-changed': '只读检查后实际依赖树发生变化，请重新核对当前状态再替换。',
      'reason.dependency-source-unsupported': '依赖使用了未审查来源或宿主／运行时包，需要独立审查的安装路径。',
      'reason.dependency-not-resolved': '无法定位某项已安装依赖进行只读核验，请先通过官方管理器核对包状态再重试。',
      'reason.dependency-graph-limit': '依赖图超过有界核验预算；这不证明包损坏，需要单独审查。',
      'reason.dependency-path-unsupported': '依赖包含不支持的链接或不安全路径，当前更新路径无法核验该依赖图。',
      'reason.dependency-graph-update-requires-separate-review': '已解析的依赖声明了不支持的布局（替代来源、安装脚本或非稳定版本）。',
      'reason.migration-not-admitted': '迁移仅接受已识别的旧普通更新器归档且无未解决操作，其它来源需通过官方管理器核对。',
      'reason.migration-state-changed': '准备迁移期间归档安装已变化，请刷新并重新核对同版本来源迁移。',
      'reason.migration-outcome-unknown': '来源迁移没有已核验的最终结果，请核对实际安装和官方管理器，不要自动重复操作。'
    });
    Object.assign(EN, {
      'update.available': 'Ready to prepare confirmation; rechecked before execution',
      'update.preflight-passed': 'Package preflight passed; ready to review',
      'reason.package-metadata-fetch-failed': 'Package details could not be downloaded. Check again later.',
      'reason.package-archive-fetch-failed': 'The update archive could not be downloaded. Check again later.',
      'reason.public-archive-redirect-unsupported': 'The archive redirects to an unapproved address. Preflight stopped.',
      'reason.registry-metadata-unavailable': 'The public source did not provide package details. Check again later.',
      'reason.archive-unavailable': 'The official archive is unavailable; this update is not admitted.',
      'reason.mirror-version-unavailable': 'The mirror does not provide this version; this update is not admitted.',
      'reason.mirror-archive-unavailable': 'The mirror archive is unavailable. Check again later.',
      'reason.mirror-runtime-metadata-mismatch': 'Mirror runtime declarations differ from the official archive. Update refused.',
      'reason.mirror-archive-mismatch': 'Mirror archive bytes differ from the official archive. Update refused.',
      'reason.integrity-mismatch': 'Archive integrity verification failed. Inspect its source before updating.',
      'reason.download-size-limit': 'The archive exceeds the preflight size budget; it was not admitted.',
      'reason.package-preflight-unavailable': 'Package preflight is unavailable. Check the installed updater version.',
      'reason.package-preflight-failed': 'Package preflight did not pass; it does not authorize replacement.',
      'reason.package-preflight-changed': 'Package or installed-state evidence changed after checking. Check again.',
      'reason.peer-graph-change': 'Historic refusal: the target changed Host peer declarations. Current versions verify peers after installation.',
      'reason.dynamic-or-included-patch-unsupported': 'Unreviewed dynamic or nested plugin declarations prevent this update.',
      'reason.installed-original-unverified': 'Installed files differ from the public archive. Inspect them in the official manager.',
      'reason.sidebar-dependency-transition-unverified': 'Historic refusal for the removed fixed Better Sidebar version pair.',
      'info.reviewed-sidebar-client-removal': 'Historic notice from the removed fixed Better Sidebar version pair.'
    });
    Object.assign(ZH, {
      'update.available': '可准备确认，执行前仍需核验',
      'update.preflight-passed': '安装包预检通过，可继续确认',
      'reason.package-metadata-fetch-failed': '下载包详情失败，请稍后重新检查。',
      'reason.package-archive-fetch-failed': '下载更新包失败，请稍后重新检查。',
      'reason.public-archive-redirect-unsupported': '更新包跳转到未获准的地址，已停止预检。',
      'reason.registry-metadata-unavailable': '查询源未能提供包详情，请稍后重新检查。',
      'reason.archive-unavailable': '官方安装包不可用，本次未获准更新。',
      'reason.mirror-version-unavailable': '镜像未提供此版本，本次未获准更新。',
      'reason.mirror-archive-unavailable': '镜像安装包不可用，请稍后重新检查。',
      'reason.mirror-runtime-metadata-mismatch': '镜像运行声明与官方原包不一致，已拒绝更新。',
      'reason.mirror-archive-mismatch': '镜像安装包与官方原包内容不一致，已拒绝更新。',
      'reason.integrity-mismatch': '更新包完整性校验失败，请先核对来源。',
      'reason.download-size-limit': '安装包超过预检大小上限，本次未获准更新。',
      'reason.package-preflight-unavailable': '安装包预检能力不可用，请核对更新器版本。',
      'reason.package-preflight-failed': '安装包预检未通过，不能据此执行替换。',
      'reason.package-preflight-changed': '检查后安装包或安装状态已变化，请重新检查。',
      'reason.peer-graph-change': '历史拒绝原因：新版变更了宿主依赖声明。当前版本改为安装后核验。',
      'reason.dynamic-or-included-patch-unsupported': '插件包含尚未获准的动态或嵌套声明，需独立审查后更新。',
      'reason.installed-original-unverified': '当前安装文件与公开原包不一致，请先在官方管理器核对。',
      'reason.sidebar-dependency-transition-unverified': '历史拒绝原因：旧版固定侧边栏版本对已移除。',
      'info.reviewed-sidebar-client-removal': '历史提示：旧版固定侧边栏版本对已移除。'
    });
    const githubReasonAliases = {
      'self-github-tree-mode-unsupported': 'self-github-tree-unsupported', 'self-github-tree-path-unsupported': 'self-github-tree-unsupported',
      'self-github-tree-size-unsupported': 'self-github-tree-unsupported', 'self-github-tree-invalid': 'self-github-tree-unsupported',
      'self-github-tree-parent-invalid': 'self-github-tree-unsupported', 'self-github-pack-control-unsupported': 'self-github-pack-policy-unsupported',
      'self-github-files-policy-unsupported': 'self-github-pack-policy-unsupported', 'self-github-lock-policy-unsupported': 'self-github-pack-policy-unsupported',
      'self-github-pack-controls-changed': 'self-github-pack-policy-unsupported', 'self-github-tree-hash-mismatch': 'self-github-object-mismatch',
      'self-github-blob-hash-mismatch': 'self-github-object-mismatch', 'self-github-commit-mismatch': 'self-github-object-mismatch',
      'self-github-response-origin-unsupported': 'self-github-object-mismatch', 'self-github-response-unavailable': 'self-github-network'
    };
    for (const [reason, alias] of Object.entries(githubReasonAliases)) { EN['reason.' + reason] = EN['reason.' + alias]; ZH['reason.' + reason] = ZH['reason.' + alias]; }
    const CSS = `
.pud-page{height:100%;box-sizing:border-box;overflow:auto;position:relative;padding:28px clamp(18px,4vw,48px) 48px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-family:inherit;font-size:13px;line-height:1.55}.pud-wrap{max-width:1120px;margin:0 auto}.pud-header,.pud-toolbar,.pud-inline{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.pud-header{justify-content:space-between;align-items:flex-start;margin-bottom:20px}.pud-header h1{font-size:22px;line-height:1.4;font-weight:600;margin:0}.pud-muted{color:var(--dsw-alias-label-secondary)}.pud-subtitle{margin:6px 0 0;max-width:780px}.pud-meta{display:flex;gap:16px;flex-wrap:wrap;margin:10px 0 0;font-size:12px}.pud-card{padding:18px;border:1px solid var(--dsw-alias-border-l3);border-radius:12px;background:var(--dsw-alias-bg-layer-1);margin:16px 0;min-width:0}.pud-card h2{font-size:15px;font-weight:600;margin:0 0 12px}.pud-card h3{font-size:13px;font-weight:600;margin:14px 0 7px}.pud-btn{min-height:34px;display:inline-flex;align-items:center;justify-content:center;padding:7px 12px;gap:7px;border:1px solid var(--dsw-alias-border-l3);border-radius:7px;background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;transition:background-color .16s,color .16s}.pud-btn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:var(--dsw-alias-button-primary-fill)}.pud-btn:disabled{opacity:1;cursor:not-allowed;background:var(--dsw-alias-button-primary-dimmed);color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l3)}.pud-btn[aria-busy=true]{cursor:progress}.pud-btn:focus-visible,.pud-record summary:focus-visible,.pud-check:focus-visible,.pud-json:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.pud-btn-compact{padding:4px 8px;min-height:28px;font-size:12px}
.pud-note{padding:12px 14px;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-card-fill);margin:12px 0;overflow-wrap:anywhere}.pud-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}.pud-warning{border-color:var(--dsw-alias-state-warn-primary)}.pud-status{display:inline-flex;align-items:center;padding:2px 8px;border-radius:5px;border:1px solid var(--dsw-alias-border-l3);font-size:12px;background:var(--dsw-alias-bg-module-platform);white-space:nowrap}.pud-status[data-state=active],.pud-status[data-state=applied],.pud-status[data-state=updated],.pud-status[data-state=restored],.pud-status[data-state=verified],.pud-status[data-state=up-to-date]{color:var(--dsw-alias-state-success-primary)}.pud-status[data-state=failed],.pud-status[data-state=error],.pud-status[data-state=missing]{color:var(--dsw-alias-state-error-primary)}.pud-status[data-state=blocked],.pud-status[data-state=recovery-required],.pud-status[data-state=unknown],.pud-status[data-state=restart-required],.pud-status[data-state=waiting]{color:var(--dsw-alias-state-warn-label)}.pud-definition{display:grid;grid-template-columns:auto minmax(0,1fr);gap:7px 14px;margin:0}.pud-definition dt{color:var(--dsw-alias-label-secondary)}.pud-definition dd{margin:0;overflow-wrap:anywhere}.pud-break{overflow-wrap:anywhere;word-break:break-word}.pud-list{margin:7px 0;padding-left:22px}.pud-table-wrap{overflow:auto;max-height:460px}.pud-table{border-collapse:collapse;width:100%;font:inherit;font-size:12px;min-width:620px}.pud-table th,.pud-table td{text-align:left;padding:10px 9px;border-bottom:1px solid var(--dsw-alias-border-l2);vertical-align:top}.pud-table th{color:var(--dsw-alias-label-secondary);font-weight:500;white-space:nowrap;background:var(--dsw-alias-bg-layer-1);position:sticky;top:0;z-index:1}.pud-table td:first-child{width:28px}.pud-table .pud-package-cell{min-width:170px;max-width:300px}.pud-table tr[data-open=true]{background:var(--dsw-alias-interactive-bg-hover-solid)}.pud-check{accent-color:var(--dsw-alias-state-business-primary);width:16px;height:16px;cursor:pointer;margin:3px 0;flex:none}.pud-check:disabled{cursor:not-allowed}.pud-json{background:var(--dsw-alias-bg-module-platform);border-radius:7px;padding:12px;max-height:300px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-family:ui-monospace,monospace;font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:10px 0 0}.pud-record{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l2)}.pud-record summary{cursor:pointer;display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:28px}.pud-record-heading{font-weight:500}.pud-small{font-size:12px}.pud-footer{justify-content:space-between;margin-top:14px}.pud-detail-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.pud-detail-head h2{margin:0}.pud-spinner{display:inline-block;width:12px;height:12px;border:2px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-secondary);border-radius:50%;animation:pud-spin 1s linear infinite}@keyframes pud-spin{to{transform:rotate(360deg)}}
.pud-dialog{padding:22px;border:1px solid var(--dsw-alias-border-l3);border-radius:14px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;width:620px;max-width:calc(100vw - 40px);max-height:calc(100vh - 48px);overflow:auto;box-sizing:border-box}.pud-dialog::backdrop{background:var(--dsw-alias-bg-mask-3)}.pud-dialog h2{font-size:17px;line-height:1.4;margin:0 0 12px}.pud-dialog-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.pud-ack{display:flex;gap:10px;align-items:flex-start;margin-top:16px;cursor:pointer}.pud-dialog-list{max-height:210px;overflow:auto;margin:12px 0;padding:0;list-style:none}.pud-dialog-list li{padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}
.pud-spinner{width:13px;height:13px;box-sizing:border-box;flex:none;display:inline-block;border:2px solid currentColor;border-inline-end-color:var(--dsw-alias-bg-skeleton);border-radius:50%;animation:pud-spin .8s linear infinite}@keyframes pud-spin{to{transform:rotate(360deg)}}.pud-progress{padding:12px 14px;margin:12px 0;border:1px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-card-fill)}.pud-progress-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;font-size:12px}.pud-progress-track{height:6px;border-radius:3px;background:var(--dsw-alias-bg-skeleton);overflow:hidden}.pud-progress-bar{height:100%;border-radius:3px;background:var(--dsw-alias-state-business-primary);transition:width .3s ease}.pud-policy{margin:14px 0;padding:14px;border:1px solid var(--dsw-alias-border-l3);border-radius:9px;display:grid;gap:12px}.pud-policy legend{padding:0 5px;font-weight:600}.pud-policy-choice{display:flex;align-items:flex-start;gap:9px;cursor:pointer}.pud-policy-choice input{margin-top:4px;accent-color:var(--dsw-alias-state-business-primary)}.pud-policy-choice small{display:block;margin-top:3px;color:var(--dsw-alias-label-secondary)}.pud-stop-confirm{border-color:var(--dsw-alias-state-error-primary)}.pud-impact{color:var(--dsw-alias-state-warn-label)}
@media(hover:hover){.pud-btn:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover-solid)}.pud-btn-primary:not(:disabled):hover{background:var(--dsw-alias-button-primary-hover)}}@media(max-width:680px){.pud-page{padding-top:22px}.pud-toolbar{width:100%}.pud-card{padding:14px}.pud-definition{grid-template-columns:1fr;gap:2px}.pud-definition dd{margin-bottom:9px}.pud-dialog-actions{flex-wrap:wrap}.pud-dialog-actions .pud-btn{flex:1}.pud-footer{align-items:flex-start}}@media(pointer:coarse){.pud-btn{min-height:40px}.pud-check{width:19px;height:19px}}@media(prefers-reduced-motion:reduce){.pud-spinner{animation:none}.pud-btn{transition:none}}
`;
    const array = value => Array.isArray(value) ? value : [];
    const string = value => typeof value === 'string' ? value : '';
    const valueOf = (value, fallback) => typeof value === 'string' || typeof value === 'number' ? value : fallback;
    const jsonOf = value => JSON.stringify(value, null, 2) ?? '{}';
    const localText = (t, key, fallback) => {
      const translated = t(key); return typeof translated === 'string' && translated.trim().length > 0 && translated !== key && translated !== NS + '.' + key ? translated : fallback;
    };
    const operationIdOf = busy => string(busy?.id) || string(busy?.operationId);
    const terminalPhase = phase => phase === 'finished' || phase === 'unknown' || phase === 'interrupted';
    const stepText = (step, t) => {
      const raw = string(step?.step); const prefix = ['preparing', 'updating', 'installing', 'restoring', 'verifying'].find(name => raw.startsWith(name + '-'));
      return prefix ? localText(t, 'step.' + prefix, prefix) + ' · ' + raw.slice(prefix.length + 1) : localText(t, 'step.' + raw, raw || t('unknown'));
    };
    const hasVersionStates = item => !!item && (Object.hasOwn(item, 'versionStatus') || Object.hasOwn(item, 'updateStatus'));
    const versionStates = item => {
      if (hasVersionStates(item)) return {
        version: ['available', 'up-to-date', 'no-compatible-version', 'unknown', 'error', 'not-checked'].includes(item.versionStatus) ? item.versionStatus : 'unknown',
        update: ['available', 'blocked', 'no-update', 'not-checked'].includes(item.updateStatus) ? item.updateStatus : 'blocked',
      };
      const version = item?.status === 'not-checked' ? 'not-checked' : item?.status === 'error' ? 'error'
        : string(item?.latestVersion) ? 'available' : item?.status === 'up-to-date' ? 'up-to-date' : 'unknown';
      return { version, update: item?.status === 'not-checked' ? 'not-checked' : item?.status === 'available' && item?.canUpdate === true ? 'available'
        : item?.status === 'blocked' || array(item?.reasons).length ? 'blocked' : 'no-update' };
    };
    // One short sentence per row: the main list answers "can this be updated?" without
    // requiring the reader to parse the full evidence block.
    const quickStatus = item => {
      if (item?.status === 'recovery-required') return 'recovery-required';
      if (item?.preflightError) return 'preflight-failed';
      const states = versionStates(item), reasons = array(item?.reasons);
      if (states.version === 'not-checked') return 'not-checked';
      if (states.version === 'error') return 'check-failed';
      if (states.update === 'available') return 'available';
      if (states.version === 'up-to-date' || states.update === 'no-update') return 'up-to-date';
      if (reasons.some(reason => ['host-dependency', 'host-runtime-dependencies', 'native-or-shared-runtime', 'core-service-takeover'].includes(reason))) return 'unavailable';
      if (reasons.some(reason => ['restart-required', 'dependency-runtime-reload-unverified', 'unmanaged-plugin'].includes(reason))) return 'needs-restart';
      if (reasons.some(reason => ['wsl-declaration-review-required', 'wsl-structure-changed', 'wsl-foreign-preset-module', 'peer-graph-change', 'dependency-graph-changed', 'declaration-changed'].includes(reason))) return 'unavailable';
      if ((item?.sourceKind && item.sourceKind !== 'registry') || reasons.includes('registry-updates-only')) return 'local-source';
      if (reasons.includes('no-compatible-stable-version')) return 'no-compatible';
      return 'unavailable';
    };
    const quickStatusText = (item, t) => localText(t, 'quick.' + quickStatus(item), t('unknown'));
    const eligible = item => item?.canUpdate === true && !!string(item.latestVersion) && (hasVersionStates(item)
      ? item.versionStatus === 'available' && item.updateStatus === 'available' : item.status === 'available');
    const initialVersionItem = item => ({ ...item, canUpdate: false, latestVersion: null, latestPublishedVersion: null,
      versionStatus: 'not-checked', updateStatus: 'not-checked', status: 'not-checked',
      ...(item?.name === 'dsh-plugin-update-doctor' ? { mode: 'host-self-update', reasons: array(item.reasons).filter(reason => reason !== 'self-update-blocked') } : {}) });
    const safeQueryOrigin = value => {
      if (!string(value) || value.length > 512) return '';
      try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? url.origin : '';
      } catch { return ''; }
    };
    const versionDisplay = item => {
      const { version } = versionStates(item);
      if (version === 'not-checked') return { value: '', label: 'notChecked' };
      if (version === 'up-to-date') return { value: string(item?.version), label: 'installedVersionShown' };
      if (string(item?.latestVersion) && version === 'available') return { value: item.latestVersion, label: 'compatibleVersionShown' };
      if (string(item?.latestPublishedVersion)) return { value: item.latestPublishedVersion, label: 'publishedVersionShown', note: version === 'no-compatible-version' ? 'notCompatibleCandidate' : 'candidateUnconfirmed' };
      return { value: '', label: version === 'error' ? 'version.error' : 'unknown' };
    };
    const recoveryEligible = item => item?.canRestore === true && !!string(item.restoreVersion) && !!string(item.recoveryId);
    const isSelf = operation => operation === 'host-self-update';
    const isRestore = operation => operation === 'batch-restore';
    const isMigration = operation => operation === 'source-migration';
    const migrationEligible = item => item?.canMigrate === true && item.name !== 'dsh-plugin-update-doctor' && item.name !== 'dsh-plugin-wsl-env';
    const mirrorAcknowledgementRequired = plan => plan?.mirrorRiskRequiresAcknowledgement === true || array(plan?.items).some(item => item?.mirrorRiskRequiresAcknowledgement === true || item?.publicMirror === true || item?.publicFallback === true || item?.sourceMode === 'public-mirror' || item?.sourceMode === 'public-fallback' || safeQueryOrigin(item?.registry) === 'https://registry.npmmirror.com');
    const operationResultTitle = operation => isMigration(operation) ? 'migrationResults' : isRestore(operation) ? 'restoreResults' : 'batchResults';
    const resultStatus = item => item?.installMode === 'registry-migration' && item.status === 'updated' ? 'migrated' : string(item?.status) || 'unknown';
    const mirrorPlanRows = plan => {
      const value = plan?.hostRegistryPlan ?? array(plan?.items).find(item => item?.hostRegistryPlan)?.hostRegistryPlan;
      if (!value || typeof value !== 'object') return [];
      const rows = [
        { label: 'mirrorPlanPrimary', origin: safeQueryOrigin(value.registry ?? value.resolved) },
        { label: 'mirrorPlanResolved', origin: safeQueryOrigin(value.resolved) },
        ...array(value.fallbackRegistries).slice(0, 8).map(origin => ({ label: 'mirrorPlanFallback', origin: safeQueryOrigin(origin) })),
      ];
      return rows;
    };
    const mirrorPlanEvidence = plan => {
      const rows = mirrorPlanRows(plan);
      const observation = plan?.hostRegistryTransport ?? array(plan?.items).find(item => item?.hostRegistryTransport)?.hostRegistryTransport;
      return { rows, complete: rows.length > 0, fallbackLabel: observation?.fallbackConfigured === true ? 'mirrorFallbackConfigured' : observation?.fallbackConfigured === false ? 'mirrorFallbackNotConfigured' : 'mirrorFallbackUnknown' };
    };
    const informationWarnings = item => array(item?.infoWarnings).filter(value => typeof value === 'string').slice(0, 12);
    const highImpactWarning = item => item?.highImpact === true || array(item?.reasons).includes('high-impact');
    const installedSourceLabel = item => item?.runtimePackaging==='union-dependency-generation' ? 'unionGenerationSource' : item?.doctorArchive === true ? 'archiveSourceIdentity' : 'source.' + string(item?.sourceKind);
    const detailSubjectCandidate = subject => subject?.kind === 'bundle' && subject.pkg?.installed === true && (subject.pkg.name === 'dsh-plugin-wsl-env' || subject.pkg.name !== 'dsh-plugin-update-doctor' && string(subject.pkg.source).startsWith('file:'));
    const verifiedDetailRecord = (subject, snapshot) => {
      if (!detailSubjectCandidate(subject)) return null;
      const record = array(snapshot?.bundles).find(item => item?.name === subject.pkg.name && item?.installed === true && item.version === subject.pkg.version);
      return record?.doctorArchive === true ? record : null;
    };
    const boundedText = (value, limit = 12000) => string(value).slice(-limit);
    const boundedLogs = value => array(value).slice(-60).map(chunk => ({ name: boundedText(chunk?.name, 200), stream: boundedText(chunk?.stream, 16), text: boundedText(chunk?.text, 1000) }));
    const request = async (action, params = {}, method = 'GET', signal, timeoutMs = 45000) => {
      const controller = new AbortController(); const abort = () => controller.abort();
      if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      try {
        const response = await fetch(API + (method === 'GET' ? '?' + new URLSearchParams({ action, ...params }) : ''), {
          method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          ...(method === 'POST' ? { headers: { 'content-type': 'application/json', 'x-dsh-plugin-update-doctor': 'panel-v1' }, body: JSON.stringify({ action, ...params }) } : {}),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || body === null) {
          const error = new Error('Host request failed'); error.code = string(body?.code) || 'transport'; error.safeDiagnostic = string(body?.error); throw error;
        }
        return body;
      } catch (error) {
        if (signal?.aborted) throw error;
        if (error?.name === 'AbortError') { const issue = new Error('Read deadline'); issue.code = 'timeout'; throw issue; }
        throw error;
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    };
    function DoctorIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M12 3 20 6v6c0 5-3 8-8 10-5-2-8-5-8-10V6l8-3Z' }), h('path', { d: 'M8 12a4 4 0 0 1 6.7-3L16 10m0-3v3h-3M16 14a4 4 0 0 1-6.7 3L8 16m0 3v-3h3' }));
    }
    function Badge({ value, prefix = 'status', t }) {
      const text = localText(t, prefix + '.' + (string(value) || 'unknown'), t('unknown'));
      return h('span', { className: 'pud-status', 'data-state': value }, text);
    }
    function VersionState({ item, t }) {
      const states = versionStates(item), origin = safeQueryOrigin(item?.registry);
      const github = item?.sourceKind === 'git' && item?.mode === 'host-self-update';
      return h('div', { className: 'pud-small pud-break', 'data-testid': 'pud-version-state' },
        h('p', { style: { margin: '0 0 5px' }, 'data-version-status': states.version },
          h('strong', null, t('versionCheck') + ': '), h('span', { className: states.version === 'error' ? 'pud-error' : states.version === 'unknown' ? 'pud-muted' : '' }, localText(t, 'version.' + states.version, t('unknown')))),
        h('p', { style: { margin: 0 }, 'data-update-status': states.update },
          h('strong', null, t('onlineUpdate') + ': '), h('span', { className: states.update === 'blocked' ? 'pud-impact' : '' }, states.update === 'blocked' && item?.packagePreflight?.status === 'failed' ? localText(t, 'reason.' + string(item.packagePreflight.code), t('update.blocked'))
            : states.update === 'available' && item?.packagePreflight?.status === 'passed' ? t('update.preflight-passed') : localText(t, 'update.' + states.update, t('unknown')))),
        states.version !== 'not-checked' ? h('p', { className: 'pud-muted pud-small pud-break', style: { margin: '5px 0 0' }, 'data-testid': 'pud-query-source' },
          t('querySource') + ': ', github ? t('queryGithubSource') : origin || t('querySourceUnknown'), ' · ', t('querySourceScope')) : null,
        item?.status === 'recovery-required' ? h(Badge, { value: 'recovery-required', t }) : null);
    }
    function InformationWarnings({ item, t }) {
      const warnings = informationWarnings(item);
      return warnings.length ? h('ul', { className: 'pud-list pud-muted pud-small', 'data-testid': 'pud-information-warnings' },
        ...warnings.map((warning, i) => h('li', { key: i }, localText(t, 'info.' + warning, warning)))) : null;
    }
    function VersionValue({ item, t }) {
      const shown = versionDisplay(item);
      return h('div', { className: 'pud-break', 'data-testid': 'pud-version-value' },
        shown.value ? h('span', null, shown.value) : t(shown.label),
        shown.value ? h('p', { className: 'pud-muted pud-small', style: { margin: '4px 0 0' } }, t(shown.label)) : null,
        shown.note ? h('p', { className: 'pud-muted pud-small', style: { margin: '4px 0 0' } }, t(shown.note)) : null);
    }
    function SourceDetails({ value, t }) {
      const raw = jsonOf(value), preview = raw.length > 24000 ? raw.slice(0, 24000) : raw;
      const [copied, setCopied] = useState(false), [error, setError] = useState('');
      useEffect(() => { setCopied(false); setError(''); }, [value]);
      return h('div', null, h('div', { className: 'pud-inline' }, h('span', { className: 'pud-muted pud-small' }, t('detail')),
        h('button', { type: 'button', className: 'pud-btn pud-btn-compact', onClick: async () => { try { await navigator.clipboard.writeText(jsonOf(value)); setCopied(true); setError(''); } catch { setError(t('copyFailed')); } } }, t(copied ? 'copied' : 'copy'))),
        error ? h('p', { className: 'pud-error', role: 'alert' }, error) : null,
        raw.length > preview.length ? h('p', { className: 'pud-muted pud-small' }, t('detailTruncated')) : null,
        h('pre', { className: 'pud-json', tabIndex: 0 }, preview));
    }
    function DetailArchiveCheck({ subject, t, openPanel }) {
      const [item, setItem] = useState(null), [pending, setPending] = useState(false), [notice, setNotice] = useState('');
      const current = useRef(null), mounted = useRef(true);
      useEffect(() => { mounted.current = true; setItem(null); setNotice(''); setPending(false); return () => { mounted.current = false; current.current?.abort(); }; }, [subject.pkg.name, subject.pkg.version]);
      const check = async () => {
        if (pending) return;
        current.current?.abort();
        const controller = new AbortController(); current.current = controller; setPending(true); setNotice(''); setItem(null);
        const acceptsResult = () => mounted.current && current.current === controller && !controller.signal.aborted;
        try {
          const snapshot = await request('list', {}, 'GET', controller.signal, 45000);
          controller.signal.throwIfAborted();
          const record = verifiedDetailRecord(subject, snapshot);
          if (!record) { if (acceptsResult()) setNotice('detailDoctorUnmanaged'); return; }
          const answer = await request('scan', {}, 'GET', controller.signal, 180000);
          const checked = array(answer?.items).find(row => row?.name === record.name && row.version === record.version);
          if (!checked) throw new Error('No matching version result');
          if (acceptsResult()) setItem(checked);
        } catch (error) { if (acceptsResult()) setNotice('requestFailed'); }
        finally { const active = acceptsResult(); if (current.current === controller) current.current = null; if (active) setPending(false); }
      };
      return h('section', { className: 'pud-card', 'data-testid': 'pud-official-archive-check' }, h('style', null, CSS),
        h('h2', null, t('detailDoctorTitle')), h('p', { className: 'pud-muted pud-small' }, t('detailDoctorHelp')),
        h('p', { className: 'pud-muted pud-small' }, t('detailDoctorReadOnly')),
        h('div', { className: 'pud-inline' }, h('button', { type: 'button', className: 'pud-btn', disabled: pending, 'aria-busy': pending, onClick: () => { void check(); }, 'data-testid': 'pud-detail-doctor-check' }, t(pending ? 'scanning' : 'detailDoctorProbe')),
          typeof openPanel === 'function' ? h('button', { type: 'button', className: 'pud-btn', onClick: openPanel, 'data-testid': 'pud-detail-doctor-open' }, t('detailDoctorOpen')) : null),
        item ? h('div', { className: 'pud-note' }, h(VersionValue, { item, t }), h(VersionState, { item, t }),
          array(item.reasons).length ? h('ul', { className: 'pud-list' }, ...item.reasons.map((reason, i) => h('li', { key: i }, localText(t, 'reason.' + string(reason), string(reason) || t('unknown'))))) : null,
          h(InformationWarnings, { item, t })) : null,
        notice ? h('p', { className: notice === 'requestFailed' ? 'pud-error' : 'pud-muted', role: 'status' }, t(notice)) : null,
        h('p', { className: 'pud-muted pud-small' }, t('detailDoctorManual')));
    }
    function Finding({ finding, t }) {
      if (!finding) return null;
      const code = string(finding.code) || 'unknown';
      const help = code === 'activation-failed' ? 'activationHelp' : code.includes('conflict') || code === 'permission-failed' ? 'conflictHelp' : code === 'restart-required' ? 'restartHelp' : code === 'active' ? 'activeHelp' : 'unknownHelp';
      return h('div', { className: 'pud-note' + (code.includes('failed') || code.includes('conflict') || code === 'restart-required' ? ' pud-warning' : '') },
        h('strong', null, localText(t, 'class.' + code, t('unknown'))), h('p', { className: 'pud-muted', style: { margin: '6px 0 0' } }, t(help)),
        h('details', { className: 'pud-small', style: { marginTop: 8 } }, h('summary', null, t('detail')), h('p', { className: 'pud-break' }, string(finding.detail)),
          array(finding.nextSteps).length ? h('ul', { className: 'pud-list' }, ...finding.nextSteps.map((step, i) => h('li', { key: i }, string(step)))) : null));
    }
    function dateText(value, locale, t) {
      const date = new Date(value); if (!Number.isFinite(date.valueOf())) return t('noValue');
      try { return date.toLocaleString(string(locale) || 'en'); } catch { return date.toLocaleString('en'); }
    }
    function CommitDetails({ value, t }) {
      if (!value || value.sourceKind !== 'git') return null;
      return h('div', { className: 'pud-note pud-small', 'data-testid': 'pud-github-commits' },
        h('strong', null, t('githubHead')), h('p', { className: 'pud-muted' }, t('githubHeadHelp')),
        h('dl', { className: 'pud-definition' },
          h('dt', null, t('githubRepository')), h('dd', null, string(value.repository)),
          h('dt', null, t('fromCommit')), h('dd', null, string(value.fromCommit ?? value.currentCommit) || t('noValue')),
          h('dt', null, t('toCommit')), h('dd', null, string(value.toCommit ?? value.latestCommit) || t('noValue'))));
    }
    function Verification({ verification, t }) {
      const pack = verification?.package, host = verification?.host;
      return h('dl', { className: 'pud-definition pud-small' },
        h('dt', null, t('packageVerification')), h('dd', null, h(Badge, { value: string(pack?.status) || 'unknown', prefix: 'package', t }), pack?.version ? h('span', null, ' · ', pack.version) : null),
        h('dt', null, t('hostVerification')), h('dd', null, h(Badge, { value: string(host?.status) || 'unknown', prefix: 'host', t }),
          typeof host?.activeRows === 'number' && typeof host?.totalRows === 'number' ? h('span', null, ' · ', host.activeRows + ' / ' + host.totalRows) : null),
        verification?.source ? h(React.Fragment, null, h('dt', null, t(verification.source.expectedKind==='derived-local-union-generation'?'unionSourceVerification':verification.source.expectedKind === 'registry' || verification.source.kind === 'registry' ? 'registrySourceVerification' : 'sourceVerification')), h('dd', null, h(Badge, { value: string(verification.source.status) || 'unknown', prefix: verification.source.expectedKind==='derived-local-union-generation'?'unionSource':verification.source.expectedKind === 'registry' || verification.source.kind === 'registry' ? 'registryCheck' : 'sourceCheck', t }))) : null,
         verification?.runtime ? h(React.Fragment,null,h('dt',null,t('unionRuntimeVerification')),h('dd',null,h(Badge,{value:string(verification.runtime.status)||'unknown',prefix:'runtime',t}))) : null);
    }
    function ClientSync({ state, retryClient, t }) {
      const failures = array(state?.failures), [retrying, setRetrying] = useState(false), [retryError, setRetryError] = useState('');
      const known = !!state && typeof state.syncing === 'boolean' && Array.isArray(state.failures);
      const status = !known ? 'clientSyncUnknown' : state.syncing || retrying ? 'clientSyncing' : failures.length ? 'clientSyncFailed' : 'clientSyncIdle';
      return h('section', { className: 'pud-card', 'data-testid': 'pud-client-sync', 'aria-live': 'polite' },
        h('h2', null, t('clientSync')), h('p', { className: failures.length || retryError ? 'pud-warning' : '' }, t(status)),
        h('p', { className: 'pud-muted pud-small' }, t('clientSyncHelp')),
        failures.length ? h('details', null, h('summary', null, t('detail') + ' (' + failures.length + ')'),
          h('ul', { className: 'pud-list' }, ...failures.slice(0, 20).map((failure, i) => h('li', { key: string(failure.id) || i }, string(failure.id), ' · ', boundedText(failure.message, 2000))))) : null,
        retryError ? h('p', { className: 'pud-error', role: 'alert' }, retryError) : null,
        failures.length || retryError ? h('button', { type: 'button', className: 'pud-btn', disabled: retrying || state?.syncing || typeof retryClient !== 'function', 'data-testid': 'pud-retry-client', onClick: async () => {
          setRetrying(true); setRetryError('');
          try { await retryClient(); } catch { setRetryError(t('requestFailed')); } finally { setRetrying(false); }
        } }, t('clientSyncRetry')) : null);
    }
    function BatchTable({ items, t, onRestore, busy = false, recoveries, onReport, reportNotice }) {
      const rows = array(items).map((item, i) => {
        const recovery = recoveries?.get(item.name);
        const canRecover = recoveryEligible(recovery) && !!string(item.recoveryId) && item.recoveryId === recovery.recoveryId;
        return h('tr', { key: string(item.name) || i },
        h('td', { className: 'pud-break pud-package-cell' }, valueOf(item.name, t('noValue'))),
        h('td', null, valueOf(item.from, t('noValue'))), h('td', null, valueOf(item.to, t('noValue'))),
        h('td', null, h(Badge, { value: resultStatus(item), t })),
        h('td', null, item.restoreKind === 'restart-required-removal' ? h('p', { className: 'pud-warning pud-small', 'data-testid': 'pud-restart-rollback' }, t('restartRollback')) : null,
           h(Verification, { verification: item.verification, t }),
           item.restore ? h('div', { className: 'pud-note pud-small' }, t('recoveryOutcome'), ' · ', h(Badge, { value: string(item.restore.application) || 'unknown', prefix: 'outcome', t }), h(Verification, { verification: item.restoreVerification, t })) : null),
        h('td', null, canRecover && typeof onRestore === 'function' ? h('button', { type: 'button', className: 'pud-btn pud-btn-compact', disabled: busy, onClick: () => onRestore(item.name), 'data-testid': 'pud-item-restore' }, t('restore')) : null,
          typeof onReport === 'function' && ['failed', 'unknown', 'restart-required'].includes(string(item.status))
            ? h('button', { type: 'button', className: 'pud-btn pud-btn-compact', 'data-testid': 'pud-copy-report', title: t('reportHint'), onClick: () => onReport(item.name) }, t(reportNotice === 'copied:' + item.name ? 'reportCopied' : 'copyReport')) : null,
          h('details', null, h('summary', null, t('detail')), h(SourceDetails, { value: item, t }))));
      });
      const head = h('thead', null, h('tr', null,
        h('th', null, t('package')), h('th', null, t('from')), h('th', null, t('to')), h('th', null, t('status')), h('th', null, t('packageVerification') + ' / ' + t('hostVerification')), h('th', null, t('resultDetails'))));
      return h('div', { className: 'pud-table-wrap' }, h('table', { className: 'pud-table' }, head, h('tbody', null, ...rows)));
    }
    function Record({ record, t, locale, onRestore, busy, recoveries, onReport, reportNotice }) {
      const result = record?.result ?? record?.event ?? {}; const items = array(record?.items); const outcome = string(result.application) || string(record?.outcome) || 'unknown';
      return h('details', { className: 'pud-record' }, h('summary', null,
        h('span', { className: 'pud-record-heading pud-break' }, valueOf(record?.package ?? record?.target, items.length ? t(operationResultTitle(record?.operation)) + ' · ' + items.length : t('noValue'))),
        h(Badge, { value: outcome, prefix: 'outcome', t }), h('span', { className: 'pud-muted pud-small' }, dateText(record?.finishedAt ?? record?.time ?? record?.startedAt, locale, t))),
        h('p', { className: 'pud-muted pud-small' }, t(record?.origin === 'official-event' ? 'officialHistory' : 'ownHistory')),
        items.length ? h(BatchTable, { items, t, onRestore, busy, recoveries, onReport, reportNotice }) : h('dl', { className: 'pud-definition pud-small' },
          h('dt', null, t('stage')), h('dd', null, result.stage ? localText(t, 'stage.' + result.stage, result.stage) : t('noValue')),
          h('dt', null, t('from')), h('dd', null, valueOf(record?.from, t('noValue'))), h('dt', null, t('to')), h('dd', null, valueOf(record?.to, t('noValue')))),
        record?.update?.restore ? h('p', { className: 'pud-inline' }, t('recoveryOutcome'), h(Badge, { value: record.update.restore.application, prefix: 'outcome', t })) : null,
        h(Finding, { finding: record?.classification, t }), h(SourceDetails, { value: record, t }));
    }
    function ConfirmDialog({ plan, t, locale, onCancel, onConfirm }) {
      const restoring = isRestore(plan.operation), selfUpdating = isSelf(plan.operation), migrating = isMigration(plan.operation);
      const githubUpdating = selfUpdating && array(plan.items).some(item => item.sourceKind === 'git');
      const publicMirror = mirrorAcknowledgementRequired(plan);
      const publicFallback = selfUpdating && array(plan.items).some(item => item.sourceMode === 'public-fallback');
      const unionGeneration=array(plan.items).some(item=>item.installMode==='union-generation');
      const ref = useRef(null), cancel = useRef(null); const [now, setNow] = useState(Date.now());
      const [taskPolicy, setTaskPolicy] = useState('wait-for-idle');
      useEffect(() => {
        const previous = document.activeElement, dialog = ref.current;
        if (dialog && !dialog.open) dialog.showModal(); cancel.current?.focus();
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => { clearInterval(timer); if (dialog?.open) dialog.close(); if (previous?.isConnected && typeof previous.focus === 'function') previous.focus(); };
      }, []);
      const expired = !Number.isFinite(Date.parse(plan.expiresAt)) || now >= Date.parse(plan.expiresAt);
      const reviewItems = array(plan.items).map((item, i) => h('li', { key: string(item.name) || i },
        h('strong', { className: 'pud-break' }, item.name),
        h('div', { className: 'pud-muted' }, valueOf(item.from, t('noValue')), ' → ', valueOf(item.to, t('noValue'))),
        selfUpdating ? h(CommitDetails, { value: item, t }) : null,
        highImpactWarning(item) ? h('p', { className: 'pud-impact pud-small' }, t('highImpact')) : null,
        item.dependencyClosure ? h('p', { className: 'pud-muted pud-small', 'data-testid': 'pud-dependency-closure-plan' },
          t('dependencyClosureHint').replace('{packages}', String(item.dependencyClosure.packages)).replace('{size}', (Math.max(1, item.dependencyClosure.bytes) / 1048576).toFixed(1) + ' MB')) : null,
        h(InformationWarnings, { item, t })));
      const warningDetails = array(plan.warnings).length ? h('details', { className: 'pud-small' },
        h('summary', null, t('detail')), h('ul', { className: 'pud-list' }, ...plan.warnings.map((text, i) => h('li', { key: i }, string(text))))) : null;
      return h('dialog', {
        ref, className: 'pud-dialog', 'aria-labelledby': 'pud-confirm-title', 'aria-describedby': 'pud-confirm-impact',
        onCancel: event => { event.preventDefault(); onCancel(); },
        onKeyDown: event => {
          if (event.key !== 'Tab') return;
          const controls = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),summary,a[href],select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(element => element.offsetParent !== null);
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        },
      },
      h('h2', { id: 'pud-confirm-title' }, selfUpdating ? t('confirmSelfTitle') : migrating ? t('confirmMigrationTitle') : t(restoring ? 'confirmRestoreTitle' : 'confirmTitle')),
      h('p', { id: 'pud-confirm-impact', className: 'pud-muted' }, selfUpdating ? t('confirmSelfImpact') : migrating ? t('confirmMigrationImpact') : t(restoring ? 'confirmRestoreImpact' : 'confirmImpact')),
      h('p', { className: 'pud-muted pud-small' }, t('profile') + ': ', valueOf(plan.profile, t('noValue')), ' · ', t('expires') + ': ', dateText(plan.expiresAt, locale, t)),
      h('ul', { className: 'pud-dialog-list', 'aria-label': t(operationResultTitle(plan.operation)) }, ...reviewItems),
      migrating ? h('div', { className: 'pud-note', 'data-testid': 'pud-migration-safety' }, h('p', null, t('migrationSafety'))) : null,
      publicMirror ? h('div', { className: 'pud-note pud-warning', 'data-testid': 'pud-public-mirror-safety' },
        h('p', { className: 'pud-small' }, t(publicFallback ? 'publicFallbackSafety' : 'mirrorSafety')),
        mirrorPlanEvidence(plan).complete ? h(React.Fragment, null,
          h('strong', null, t('mirrorRegistryPlan')),
          h('dl', { className: 'pud-definition pud-small' }, ...mirrorPlanEvidence(plan).rows.map((row, i) => h(React.Fragment, { key: i }, h('dt', null, t(row.label)), h('dd', null, row.origin || t('querySourceUnknown')))))) : h(React.Fragment, null,
          h('p', { className: 'pud-muted pud-small', 'data-testid': 'pud-mirror-plan-unavailable' }, t('mirrorPlanUnavailable')),
          h('p', { className: 'pud-muted pud-small' }, t(mirrorPlanEvidence(plan).fallbackLabel))),
        h('ul', { className: 'pud-list pud-small' }, ...array(plan.items).filter(item => item?.publicMirror || item?.publicFallback || item?.sourceMode === 'public-mirror' || item?.sourceMode === 'public-fallback' || safeQueryOrigin(item?.registry) === 'https://registry.npmmirror.com').map((item, i) => h('li', { key: i }, string(item.name), ' · ', safeQueryOrigin(item.registry) || t('querySourceUnknown'))))) : null,
      githubUpdating ? h('p', { className: 'pud-note pud-warning', 'data-testid': 'pud-github-safety' }, t('githubConfirmSafety')) : null,
      h('fieldset', { className: 'pud-policy' }, h('legend', null, t('taskPolicy')),
        h('label', { className: 'pud-policy-choice' }, h('input', { type: 'radio', name: 'pud-task-policy', value: 'wait-for-idle', checked: taskPolicy === 'wait-for-idle', onChange: () => { setTaskPolicy('wait-for-idle'); } }),
          h('span', null, t('waitPolicy'), h('small', null, t(selfUpdating ? 'selfGateHelp' : 'waitPolicyHelp')))),
        h('label', { className: 'pud-policy-choice' }, h('input', { type: 'radio', name: 'pud-task-policy', value: 'cancel-active', checked: taskPolicy === 'cancel-active', disabled: !array(plan.taskPolicies).includes('cancel-active'), onChange: () => { setTaskPolicy('cancel-active'); } }),
          h('span', null, t('stopPolicy'), h('small', null, t('stopPolicyHelp'))))),
      !selfUpdating && array(plan.items).some(item=>item.installMode==='registry-spec') ? h('p',{className:'pud-note pud-warning','data-testid':'pud-registry-handoff-safety'},t('registryHandoffSafety')) : null,
unionGeneration ? h('div', { className: 'pud-note', 'data-testid': 'pud-union-generation-safety' }, h('p', null, t('unionGenerationSafety'))) : null,
      warningDetails,
      expired ? h('p', { className: 'pud-error', role: 'alert' }, t('expired')) : null,
      h('div', { className: 'pud-dialog-actions' },
        h('button', { ref: cancel, type: 'button', className: 'pud-btn', onClick: onCancel }, t('cancel')),
        h('button', { type: 'button', className: 'pud-btn pud-btn-primary', disabled: expired || !array(plan.items).length, onClick: () => onConfirm({ taskPolicy, ...(taskPolicy === 'cancel-active' ? { confirmCancel: true } : {}), ...(publicMirror ? { confirmPublicMirror: true } : {}), ...(unionGeneration ? { confirmUnionGeneration: true } : {}), ...(migrating ? { confirmMigration: true } : {}) }) }, selfUpdating ? t(taskPolicy === 'cancel-active' ? 'selfStop' : 'selfWait') : migrating ? t(taskPolicy === 'cancel-active' ? 'confirmMigrationStop' : 'confirmMigrationWait') : t(restoring ? taskPolicy === 'cancel-active' ? 'confirmRestoreStop' : 'confirmRestoreWait' : taskPolicy === 'cancel-active' ? 'confirmStop' : 'confirmWait'))));
    }
    class PanelBoundary extends React.Component {
      constructor(props) { super(props); this.state = { failed: false }; }
      static getDerivedStateFromError() { return { failed: true }; }
      render() { return this.state.failed ? h('div', { className: 'pud-note pud-error', role: 'alert' }, this.props.message) : this.props.children; }
    }
    const selectLocale = snapshot => snapshot.active;
    const selectClientSync = snapshot => snapshot;
    function DoctorPanel({ t, useLocale, useClientSync, retryClient }) {
      const locale = useLocale(selectLocale);
      const clientSync = useClientSync(selectClientSync);
      const [snapshot, setSnapshot] = useState(null), [scanResult, setScanResult] = useState(null), [checked, setChecked] = useState(new Set());
      const [openName, setOpenName] = useState(''), [diagnosis, setDiagnosis] = useState(null), [locks, setLocks] = useState(null);
      const [pending, setPending] = useState(''), [error, setError] = useState(null), [plan, setPlan] = useState(null);
      const [operationId, setOperationId] = useState(''), [operation, setOperation] = useState(null), [pollNotice, setPollNotice] = useState(''), [pollEpoch, setPollEpoch] = useState(0);
      const [reportNotice, setReportNotice] = useState('');
      const [reportText, setReportText] = useState('');
      const [scanProgress, setScanProgress] = useState(null);
      const [selfOperationId, setSelfOperationId] = useState(''), [selfState, setSelfState] = useState(null);
      const mounted = useRef(true), generation = useRef(0), requests = useRef(new Set()), openRef = useRef(openName); openRef.current = openName;
      useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const controller of requests.current) controller.abort(); }; }, []);
      const errorInfo = issue => ({ code: string(issue?.code), diagnostic: string(issue?.safeDiagnostic) });
      const read = useCallback(async (action, params = {}, method = 'GET', timeout) => {
        const controller = new AbortController(); requests.current.add(controller);
        try { return await request(action, params, method, controller.signal, timeout); } finally { requests.current.delete(controller); }
      }, []);
      const copyReport = useCallback(async name => {
        try {
          const report = await read('report', name ? { name } : {});
          const lastError = error?.code || error?.diagnostic ? { code: error.code || null, diagnostic: error.diagnostic || null } : null;
          const document = lastError ? { ...report, client: { lastError } } : report;
          const text = JSON.stringify(document, null, 2);
          setReportText(text);
          await navigator.clipboard.writeText(text);
          setReportNotice(name ? 'copied:' + name : 'copied');
        } catch { setReportNotice('failed'); }
      }, [read, error]);
      const load = useCallback(async () => {
        const answer = await read('list'); if (!mounted.current) return;
        setSnapshot(answer); setSelfState(answer.selfUpdate ?? null);
        if (answer.selfUpdate?.id && ['waiting', 'handed-off'].includes(answer.selfUpdate.phase)) setSelfOperationId(answer.selfUpdate.id);
        const id = operationIdOf(answer.busy);
        if (id) { setOperationId(id); setPollNotice(''); }
      }, [read]);
      useEffect(() => { setPending('list'); load().catch(issue => { if (mounted.current) setError(errorInfo(issue)); }).finally(() => { if (mounted.current) setPending(''); }); }, [load]);
      const initialItems = array(snapshot?.items).length ? snapshot.items : array(snapshot?.bundles);
      const currentItems = new Map(initialItems.map(item => [item.name, item]));
      const scannedItems = scanResult ? array(scanResult.items).map(item => {
        const current = currentItems.get(item.name);
        return { ...item, ...(current ? Object.fromEntries(['canRestore', 'restoreVersion', 'recoveryId', 'canMigrate', 'doctorArchive'].map(key => [key, Object.hasOwn(item, key) ? item[key] : current[key]])) : {}) };
      }) : [];
      const baseItems = scanResult ? [...scannedItems, ...initialItems.filter(item => recoveryEligible(item) && !scannedItems.some(scanned => scanned.name === item.name))
        .map(item => ({ ...initialVersionItem(item), status: 'recovery-required' }))] : initialItems.map(initialVersionItem);
      const byName = new Map(baseItems.map(item => [item.name, item]));
      const selected = baseItems.filter(item => checked.has(item.name) && eligible(item));
      const available = baseItems.filter(eligible);
      const normalAvailable = available.filter(item => item.mode !== 'host-self-update');
      const currentPhase = operation?.phase ?? snapshot?.busy?.phase;
      const normalBusy = !!snapshot?.externalBusy || !!snapshot?.busy || !!operationId && !terminalPhase(operation?.phase);
      const selfPending = !!selfState?.attempt && !selfState.result || !!selfState?.warning && !selfState.result;
      const busy = normalBusy || selfPending;
      useEffect(() => {
        const revision = ++generation.current; setDiagnosis(null); setLocks(null);
        if (!openName) return;
        setPending('diagnose'); setError(null);
        read('diagnose', { name: openName }).then(answer => { if (mounted.current && revision === generation.current) setDiagnosis(answer); })
          .catch(issue => { if (mounted.current && revision === generation.current) setError(errorInfo(issue)); })
          .finally(() => { if (mounted.current && revision === generation.current) setPending(''); });
      }, [openName, read]);
      useEffect(() => {
        if (!operationId) return;
        let alive = true, timer, failures = 0; const controller = new AbortController(), started = Date.now();
        const poll = async () => {
          if (!alive) return;
          if (Date.now() - started > 15 * 60 * 1000) { setPollNotice('pollLimit'); return; }
          try {
            const answer = await request('operation', { id: operationId }, 'GET', controller.signal, 20000);
            if (!alive) return; failures = 0; setOperation(answer); setPollNotice('');
            if (terminalPhase(answer.phase)) {
              setOperationId(''); setChecked(new Set()); setScanResult(null); setOpenName(''); await load();
              if (answer.phase !== 'finished') setPollNotice('unknownOperation');
              return;
            }
          } catch (issue) {
            if (!alive || controller.signal.aborted) return;
            if (++failures >= 3) { setPollNotice('pollLost'); return; }
          }
          if (alive) timer = setTimeout(poll, 1500);
        };
        void poll(); return () => { alive = false; clearTimeout(timer); controller.abort(); };
      }, [operationId, pollEpoch, load]);
      useEffect(() => {
        if (!selfOperationId) return;
        let alive = true, timer, failures = 0; const controller = new AbortController(), started = Date.now();
        const poll = async () => {
          if (Date.now() - started > 15 * 60 * 1000) { setSelfOperationId(''); setSelfState(current => ({ ...(current ?? {}), phase: 'unknown', warning: 'self-update-poll-limit' })); return; }
          try {
            const answer = await request('self-operation', { id: selfOperationId }, 'GET', controller.signal, 20000);
            if (!alive) return;
            setSelfState(answer); failures = 0;
            if (!answer || terminalPhase(answer.phase)) { setSelfOperationId(''); await load(); return; }
          } catch { if (!alive || controller.signal.aborted) return; if (++failures >= 3) { setSelfOperationId(''); setSelfState(current => ({ ...(current ?? {}), phase: 'unknown', warning: 'self-update-transport-lost' })); return; } }
          if (alive) timer = setTimeout(poll, 1500);
        };
        void poll(); return () => { alive = false; clearTimeout(timer); controller.abort(); };
      }, [selfOperationId, load]);
      const refresh = async () => {
        if (pending) return; setPending('list'); setError(null); setScanResult(null); setChecked(new Set()); setOpenName(''); setPlan(null); setPollEpoch(value => value + 1);
        try { await load(); } catch (issue) { if (mounted.current) setError(errorInfo(issue)); } finally { if (mounted.current) setPending(''); }
      };
      const scan = async () => {
        if (pending || busy) return; setPending('scan'); setError(null); setChecked(new Set()); setPlan(null); setScanProgress({ phase: 'versions', done: 0, total: 0, current: null });
        const progressId = 'scan-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        let poll = null;
        poll = setInterval(async () => {
          try { const progress = await read('scan-progress', { id: progressId }, 'GET', 15000); if (mounted.current) setScanProgress(progress); } catch { /* transient polls do not abort the scan */ }
          if (!mounted.current) clearInterval(poll);
        }, 1200);
        try { const answer = await read('scan', { progressId }, 'GET', 300000); if (mounted.current) { setScanResult(answer); setSnapshot(current => ({ ...(current ?? {}), profile: answer.profile, runtimeVersion: answer.runtimeVersion })); } }
        catch (issue) { if (mounted.current) { setScanResult(null); setError(errorInfo(issue)); } }
        finally { clearInterval(poll); if (mounted.current) { setPending(''); setScanProgress(null); } }
      };
      const prepare = async () => {
        if (pending || busy || !selected.length) return; setPending('prepare'); setError(null);
        try {
          const selfSelected = selected.find(item => item.mode === 'host-self-update');
          if (selfSelected && selected.length !== 1) { setError({ code: 'self-update-separate-confirmation', diagnostic: t('selfHelp') }); return; }
          const answer = selfSelected
            ? await read('prepare-self-update', { version: selfSelected.latestVersion, ...(selfSelected.sourceKind === 'git' ? { commit: selfSelected.latestCommit } : {}) }, 'POST', 180000)
            : await read('prepare-batch', { items: selected.map(item => ({ name: item.name, version: item.latestVersion })) }, 'POST', 180000);
          if (!mounted.current) return;
          if (typeof answer.ticket === 'string' && !answer.blocked && array(answer.items).length) setPlan(answer);
          else setError({ code: 'state-changed', diagnostic: array(answer.reasons).join('; ') });
        } catch (issue) { if (mounted.current) setError(errorInfo(issue)); } finally { if (mounted.current) setPending(''); }
      };
      const prepareRestore = async name => {
        if (pending || busy || !string(name)) return;
        setPending('prepare-restore'); setError(null); setPlan(null);
        try {
          const answer = await read('prepare-restore', { name }, 'POST', 180000);
          if (!mounted.current) return;
          if (typeof answer.ticket === 'string' && !answer.blocked && isRestore(answer.operation) && array(answer.items).length === 1 && answer.items[0].name === name && string(answer.items[0].recoveryId)) setPlan(answer);
          else setError({ code: 'state-changed', diagnostic: array(answer.reasons).join('; ') });
        } catch (issue) { if (mounted.current) setError(errorInfo(issue)); } finally { if (mounted.current) setPending(''); }
      };
      const prepareMigration = async name => {
        const target = currentItems.get(name) ?? byName.get(name);
        if (pending || busy || checked.size || !migrationEligible(target)) return;
        setPending('prepare-migration'); setError(null); setPlan(null);
        try {
          const answer = await read('prepare-migration', { name }, 'POST', 180000);
          if (!mounted.current) return;
          if (typeof answer.ticket === 'string' && !answer.blocked && isMigration(answer.operation) && array(answer.items).length === 1 && answer.items[0].name === name && answer.items[0].from === answer.items[0].to && answer.items[0].installMode === 'registry-migration') setPlan(answer);
          else setError({ code: 'state-changed', diagnostic: array(answer.reasons).join('; ') });
        } catch (issue) { if (mounted.current) setError(errorInfo(issue)); } finally { if (mounted.current) setPending(''); }
      };
      const commit = async ({ taskPolicy = 'wait-for-idle', confirmCancel, confirmPublicMirror, confirmUnionGeneration, confirmMigration } = {}) => {
        if (!plan || pending) return; const ticket = plan.ticket; setPlan(null); setPending('commit'); setError(null); setOperation(null);
        try {
          const answer = await read('commit', { ticket, taskPolicy, ...(taskPolicy === 'cancel-active' && confirmCancel === true ? { confirmCancel: true } : {}), ...(mirrorAcknowledgementRequired(plan) && confirmPublicMirror === true ? { confirmPublicMirror: true } : {}), ...(array(plan.items).some(item=>item.installMode==='union-generation')&&confirmUnionGeneration===true?{confirmUnionGeneration:true}:{}), ...(isMigration(plan.operation)&&confirmMigration===true?{confirmMigration:true}:{}) }, 'POST', 45000);
          if (!mounted.current) return;
          if (typeof answer.operationId !== 'string') { setPollNotice('unknownOperation'); await load(); return; }
          if (isSelf(answer.operation)) {
            setSelfOperationId(answer.operationId); setSelfState({ id: answer.operationId, phase: 'waiting', result: null, attempt: { id: answer.operationId } }); setChecked(new Set()); return;
          }
          setOperationId(answer.operationId); setChecked(new Set()); setSnapshot(current => ({ ...(current ?? {}), busy: { id: answer.operationId, phase: 'waiting' } }));
        } catch (issue) { if (mounted.current) { setError(errorInfo(issue)); await load().catch(() => {}); } } finally { if (mounted.current) setPending(''); }
      };
      const cancelSelfWait = async () => {
        if (!selfState?.id || selfState.phase !== 'waiting' || pending) return;
        setPending('cancel-wait');
        try { await read('cancel-wait', { id: selfState.id }, 'POST', 45000); await load(); }
        catch (issue) { setError(errorInfo(issue)); } finally { if (mounted.current) setPending(''); }
      };
      const cancelWait = async () => {
        const id = operationId || operationIdOf(snapshot?.busy); if (!id || pending || currentPhase !== 'waiting') return;
        setPending('cancel-wait'); setError(null);
        try { await read('cancel-wait', { id }, 'POST', 45000); if (mounted.current) { setPollNotice('cancelledWait'); setPollEpoch(value => value + 1); await load(); } }
        catch (issue) { if (mounted.current) setError(errorInfo(issue)); } finally { if (mounted.current) setPending(''); }
      };
      const runLocks = async () => {
        if (!openName || pending || busy) return; const revision = generation.current; setPending('locks'); setError(null);
        try { const answer = await read('locks', { name: openName }, 'POST', 45000); if (mounted.current && revision === generation.current) setLocks(answer); }
        catch (issue) { if (mounted.current && revision === generation.current) setError(errorInfo(issue)); } finally { if (mounted.current && revision === generation.current) setPending(''); }
      };
      const toggle = (item, enabled) => {
        if (!eligible(item) || pending || busy) return;
        if (enabled && item.mode === 'host-self-update') { setChecked(new Set([item.name])); return; }
        if (enabled && baseItems.some(candidate => candidate.mode === 'host-self-update' && checked.has(candidate.name))) { setChecked(new Set([item.name])); return; }
        if (enabled && !checked.has(item.name) && checked.size >= 20) { setError({ code: 'batch-limit', diagnostic: '' }); return; }
        setChecked(current => { const next = new Set(current); if (enabled) next.add(item.name); else next.delete(item.name); return next; });
      };
      const reasonText = reason => localText(t, 'reason.' + string(reason), string(reason) || t('unknown'));
      const errorText = error?.code === 'timeout' ? t('timeout') : error?.code === 'batch-limit' ? t('batchLimit') : ['stale-confirmation', 'state-changed'].includes(error?.code) ? t('stale') : error?.code === 'busy' ? t('externalBusy') : localText(t, 'reason.' + string(error?.code), t('requestFailed'));
      const detailBundle = diagnosis?.bundle ?? byName.get(openName);
      const operationItems = array(operation?.record?.items);
      const staging = currentPhase === 'waiting' && operationItems.some(item => item.status === 'preparing');
      const pluginRows = baseItems.map(item => {
        const reasons = array(item.reasons).length ? h('details', { className: 'pud-small', style: { marginTop: 5 } },
          h('summary', null, t('reasonTitle')),
          h('ul', { className: 'pud-list' }, ...item.reasons.map((reason, i) => h('li', { key: i }, reasonText(reason))))) : null;
        return h('tr', { key: item.name, 'data-open': item.name === openName, 'data-package': item.name },
          h('td', null, h('input', { type: 'checkbox', className: 'pud-check', checked: checked.has(item.name) && eligible(item), disabled: !eligible(item) || !!pending || busy,
            'aria-label': t('select') + ' ' + item.name, onChange: event => toggle(item, event.target.checked) })),
          h('td', { className: 'pud-package-cell pud-break' }, h('strong', null, item.name),
            item.runtimePackaging==='union-dependency-generation' ? h('p',{className:'pud-muted pud-small'},t('unionGenerationSource')) : item.doctorArchive === true ? h('p', { className: 'pud-muted pud-small' }, t('archiveSourceIdentity')) : null),
          h('td', null, valueOf(item.version, t('noValue'))), h('td', null, h(VersionValue, { item, t })),
          h('td', null, h('p', { className: 'pud-small', style: { margin: 0 }, 'data-quick-status': quickStatus(item) }, quickStatusText(item, t)),
            item.packagePreflight?.hostDependencies?.length ? h('span', { className: 'pud-impact pud-small', style: { marginInlineStart: 6 }, 'data-testid': 'pud-host-dependencies-badge' }, t('hostDependenciesBadge')) : null,
            h('details', { className: 'pud-small', style: { marginTop: 4 } }, h('summary', null, t('rowDetails')),
              h(VersionState, { item, t }),
              item.mode === 'host-self-update' ? h('p', { className: versionStates(item).version === 'not-checked' ? 'pud-muted pud-small' : 'pud-impact pud-small' },
                versionStates(item).version === 'not-checked' ? t('selfCheckHelp') : [t('selfMode'), ' · ', t('selfHelp')]) : null,
              item.mode === 'host-self-update' && item.sourceKind === 'git' ? h('details', { className: 'pud-small' }, h('summary', null, t('githubHead')), h(CommitDetails, { value: item, t })) : null,
              highImpactWarning(item) ? h('p', { className: 'pud-impact pud-small' }, t('highImpact')) : null,
              h(InformationWarnings, { item, t }),
              item.preflightError ? h('p', { className: 'pud-muted pud-small', 'data-testid': 'pud-preflight-error' }, t('preflightRetryHint')) : null,
              item.packagePreflight?.hostDependencies?.length ? h('p', { className: 'pud-impact pud-small', 'data-testid': 'pud-host-dependencies' }, t('hostDependenciesWarning').replace('{list}', item.packagePreflight.hostDependencies.join(', '))) : null,
              item.generationPreflight?.status === 'download-required' ? h('p', { className: 'pud-muted pud-small', 'data-testid': 'pud-dependency-closure' },
                t('dependencyClosurePlanned').replace('{packages}', String(item.generationPreflight.closurePackages ?? '?'))) : null,
              reasons)),
          h('td', null, h('div', { className: 'pud-inline' }, h('button', { type: 'button', className: 'pud-btn pud-btn-compact', disabled: !!pending,
            onClick: () => setOpenName(current => current === item.name ? '' : item.name), 'aria-expanded': openName === item.name }, t('diagnosis')),
            recoveryEligible(item) ? h('button', { type: 'button', className: 'pud-btn pud-btn-compact', disabled: !!pending || busy, onClick: () => { void prepareRestore(item.name); }, 'data-testid': 'pud-restore' }, t('restore')) : null,
            migrationEligible(item) ? h('button', { type: 'button', className: 'pud-btn pud-btn-compact', disabled: !!pending || busy || !!checked.size, onClick: () => { void prepareMigration(item.name); }, 'data-testid': 'pud-migrate' }, t('migrateSource')) : null)));
      });
      const pluginTable = !snapshot ? null : !baseItems.length ? h('p', { className: 'pud-muted' }, t('empty')) : h('div', { className: 'pud-table-wrap' },
        h('table', { className: 'pud-table', 'data-testid': 'pud-plugin-table' },
          h('thead', null, h('tr', null, ...['select', 'package', 'currentVersion', 'latestVersion', 'status', 'actions'].map(key => h('th', { key, scope: 'col' }, t(key))))),
          h('tbody', null, ...pluginRows)));
      const footer = h('div', { className: 'pud-toolbar pud-footer' },
        h('div', { className: 'pud-inline' },
          h('button', { type: 'button', className: 'pud-btn', disabled: !!pending || busy || !normalAvailable.length,
            onClick: () => setChecked(new Set(normalAvailable.slice(0, 20).map(item => item.name))), 'data-testid': 'pud-select-all' }, t(normalAvailable.length > 20 ? 'selectFirstBatch' : 'selectAll')),
          h('button', { type: 'button', className: 'pud-btn', disabled: !!pending || busy || !checked.size,
            onClick: () => setChecked(new Set()), 'data-testid': 'pud-clear-selection' }, t('clearSelection')),
          h('span', { className: 'pud-muted pud-small', 'aria-live': 'polite' }, t('selectedCount') + ' ' + selected.length + ' · ' + t('availableCount') + ' ' + available.length)),
        h('button', { type: 'button', className: 'pud-btn pud-btn-primary', disabled: !!pending || busy || !selected.length || selected.length > 20,
          'aria-busy': pending === 'prepare' || pending === 'commit', onClick: () => { void prepare(); }, 'data-testid': 'pud-update-selected' },
          pending === 'prepare' || pending === 'commit' ? h('span', { className: 'pud-spinner', 'aria-hidden': true }) : null,
          t(pending === 'prepare' ? 'reviewing' : pending === 'commit' ? 'queuing' : 'updateSelected') + (selected.length ? ' (' + selected.length + ')' : '')));
      const mainList = h('section', { className: 'pud-card' }, h('h2', null, t('installed')),
        h('p', { className: 'pud-muted pud-small' }, t('scanHint')),
        scanResult?.checkedAt ? h('p', { className: 'pud-muted pud-small' }, t('lastChecked') + ': ', dateText(scanResult.checkedAt, locale, t)) : null,
        pluginTable, footer,
        available.length > 20 ? h('p', { className: 'pud-muted pud-small' }, t('batchLimit')) : null,
        scanResult && !available.length ? h('p', { className: 'pud-muted pud-small' }, t('noAvailable')) : !scanResult ? h('p', { className: 'pud-muted pud-small' }, t('uncheckedHint')) : null);
      const processRows = array(locks?.processes).map((item, i) => h('tr', { key: i },
        h('td', null, valueOf(item.pid, t('noValue'))),
        h('td', { className: 'pud-break' }, valueOf(item.applicationName ?? item.name, t('noValue'))),
        h('td', null, valueOf(item.startTime, t('noValue')))));
      const lockView = locks ? h('div', null,
        h('h3', null, t('locks')), h('p', { className: 'pud-muted pud-small' }, t('lockIntro')),
        h('div', { className: 'pud-note' + (locks.status === 'checked' && locks.evidence !== 'unknown' ? '' : ' pud-warning') }, t(locks.status === 'checked' && locks.evidence !== 'unknown' ? 'lockChecked' : 'lockUnknown')),
        h(Finding, { finding: locks.classification, t }), h('h3', null, t('processes')),
        processRows.length ? h('div', { className: 'pud-table-wrap' }, h('table', { className: 'pud-table' },
          h('thead', null, h('tr', null, ...['pid', 'application', 'startTime'].map(key => h('th', { key }, t(key))))), h('tbody', null, ...processRows))) : h('p', { className: 'pud-muted' }, t('noProcesses')),
        h('details', null, h('summary', null, t('files') + ' (' + array(locks.files).length + ')'), h(SourceDetails, { value: locks, t }))) : null;
      const detailView = openName ? h('section', { className: 'pud-card', 'data-testid': 'pud-diagnosis' },
        h('div', { className: 'pud-detail-head' }, h('h2', { className: 'pud-break' }, t('diagnosis') + ' · ' + openName),
          h('button', { type: 'button', className: 'pud-btn pud-btn-compact', disabled: !!pending, onClick: () => setOpenName('') }, t('closeDetails'))),
        detailBundle ? h('dl', { className: 'pud-definition pud-small', style: { marginTop: 14 } },
          h('dt', null, t('hostState')), h('dd', null, h(Badge, { value: string(detailBundle.state) || 'unknown', prefix: 'state', t })),
          h('dt', null, t('rows')), h('dd', null, valueOf(detailBundle.activeRows, 0) + ' / ' + valueOf(detailBundle.totalRows, 0)),
          h('dt', null, t('source')), h('dd', null, localText(t, installedSourceLabel(detailBundle), t('noValue')))) : null,
        h('div', { className: 'pud-toolbar', style: { marginTop: 14 } }, h('button', { type: 'button', className: 'pud-btn', disabled: !!pending || busy || !detailBundle?.installed,
          onClick: () => { void runLocks(); } }, t('locks')), recoveryEligible(detailBundle) ? h('button', { type: 'button', className: 'pud-btn', disabled: !!pending || busy, onClick: () => { void prepareRestore(openName); }, 'data-testid': 'pud-detail-restore' }, t('restore')) : null,
          migrationEligible(detailBundle) ? h('button', { type: 'button', className: 'pud-btn', disabled: !!pending || busy || !!checked.size, onClick: () => { void prepareMigration(openName); }, 'data-testid': 'pud-detail-migrate' }, t('migrateSource')) : null,
          h('button', { type: 'button', className: 'pud-btn', 'data-testid': 'pud-copy-report-detail', onClick: () => { void copyReport(openName); } }, t('copyReport'))),
        migrationEligible(detailBundle) ? h('p', { className: 'pud-note pud-warning' }, t('migrationHelp')) : null,
        recoveryEligible(detailBundle) ? h('div', { className: 'pud-note pud-warning' }, h('strong', null, t('recoveryTarget') + ': ', detailBundle.restoreVersion), h('p', { className: 'pud-muted pud-small' }, t('recoveryHelp'))) : null,
        h(Finding, { finding: diagnosis?.classification, t }), lockView,
        h('details', { className: 'pud-small', style: { marginTop: 14 } }, h('summary', null, t('detail')), h(SourceDetails, { value: diagnosis, t }))) : null;
      const observedSteps = array(operation?.steps).length ? h('details', null, h('summary', null, t('steps')),
        h('ol', { className: 'pud-list' }, ...operation.steps.map((step, i) => h('li', { key: i },
          stepText(step, t), step.name ? h('span', { className: 'pud-break' }, ' · ', step.name) : null)))) : null;
      const recovering = isRestore(operation?.record?.operation), migrating = isMigration(operation?.record?.operation);
      const installProgress = operation?.installProgress;
      const logChunks = boundedLogs(operation?.boundedlogs ?? operation?.boundedLogs ?? operation?.logs);
      const installView = installProgress ? h('p', { className: 'pud-inline' }, t('installProgress') + ': ',
        h(Badge, { value: string(installProgress.phase) || 'unknown', prefix: 'install', t }), string(installProgress.name)) : null;
      const logView = logChunks.length ? h('details', null, h('summary', null, t('logDetails')),
        h('p', { className: 'pud-muted pud-small' }, t('logBound')), h('pre', { className: 'pud-json', tabIndex: 0 },
          logChunks.map(chunk => [chunk.name, chunk.stream, chunk.text].filter(Boolean).join(' · ')).join('\n'))) : null;
      const progress = !selfPending && normalBusy || pollNotice ? h('section', { className: 'pud-card', 'aria-live': 'polite' },
        h('h2', null, t(pollNotice || ['unknown','interrupted'].includes(currentPhase) ? 'progressUnknown' : snapshot?.externalBusy && !operationId ? 'externalBusy' : staging ? 'staging' : currentPhase === 'waiting' ? 'waiting' : migrating ? 'migratingSource' : recovering ? 'restoring' : 'running')),
        h('p', { className: 'pud-muted' }, t(pollNotice || ['unknown','interrupted'].includes(currentPhase) ? 'progressUnknownDetail' : staging ? 'stagingDetail' : currentPhase === 'waiting' ? 'waitingDetail' : 'runningDetail')),
        h('p', { className: 'pud-muted pud-small' }, t('continuing')),
        operation?.waiting ? h('p', { className: 'pud-muted pud-small' }, t('activeTasks') + ': ' + valueOf(operation.waiting.runningAgents, t('unknown'))) : null,
        currentPhase === 'waiting' ? h('div', { className: 'pud-note' },
          h('p', { className: 'pud-muted pud-small', style: { margin: '0 0 8px' } }, t('cancelWaitHelp')),
          h('button', { type: 'button', className: 'pud-btn', disabled: !!pending, onClick: () => { void cancelWait(); }, 'data-testid': 'pud-cancel-wait' }, t('cancelWait'))) : null,
        installView, logView, observedSteps,
        pollNotice ? h('div', { className: 'pud-note pud-warning', role: 'status' }, t(pollNotice),
          h('div', { style: { marginTop: 8 } }, h('button', { type: 'button', className: 'pud-btn', disabled: !!pending,
            onClick: () => { setPollNotice(''); setPollEpoch(value => value + 1); void refresh(); } }, t('checkProgress')))) : null) : null;
      const results = operation?.record ? h('section', { className: 'pud-card' },
        h('h2', null, t(isMigration(operation.record.operation) ? 'migrationResults' : isRestore(operation.record.operation) ? 'restoreResults' : terminalPhase(operation.phase) ? 'finished' : 'batchResults')),
        terminalPhase(operation.phase) ? h('p', { className: 'pud-muted' }, t(operation.phase === 'finished' ? 'finishedDetail' : 'unknownOperation')) : null,
        operationItems.length ? h(BatchTable, { items: operationItems, t, onRestore: prepareRestore, busy: busy || !!pending, recoveries: currentItems, onReport: copyReport, reportNotice }) : h('p', { className: 'pud-muted' }, t('noResults')),
        h('details', { className: 'pud-small', style: { marginTop: 12 } }, h('summary', null, t('detail')), h(SourceDetails, { value: operation, t }))) : null;
      const selfOutcome = selfState?.result?.result?.application === 'applied' && !selfState.verifiedApplied ? 'unknown' : string(selfState?.result?.result?.application) || string(selfState?.result?.outcome) || 'unknown';
      const selfView = selfState ? h('section', { className: 'pud-card', 'data-testid': 'pud-self-update', 'aria-live': 'polite' },
        h('h2', null, t('selfResult')),
        h('p', null, t(selfState.phase === 'handed-off' ? 'selfHandedOff' : selfState.phase === 'waiting' ? 'waiting' : selfState.phase === 'unknown' ? 'selfUnknown' : 'finished'), ' · ', h(Badge, { value: selfOutcome, prefix: 'outcome', t })),
        h('p', { className: 'pud-muted pud-small' }, t('selfContinuing')),
        h('p', { className: 'pud-note pud-warning' }, t('selfGateHelp')),
        selfState.attempt ? h('p', null, valueOf(selfState.attempt.from, t('noValue')), ' → ', valueOf(selfState.attempt.to, t('noValue'))) : null,
        h(CommitDetails, { value: selfState.attempt, t }),
        h(Verification, { verification: selfState.verification, t }),
        selfState.result?.restore ? h('div', { className: 'pud-note' }, t('recoveryOutcome'), ' · ', h(Badge, { value: string(selfState.result.restore.application) || 'unknown', prefix: 'outcome', t }), h(Verification, { verification: selfState.restoreVerification, t })) : null,
        selfState.warning ? h('p', { className: 'pud-warning' }, t('selfUnknown')) : null,
        selfState.phase === 'waiting' ? h('button', { type: 'button', className: 'pud-btn', disabled: !!pending, onClick: () => { void cancelSelfWait(); } }, t('cancelWait')) : null,
        h('details', null, h('summary', null, t('detail')), h(SourceDetails, { value: selfState, t }))) : null;
      const restart = snapshot?.restart, restartPending = restart?.pending, restartLast = restart?.last;
      const restartNotice = !restartPending && !restartLast ? null : h('div', { className: 'pud-note' + (restartLast && restartLast.outcome !== 'applied' ? ' pud-warning' : ''), role: 'status', 'data-testid': 'pud-restart' },
        h('strong', null, restartPending ? t('restartPending') : t(restartLast.outcome === 'applied' ? 'restartApplied' : restartLast.outcome === 'rolled-back' ? 'restartRolledBack' : 'restartUnknown')),
        h('span', { className: 'pud-muted pud-small' }, ' · ', (restartPending ?? restartLast).name, ' ', restartPending ? restartPending.from + ' → ' + restartPending.to : restartLast.outcome === 'rolled-back' ? restartLast.from : restartLast.to));
      const header = h('header', { className: 'pud-header' },
        h('div', null, h('h1', null, t('title'), h('span', {className:'pud-muted',style:{fontSize:12,marginInlineStart:10,fontWeight:400}}, 'v0.6.14')), h('p', { className: 'pud-subtitle pud-muted' }, t('intro')),
          h('div', { className: 'pud-meta pud-muted' }, h('span', null, t('profile') + ': ', valueOf(snapshot?.profile, t('noValue'))), h('span', null, t('runtime') + ': ', valueOf(snapshot?.runtimeVersion, t('noValue'))))),
        h('div', { className: 'pud-toolbar' },
          h('button', { type: 'button', className: 'pud-btn', disabled: !!pending, onClick: () => { void refresh(); }, 'data-testid': 'pud-refresh' }, t('refresh')),
          h('button', { type: 'button', className: 'pud-btn', onClick: () => { void copyReport(); }, 'data-testid': 'pud-copy-report-all' }, t('copyReportAll')),
          h('button', { type: 'button', className: 'pud-btn pud-btn-primary', disabled: !!pending || busy, 'aria-busy': pending === 'scan', onClick: () => { void scan(); }, 'data-testid': 'pud-scan' },
            pending === 'scan' ? h('span', { className: 'pud-spinner', 'aria-hidden': true }) : null, t(pending === 'scan' ? 'scanning' : 'scan'))));
      const failure = error ? h('div', { className: 'pud-note pud-error', role: 'alert' },
        h('strong', null, errorText),
        error.diagnostic || error.code ? h('details', null, h('summary', null, t('detail')),
          error.code ? h('p', { className: 'pud-break' }, error.code) : null,
          error.diagnostic ? h('p', { className: 'pud-break' }, error.diagnostic) : null) : null,
        !error.diagnostic && error.code !== 'batch-limit' ? h('p', null, t('transportFailed')) : null) : null;
      const history = h('section', { className: 'pud-card' }, h('h2', null, t('history')),
        array(snapshot?.history).length ? snapshot.history.slice(0, 12).map(record => h(Record, { key: record.id, record, t, locale, onRestore: prepareRestore, busy: busy || !!pending, recoveries: currentItems, onReport: copyReport, reportNotice })) : h('p', { className: 'pud-muted' }, t('noHistory')));
      const limits = array(snapshot?.limitations).length ? h('details', { className: 'pud-muted pud-small' }, h('summary', null, t('limitations')),
        h('ul', { className: 'pud-list' }, ...snapshot.limitations.map((item, i) => h('li', { key: i }, string(item))))) : null;
      // Everything below answers "what next?" — technical evidence lives in one
      // collapsed diagnostics section instead of the normal reading path.
      const syncProblem = array(clientSync?.failures).length > 0;
      const selfActive = !!selfState && (!!selfState.attempt && !selfState.result || ['waiting', 'handed-off'].includes(string(selfState.phase)));
      const diagnostics = h('details', { className: 'pud-card', 'data-testid': 'pud-diagnostics' },
        h('summary', null, t('diagnostics')),
        h('p', { className: 'pud-muted pud-small' }, t('diagnosticNote')),
        h('p', { className: 'pud-muted pud-small' }, t('safety')),
        h('p', { className: 'pud-muted pud-small' }, t('sourcePublicOnly')),
        syncProblem ? null : h(ClientSync, { state: clientSync, retryClient, t }),
        selfActive ? null : selfView,
        history, limits);
      const scanBar = pending === 'scan' && scanProgress ? (() => {
        const total = Math.max(0, Number(scanProgress.total) || 0), done = Math.min(total || Number.MAX_SAFE_INTEGER, Math.max(0, Number(scanProgress.done) || 0));
        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
        const label = scanProgress.phase === 'complete' ? t('scan.phase.complete')
          : scanProgress.current ? t('scanProgressLabel').replace('{name}', string(scanProgress.current)).replace('{done}', String(Math.min(done + 1, total || done + 1))).replace('{total}', String(total || '?'))
            : t('scan.phase.' + (string(scanProgress.phase) || 'versions'));
        return h('div', { className: 'pud-progress', role: 'status', 'aria-live': 'polite', 'data-testid': 'pud-scan-progress' },
          h('div', { className: 'pud-progress-head' }, h('span', { className: 'pud-break' }, label), total > 0 ? h('span', { className: 'pud-muted pud-small' }, pct + '%') : null),
          h('div', { className: 'pud-progress-track', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct },
            h('div', { className: 'pud-progress-bar', style: { width: pct + '%' } })));
      })() : null;
      return h('div', { className: 'pud-page' }, h('style', null, CSS),
        h('div', { className: 'pud-wrap' }, header, scanBar,
          reportNotice ? h('p', { className: 'pud-note pud-muted pud-small', role: 'status', 'data-testid': 'pud-report-notice' }, reportNotice === 'failed' ? t('reportFailed') : t('reportCopied') + ' · ' + t('reportHint')) : null,
          reportText ? h('details', { className: 'pud-card pud-small', 'data-testid': 'pud-report-view', ...(reportNotice === 'failed' ? { open: true } : {}) },
            h('summary', null, t('showReport')),
            h('pre', { className: 'pud-json', tabIndex: 0, 'data-testid': 'pud-report-json' }, reportText)) : null,
          restartNotice, failure,
          snapshot?.persistenceWarning ? h('div', { className: 'pud-note pud-warning', role: 'status' }, t('persistence') + ': ', string(snapshot.persistenceWarning)) : null,
           snapshot?.truncationWarning ? h('div', { className: 'pud-note pud-muted', role: 'status' }, t('historyTruncated')) : null,
          pending && !(pending === 'scan' && scanProgress) ? h('div', { className: 'pud-inline pud-muted', role: 'status', 'aria-live': 'polite' }, h('span', { className: 'pud-spinner', 'aria-hidden': true }), t(pending === 'scan' ? 'scanning' : pending === 'prepare-migration' ? 'reviewingMigration' : pending === 'prepare-restore' ? 'reviewingRestore' : 'loading')) : null,
          syncProblem ? h(ClientSync, { state: clientSync, retryClient, t }) : null, selfActive ? selfView : null,
          progress, results, mainList, detailView, diagnostics),
        plan ? h(ConfirmDialog, { plan, t, locale, onCancel: () => setPlan(null), onConfirm: policy => { void commit(policy); } }) : null);
    }
    return {
      inject: ['slots', 'modules'],
      apply(ctx) {
        ctx.inject(['locale'], scope => {
          scope.effect(() => scope.locale.register(NS, { en: EN, zh: ZH }), 'plugin-update-doctor: locale');
          const t = scope.locale.bind(NS);
          scope.slots.inject('sidebar.panellist', function* () {
            yield scope.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 35, label: () => t('panel'), locale: NS }, ({ size }) => h(DoctorIcon, { size }));
          });
          scope.slots.inject('plugins.detail.section', function* () {
            yield scope.slots.register({ name: 'plugins.detail.section', id: 'plugin-update-doctor-archive-versions', order: 35, locale: NS,
              inject: () => {
                const layout = scope.get('layout');
                return { openPanel: typeof layout?.selectPanel === 'function' ? () => layout.selectPanel(PANEL_ID) : undefined };
              } }, props => detailSubjectCandidate(props.subject) ? h(DetailArchiveCheck, { subject: props.subject, t: props.t, openPanel: props.openPanel }) : null);
          });
          scope.slots.inject('main', function* () {
            yield scope.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({
              hooks: { locale: scope.locale, clientSync: scope.modules.entries.state },
              retryClient: () => scope.modules.entries.retry(),
            }) }, props => h(PanelBoundary, { message: props.t('renderFailed') }, h(DoctorPanel, props)));
          });
        });
      },
    };
  },
});
