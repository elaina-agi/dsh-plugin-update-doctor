# Production generation follow-up

The final repeat imports **`../lib/generation.js`** directly; it does not reuse the independent experiment-only transform. Evidence: `wsl-full-inplace-0.26.2-generation-names-production-proof-result.json`.

Same isolated ASAR DSH 0.2.2-rc.3 process, without restarting:

- Complete official base/web Host layers plus real original WSL 0.24.0: **14/14 WSL rows active** before update.
- The production transform preserves the bare `dsh-plugin-wsl-env` no-op Host anchor; runtime subpaths use generation aliases.
- Direct installation of production-generation 0.26.2 archive without removing selection initially reports `restart-required: unmanaged-plugin`, followed by one public same-selection reapplication reporting **`applied`**.
- **15/15 WSL rows active**, actual bare anchor still exact package name and active.
- Real Host filesystem target round trip succeeds: `target = await fs.resolve(ownedRoot); fs.processPath(target)` returns the owned temporary root; actual `subprocess` service is present. No WSL command or external process is spawned for this smoke.
- Direct original 0.24.0 restore initially reports restart-required; public reapplication reports **`applied`, 14/14 active** in the same PID.
- Temporary profiles cleaned after actual root disposal; no user desktop/profile/package/kernel file was modified.

The first smoke failed only because the experiment called `fs.processPath()` without the required resolved target argument. The API call was corrected; the successful final result above supersedes that test error.

**Limits:** no browser/module-roster runtime test was performed because this isolation intentionally disables Web listener and module delivery. Preserving the exact bare package anchor addresses the documented roster prerequisite, but is not itself proof of browser synchronization. No real Agent/model/WSL task continuity was tested, no distro was started in this repeat, and no blanket compatibility claim for arbitrary plugins is made.
