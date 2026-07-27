# EyesOnAgents Open Does Not Resolve An Unknown Task

Status: implemented; owner verification pending

## Symptom

A Focus card shows `unknown` with no working spinner. The user clicks `Open`, lands in the live
Codex session, sees that it is plainly still running, comes back to Bitterless — and the card still
says `unknown`. Nothing about the explicit Open acted on the one thread the user just proved they
care about.

## Root cause

Two different rows render as `unknown`, and neither is repaired by Open.

**(a) Persisted unknown.** A Hook listener lifetime boundary rewrites the row to
`discovery + unknown` with no active turn. This is a missed-working recovery candidate, and
[eyes-on-agents-working-recovery-gap](eyes-on-agents-working-recovery-gap.md) already defined the
repair — but the repair only runs from the tiered ten-second poll's page selection. Open performs a
deep link and `markOpened` and nothing else, so an explicit user action is strictly weaker than
waiting for a poll tick.

**(b) Displayed unknown.** The row is persisted as `codex_hook` + an active runtime state with a
real active turn, but the Hook bridge is not currently listening, so
`effectiveEyesOnAgentsRuntimeState` degrades it to `unknown`. Correct by itself — stale Hook
evidence must not survive a listener gap. But the managed App Server may still be connected and can
still answer, content-free, whether that exact turn is in progress. The current contract discards
that answer: for an already-active row `inProgress` is explicitly a no-op, a rule written when Hook
authority was assumed present and App Server confirmation therefore added nothing.

The result is a control that looks broken in both cases, and looks broken *differently* in each,
which is worse than a control that never helps.

## Resolution contract

- A successful `Open` runs one status sync for that single thread, using the same content-free
  `thread/turns/list(itemsView: notLoaded, sortDirection: desc, limit: 1)` request and the same
  candidate classification as the tiered poll. It is an on-demand trigger of existing evidence, not
  a new authority.
- The sync is best effort and never fails the Open. A disconnected App Server, a rejected request,
  a malformed response, or a lost race leaves the successful deep link and its Open evidence intact.
- A thread that is neither an active candidate nor a recovery candidate issues no request at all.
- **(a)** is covered by running the existing missed-working recovery for that one thread.
- **(b)** relaxes the `inProgress` no-op rule by exactly one case: when a persisted-active row's
  current authority is absent — that is, when the shared projection already degrades it to
  `unknown` — and the App Server reports the same exact active turn ID as `inProgress` with a
  persisted start time no later than the poll, Bitterless may reclaim that row under the
  `app_server_turn` source. `inProgress` remains a no-op whenever the row's authority is present.
- A reclaim changes the source, the status watermark, and the activity floor only. It preserves
  `runtime_state` and `active_flags_json`, so a task that was last observed `waiting_approval` is
  not silently downgraded to `working` and lost from the top of the Focus order. App Server proves
  the turn is still running; it does not claim to know the sub-state, and the previously observed
  wait is the best available detail until newer Hook evidence replaces it.
- The reclaim is a compare-and-set against the exact prior row: expected `codex_hook` source, an
  active runtime state, the exact active turn ID, the exact status watermark, and a turn not
  already recorded as completed. Any concurrent change makes it a no-op.
- A reclaimed row behaves exactly like a recovered one: it survives full inventory discovery and
  App Server reconnect invalidation, it is an ordinary exact-ID terminal reconciliation candidate,
  it renders active only while the managed reader is connected, and real Hook evidence supersedes
  it through the normal watermark rule.
- Because the projection is shared, the ten-second poll gains the same reclaim. Open is the
  immediate trigger; the poll is the passive one. Neither introduces a new interval, a new request
  per task, elapsed-time inference, transcript reading, or a `paused` state.

Delivery: [eyes-on-agents-open-status-sync-029](../plan/tasks/eyes-on-agents-open-status-sync-029.md)
