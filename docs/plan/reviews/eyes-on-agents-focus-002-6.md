# Review: eyes-on-agents-focus-002 (round 6)

## Verdict

**blocking** — round 5's App Server notification and pre-connect invalidation fences are closed,
and the required suites pass, but a rejected repository write during the trusted hook-buffer flush
leaves the listener lifetime fail-open. Later terminal events can persist after the failed Sync and
can cross the next fresh `hooks/list` boundary before trust is known.

## Blocking finding

### [P1] A rejected buffered write leaves hook admission in `flushing` and crosses fresh trust

`flushCodexHookEvents()` changes the lifetime to `flushing`, enqueues the detached bounded batch,
and awaits `Promise.allSettled()`. If any repository write rejects, it immediately throws the first
reason without rejecting the lifetime, clearing admission, or invalidating hook evidence
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:511-538`). The lifetime therefore remains
`flushing` indefinitely.

That state is still an admitting state. `applyCodexHookEvent()` sends every later event directly to
the FIFO tail while `flushing`, and `enqueueCodexHookWrite()` excludes only an explicitly
`rejected` lifetime. It does not exclude a pending fresh inspection
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:779-820`). A failed `UserPromptSubmit` can therefore
be followed by a successfully persisted `Stop`, creating an incorrect completion/unread marker and
the wrong Focus result even though the observation transition itself failed.

The failure also crosses the next trust boundary. A later Sync changes the same lifetime from
`flushing` to `pending` and starts a new `hooks/list`, but already queued tail closures can still
run against the bridge's previous `installed` status. They can persist while the new request is
unresolved, or before it ultimately reports `needs_trust`; the later active-status invalidation
cannot remove a durable completion marker. This contradicts the integration contract that a prior
`installed` result never authorizes events across a new inspection boundary
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:541-585,803-814`;
`docs/integrations/eyes-on-agents.md:79-83`).

An isolated deterministic harness reproduced the first half of this trace:

1. Hold `hooks/list` while injecting a buffered `Stop`.
2. Make the first `repository.applyRuntimeEvent()` reject with
   `simulated repository failure`.
3. Assert `connectAppServer()` rejects while bridge status remains `installed`.
4. Deliver a second `Stop`, then release one event-loop turn.

Observed result: `writeCount = 2` and the second turn ID was persisted after the failed flush. The
checked-in focused suite has no repository-rejection case, so all green tests currently miss this
path.

Required correction before acceptance:

- Put arrivals during `flushing` behind an explicit outcome barrier rather than allowing them to
  start as soon as the bounded snapshot's tail settles.
- On any snapshot write rejection, synchronously reject the lifetime before releasing that
  barrier, discard/skip all suffix events, set only a bounded generic inspection error, and
  invalidate partially applied hook-active evidence.
- Ensure a new Sync cannot set `pending` while any closure admitted by the prior inspection can
  still start a repository write. A non-installed retry must leave zero active or terminal writes
  from that old admission epoch.
- Add deterministic regressions for both the direct failure and crossover: gate the snapshot
  repository write, inject a suffix event during `flushing`, fail the snapshot, start a second Sync
  with `hooks/list` held, and prove no suffix/terminal event persists before or after a
  `needs_trust` result. Then prove a later installed inspection resumes with FIFO ordering and no
  recursive teardown deadlock.

## Round 5 blocker resolution

- App Server notifications capture the current observation context, register synchronously in the
  joined runtime-operation set before their first asynchronous repository boundary, and suppress
  the broadcast after abort (`src/main/eyesOnAgents/eyesOnAgents.service.ts:695-751`).
- The pre-connect App Server invalidation now runs inside the registered observation operation.
  Teardown disables intake and aborts the context before joining observation/runtime operations,
  then performs bridge removal and final hook invalidation
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:243-281,341-403`).
- Deterministic shutdown and explicit-disconnect cases gate both App Server notification writes and
  pre-connect invalidation. They prove final invalidation waits for accepted work, later intake is
  fenced, no old broadcast occurs after abort, and reconnect uses a fresh controller
  (`scripts/eyes-on-agents/core.test.mjs:1079-1346`).

No additional P1/P2 teardown race was found. Listener replacement during inspection and drain
still loops through a fresh `hooks/list`; shutdown, Disconnect, cleanup, stale Connect/Sync, and
preference-write work are joined before final invalidation and return.

## Non-blocking observation

`runObservationOperation()` deliberately waits for an existing teardown and then returns, so a
Connect invoked during that teardown is a successful no-op. This is surprising API behavior, but
the singleton renderer serializes every lifecycle action with one `busyAction`, and the checked-in
Sync-during-teardown regression explicitly treats overlap as fenced. It is recoverable by retry and
is not a P1/P2 blocker for the current product surface; reconsider last-intent-wins semantics if
multiple renderer/XPC clients are later supported.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass | Core, repository, App Server, bridge, and UI suites exited 0; no repository-rejection flush regression exists. |
| `yarn typecheck:eyes-on-agents:core` | pass | Scoped strict main/shared/preload check exited 0. |
| `yarn typecheck:eyes-on-agents:ui` | pass | Scoped strict EyesOnAgents Vue check exited 0. |
| `yarn build` | pass | Main, preload, and all renderer production bundles built successfully. |
| `git diff --check` | pass | Exited 0 before this review artifact was added. |

## Conclusion

**blocked** — the teardown lifetime fence now includes App Server notifications and pre-connect
invalidation, but hook-buffer persistence errors still leave admission fail-open. Re-review after a
failure barrier rejects the old epoch before suffix writes can start, including across a fresh
non-installed inspection.
