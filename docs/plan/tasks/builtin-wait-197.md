---
id: builtin-wait-197
scope: generic built-in wait tool (ms, cap 60000) usable in any scenario; downloadSettleMs; timerHelper abort
status: done
depends-on: [uiact-wait-193]
---

Paired with `micromeet-cowork` `docs/plan/tasks/builtin-wait-001.md` (Cowork copies `waitTool.ts` from here byte-for-byte). Bitterless style: static alias imports, `for…of`; `waitTool.ts` follows `reloadSkillsTool.ts` (shared agent/ tree).

# Built-in `wait` tool

## Objective

Implement `docs/features/builtin-wait-tool.md` (#1–#4):

- `src/main/agent/tools/waitTool.ts` — `wait {ms}` exactly as #1 (cap 60000, `timedOut` feedback as JSON, `aborted` on abort,
  `ERROR:` only for invalid input), tool description per #2.1 (incl. the `workflow_wait` distinction), `timeoutMs` 65000,
  `downloadSettleMs: 0`. Shaped like `reloadSkillsTool.ts`; **byte-identical across both repos**.
- Register it next to `reloadSkillsTool` and add the catalog entry; it must not be in the browser-target tool set.
- `downloadSettleMs` optional tool field in `agent/runtime/agentRuntime.types.ts`; `hostToolExecution.ts` passes it to
  `drainDownloadNote(budgetMs)` (default budget unchanged for every other tool).
- `timerHelper.delay(ms, signal?)`: resolves on time or abort, never throws.
- One sentence in `workflow_wait`'s description pointing at `wait` for in-turn pauses (and vice versa in `wait`).
- `ui_act` description (same wording in both repos): add "ui_act has no wait action — to pause, call the wait tool between ui_act calls";
  in the tab_id sentence change "cannot catch" to "cannot reliably catch" (uiact-wait-193 review N2 / N3). A mixed batch silently drops `wait`, so the model must be told.

## Context

- `docs/features/builtin-wait-tool.md` (contract)
- `docs/features/browser-downloads.md` #1.2 (download NOTE + 15 s settle) — only to understand `downloadSettleMs`

## Path

- `src/main/agent/tools/waitTool.ts` (new)
- `src/main/maestro/windows/main/maestroWindow.controller.ts` (registration only)
- `src/main/agent/hostToolCatalog.ts`
- `src/main/agent/runtime/agentRuntime.types.ts`, `src/main/agent/runtime/hostToolExecution.ts`
- `src/shared/timerHelper/timer.helper.ts`
- `src/main/agent/workflowEngine/hostIntegration.ts` (one description sentence)
- tests next to the existing agent/tool tests
- `scripts/maestro/check-download-destination.mjs` — step ④ regexes accept `drainDownloadNote(tool.downloadSettleMs)` (approved 2026-09-24)
- `src/main/agent/workflowEngine/hostIntegration.ts:427` — `outcome.ok === false` (pre-existing TS2345 under strict:false; behaviour unchanged; accepted)

## Review 1 follow-ups (2026-09-24, docs/plan/reviews/builtin-wait-197-1.md)

- F1 (P2, do now): `AgentToolSpec.executionMode?: 'sequential' | 'parallel'`, passed through where host tools are handed to pi (`bindPiTools`); `wait` declares `sequential`; description adds "call wait on its own, then observe". Test that a batch containing `wait` runs in order.
- F3 / F6: contract notes already added to the design doc — no code change.
- F4: unit test for the failure path keeping the default 15 s budget.
- F5: known limitation, documented; no code change.
- F2: acceptable because download-history-196 follows directly with no release in between.

## Verification

- #4 unit tests; source assertion that `wait` is not browser-targeted; `yarn typecheck` (changed files 0 diagnostics). No E2E.
