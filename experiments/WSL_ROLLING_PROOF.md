# Rolling production pair preserves cached old resource paths

Latest retained historical ASAR DSH 0.2.2-rc.3 run, within one isolated process, uses `lib/generation.js` directly with its rolling options:

```js
next = generationArchive(original26, {
  legacyOriginal: original24,
  retainedOriginal: [original26],
})
rollback = generationArchive(original24, {
  legacyOriginal: original24,
  retainedOriginal: [original26],
})
```

Real complete base/web Host, no user profile or task:

1. Original 0.24.0 cold start: **14/14 active**.
2. Rolling generation 0.26.2 original-selection installation: **`application: applied` immediately, 15/15 active**. Unlike the previous nonrolling generation, this repeat needs no second reapplication.
3. Bare exact package-name no-op Host anchor remains active; real Host filesystem target resolution / process-path round trip works and subprocess service remains present.
4. Installed root `agent/wsl-agent.sh` bytes equal the verified original 0.24.0 archive; installed `g/<26-SHA>/agent/wsl-agent.sh` bytes equal the verified 0.26.2 archive. Both source versions happen to have the same script digest; the assertion checks equality with each expected version, not a false claim that this script differs.
5. Rolling rollback archive retaining the new generation installs immediately with **`applied`, 14/14 old declaration active**, same process.

Evidence: `wsl-full-inplace-0.26.2-generation-names-production-rolling-proof-result.json`.

This preserves root resource paths referenced by previously cached old modules, while current declaration imports the immutable generation paths. **It does not force existing nonblank Agent/preset contexts to join the new generation.** The public `agentPresets.recompose` contract explicitly targets blank Agents; this experiment does not bypass that by rebinding existing historical sessions. No real WSL/model task or existing-history Agent was run across the update, so retained-session continuity remains unverified.

No user profile, WSL setting, distro, task or Host kernel code was changed. Preflight probing is disabled only in the owned temporary profile, and child PATH prevents optional WSL fact calls from starting user distros. All temporary profiles and own child jobs were collected/cleaned. Raw evidence is ignored and must not enter public packaging.
