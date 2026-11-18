# Real online-update experiment (isolated DSH 0.2.2-rc.3)

## Verified

`run-online-proof.ps1` launches the installed Electron executable with `ELECTRON_RUN_AS_NODE=1` and `--expose-internals`. It uses the real installed Cordis, Loader, AppBoot, RuntimeResolution, HMR and PluginManager. It creates a unique temporary DSH_HOME/profile and local tarballs for a fake plugin. No user desktop/WSL configuration is touched and no replacement GUI is launched.

Latest retained historical result: **one isolated process throughout**, `passed: true`. Raw results are local-only and are not shipped in public clones.

- Real v1 package installation and cold activation returns `real-code-1.0.0`.
- v1 starts a cooperative gated operation. The official `removeBundle` reaches its asynchronous disposer and waits; it does not finish while the operation is held. An unrelated service still returns `unrelated-alive`.
- The operation is released and returns `work-completed-1.0.0` without cancellation.
- Old `dispose-end` event (index 4) occurs before new v2 `start` (index 5).
- Real `installBundle(localTarball, expected)` returns `application: applied`; code actually returns `real-code-1.1.0`, not just a disk version observation.
- Deliberately bad v3 package installs (`pnpm exitCode: 0`) but activation returns `application: failed`, `stage: enable`, with full diagnostic `PROOF_BAD_ACTIVATION: fixture v3 deliberately fails`.
- Removing the failed candidate and installing staged v1 restores real code to `real-code-1.0.0` in that same process.
- All unique temporary fixture files are removed in `finally`; the JSON evidence remains in this experiments directory only.

Readiness is an explicit test seam; the actual package management, imports, plugin activation, asynchronous effect cleanup and HMR are not mocked. This proves ordinary cooperative plugins can be online replaced through staged local tarballs. It **does not prove every plugin is safe**, does not test a real model request, browser graph synchronization, arbitrary native modules, or the user’s actual WSL incident.

## Real WSL package comparison: important negative limitation

`run-wsl-online-proof.ps1` installed real WSL 0.24.0 and called real `updateBundle(..., 0.26.1)` in a second unique minimal profile. Both target and old-version package installs completed, and both activations returned the detailed error below:

```text
wsl-doctor-command (dsh-plugin-wsl-env/wsl-doctor-command):
Error: cannot get property "commands" without inject
fs-routing: pending (waiting for service: sandboxPolicy)
wsl-shell-env: pending (waiting for service: shellEnv)
auto-preset: pending (waiting for services: agents, agentPresets)
wsl-cwd-prompt-tool: pending (waiting for services: tools, workingDirectory)
preset-wsl: pending (waiting for service: agentPresets)
```

The minimal profile **already had those failures at cold start**. It lacks the user Desktop’s commands, agents, presets, sandbox and workspace services. Therefore this is **not a reproduction or root-cause identification of the user’s Desktop failure**. It establishes why metadata/install success alone cannot stand in for complete composition activation. Do not claim WSL is fixed by the ordinary-plugin proof.

## APIs and residual work

- Official `pluginManager.removeBundle` + `installBundle` owns profile/package mutation. Staging is done with owned test tarballs, not registry latest lookup.
- No patch of private HMR state, module-loader hooks, file handles or ACLs was used.
- Public real Agent `whenIdle`/`runMaintenance` is owned by AgentLoop. `run-agent-gate-proof.ps1` now uses the real public AgentRegistry, AgentLoop, Session, session projections, LLM runtime, native tool executor, tools and system prompt services, and imports the current production `lib/task-gate.js`. Within one isolated process, `passed: true`: an existing gated Agent maintenance job completed naturally; the updater waited; idle-agent maintenance claims excluded overlapping maintenance; a new `agents.create()` completed normally while the gate was active (creation is not blocked); its waking input reached the real `agent/pre-step` event and `beforeStep()` held it with zero `step/start` events; releasing the updater allowed that event to continue; and the existing agent remained usable afterward. **The test listener returns `reject` after release so no model call is made. The initial held activity is a real Agent maintenance operation, not a model request.** Earlier creation-blocking designs are superseded by this result, because they could deadlock a replacement's `apply()` that awaited agent creation.
- Shared-dependency real-directory migration is documented by installed RuntimeResolution/HMR as requiring restart, but the independent fixture for that specific limitation has not yet been run.

Result JSON files contain full local fixture paths from testing. They are local diagnostic evidence and must be sanitized or excluded before public packaging.
