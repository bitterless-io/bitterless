---
id: onlypreview-recent-directory-006-2
status: pass
reviewed_task: onlypreview-recent-directory-006
target: 050f30e
base: 4df92d1
date: 2026-08-08
review_type: independent-static-source-review
---

# Verdict

**PASS by static source review.** The two Round 1 P2 findings are closed. Runtime acceptance remains
with Ral; this review did not run tests, build, Playwright, Electron, or the Bitterless application.

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Round 1 Closure

1. `openExplicitTarget()` now records the canonical directory synchronously and returns the created
   workspace without awaiting the optional SettingDao chain. `scheduleStorageFlush()` owns a
   handled background promise, so a deferred storage read cannot block workspace broadcast or
   window display and cannot create an unhandled rejection.
2. `clearTransientState()` advances the mutation generation and clears `pendingDirectory`, making
   pre-ready work stale during auth/quit teardown. Ordinary host revocation still clears only
   host-scoped maps, preserving the last successful directory long enough for normal delayed
   storage readiness.
3. The focused source tests model both boundaries: a permanently deferred storage read is separated
   from the already-settled open result, and revoke-plus-teardown before ready performs no storage
   operation. These tests were inspected but not executed in this review.

# Contract Review

- Stored state remains the exact versioned canonical directory record and contains no selected
  file, workspace ID, host capability, asset token, or renderer-provided absolute path.
- Reads and writes remain limited to `getStored`, `insertIfAbsent`, and `compareAndSet`; invalid
  history is cleared only against its observed serialized value.
- Shell/Preview restoration remains one flight per content host. Host liveness plus global and
  host generations fence late restore and explicit-target races.
- Main-owned OS targets still begin their explicit generation before `ensureStandalone()`, so
  mounting renderers cannot restore old history over an explicit request.
- The renderer API is unchanged and the service contains no path/value logging.

# Verification Boundary

This round used only static inspection of `4df92d1..050f30e` and the cumulative implementation.
No command that loads application code was run. No Electron, Playwright, E2E, build, or Keychain
path was invoked. Ral retains the manual restart and explicit-target acceptance step.

# Conclusion

**pass — owner verification pending**
