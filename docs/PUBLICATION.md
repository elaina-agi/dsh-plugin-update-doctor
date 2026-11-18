# Publication and privacy notes

This repository contains the v0.3.0 **public testing** source snapshot, under MIT. It is an independent third-party bundle, not an official DSH component. The verified Host is DSH Desktop 0.2.2-rc.3 on Windows x64.

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

The GitHub source upload does **not** publish npm or create a GitHub Release. GitHub/local-source installation is documented in the README. Any later package publication or release requires a separate explicit decision and another check of the actual artifact contents.

Before reporting an issue, manually review copied diagnostics and screenshots. Remove usernames, full paths, credentials and private configuration; do not attach raw experiment JSON or the DSH profile directory.
