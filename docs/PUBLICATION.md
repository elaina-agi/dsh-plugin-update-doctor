# Publication and privacy notes

The initial public source snapshot was v0.3.0 under MIT. v0.4.0 added a narrowly admitted npm self-update handoff; v0.5.0 adds a separate fixed-commit GitHub handoff. **v0.5.0 is now published on public npm**, following the user's separate publication action. It is an independent third-party bundle, not an official DSH component. Self-update experiments use DSH Desktop 0.2.2-rc.5 on Windows x64; earlier update experiments use 0.2.2-rc.3.

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

## Distribution

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
