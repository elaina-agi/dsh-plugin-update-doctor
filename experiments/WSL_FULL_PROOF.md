# Complete WSL online-update proof — current ASAR DSH 0.2.2-rc.3

This extends the earlier **invalid minimal-host comparison**. It uses the actual installed ASAR Electron runtime with `--expose-internals`, public AppBoot/RuntimeResolution/Cordis/Loader/HMR/PluginManager, and the complete official `dsh-base` + `dsh-web-app` layers plus real `dsh-plugin-wsl-env` registry packages.

Each run creates its own unique temporary `DSH_HOME`/profile. No user desktop profile, WSL configuration, task, plugin package or kernel source is copied or modified. Browser opening and listener/module delivery are disabled; the real connection registry, commands, agents, tools, sandbox policy, working directory, agent presets and shell environment services remain. Two unrelated Web-dependent Host rows (`open-in-app`, `harness-dev-context`) are pending because the test intentionally binds no Web server/app; **all enabled WSL rows must be active before an update is attempted**.

## Results

### Official update sequence: reproduced real failure

Retained local evidence: `wsl-full-proof-result.json`; the original numeric process identifier is omitted from this public summary.

- Real WSL **0.24.0 cold start: 14/14 enabled Host rows active**.
- Actual `commands`, `agents`, `tools`, `sandboxPolicy`, `workingDirectory`, `connection`, `agentPresets`, `shellEnv` services are present.
- `pluginManager.updateBundle('dsh-plugin-wsl-env', '0.26.1')`: package manager exit 0, but Host activation fails.
- Its automatic restoration to 0.24.0 also installs successfully but fails activation.

Exact substantive diagnostics:

```text
subprocess-wsl: service "subprocess" has been registered at <LocalSubprocessRuntime>
fs-routing: service "fs" has been registered at <SandboxedFileSystem>
wsl-cwd-prompt-tool: pending (waiting for service: workingDirectory)
```

Removing WSL temporarily restores the base providers; re-adding WSL then conflicts with those live service registrations. This is actual observed service-lifecycle evidence, not a Windows file-lock conclusion. The run intentionally refuses the staged comparison once the restored 0.24.0 baseline is no longer fully active; its `completed: false` is the failed-baseline assertion, not a cold-start failure.

### Verified tarball in-place replacement: avoids one problem, exposes stale ESM namespace

Retained local evidence: `wsl-full-inplace-proof-result.json`; the update and recovery share one isolated process.

- Fresh real WSL **0.24.0 cold start: 14/14 active**.
- SHA512-verified target tarball installed through public `installBundle(localTarball, expected)` **without removing the selected bundle first**.
- Disk package becomes 0.26.1, `subprocess` and `fs` replacement rows remain active, and base `subprocess`/`fs-sandbox` rows remain disabled: no base-provider duplicate-registration error.
- WSL `status` and `wsl-doctor-command` nevertheless fail import:

```text
SyntaxError: The requested module './doctor-live.js'
does not provide an export named 'mergeAutoPresetSeam'
```

- Public same-selection `setBundleEnabled(name, true)` reapplication fails with the same error.
- Public off/on of **only the two failed rows**, while preserving bundle selection/base-provider suppression, fails with the same error.
- **58 JS files** in the owned installed fixture were replaced via copy-on-write with identical bytes; before/after SHA256 equality was verified for every file. One more public reapplication still fails with the same error. No private ESM cache/HMR hook was patched.
- Installing the verified 0.24.0 tarball in place **restores 14/14 active rows in the same process**.

### Fresh 0.26.1 cold baseline: package is valid

Retained local evidence: `wsl-full-cold26-proof-result.json`, from a separate cold-start control process.

Fresh real WSL **0.26.1 cold start: 15/15 enabled Host rows active**, including the added `wsl-open-in-app` row. Thus this is not a package that cannot activate even in a complete Host. The cold/hot difference supports a cached namespace / module-generation problem in the in-place path, but no private-cache internals were changed to assert a stronger root cause.

## What this does and does not establish

This is now a valid cold-all-active WSL online-update failure reproduction. It does **not** establish a successful safe live WSL update path. Merely relaxing patch/peer/native admissibility in the updater would not fix the reproduced Host lifecycle and cached-import failures.

A safe successful route would need a public Host replacement seam that invalidates the complete affected ESM generation and settles provider release in the correct order, or an upstream/core correction. This experiment does not authorize or perform core patches, private loader cache invalidation, user WSL tasks, browser synchronization testing, process termination or forced unlocking.

The first official run used the package's default optional shell/preflight fact probes, which may invoke WSL during activation; no distro configuration was changed and no doctor task was intentionally run. Subsequent in-place and cold26 runs disable preflight startup probing in the **owned profile** and remove Windows system directories from only the child PATH, so absent `wsl.exe` fact probes fall back without starting user distros while actual WSL Host rows remain active. This limitation is not hidden behind a fake service.

## Reproduction

```powershell
$env:WSL_FULL_PROOF_MODE = 'official'
.\experiments\run-wsl-full-proof.ps1

$env:WSL_FULL_PROOF_MODE = 'inplace'
.\experiments\run-wsl-full-proof.ps1

$env:WSL_FULL_PROOF_MODE = 'cold26'
.\experiments\run-wsl-full-proof.ps1
```

The wrapper bounds each owned child to 240 seconds and never launches a browser. Result JSON contains full local fixture paths and belongs only in ignored/local evidence, never in a public release. All completed child processes were collected and unique temporary profiles cleaned; the initial cwd-held EBUSY residue was verified by its exact absolute path and removed after process exit.
