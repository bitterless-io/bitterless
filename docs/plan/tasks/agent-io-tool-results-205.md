---
id: agent-io-tool-results-205
scope: agent-io records every host tool result (tool_result + inputBudget) through a measuring shell in HostToolRegistry, as Cowork does (PQ-1)
status: done
depends-on: []
---

Port source: micromeet-cowork `apps/cowork/src/main/agent/runtime/hostToolRegistry.ts` `measuredTool` (Cowork already records; no Cowork change).
Owner: overmind session 2ddacc6d. Built-in tools are `agent-io-tool-results-206`.

# Host tool results reach agent-io

## Objective

Implement the host-tool row of `docs/issues/builtin-tools-skip-host-result-hooks.md`「修法(已定:agent-io 补记)」:

- `src/main/agent/runtime/hostToolRegistry.ts`: `toRuntimeTools()` wraps **every** registered tool (not only `confirm` ones) in a `measuredTool` shell,
  same behaviour as Cowork's:
  - result → text (a string as is, anything else `JSON.stringify(out ?? '')`); `inputBudget.record(name, utf-8 bytes, subjectOf(args))`;
    `modelIoLog.append({ kind: 'tool_result', name, subject, text, turn: inputBudget.turnIndexNow })`; return the original result unchanged.
  - thrown error → record `<name> (threw)` with the error message (bytes + `modelIoLog`), then rethrow the same error.
  - BL's `execute(args, signal, extra)` passes all three arguments through untouched (`extra.confirm` for `deferConfirmation` tools must survive).
  - The shell sits outside `confirmedTool`, so an operator denial is recorded as `(threw)` like any other error.
- Calls that are not the chat agent's own model input must not be measured: `HostToolRegistry.toUnmeasuredTools()` applies policy only (the old
  `toRuntimeTools()` behaviour). `maestroAgent.service.ts` builds both variants from one private builder (`wrapHostTools` measured,
  `wrapHostToolsUnmeasured` not — review 205-1 F3: no 15-line copy that can drift). Unmeasured callers: `maestroWindow.controller.ts`
  `manageSkillInstallation` (the Skills page — `list` on every page load) and the workflow sub-agents' registry in `maestroAgent.service.ts`
  (~:334-345 — the workflow worker already records their results; review 205-1 F1). The chat agent keeps `wrapHostTools`.
- Style: match each file's existing style (`hostToolRegistry.ts` has no semicolons — keep it that way; no reformatting of untouched lines),
  `for…of`, static imports (check that `scripts/maestro/check-agent-activity.mjs` / `check-agent-runtime.mjs` can still load
  the file — Cowork's header comment explains why its host-neighbour imports are relative).
- `BaseAgent.ts` `turn_end` is not edited: once results are recorded its 「本轮工具结果 X tok / N 次」 line reports real numbers.

## Context

- `docs/issues/builtin-tools-skip-host-result-hooks.md` (this repo, and the Cowork file of the same name)
- micromeet-cowork `apps/cowork/src/main/agent/runtime/hostToolRegistry.ts` (read only)
- `src/main/agent/runtime/inputBudget.ts`, `src/main/agent/runtime/modelIoLog.ts` (already the same as Cowork's), `src/main/agent/BaseAgent.ts` (turn_end reader)

## Path

- `src/main/agent/runtime/hostToolRegistry.ts`
- new test `tests/maestro/hostToolResultsRecorded.test.mjs`
- `src/main/agent/maestroAgent.service.ts` (the builder, the two wrap methods, the workflow registry's last call only) and `src/main/maestro/windows/main/maestroWindow.controller.ts`
  (`manageSkillInstallation` only) — both carry other sessions' uncommitted edits: exact edits, touch nothing else
- Do NOT edit `hostToolExecution.ts`, `piRuntimeAdapter.ts`, `piRuntimeSession.ts`, `agentRuntime.types.ts`, `hostToolCatalog.ts` (other sessions'
  uncommitted edits), the decision-helper-199 files, or anything under micromeet-cowork.

## Verification

- The issue's 验收 for 205: success and thrown results each write one `tool_result` and count in `inputBudget`; `confirm` tools are measured too;
  `signal` and `extra.confirm` pass through; a denied confirmation is recorded as `(threw)`; the Skills-page path records nothing
  and so does the workflow registry path (pinned by a test that kills the "workflow registry measured" mutant); a tool result does not wait for the
  agent-io disk write (review 205-1 F4); the two comments review 205-1 F2 names are reworded;
  (no `tool_result`, no `inputBudget`) while policy still applies (`disabled` → the existing error, `confirm` → `onConfirm`).
- `node scripts/maestro/check-agent-runtime.mjs`, `node scripts/maestro/check-agent-activity.mjs`, and the existing session-io tests
  (`tests/maestro/sessionIoInitialization.test.mjs`, `maestroSessionIoPath.test.mjs`) — no new failures against HEAD.
- `TYPECHECK_SURFACES_LIST_ERRORS=1 yarn typecheck` against the HEAD baseline: no new diagnostics, 0 in changed files. No E2E.

## Close-out (2026-09-24)

- Review [205-1](../reviews/agent-io-tool-results-205-1.md): pass; its F1 (P2 — workflow sub-agents' results recorded twice, each workflow agent creating
  an agent-io directory that pushes old chat logs out of the 20-slot retention) and F2–F4 were fixed in round 3. The round-3 re-review was stopped and
  replaced by a lead basic review (Ral 2026-09-24 ~22:30:「只保留开发工作的 subagent，结束掉审核作用的 subagent，完成开发和基本代码 review，我来测试」).
- Round 3: `toUnmeasuredTools()` / `wrapHostToolsUnmeasured()` from one private builder; the workflow registry (`maestroAgent.service.ts` ~:344) and the
  Skills page use the unmeasured variant; the chat agent keeps `wrapHostTools`. Test 12/12; 25 mutants killed (incl. review K7, K3, K9);
  typecheck 93 → 93 (one pre-existing diagnostic moved by the inserted comment); listed regressions and guards unchanged.
- Split off: F5 and the observations → `docs/issues/agent-io-tool-result-recording-gaps.md` (both repos); the Cowork twin of F1 →
  micromeet-cowork `docs/issues/workflow-tool-results-recorded-twice.md`.
- Pending: Ral's real-session check — `turn_end` no longer says 0; agent-io `tool_result` count equals the tool calls actually run; opening the Skills page
  or running a workflow adds no agent-io directory.
