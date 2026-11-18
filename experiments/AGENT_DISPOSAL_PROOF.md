# Agent owner-disposal gate proof

## Result

The maintenance reservation now responds to its Agent's own cancellation signal as well as global gate release. Disposing one Agent settles **only that claim**; unrelated Agents remain reserved and `beforeStep()` remains closed until the update finishes.

The fix is in [TaskGate](<../lib/task-gate.js#L48-L78>). The callback captures its own gate generation, so it never follows a later `this.current` value. Local cancellation is expected settlement of this no-work reservation, not cancellation or failure of the whole update.

### Why respond to user cancellation too?

Agent `cancel()` may abort maintenance for `user`, `parent`, `hook`, or `disposed`. An AbortSignal retains its first reason: if a user cancellation occurs before later disposal, a callback waiting specifically for a new `disposed` reason would still deadlock. Any local abort therefore ends that Agent's claim without opening the global barrier. Default waiting and confirmation/activity-epoch cancellation scope are unchanged; the updater adds no automatic user cancellation.

## Real-runtime comparison

Final verified run: legacy control and fixed production gate used separate isolated processes. Both returned structured evidence with `passed: true`, verified owned package store and successful cleanup; fixed removal and installation returned `applied` with no warnings. Fixed mode loaded `1.1.0` without restarting that process and kept the unrelated Agent usable.

`run-agent-disposal-proof.ps1` launches **separate current installed Electron/ASAR processes**, each with its own temporary DSH_HOME/profile and generated local plugin. The actual installed AppBoot, Cordis, Loader, HMR, PluginManager, AgentRegistry, AgentLoop and Session implementations run; no mock manager is used.

The fixture bundle creates and owns a real idle Agent, plus the runner creates a second independent idle Agent. It declares both AgentRegistry and AgentLoop readiness dependencies.

- **Legacy claim control:** on the real owned Agent, recreate the old callback that ignores its maintenance signal. Actual `manager.removeBundle()` enters the bundle's disposer and causes `agent.cancel({kind:'disposed'})`; removal and owner disposal remain unfinished during a bounded 250 ms observation. Explicitly releasing this test-owned reservation lets the real removal complete. This is a controlled waiting-cycle observation, not a claim that a real user was force-stopped or that the operation timed out on its own.
- **Fixed production gate:** production `TaskGate.run()` wraps actual `manager.removeBundle()` and `manager.installBundle()`. The old owner Agent disposes and leaves its registry before gate completion. The independent Agent still rejects overlapping maintenance, and the global `beforeStep()` remains held. New fixture version `1.1.0` creates its replacement Agent without blocking `agent/created`, activates its Host row, and really returns `real-code-1.1.0`. After release the other Agent remains usable.
- Both modes contain **zero Agent driver/step/model request events**. Cancellation is only the fixture lifecycle's `disposed` cause; no user task exists.

Every package operation uses the official manager or profile operation API. Local fixtures install offline into pnpm 11 `storeDir` and `cacheDir` below the owned root, with `packageImportMethod: copy` in workspace YAML. Actual pnpm output and parsed virtual-store metadata verify that store identity. No user package-manager store is substituted as proof.

## Evidence and reproduction

```powershell
node --test tests/task-disposal.test.mjs tests/task-policy.test.mjs tests/task-policy-new-targets.test.mjs tests/task-activity.test.mjs
./experiments/run-agent-disposal-proof.ps1
```

- [Focused disposal cases](<../tests/task-disposal.test.mjs>): disposed, user-then-disposed, parent, hook, already-aborted signal, concurrent local/global release and later gate reuse. Against the old implementation, the first three new cases failed with `maintenance claim did not settle`; after the fix all 11 isolated TaskGate tests passed (the separate service-confirmation fixtures are owned by integration).
- [Real runtime runner](<agent-disposal-proof-runner.mjs>) and [PowerShell wrapper](<run-agent-disposal-proof.ps1>).
- Raw per-mode results are retained locally as `agent-disposal-proof-result.json`, recording process identity, exact manager outcomes, real code/Agent state, observed local disposal causes and cleanup. The JSON contains local fixture paths and is excluded from Git and package archives; it is not available in a public clone.

One initial experiment failed at cold activation because the fixture injected only `agents` before the factory initialization completed (`no agent factory registered`). The fixture now also injects `agentLoop`; that failure was a runner composition mistake before the update, not evidence of a gate or package-update failure. Its temporary roots were cleaned, and the final result supersedes it without relabeling the error.

## Ownership and limits

- Only the task gate and delegated task tests/experiment files changed; no commit, plugin installation into the live profile, DSH source edit, WSL operation or user task was performed.
- Cleanup first checks the exact absolute `mkdtemp` root, its real path, temporary parent and ordinary non-symlink directory identity, then removes only that root. All normal-run fixture resources close before deletion. Wrapper timeout terminates only its own test process tree and records unknown/missing evidence rather than claiming success.
- This experiment exercises `TaskGate.run()` with real package replacement, **not the production DoctorService.runBatch or panel ticket/HTTP flow**. Parent integration owns those separate tests.
- The global `beforeStep()` assertion is called directly; it does not launch a model task. Real new-Agent tool resolution and prompt assembly precede the pre-step hook. The gate is not advertised as a freeze of every callback, worker, terminal, creation activity or all execution.
- No replacement GUI, HTTP listener, model provider or network model request is created. This does not establish browser synchronization or all plugin lifecycle safety.
