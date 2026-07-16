# Review: eyes-on-agents-focus-002 (round 7)

## Verdict

**blocking** — round 6's buffered-flush failure now rejects the current admission state and skips
the tail already queued behind that flush. The same protection is not stable across a concurrent
fresh trusted Sync, however: retry mutates the rejected lifetime object back to `trusted`, allowing
an old live-event suffix to start after the retry. Round 7 also found a missing renderer refresh on
fail-closed invalidation; that notification correction landed after the finding and requires final
round verification.

## Blocking finding

### [P1] A fresh trusted Sync can revive suffix work from a failed live admission epoch

Every queued write closes over the mutable `HookListenerLifetime` object and checks that object's
state only when its FIFO turn begins. A write failure changes the object to `rejected`, sets the
bridge inspection error, and then awaits hook-status invalidation. A concurrent Sync reuses that
same object: `performRefreshBridgeInspection()` changes it from `rejected` to `pending`, and a
successful `hooks/list` eventually changes it to `trusted`
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:472-475,541-575`).

This creates the following deterministic trace outside the inspection-flush path:

1. Establish one trusted listener lifetime.
2. Admit live event F and hold its `repository.applyRuntimeEvent()` call. Admit live event S behind
   F in `hookWriteTail`.
3. Reject F. Its catch synchronously marks the lifetime `rejected` and the bridge `error`, then hold
   the catch inside `invalidateCodexHookStatuses()`.
4. Start Sync. Allow Sync's own invalidation to finish and let fresh `hooks/list` report installed.
   The same lifetime object becomes `pending`, `flushing`, then `trusted`.
5. Release F's old invalidation. F settles, so S's closure gets its FIFO turn. Its guard now sees
   the revived object as current and trusted and the bridge as installed, so S persists
   (`src/main/eyesOnAgents/eyesOnAgents.service.ts:798-824`).

F can be `UserPromptSubmit` and S can be `Stop`; the result is a durable completion/unread marker
whose start failed, even though S belonged to the poisoned pre-retry admission epoch. A fresh
`needs_trust` result remains safe because the bridge/lifetime stay non-admitting, but a normal
trusted recovery is unsafe.

The new failure regression does not exercise this race. It fails a buffered event during Connect,
waits for Connect and its queued tail to settle, then runs the non-installed and installed Syncs
sequentially (`scripts/eyes-on-agents/core.test.mjs:706-787`). At that point there is no old suffix
left that can be revived.

Required correction before acceptance:

- Give each fresh inspection retry an immutable admission epoch. Replacing a rejected lifetime
  object for the same `listeningSince`, or capturing and comparing a separate epoch token in every
  queued closure, are both sufficient; mutating the rejected object back to `pending` is not.
- Old FIFO work must remain poisoned regardless of how a later inspection resolves. A successful
  retry may admit only events received for its new epoch.
- Add a deterministic trusted-live regression using the five gates above. Cover both fresh
  `installed` and `needs_trust`: neither may persist S, while an event received after the installed
  retry must persist normally.
- Run the same case against teardown to retain the existing rule that no old write or notification
  crosses final invalidation or return.

## Round 6 blocker resolution

The direct round 6 trace is closed:

- Repository failure now rejects the lifetime before awaiting cleanup, changes the exposed bridge
  inspection to the bounded generic error, invalidates active hook evidence, and rethrows
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:812-824`).
- Every item already queued behind the failed write checks `rejected` immediately before
  persistence, so suffix events from the same uninterrupted flush skip rather than creating a
  partial terminal result (`src/main/eyesOnAgents/eyesOnAgents.service.ts:803-811`).
- The regression proves a failed buffered `Stop`, its flushing suffix, later rejected events, a
  `needs_trust` Sync, and sequential trusted recovery (`scripts/eyes-on-agents/core.test.mjs:706-787`).

This is a real improvement, but it does not create an immutable boundary between the poisoned tail
and a concurrent trusted retry, which is why the P1 above remains.

## Round 7 checkpoint finding corrected before final review

### [P2] Fail-closed state originally changed without refreshing the renderer

At the round 7 checkpoint, the write-failure catch set bridge state to `error` and changed persisted
hook-active state to unknown without broadcasting `eyes-on-agents/changed`. Live trusted hooks are
fire-and-forget, rejected lifetimes ignore subsequent hooks, and the renderer has no polling; it
could therefore retain an old working Focus card and installed bridge status indefinitely.

The current follow-up now broadcasts after successful invalidation only when the same observation
context is still active (`src/main/eyesOnAgents/eyesOnAgents.service.ts:815-820`). The added direct
write-failure regression requires event attempt, invalidation, then exactly one notification, and
proves later admission remains closed (`scripts/eyes-on-agents/core.test.mjs:789-835`). Round 8 must
re-run this together with teardown/abort coverage so an old failure cannot broadcast after final
invalidation.

## Teardown, trust, and privacy sweep

- App Server notifications, pre-connect invalidation, Sync writes, hook writes, and inspection
  work remain registered in the joined observation/runtime sets. No additional post-return write
  or notification path was found.
- Hook failure details remain bounded by `CodexDesktopBridgeService.setHookInspectionError()`; no
  prompt, response, tool payload, diff, hook command, or credential is added to SQLite or XPC.
- Listener replacement during pending/drain still requests fresh trust. The remaining P1 is an
  admission-epoch identity problem, not a missing `hooks/list` call.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass | All five focused suites exited 0 before the renderer-notification follow-up; no concurrent trusted-retry failure regression exists. |
| `yarn typecheck:eyes-on-agents:core` | pass | Scoped strict main/shared/preload check exited 0. |
| `yarn typecheck:eyes-on-agents:ui` | pass | Scoped strict EyesOnAgents Vue check exited 0. |
| `yarn build` | pass | Main, preload, and renderer production bundles built successfully before the notification follow-up. |
| `git diff --check` | pass | Current diff exited 0 before this review artifact was added. |

## Conclusion

**blocked** — failure now poisons the immediate flush tail and the renderer-notification gap has a
follow-up correction, but a concurrent fresh trusted Sync can still mutate the poisoned lifetime
back into an admitting state. Final review requires immutable admission epochs and the gated live
failure/retry regressions above.
