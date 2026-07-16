# Review: eyes-on-agents-focus-002 (round 4)

## Verdict

**accepted** — both round 3 blockers are closed. The current-lifetime admission boundary, bounded
FIFO buffering, rejection paths, overflow handling, and listener-start concurrency regressions are
consistent with the Focus contract. No new P1 or P2 finding was found.

## Round 3 blocker resolution

### Fresh inspection no longer inherits stale `installed` admission — resolved

- Every listener lifetime now owns an explicit inspection state:
  `uninspected -> pending -> flushing -> trusted`, or `rejected`. Hook events received while the
  state is uninspected, pending, or flushing are buffered rather than persisted
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:43-59,276-328,535-553`).
- Every `performSync()` enters `refreshBridgeInspection()` before `thread/list`. The refresh is
  single-flight, sets the current lifetime to `pending` before awaiting `hooks/list`, and therefore
  cannot use a previous successful in-memory inspection to admit events while fresh trust is
  unresolved (`src/main/eyesOnAgents/eyesOnAgents.service.ts:355-419`).
- An exact fresh `installed` result drains the queue in receive order. Events arriving while an
  earlier buffered event is being persisted remain in the same queue and are drained afterward;
  the state changes to `trusted` only after the queue is empty
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:330-353`).
- `needs_trust`, `drifted`, `error`, or a replaced listener lifetime clears the old queue without
  applying active or terminal events. If the lifetime changes while `hooks/list` is pending, the
  old inspection is rejected and the loop performs a fresh inspection for the replacement
  lifetime (`src/main/eyesOnAgents/eyesOnAgents.service.ts:355-397`).

The deterministic regressions hold `hooks/list` open and inject both `UserPromptSubmit` and `Stop`.
The trusted case proves FIFO consumption, including an event received during draining; the
untrusted and inspection-error cases prove zero durable runtime writes; the lifetime-switch case
proves only the replacement-lifetime event survives
(`scripts/eyes-on-agents/core.test.mjs:600-674,770-795`).

### Listener-start event and concurrent Connect/Sync coverage — resolved

- A stopped listener lifetime is reset and old active hook evidence is invalidated before
  `bridgeListener.start()` can receive an event. Desktop observation setup remains single-flight
  across concurrent public callers (`src/main/eyesOnAgents/eyesOnAgents.service.ts:236-265`).
- The start-boundary regression now delivers a real `UserPromptSubmit` from inside the fake
  listener's `start()` before it resolves. Concurrent `connectAppServer()` and `syncThreads()` must
  share one listener transition and one pending `hooks/list`; the event remains buffered until
  trust resolves, then persists after every old-lifetime invalidation
  (`scripts/eyes-on-agents/core.test.mjs:520-586`).
- The App Server concurrency regression independently requires one shared hook-trust inspection
  for concurrent service requests (`scripts/eyes-on-agents/app-server.test.mjs:388-437`).

## Overflow and fail-closed review

- The pending queue is bounded at 256 metadata-only events. Event 257 marks the lifetime
  overflowed and clears the entire pending batch; later events are ignored until a future Sync
  establishes a fresh inspection boundary (`src/main/eyesOnAgents/eyesOnAgents.service.ts:45,
  317-328,355-383`).
- Overflow detected either while `hooks/list` is pending or while the queue is flushing sets the
  bridge to the existing bounded generic inspection error, rejects the lifetime, and invalidates
  partially applied active hook evidence. The bridge service deliberately does not expose the
  underlying error value (`src/main/eyesOnAgents/eyesOnAgents.service.ts:330-395`;
  `src/main/eyesOnAgents/codexDesktopBridge.service.ts:61-69,320-327`).
- Regressions cover pending overflow, refusal of subsequent events before retry, successful fresh
  admission after Sync, flushing overflow, and active invalidation after a partial flush
  (`scripts/eyes-on-agents/core.test.mjs:676-768`).

## Security and persistence sweep

- Buffered values remain the allowlisted metadata-only `CodexHookEvent` envelope; no prompt,
  response, tool payload, diff, hook command, or credential is added to SQLite or XPC.
- Runtime writes still pass through the existing repository event parser and timestamp ordering.
  Rejected pending `Stop` events never create completion/unread markers.
- Explicit disconnect, auth shutdown, and bridge cleanup reset in-memory lifetime queues before and
  after listener stop, and explicit disconnect continues to invalidate active hook evidence.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass | Core, repository, App Server, bridge, and UI suites exited 0, including pending/flushing overflow, lifetime change, start-boundary, and concurrent inspection regressions. |
| `yarn typecheck:eyes-on-agents:core` | pass | Scoped main/shared/preload strict check exited 0. |
| `yarn typecheck:eyes-on-agents:ui` | pass | Scoped EyesOnAgents Vue strict check exited 0. |
| `yarn build` | pass | Current main, preload, and renderer sources built successfully; the updated EyesOnAgents main chunk and standalone renderer were emitted. |
| `git diff --check` | pass | Exited 0 before this review artifact was added. |

## Conclusion

**pass / accepted** — a fresh `hooks/list` now gates every listener lifetime and every Sync; only a
fresh installed result releases current-lifetime events in order. All rejected, errored, replaced,
or overflowed paths discard pending evidence and fail closed, and the original start-boundary race
now has an event-bearing concurrent regression.
