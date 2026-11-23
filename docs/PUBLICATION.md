# Publication and privacy notes

The initial public source snapshot was v0.3.0 under MIT. v0.4.0 added a narrowly admitted npm self-update handoff; v0.5.0 adds a separate fixed-commit GitHub handoff. **v0.5.0 is now published on public npm**, following the user's separate publication action. It is an independent third-party bundle, not an official DSH component. Self-update experiments use DSH Desktop 0.2.2-rc.5 on Windows x64; earlier update experiments use 0.2.2-rc.3.

The latest repository Markdown includes a post-install user-upgrade record and [Windows runtime requirements](<WINDOWS_REQUIREMENTS.md>). This documentation-only follow-up does not overwrite, rebuild or reinstall the reviewed0.5.3 archive. A later distribution requires explicit authorization and a new artifact check.

## What is public

- Plugin source, locale/icon resources, documentation and regression tests.
- Read-only native helper source, its build script and the shipped Windows x64 executable.
- Experiment runners and carefully scoped summaries. Public package names, versions and package digests identify reproducible inputs; they are not user secrets.

## What is not uploaded

- Raw experiment JSON, local diagnostic history, installation identities, staged archives or configuration.
- Credentials, browser/session data, user profile contents, machine-specific directories and generated logs.
- Original local development history. The first public commit is a clean source snapshot; the prior local history remains local.

The review covers candidate source files, prior local commits and the helper's ASCII/UTF-16 strings and PE debug directory. The helper contains no PDB reference. This is a scoped audit, not a guarantee that every possible secret format is detectable. Ignored files remain local rather than being rewritten and presented as new experiment results.

Retained-evidence tests explicitly skip when private local results are absent. A public clone can run normal regressions without those results; skipped evidence is not a pass or a repeat of a historical Host experiment. Existing but invalid evidence must fail.

## v0.5.3 本地修复补充

本版修复WSL固定版本名单拦截，改为绑定公开原包的结构／宿主声明契约和完整保留原包证明；原版rc.5隔离0.26.2→0.29.0更新及预准备旧恢复通过。schema4与未知结果拒绝保护见[说明](<WSL_STRUCTURAL_0_5_3.md>)。本版未发布npm、未推送，本机0.5.3安装已确认，用户随后在真实面板执行WSL0.26.2→0.29.0成功，日志/资源核验通过、16/16Host条目active。安装更新器不会自动更新WSL或Union；后续操作必须由用户另行确认。

## v0.5.2阶段记录（未发布公共npm）

v0.5.2本地测试包与先前0.5.1测试包不同，新增仅已审查Union24→25完整依赖本地代际，原型及生产限定隔离路径通过；常规Unionnpm/HMR失败事实不变，这不是修补DSH。新来源／确认／schema3与恢复限制见[Union代际说明](<UNION_GENERATION_0_5_2.md>)。未推送或发布公共npm；本地安装须另行确认，最终归档与本机安装状态以交付验收记录为准，不自动替换真实Union。历史0.5.1和公共0.5.0归档不被覆盖。

## Distribution（以下0.5.1为历史状态）

The local v0.5.1 development revision implements corrected source-scoped version discovery, separation of discovery from replacement admission, exact npm-source preservation through the public Host updater, independently confirmed same-version migration of identified older Doctor archives, fixed public-mirror self-update, reviewed unchanged JS dependency graphs, the isolated WSL 0.26.2 to 0.28.0 generation path, and a separate Doctor-owned archive check/navigation entry on detail pages. These are narrowly reviewed development paths, not universal hot updates. **Safe no-restart Union Search update/migration/recovery is blocked in the current HMR environment. Blocking is risk handling, not a fix. Installing this updater alone does not resolve that problem.** Separate Union or Node/Electron research is not a shipped updater capability and does not justify Host patching or debugger injection by the plugin. Prepared bytes are evidence, not the Host's refetched artifact transaction.

At the historical v0.5.1 packaging checkpoint it had not been published, pushed or installed in the user's profile; the user later separately authorized local0.5.1/0.5.2/0.5.3 installations. None of these actions published a new npm version. At that historical checkpoint, candidate archive resources and owned isolated stock Host installation/limited flows had been checked; real-user upgrades, public old-version self-update and live browser acceptance were still pending. The later local WSL0.29.0 user-upgrade record appears above and does not retrospectively change that checkpoint. The public v0.5.0 artifact and its digests below remain unchanged. See the [draft release notes](<RELEASE_NOTES_0_5_1.md>) and [release review checklist](<RELEASE_REVIEW_0_5_1.md>). Publication requires a new reviewed artifact and explicit authorization; source tests alone are not live-update or browser evidence.

On **2026-11-21 (Asia/Shanghai)**, read-only checks confirmed that [public npm serves v0.5.0](<https://registry.npmjs.org/dsh-plugin-update-doctor/0.5.0>), the package's `latest` tag is `0.5.0`, and the [tarball](<https://registry.npmjs.org/dsh-plugin-update-doctor/-/dsh-plugin-update-doctor-0.5.0.tgz>) is downloadable with HTTP 200. The downloaded bytes match the reviewed publication artifact:

- Source commit: `7eb59f934ae80ee5636bddfbc79afa67bbc2970e`.
- Archive size: **122,671 bytes**; **36 packaged files** in the pre-publication pack review.
- SHA256: `e06a9b565aa38974b98db92ee83cf73146eed729aaef15a392c2603342babc15`.
- npm SHA1: `f9bab2c9a2e2a0eeb61038805006060f269bee34`.
- npm integrity: `sha512-ekZzyGVL7MwqENAjP0f6IYHDBmkCGYcf5zndRdb8uoC7pg/kE41beqXiwPPiebXwlyL95Es06Tq8R0J3Fgrjhg==`.

The user performed the npm publication; these subsequent checks did not publish, install or change a live profile. Public archive availability and integrity are not evidence of a real npm-source DSH installation or a future live self-update.

The [README](<../README.md>) documents npm installation through DSH's official Plugin Manager with `dsh-plugin-update-doctor@0.5.0`, plus fixed-commit GitHub and local-source alternatives. npm publication does not migrate an existing GitHub installation. npm self-update admission remains separate from first installation and can refuse Host registry plans with fallback or unsupported dependencies.

The GitHub source upload itself does **not** publish npm or create a GitHub Release. npm publication was a separate action; no GitHub Release is asserted here. The published v0.5.0 archive retains documentation written before publication, including the earlier no-npm-publication status. This repository documentation update does not rebuild or overwrite that archive. Consult the [current repository README](<https://github.com/elaina-agi/dsh-plugin-update-doctor#readme>) for current installation guidance. A later package change requires a new version, a separate publication decision and another check of the actual artifact contents.

Before reporting an issue, manually review copied diagnostics and screenshots. Remove usernames, full paths, credentials and private configuration; do not attach raw experiment JSON or the DSH profile directory.
