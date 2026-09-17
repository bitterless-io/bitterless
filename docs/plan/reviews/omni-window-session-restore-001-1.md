# Omni window session restore — Review 1

Date: 2026-09-16

Status: pass

Scope: [task](../tasks/omni-window-session-restore-001.md) and
[feature contract](../../features/omni-window-session-restore.md), reviewed against the current
worktree independently from implementation. No source files were edited by the reviewer.

## Findings

No open blocking or non-blocking findings remain.

### P2 — blocking, resolved: failed quit could discard renderer readiness

- Contract: feature “Contract” requires canceled/failed shutdown to preserve ordinary window
  behavior; “Storage and lifecycle ownership” makes the shutdown fence reversible.
- Code: `src/main/windows/omniWindow.helper.ts`, `isCreationActive`,
  `isRendererReadyFenceCurrent`, and `assertCreationActive`; renderer receipt is sent once in
  `src/renderer/omni/omniWindow/src/main.ts`.
- Initial behavior: the shutdown flag was included in the general creation-identity check. If
  first-show had occurred, then renderer load/mount completed during cleanup that subsequently
  failed, both readiness events were discarded. Resetting the shutdown flag did not replay them;
  the current open flight remained pending until timeout and would destroy the visible window.
- Independent Node probe using production readiness fences reproduced
  `accepted: false`, `loadPending: true`, `mountPending: true`, and a pending open flight after
  clearing the quit flag.
- Resolution: creation identity remains independent of shutdown. `assertCreationActive`,
  `create`, and `show` retain the shutdown guard at presentation boundaries. The same independent
  probe now accepts the receipt, settles readiness, finishes the flight, and retains the window.
  The committed-test candidate now includes the real-fence failed-quit regression.

### P2 — blocking, resolved before final review: internal destroy must permit reopening

- Contract: feature requires manual opening to remain available; internal destruction preserves
  intent rather than simulating an explicit user close.
- Code: `src/main/xpc/auth.handler.ts:235` also calls `omniWindowHelper.destroy()`. The proposed
  permanent shutdown flag in `destroy()` would have disabled Omni after logout.
- Resolution: only App cleanup owns the reversible shutdown flag. `destroy()` invalidates and
  tears down the current window without poisoning future opens. The internal-teardown regression
  verifies a later open and explicit close.

## Contract assessment

- First presentation synchronously flushes geometry and records open intent. Minimize/application
  hiding does not change intent. Explicit current-window closure records false; cleanup clears the
  current-window reference before destruction, preserving intent on failure and App teardown.
- Session storage is Main-owned, lazy, atomic, and separate from geometry. Fresh, malformed, and
  legacy geometry-only state default to closed; a close before Core readiness is respected.
- Core-ready restoration runs once after Home creation without awaiting Omni in the foreground
  startup lane. Concurrent manual/automatic opening uses the existing coordinator flight.
- Startup/layout continuations cannot present while App cleanup is active. Canceling the quit
  confirmation never enters cleanup; cleanup failure clears the flag. Failed auto-open preserves
  intent for a later launch and permits a manual retry.
- The actual shared geometry resolver is exercised for a secondary display, changed display
  origin, disconnected display, smaller work area, normal bounds, maximized mode, and fullscreen.
  The first shown bounds match the resolved bounds.

## Verification

- Independently ran
  `node --test --test-reporter=dot tests/omni/omniWindowSession.test.mjs tests/omni/omniOpenCoordinator.test.mjs`:
  **25/25 passed** after the final fixes (18 session tests and 7 coordinator tests).
- Independently ran `yarn test:startup`: passed.
- Independently reproduced the real-readiness failure, then reran the same in-memory Node probe
  against the fix: passed. The probe launched no Electron process and left no files behind.
- Task-scoped `git diff --check`: passed.
- Main typecheck remains affected by 65 existing diagnostics. The orchestrator compared the
  current result with a compiler-host overlay of pre-change HEAD sources and reported identical
  file/code/message sets, ignoring shifted line numbers. This is not a clean full-typecheck claim.
- Full build and combined regressions are being run by the implementation/orchestration lane;
  their final outcomes belong in the task result. This reviewer did not duplicate that build.
- No Electron launch, desktop interaction, or Electron E2E was run, as required. Physical monitor
  placement and native fullscreen timing were verified through Electron doubles, not a live OS.

## Conclusion

**Pass.** Both concrete lifecycle findings are resolved and regression-tested. No code-review
blocker remains; final delivery still records the separate build/regression outcomes and the
existing typecheck limitation.
