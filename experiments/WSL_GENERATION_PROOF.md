
## Version-generation packaging follow-up: observed working Host path for 0.26.2

`WSL_FULL_TARGET=0.26.2` also fails the original in-place tarball path: stale `wsl.js` export `execProgramFailure`, plus stale `doctor-live.js` export `mergeAutoPresetSeam`. Same-selection reapplication, individual failed-row off/on and byte-identical copy-on-write do not repair it.

The experiment-only `generation-tar.mjs` then repacks the verified original package:

- Copies its complete tree into `g/<original-SHA256-prefix>/` so relative imports and resource paths remain self-contained.
- Adds generation-specific runtime export aliases and changes **only the package's own literal `name:` module references** in its contributed patch to those aliases.
- Preserves row IDs, core overrides/disabled state, foreign core references, package name/version and peer declarations.
- Keeps all original JS and asset bytes equal, and every generation copy equal to its corresponding original; only package manifest and the runtime-module-name references in the contributed patch change.
- Never patches the Host or its private module caches.

Recorded final repeat, within one isolated process:

1. Original 0.24.0 cold baseline: **14/14 active**.
2. Generation-repacked 0.26.2 direct installation, without removing bundle selection: reports `restart-required: unmanaged-plugin`, **but all 15 WSL rows are actually active at the new generation module paths**.
3. One public `setBundleEnabled(name, true)` reapplication, without off/on: **`application: applied`, all 15 rows active**, same process, no restart.
4. Direct installation of the original verified 0.24.0 archive initially reports `restart-required`; one public same-selection reapplication returns **`applied`, 14/14 original rows active**, same process.

The same update path also passed an earlier independent repeat; numeric process identifiers are not included in the public summary.

This is a meaningful successful **Host activation** path, not a blanket claim that all plugins or active WSL tasks support it. The browser roster normally anchors an exact package-name row; changing the bare-name runtime row to an alias may omit client delivery until a separate unchanged anchor is provided and verified. No browser synchronization or real distro/model task was tested. The first `restart-required` result must not itself be mislabeled online success; the observed public reapplication and all-row verification are required.

Latest retained reproduction: `wsl-full-inplace-0.26.2-generation-names-proof-result.json`. The runner additionally reapplies the restored original 0.24.0 so its whole old Host generation is verified, rather than trusting its initial `restart-required` result.
