# Review: eyes-on-agents-focus-002 (round 3)

## Verdict

**blocking findings** — the focused suite, scoped type checks, and production build pass, but round
2 does not close the complete inspection window required by the integration contract. It also does
not contain the deterministic listener-start event regression required by round 1.

## Findings

### [P1] [blocking] A stale `installed` inspection can admit hook events before fresh trust is known

The contract requires hook trust to be established before thread enumeration and, when events can
arrive during inspection, requires current-listener-lifetime events to be held until that inspection
finishes (`docs/integrations/eyes-on-agents.md:83-92`). `performSync()` now awaits `hooks/list` before
`thread/list`, but it does not mark inspection as in flight or buffer hook events
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:243-256`).

This leaves an executable window after an auth suspend/resume or any later sync on the same process:
`shutdown()` stops the listener without clearing `CodexDesktopBridgeService`'s last successful hook
inspection, a restarted listener can therefore report `installed`, and `applyCodexHookEvent()`
immediately persists events while the new `hooks/list` request is still pending
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:124-129,225-233,377-418`). If the fresh inspection
then reports `needs_trust`, `drifted`, or `error`, active hook state is invalidated, but a prematurely
accepted `Stop` has already written durable completion/unread markers. The invalidation query only
clears active hook states, while completion updates `last_completed_turn_id` and
`last_completed_at` (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:218-235,373-398`). Such an event was
not proven trusted for the current inspection and must have been discarded.

The current "during sync" regressions inject `UserPromptSubmit` from inside `thread/list`, after
`updateHookInspection()` has already selected `installed` or `needs_trust`
(`scripts/eyes-on-agents/core.test.mjs:496-559`). They do not exercise an event received while
`hooks/list` itself is unresolved.

Required correction: introduce an inspection-in-flight boundary keyed to the current listener
lifetime. Buffer only events from that lifetime while inspection is pending, flush them in arrival
order only when the fresh result is `installed`, and discard them for every other result. Add a
deterministic regression that holds `hooks/list` open, injects both active and terminal events, and
proves trusted results consume them while non-installed results consume neither.

### [P1] [blocking] The listener-start regression asserts call order but never delivers an event

Round 1 required a deterministic `UserPromptSubmit` at the listener start boundary and proof that
the new-lifetime event survives. The replacement test only compares the index of
`invalidate-hook` with `listener-start`; its fake `bridgeListener.start()` changes status and
returns without invoking `applyCodexHookEvent()` (`scripts/eyes-on-agents/core.test.mjs:451-459,
533-547`). The concurrent service test similarly checks shared initialization and request order,
not event survival (`scripts/eyes-on-agents/app-server.test.mjs:388-417`).

The implementation order is directionally correct — old hook-active evidence is invalidated before
`bridgeListener.start()` (`src/main/eyesOnAgents/eyesOnAgents.service.ts:225-228`) — but the missing
event-bearing regression means a future late invalidation can reintroduce the original loss while
all checked-in tests remain green.

Required correction: make the fake listener become active and deliver `UserPromptSubmit` before
`start()` resolves, then assert that the corresponding `turn_started` write remains after the
observation transition completes. Exercise concurrent `connectAppServer()` / `syncThreads()`
through the same pending transition so no caller can run a post-start invalidation.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass | All five focused suites exit 0, but neither blocking window above is exercised. |
| `yarn typecheck:eyes-on-agents:core` | pass | Scoped main/shared/preload strict check exits 0. |
| `yarn typecheck:eyes-on-agents:ui` | pass | Scoped EyesOnAgents Vue strict check exits 0. |
| `yarn build` | pass | Main, preload, and renderer production bundles build successfully. |
| `git diff --check` | pass | Existing diff has no whitespace errors before this review artifact is added. |

## Conclusion

**blocked** — round 2's ordering change protects events received during `thread/list`, but not events
received during the preceding fresh trust inspection, and the listener-start boundary remains
untested with a real event. Re-review after both deterministic regressions and the current-lifetime
inspection buffer are implemented.
