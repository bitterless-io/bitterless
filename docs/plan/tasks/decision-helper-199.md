---
id: decision-helper-199
scope: Decision Helper — one main-process decision entry with a default 0.5 threshold and per-call thresholds; migrate every Jev call site onto it
status: done
depends-on: [decision-maker-card-198]
---

Paired with `micromeet-cowork` `docs/plan/tasks/decision-helper-001.md`. Bitterless style: semicolons in `main/decision/`, `for…of`, static alias imports. **When develop + verify pass, stop and hand the code to Ral for review before any task that depends on this one.**

# Decision Helper

> Started in parallel with the decision-maker-card task (Ral 2026-09-24:「别等了赶紧开发」). Shared files (`uiActGate.ts`, `jevDecision.service.ts`, `snapshotSegment.ts`) are edited with exact-string edits only, re-read before each edit, never reverting the card task's changes.

## Objective

Implement `docs/features/decision-helper.md` (#3–#5):

- `src/main/decision/decisionHelper.ts`: `DECISION_DEFAULT_THRESHOLD = 0.5`; `enabled / judge / choose / check / score` with `options.threshold`
  (strictly greater than; invalid → 0.5 with a message), `DecisionOutcome` exactly as #3, user-facing text says "decision maker".
- Shared types in `src/shared/decision/` (extend `jev.api.ts` or add `decision.api.ts`) so a renderer caller can type against them later.
- Renderer module (Ral 2026-09-24 picked this over a preload `contextBridge` instance): `src/renderer/common/decision/decisionHelper.ts` with the same `enabled / judge / choose / check / score` signatures, calling `xpc:DecisionHandler/*` via `createXpcRendererEmitter`; business code imports only this module; options pass through untouched.
- Migrate: BJ3 `uiActGate.ts` (default 0.5, fail-closed policy stays in the gate), BJ1 `snapshotSegment.ts` (explicit 0.7, fail-open stays),
  skill sandbox binding `decision` + alias `jev` (same object), renderer facade renamed `DecisionHandler` (`xpc:DecisionHandler/*`).
- `jevDecision.service.ts` is imported only by `decisionHelper.ts` afterwards (source guard).

## Context

- `docs/features/decision-helper.md` (contract)
- `docs/features/decision-maker-naming-and-approval-card.md` (wording)
- `src/shared/decision/jev.api.ts` (current types and failure reasons)

## Path
- `src/renderer/common/decision/decisionHelper.ts` (new)

- `src/main/decision/decisionHelper.ts` (new), `src/main/decision/jevDecision.service.ts`
- `src/shared/decision/`
- `src/main/maestro/drive/uiActGate.ts`, `src/main/maestro/drive/snapshotSegment.ts`, `src/main/maestro/drive/skillScript.ts`
- `src/main/xpc/jev.handler.ts` → `decision.handler.ts` (+ its registration in `src/main/xpc/xpc.helper.ts`)
- tests under `tests/maestro/`

## Verification

- #5 unit tests (threshold edges, three question types, every failure reason passed through, no Jev in messages, before/after parity of BJ3 / BJ1 /
  sandbox with a stubbed judge, `jev` alias still works) + the import guard.
- `yarn typecheck`. No E2E.

## Close-out (2026-09-24)

- Reviews: [199-1](../reviews/decision-helper-199-1.md) pass; [199-2](../reviews/decision-helper-199-2.md) pass (11,828 scenarios: 0 difference except the new
  unusable-answer log line; the parts shared with Cowork identical over 1,927 calls). Round 3 (199-2 F1–F3, the array examples, and Cowork 001-3 N1 / N3
  pins; tests and comments only) got a lead basic review instead of an independent one (Ral 2026-09-24 ~22:30:「只保留开发工作的 subagent，结束掉审核作用的 subagent，完成开发和基本代码 review，我来测试」).
- Round 3 evidence: 44,427 observations (requests, POST bodies, returns, logs) sha256-identical before / after (`1ec5e3c6…`); comment-stripped JS of helper,
  gate and `skillScript.ts` identical; N8, N9, V1, V8, M4 killed (V2 was already pinned).
- Final checks: typecheck 93 → 93, 0 in changed files; decisionHelper 23/23, decisionMakerCard 31/31, uiActWaitHover 8/8, agentDecisionSheet 13/13;
  skillScopes/execution 0/26 before and after (fixture drift, `docs/issues/unit-tests-hang-after-fixture-drift.md`).
- Not done by decision (in `docs/plan/backlog.md`): R7, O1, O3, O4, O5. Small leftover: a failed case label prints `"0.9"` and `[0.9]` the same (test output only).
- Pending: Ral's code review and real-app test.
