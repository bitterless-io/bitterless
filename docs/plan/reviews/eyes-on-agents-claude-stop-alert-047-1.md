# EyesOnAgents Claude Stop Alert — Independent Acceptance

Status: accepted for non-Electron scope; owner audible E2E pending

Date: 2026-08-18

## Verdict

**Implementation: PASS, with no open P1, P2, or P3 finding.** Every admitted Claude `Stop` now
uses its validated Hook delivery UUID as a concrete completion identity, so a response boundary can
emit the existing notification and sound without a preceding `UserPromptSubmit`. Duplicate delivery
replay remains silent, while each distinct admitted `Stop` may alert once.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

## Behavior and exclusion matrix

| Case | Verified behavior | Result |
|---|---|---|
| Standalone `Stop` | Maps to `turn_completed/completed` with `turnId = deliveryId`; emits one completion intent without an active persisted turn | PASS |
| Duplicate delivery UUID | Hook delivery receipt returns duplicate and no second completion intent is dispatched | PASS |
| Distinct `Stop` UUID | Persists a distinct completion identity and may emit one additional alert | PASS |
| `StopFailure` | Maps to failed completion with no concrete turn identity and no completion alert | PASS |
| Enable cutoff | Event at or before the cutoff returns duplicate before inventory/runtime persistence and emits no side effect | PASS |
| Disabled/current-generation fence | Intake rejects disabled delivery; a disable racing an admitted commit suppresses late Claude side effects | PASS |
| Stale runtime event | Newer persisted runtime evidence prevents the older event from claiming an alert | PASS |
| Archived thread | Completion claim requires `is_archived = 0`; archived rows cannot produce an intent | PASS |
| Codex isolation | Provider is derived from `claude_hook`; Claude availability gates only Claude alerts and leaves Codex lifecycle/polling intact | PASS |
| Commit-before-side-effect | Hook receipt, runtime transition, and completion receipt commit in one SQLite transaction; Main dispatches only after the DAO promise resolves | PASS |

## Static evidence

- `eyesOnAgents.service.ts:2850-2884` parses the complete delivery before admission and gives only
  `Stop` the validated `deliveryId`; `StopFailure` retains `turnId: null` and a failed outcome.
- `eyesOnAgents.service.ts:2915-2927` rechecks the Claude runtime generation, awaits
  `applyRuntimeEventDelivery`, then dispatches the returned completion intent. The completion
  side effect therefore cannot precede persistence.
- `eyesOnAgents.dao.ts:1505-1556` inserts the delivery receipt and applies the runtime event inside
  one `better-sqlite3` transaction. A duplicate receipt returns without reapplying the event.
- `eyesOnAgents.dao.ts:536-573,674-719` claims `(session_key, turn_id)` only after the row is idle,
  unread, unarchived, and stores the same completed turn. `ON CONFLICT` provides durable once-only
  behavior, including after restart.
- The session key and runtime provider are provider-qualified, so a Claude UUID cannot share a
  completion receipt with a Codex task.

## Independent verification

| Check | Result |
|---|---|
| `node --test scripts/eyes-on-agents/claude-provider-isolation.test.mjs` | PASS — 5/5, including standalone Stop, duplicate, distinct Stop, StopFailure, disable race, and Codex continuity |
| `yarn test:eyes-on-agents:claude` | PASS — every Claude stage passed; combined provider suite 23/23 |
| `yarn test:eyes-on-agents:repository` | PASS — real SQLite delivery/completion receipts, rollback, archive exclusion, restart dedupe, and provider qualification |
| `yarn test:eyes-on-agents:core` | PASS — Main completion dispatch ordering and Codex completion behavior remain intact |
| `yarn typecheck:eyes-on-agents:core` | PASS |
| `git diff --check` | PASS |

No Electron process was launched and no audible sound test was performed. Ral owns the final runtime
check that a real Claude response-end `Stop` produces the expected system notification and bundled
completion sound. This review changes only this acceptance file and does not alter task status.

## Conclusion

**accepted for the verified scope** — Claude `Stop` now means “this response ended; return to review
it,” with durable delivery-based once-only alerting and all specified silent exclusions preserved.
