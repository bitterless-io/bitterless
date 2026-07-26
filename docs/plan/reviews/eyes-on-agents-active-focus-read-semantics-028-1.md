---
id: eyes-on-agents-active-focus-read-semantics-028-1
status: pass
reviewed_task: eyes-on-agents-active-focus-read-semantics-028
date: 2026-07-25
review_type: independent-code-and-contract
---

# Verdict

**PASS. No P1, P2, or P3 finding was identified.**

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Contract Assessment

- Focus is now derived solely as active runtime or unread in the shared contract, and both SQLite
  projection and Main's effective-runtime projection use that two-input rule. Open timestamps no
  longer suppress `working`, `waiting_approval`, or `waiting_input` attention
  (`docs/integrations/eyes-on-agents.md:484`,
  `src/shared/eyesOnAgents/eyesOnAgents.contract.ts:285`,
  `src/preload/sqlite/dao/eyesOnAgents.dao.ts:267`,
  `src/main/eyesOnAgents/eyesOnAgents.service.ts:558`).
- Main still waits for a successful deep link before recording Open evidence. SQLite always updates
  `last_opened_turn_id` and `last_opened_at`, while its positive terminal allowlist clears unread
  only for `idle`, `failed`, and `ended`; active and `unknown` states preserve their marker
  (`docs/plan/tasks/eyes-on-agents-active-focus-read-semantics-028.md:19`,
  `src/main/eyesOnAgents/eyesOnAgents.service.ts:1812`,
  `src/preload/sqlite/dao/eyesOnAgents.dao.ts:1223`).
- Renderer eligibility and the single SQLite `Read all` mutation use the same positive
  `idle`/`failed`/`ended` allowlist. The mutation additionally requires non-archived unread rows and
  changes neither runtime, Open evidence, nor activity ordering; `unknown` is not cleared
  (`docs/integrations/eyes-on-agents.md:510`,
  `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:82`,
  `src/preload/sqlite/dao/eyesOnAgents.dao.ts:1241`).
- Repository coverage exercises completion, failure, and interruption after active work, including
  the active-Open-to-terminal unread transition, terminal Open acknowledgement, all three active
  states, `unknown`, and archived exclusions. Core coverage exercises every active and inactive
  Focus state (`scripts/eyes-on-agents/repository.test.mjs:592`,
  `scripts/eyes-on-agents/repository.test.mjs:1652`,
  `scripts/eyes-on-agents/repository.test.mjs:1977`,
  `scripts/eyes-on-agents/core.test.mjs:168`).
- The persisted enum remains unchanged: authoritative interruption continues to use `ended`, whose
  localized labels are now `Interrupted` and `已中断`; no `paused` runtime was introduced
  (`docs/issues/eyes-on-agents-active-focus-read-semantics.md:30`,
  `src/renderer/common/i18n/en.ts:385`,
  `src/renderer/common/i18n/zh.ts:386`).
- The working tree contains concurrent unrelated edits. This review isolated the 028 source/test
  paths and only the `ended` label hunks in the shared locale files. Those task-specific hunks do
  not modify polling intervals, Electron UI, unrelated runtime behavior, or the other dirty changes.

# Verification

- `yarn test:eyes-on-agents:core` — PASS.
- `yarn test:eyes-on-agents:repository` — PASS.
- `yarn test:eyes-on-agents:ui` — PASS, 35 tests.
- `yarn typecheck:node` — PASS.
- `yarn check:renderer-i18n` — PASS.
- `git diff --check` — PASS.
- `yarn typecheck:eyes-on-agents:core` — existing baseline failure in untouched
  `src/shared/eyesOnAgents/codexHookBridge.contract.ts:274` and `:292` (`rawInput` is `unknown` at a
  stricter helper boundary); no diagnostic points to a 028-touched source path.
- `yarn typecheck:eyes-on-agents:ui` — existing baseline alias-resolution failure in untouched
  `src/renderer/eyesOnAgents/src/contextBridge/eyesOnAgentsEnv.bridge.ts:1`; no diagnostic points to
  a 028-touched source path.

# Verification Boundary

This review was source- and non-Electron-test based. Per the task contract, Ral retains the live
Electron acceptance check.
