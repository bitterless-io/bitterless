---
id: builtin-tool-results-204
scope: pi built-in tool results get the download NOTE through the shared afterToolCall hook (no agent-io recording here — PQ-1)
status: done
depends-on: []
---

Paired with `micromeet-cowork` `docs/plan/tasks/builtin-tool-results-001.md` (the hook file is copied byte-for-byte from there).

# Built-in tool results get the download NOTE

## Objective

Implement the 下载 NOTE part of `docs/issues/builtin-tools-skip-host-result-hooks.md`: copy `src/main/agent/runtime/builtinToolResultHook.ts`
byte-for-byte from micromeet-cowork `apps/cowork/src/main/agent/runtime/builtinToolResultHook.ts`, wire it once in
`src/main/agent/runtime/piRuntimeAdapter.ts` without a recorder, and apply the same #1.2 edit to `docs/features/browser-downloads.md`.
No agent-io recording. Host-tool paths unchanged.
(PQ-1 decided 2026-09-24: record. That is done by `agent-io-tool-results-205` / `-206` in another session — keep this task's scope as written; `-206` adds the recorder to this wiring after this task is done.)

## Context

- `docs/issues/builtin-tools-skip-host-result-hooks.md`; micromeet-cowork `docs/issues/builtin-tools-skip-host-result-hooks.md`

## Path

- `src/main/agent/runtime/builtinToolResultHook.ts` (copied), `src/main/agent/runtime/piRuntimeAdapter.ts` (wiring lines only — file has other sessions' uncommitted edits)
- `scripts/maestro/check-download-destination.mjs` (one assertion), a hook test under `tests/`
- `docs/features/browser-downloads.md` (#1.2 only)

## Verification

- The issue's 验收; `cmp` against the Cowork hook file; existing download and bash tests; typecheck against the HEAD baseline. No E2E.

## Handoff (2026-09-24, develop interrupted — resume in another session)

Done: `src/main/agent/runtime/builtinToolResultHook.ts` copied (`cmp` identical with Cowork's); wiring in `piRuntimeAdapter.ts`
(import :14, `installBuiltinToolResultHook(session, { isHostTool, drainNote })` :225-228, no recorder — `-206` adds `record`);
one hook-path assertion in `scripts/maestro/check-download-destination.mjs` (ok; the two `downloadSettleMs` regex lines in that
diff belong to builtin-wait-197). Missing: the `docs/features/browser-downloads.md` #1.2 edit (copy the Cowork paragraph verbatim),
a BL hook test under `tests/`, regression runs, typecheck vs HEAD baseline. If the Cowork review changes the hook, re-copy it.

## Takeover (2026-09-24 18:4x)

Owner from here: overmind session 2ddacc6d (Ral 2026-09-24:「另一个会话的工作你补充下一起完成」). `browser-downloads.md` #1.2 copied verbatim from Cowork by the lead. The remaining develop work (hook test, regressions, typecheck vs baseline, `cmp`) is done in one develop pass together with `agent-io-tool-results-206` (the recorder on this wiring); one review covers both tasks.

## Close-out (2026-09-24)

- The remaining develop work ran in one pass with `agent-io-tool-results-206`. The joint independent review was stopped and replaced by a lead basic review
  (Ral 2026-09-24 ~22:30:「只保留开发工作的 subagent，结束掉审核作用的 subagent，完成开发和基本代码 review，我来测试」): hook `cmp`-identical with Cowork's; wiring identical to Cowork's :210-218; workflow sub-agents build their pi sessions with
  `createWorkflowPiSession` (not `PiRuntimeAdapter`), so the hook never runs there and nothing is recorded twice.
- Checks: `tests/maestro/builtinToolResultHook.test.mjs` 14/14 (3 wiring cases on a real pi session loop); downloadManager 6/6, steeringInterruptsBash 9/9,
  hostToolResultsRecorded 9/9 at the time; `check-download-destination` ok; typecheck 93 → 93 (line shift only); 15 mutants killed.
- If the Cowork hook ever changes, re-copy it (`cmp` case in the test).
- Pending: Ral's real-session check (download, then `bash ls` shows the NOTE).
