# Review: eyes-on-agents-focus-002 (round 9)

## Verdict

**accepted** — the round 8 terminal-loss race is closed. The current lifecycle establishes a
bounded pending boundary before draining the preceding admission tail, preserves FIFO ordering
through fresh trust inspection, and retains the fail-closed repository, listener replacement, and
teardown guarantees from rounds 3–7. No P1 or P2 finding remains in the reviewed Focus lifecycle.

## Round 8 blocker resolution

### Pending now precedes the old-tail drain — resolved

- `performRefreshBridgeInspection()` captures the current admission epoch and changes the current
  listener lifetime to `pending` before it reads and awaits `context.hookWriteTail`
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:548-560`). Events received after that synchronous
  boundary use the bounded pending queue instead of joining the old trusted tail
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:803-811`).
- After the old tail settles, the refresh verifies that the listener, epoch, and pending state are
  unchanged before advancing the immutable admission epoch and calling `hooks/list`
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:562-579`). A trusted result drains the buffered
  batch through the same FIFO write tail; non-installed, overflowed, cancelled, or replaced
  transitions reject or discard it (`src/main/eyesOnAgents/eyesOnAgents.service.ts:595-619`).
- The new deterministic regression holds a successful `UserPromptSubmit` repository write, starts
  Sync, delivers the matching `Stop`, proves `hooks/list` and the terminal write both remain
  blocked, then proves the trusted inspection persists `turn_started` followed by
  `turn_completed` (`scripts/eyes-on-agents/core.test.mjs:1009-1060`). This directly exercises the
  round 8 P/Q trace.

## Full lifecycle review

### Listener replacement and fresh trust

- A listener lifetime is keyed by `listeningSince`; a replacement clears the old pending queue and
  creates a fresh uninspected lifetime (`src/main/eyesOnAgents/eyesOnAgents.service.ts:437-471`).
- Replacement detected while draining or awaiting `hooks/list` rejects the old lifetime and loops
  into a fresh inspection for the current listener. Replacement after a buffered flush triggers
  invalidation before the fresh loop (`src/main/eyesOnAgents/eyesOnAgents.service.ts:551-619`).
- Pending-, inspection-, and drain-time replacement regressions require a second `hooks/list`,
  admit only replacement-lifetime events after fresh trust, and discard a replacement terminal
  event when the new result is `needs_trust`
  (`scripts/eyes-on-agents/core.test.mjs:1062-1175`).

### Bounded pending queue and FIFO flushing

- The pre-trust queue is bounded at 256 metadata-only events. Overflow clears the full batch and
  prevents further buffering until a fresh inspection attempt
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:480-490`). Overflow becomes the bounded bridge
  error, rejects the epoch, and invalidates hook-active evidence before Sync proceeds
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:595-601`).
- Trusted buffered events are detached as one ordered batch and appended to the per-observation
  FIFO tail. Arrivals during `flushing` append behind that batch with the same immutable epoch;
  they cannot overtake the inspected prefix (`src/main/eyesOnAgents/eyesOnAgents.service.ts:514-545,
  813-869`).
- Regressions cover trusted pending active/terminal events, untrusted and inspection-error discard,
  pending overflow/recovery, and a 257-event suffix received during trusted drain without ordering
  loss (`scripts/eyes-on-agents/core.test.mjs:634-709,921-1007`).

### Repository failure remains fail closed

- Every queued closure captures `admissionEpoch` by value and rechecks it immediately before the
  repository write (`src/main/eyesOnAgents/eyesOnAgents.service.ts:832-847`). The first repository
  failure increments the lifetime epoch and rejects admission before awaiting cleanup, so already
  queued suffix work cannot be revived by either an `installed` or `needs_trust` retry
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:848-860`).
- The exposed error remains the generic bounded hook-inspection message; the underlying repository
  error is not copied into the bridge snapshot
  (`src/main/eyesOnAgents/codexDesktopBridge.service.ts:61-70,320-327`). Successful fail-closed
  invalidation broadcasts once while the same observation context remains active, so a stale
  working Focus card is refreshed without allowing an aborted observation to notify later.
- Failure regressions cover buffered failure plus flushing suffix, direct live failure and renderer
  refresh, immutable old-suffix rejection across concurrent trusted/untrusted retry, and fresh
  post-recovery admission (`scripts/eyes-on-agents/core.test.mjs:711-919`).

### Teardown, notifications, pre-connect work, and preferences

- Shutdown, explicit Disconnect, and cleanup synchronously disable intake, advance lifecycle
  intent, abort the current observation, and clear the in-memory lifetime before teardown work can
  proceed (`src/main/eyesOnAgents/eyesOnAgents.service.ts:406-428`). Teardown joins observation,
  runtime, setup, and inspection work before bridge removal and final hook invalidation
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:342-403`).
- App Server notifications capture the current observation context and are registered in joined
  runtime work. They may finish an already accepted repository write before final invalidation,
  but cannot accept later intake or broadcast after abort
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:729-785`). The pre-connect App Server status
  invalidation is inside the registered Connect/Sync observation operation, and a late App Server
  connect is followed by the teardown's second disconnect
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:244-282,364-371`).
- Connect's `true` preference write is joined before an overlapping Disconnect writes the final
  `false`; lifecycle intent prevents the older Connect from entering Sync afterward
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:208-220,376-381`). Deterministic regressions cover
  pending inspection, shifted buffer drain, App Server notifications, pre-connect invalidation,
  held connect, late thread listing, preference overlap, teardown upgrade, cleanup, and reconnect
  with a fresh controller (`scripts/eyes-on-agents/core.test.mjs:1177-1800`).

## Privacy and product-boundary sweep

- No prompt, response, tool payload, diff, hook command, approval content, or credential was added
  to persistence or XPC. Hook persistence still derives only thread/session ID, turn ID, working
  directory, allowlisted lifecycle event name, and timestamp
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:872-901`).
- The managed App Server remains separate from Codex Desktop's private stdio process. The reviewed
  change affects lifecycle evidence admission only and does not add transcript access, steering,
  queueing, or arbitrary RPC surfaces.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass | Core, repository, App Server, bridge, and UI suites exited 0, including the round 8 slow-write/Sync terminal regression. |
| `yarn typecheck:eyes-on-agents:core` | pass | Scoped strict main/shared/preload check exited 0. |
| `yarn typecheck:eyes-on-agents:ui` | pass | Scoped EyesOnAgents Vue check exited 0. |
| `yarn build` | pass | Main, preload, and renderer production bundles built successfully. |
| `git diff --check` | pass | Current working diff, including both review artifacts, has no whitespace errors. |

## Conclusion

**pass / accepted** — fresh inspection now closes admission before draining old trusted work, so a
matching terminal event received during a normal slow write is buffered and preserved. Immutable
epochs prevent failed suffix revival, listener replacement always proves fresh trust, all rejected
paths remain fail closed and renderer-visible, and teardown joins every accepted lifecycle write
before final invalidation and return.
