# EyesOnAgents Hook Delivery Review — Round 1

Status: accepted

Date: 2026-07-17

## Conclusion

**Pass for task 007.** The independent review found no remaining P0, P1, or P2 issue in the
lightweight helper, durable outbox, commit acknowledgement, persistent dedupe, teardown, removal,
or migration slice. Two packaging/platform defects found during review were fixed and covered by
regressions before acceptance.

This acceptance unblocks `eyes-on-agents-global-onboarding-008`; it is not acceptance of that
separate lifecycle/UI task or of the complete feature contract by itself.

## Findings resolved during review

1. **P1 — packaged helper discovery used the main chunk directory.** The first implementation
   derived `codexHookHelper.js` from the service module's `__dirname`. Electron Vite places that
   service in `out/main/chunks/` while emitting the helper at `out/main/codexHookHelper.js`, so a
   real Enable/Repair would have failed before copying the helper. The service now resolves from
   `app.getAppPath()/out/main`, which is the project root in development and the application root in
   a packaged build. A regression constructs the service from a modelled chunk layout without a
   helper-path test override and copies both the entry and its relative chunk closure.
2. **P2 — percent-bearing Windows paths were not recognized as owned hooks.** Win32 command
   serialization correctly escapes `%` as `%%`, but ownership and `hooks/list` matching initially
   searched that serialized command for the unescaped shim path. Such an installation was reported
   as drifted and could not be removed. Ownership now compares the exact platform command, and the
   regression covers install, trusted inspection, unrelated-hook preservation, and removal with a
   `%` in `userData`.

## Contract evidence

- The production build emits a dedicated `out/main/codexHookHelper.js` plus one bounded relative
  chunk. Its copied closure contains no `app.main`, `electron`, or `BrowserWindow` import. The stable
  userData shim invokes the copied entry with `ELECTRON_RUN_AS_NODE=1`; helper-only upgrades leave
  the exact `~/.codex/hooks.json` text unchanged.
- The helper creates one delivery UUID, sends a strict metadata-only envelope, and persists the same
  envelope after connection failure, timeout, or an unproven acknowledgement. Atomic temporary-file
  recovery, a 512-file pending bound, a 16 KiB file bound, a 32-file quarantine bound, corruption
  quarantine, overflow/storage coverage markers, and oldest-first replay are exercised.
- The listener parses and authenticates every replay through the current installation and trusted
  admission lifetime. It returns `committed` only after `applyRuntimeEventDelivery` resolves.
- The repository inserts the receipt and applies the runtime event in one SQLite transaction. A
  failed event rolls both back; a persisted receipt suppresses the same delivery after database
  restart, covering the commit-then-lost-ACK case.
- Disable and shutdown reject buffered acknowledgements, fence new intake, drain accepted writes,
  and then stop the listener. Removing the bridge deletes its shim/helper/outbox while preserving
  unrelated hook groups and settings.
- Fresh and retained older SQLite baselines converge on the receipt table with integer
  `observed_at` and `committed_at` fields.

## Verification

| Check | Result |
|---|---|
| `yarn test:eyes-on-agents` | pass: core, repository, App Server, bridge, delivery, Project, activation, and UI suites |
| `yarn typecheck:eyes-on-agents:core` | pass |
| `yarn typecheck:eyes-on-agents:ui` | pass |
| `yarn audit:sqlite-migrations` | pass: 11 Core + 7 Maestro retained/fresh baselines |
| `yarn build` | pass; dedicated helper and relative chunk emitted |
| compiled-helper offline smoke | pass: one pending delivery, prompt sentinel absent from disk |
| Electron Fuse inspection | `RunAsNode is Enabled` in the installed Electron 40 binary and existing packaged Bitterless app |
| `git diff --check` | pass |

No Electron GUI flow was used. A direct Mach-O execution probe was terminated after the workspace
sandbox timed out and is deliberately excluded from the acceptance evidence; the review relies on
the focused helper tests, compiled-artifact smoke test, production build, and explicit Fuse
inspection instead.
