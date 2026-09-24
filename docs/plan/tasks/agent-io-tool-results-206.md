---
id: agent-io-tool-results-206
scope: agent-io records pi built-in tool results by passing a recorder to the builtinToolResultHook wiring (PQ-1)
status: done
depends-on: [builtin-tool-results-204, agent-io-tool-results-205]
---

Port source: micromeet-cowork `builtin-tool-results-001` (its recorder in `apps/cowork/src/main/agent/runtime/piRuntimeAdapter.ts`).
Owner: overmind session 2ddacc6d. `builtin-tool-results-204` adds the hook without a recorder; this task only adds the recorder. This session took over -204 (2026-09-24 18:4x), so -204's remaining develop work and this task run in one develop pass, with one review for both.

# Built-in tool results reach agent-io

## Objective

Implement the 自带工具 row of `docs/issues/builtin-tools-skip-host-result-hooks.md`「修法(已定:agent-io 补记)」: at the hook wiring
`builtin-tool-results-204` adds in `src/main/agent/runtime/piRuntimeAdapter.ts`, pass the same recorder Cowork passes — one `tool_result` with the
final model-visible text (including the NOTE), counted in `inputBudget`, `<name> (threw)` for error results. `builtinToolResultHook.ts` itself is
not edited (it stays byte-identical with Cowork's). Host tools stay recorded only by `agent-io-tool-results-205`'s shell.

## Context

- `docs/issues/builtin-tools-skip-host-result-hooks.md` (this repo, and the Cowork file of the same name)
- micromeet-cowork `apps/cowork/src/main/agent/runtime/builtinToolResultHook.ts` and its `piRuntimeAdapter.ts` wiring (read only)
- `docs/plan/tasks/builtin-tool-results-204.md`, `docs/plan/tasks/agent-io-tool-results-205.md`

## Path

- `src/main/agent/runtime/piRuntimeAdapter.ts` (the recorder argument only — the file has other sessions' uncommitted edits)
- a test under `tests/` (extend -204's hook test or add one)

## Verification

- The issue's 验收 for 206: one `bash` call writes one `tool_result` whose text includes the NOTE; host tools are not recorded twice; an error result
  is recorded as `bash (threw)`.
- -204's hook tests still pass; `cmp` the hook file against Cowork's; typecheck against the HEAD baseline. No E2E.

## Close-out (2026-09-24)

- Developed together with -204's remaining work; review as in -204's close-out (lead basic review, Ral 2026-09-24 ~22:30:「只保留开发工作的 subagent，结束掉审核作用的 subagent，完成开发和基本代码 review，我来测试」).
- `recordBuiltinToolResult` and the `record:` wiring are byte-identical with Cowork's; `bash` (the host's interruptible stand-in) is not a host tool here,
  so it is recorded once by this recorder and never by 205's `measuredTool`.
- Pending: Ral's real-session check (agent-io `tool_result` count equals the tool calls actually run, bash / read included).
