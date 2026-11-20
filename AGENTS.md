# Plugin update doctor development

Independent DSH bundle. Current self-update handoff targets installed DSH 0.2.2-rc.5 APIs; historical ordinary/WSL proofs used 0.2.2-rc.3. Read installed dsh-doc before changing integration APIs.

- Host operations reuse pluginManager; never hand-edit user profile/package/patch files.
- User confirms mutations through the authenticated same-origin panel; agent tools expose only diagnostics and plans without confirmation tickets.
- Exact installed package/version only; no arbitrary command/spec/path input. Ordinary batches refuse self; self-updates require a separate authenticated confirmation and independent Host handoff. Refuse shipped management packages, unsupported sources, incompatible targets and automatic script approvals/exemptions.
- Native helper only probes metadata/shared-file usage and Restart Manager lists. Never RmShutdown/RmRestart, kill a user process, force unlock, elevate, change ACL or modify target files.
- Only terminate a helper created by the current diagnostic call on cancellation/deadline; track its own PID and await exit.
- Capture current disk state independently from historical outcomes. Interrupted jobs become unknown, never success.
- Persist only plugin-owned bounded sanitized history, not session events or user configuration; file logging failure must not turn actual outcomes into success.
- Client uses Host theme tokens and standard slots, not DOM injection, duplicate browser app or client primitive imports.
- Test only owned temporary fixtures. Review diffs and run regressions before installing; report browser verification limits truthfully.
