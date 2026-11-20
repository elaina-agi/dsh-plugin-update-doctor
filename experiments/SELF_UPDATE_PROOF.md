# Isolated production self-update experiment

## Verified result (2026-11-20)

Final repeat used production source **v0.4.0** with the current installed **DSH 0.2.2-rc.5 / Electron 44.7.0 / Node 24.21.0**. Both modes passed in separate isolated processes and cleaned their owned roots. The runner records the complete source file SHA256 map, including the original manifest and client artifact, before overriding only fixture version/dependency declarations and the test entry hook. Runtime hashes are compared with the frozen workspace at the end of the run; later verification-document edits do not require rerunning package lifecycle evidence.

| Mode | Actual outcome | Independent current-state check |
| --- | --- | --- |
| `update-good` | Official Host update installed `0.3.1`, returned `applied`; actual new production instance and marker ran in the same process | Exact package-byte verification passed, Host 1/1 active, `verifiedApplied: true`; new coordinator read the old generation's final receipt |
| `bad-rollback` | Deliberately bad `0.3.2` package installed with exit 0 but activation failed; actual official automatic restoration returned `applied` for `0.3.0` | Target result remains failed and `verifiedApplied: false`; restored byte verification passed, restored Host 1/1 active and original code marker callable |

Old coordinator and Doctor disposers completed in approximately 0 ms during handoff; the gate was released and the manager's public Loader fiber identity did not change. There was no five-second self-update/disposal waiting cycle. YAML remained exactly `2.9.1`, its public original archive integrity was verified, and parsed pnpm store metadata confirmed the owned store.

The good-mode same-version tamper control also passed: modifying one owned installed runtime file preserved the historical `applied` outcome but changed independent package verification to `failed` and `verifiedApplied` to false. Fixture bytes were restored before cleanup.

The raw per-mode results remain local-only and are not public attachments. These are generated fixture versions, not evidence of npm publication or real-user update clicks.

Earlier runner iterations were not called successful: one initially bound the transport wrapper to a root manager and its update was refused before new activation; the corrected wrapper preserves `this`. Another compared Cordis trace proxies using strict object identity, which attempted unauthorized `href` access; identity now uses the public Loader fiber UID. A later tamper assertion expected `unknown` instead of the implementation's explicit byte-check `failed`. Those were fixture/assertion defects; final runs use the corrected runner without replacing actual package outcomes.

## Scope

The experiment creates two fresh installed Electron/ASAR processes, each with its own temporary DSH home/profile, pnpm store/cache, and loopback fixture registry:

- `update-good`: generated updater `0.3.0 → 0.3.1`.
- `bad-rollback`: generated updater `0.3.0 → 0.3.2`, where target activation deliberately throws; the actual official manager must attempt its own old-version restoration.

Fixture archives copy the current production updater files. Only fixture entry code gets a test hook/code marker, and bad mode gets an explicit intentional throw. Production `DoctorService`, `SelfUpdateCoordinator`, `SelfUpdatePreflight`, `SelfUpdateStore`, `TaskGate` and disposer ordering run from the installed package, not as manually constructed workspace instances.

The Host composition uses real installed AppBoot, Cordis, Loader, HMR and PluginManager, with full base/web Host layers. Browser opening, Web listener/module delivery, models and telemetry are disabled. There are no user or model tasks, and no live profile or WSL package is copied or touched.

## Disclosed test seams

- Generated updater bytes are fixture inputs, **not published npm versions**. Preflight's logical public npm URLs are served by an injected fetch adapter. Version/registry queries declare that fixture origin.
- The public `updateBundle` boundary changes only registry transport to the owned loopback registry. It must preserve the actual receiver (`this`) of the production updater's captured service; it must not bind execution to a substituted root manager or unwrap private trace symbols.
- Package commands, Loader/HMR lifecycle, results and automatic rollback use the actual official implementation and cannot be forced successful.
- YAML `2.9.1` is fetched from public npm with SHA512 integrity verification, then supplied by the fixture registry. Resolved YAML and actual owned store metadata are checked.
- The production HTTP handler receives an in-memory panel-shaped request. This is not evidence of real Connection authentication or a browser click.
- Readiness callbacks and test markers are fixtures. Served Client resources and React/DOM rendering are not tested here.

## Assertions

The runner requires exact installed versions, actual callable old/new code markers, enabled and active Host rows, stable independent manager identity, old disposer completion without a five-second update/disposal cycle, old TaskGate release, and final results read by the new/restored production coordinator.

The runner also changes one owned installed runtime file without changing its package version, verifies that the recorded `applied` outcome remains intact while independent package verification becomes `failed` and `verifiedApplied` becomes false, then restores those fixture bytes. This is a verification-only tamper control, not another plugin installation or a real-user file change.

Failure mode must preserve the intentional target activation failure separately from official restoration; a restored old version must not be mislabeled target success. No `waitForInstall(null)` or disk version alone is treated as a successful update.

## Run

From the source workspace in a PowerShell session carrying the installed DSH runtime environment:

```powershell
.\experiments\run-self-update-proof.ps1
```

The wrapper bounds each owned child to 240 seconds and only terminates its own test process tree on deadline. The runner checks the exact temporary absolute path, realpath, parent and ordinary non-symlink directory identity before cleanup. Raw `self-update-proof-result.json` is local-only and ignored by Git/package policy.

## Limits

The successful experiment demonstrates package/Host handoff, not full self-update-time task freezing, actual active-task cancellation, browser continuity, arbitrary dependency migration, future DSH versions, or npm publication. Old/new downloaded archives are preflight evidence; official replacement still uses registry specs and its own rollback semantics rather than Doctor's exact-archive batch recovery.
