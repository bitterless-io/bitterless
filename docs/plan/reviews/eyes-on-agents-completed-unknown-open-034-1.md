---
id: eyes-on-agents-completed-unknown-open-034-1
status: pass
reviewed_task: eyes-on-agents-completed-unknown-open-034
date: 2026-07-31
review_type: static-acceptance
---

# Verdict

**PASS — no P1, P2, or P3 findings.**

The implementation matches the task and integration contracts. This review was performed
independently from implementation and did not launch Electron.

# Findings

None.

# Contract conformance

| Requirement | Evidence | Result |
|---|---|---|
| A recovery candidate with an equal existing `last_completed_turn_id` may still converge | The settlement CAS intentionally does not reject an equal completion identity (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:937`); the real SQLite regression seeds the same ID plus an existing alert receipt and proves transition to `idle` without replaying the alert (`scripts/eyes-on-agents/repository.test.mjs:2312`). | Pass |
| `settledTurn` is a strict shared-boundary transition and mutually exclusive with terminal, recovery, and reclaim | Parser validation and the four-way transition count are in `src/shared/eyesOnAgents/eyesOnAgents.contract.ts:549` and `src/shared/eyesOnAgents/eyesOnAgents.contract.ts:671`; every pair is rejected in `scripts/eyes-on-agents/core.test.mjs:111`. | Pass |
| SQLite settlement uses an exact compare-and-set and preserves unread until acknowledgement | The update requires non-archived, unread, `discovery + unknown`, no active turn, and the exact selected watermark (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:943`). Repository regressions cover each rejection condition and all three terminal mappings (`scripts/eyes-on-agents/repository.test.mjs:2204`). | Pass |
| Completed settlement reuses durable notification dedupe | Receipt claiming occurs only after the settlement CAS succeeds (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:970`) and reuses the existing `(thread_id, turn_id)` receipt (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:441`). New and previously claimed completion cases are both covered. | Pass |
| One Open settles before acknowledging | Main now executes deep link, best-effort status sync, then `markOpened`, broadcast, and snapshot (`src/main/eyesOnAgents/eyesOnAgents.service.ts:1976`). Core coverage records the complete call order and proves a newly settled row becomes read in the same Open (`scripts/eyes-on-agents/core.test.mjs:1275`). | Pass |
| Deep-link and sync failures retain their required semantics | A failed deep link reaches neither sync nor `markOpened`; a disconnected or rejected sync is swallowed and final Open evidence is still recorded (`src/main/eyesOnAgents/eyesOnAgents.service.ts:1989`, `scripts/eyes-on-agents/core.test.mjs:433`, `scripts/eyes-on-agents/core.test.mjs:1427`). | Pass |
| Archive/unread behavior is unchanged | Both archive mutations continue to preserve unread (`src/preload/sqlite/dao/eyesOnAgents.dao.ts:1260`, `src/preload/sqlite/dao/eyesOnAgents.dao.ts:1294`); archived settlement is rejected without clearing it, and existing archive/unarchive persistence regressions remain intact (`scripts/eyes-on-agents/repository.test.mjs:771`, `scripts/eyes-on-agents/repository.test.mjs:2211`). | Pass |

# Verification

- `yarn test:eyes-on-agents:core` — PASS.
- `yarn test:eyes-on-agents:repository` — PASS.
- `yarn typecheck:node` — PASS.
- `git diff --check` — PASS, including this review file.
- `yarn typecheck:eyes-on-agents:core` — still blocked by the pre-existing
  `rawInput: unknown` errors in unchanged
  `src/shared/eyesOnAgents/codexHookBridge.contract.ts:274` and
  `src/shared/eyesOnAgents/codexHookBridge.contract.ts:292`; no changed file from task 034 appears
  in that failure.

# Remaining human verification

Ral should perform the live Electron check: use a non-archived task persisted as
`discovery + unknown + unread` whose newest Codex turn is the same completed turn already recorded
in `last_completed_turn_id`, click `Open` once, and confirm it leaves Focus without replaying a
previously claimed completion notification. Also confirm an actually `inProgress` task remains in
Focus after Open. No Electron UI verification was run by this review.
