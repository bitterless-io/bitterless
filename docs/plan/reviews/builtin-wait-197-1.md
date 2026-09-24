# `builtin-wait-197` — independent review 1

Date: 2026-09-24. The review was read-only. No source was edited, nothing was staged or committed, no branch was switched, nothing was stashed, and no app or E2E was started. Every "at HEAD" comparison ran on a `git archive HEAD` export in the session scratch directory. Every mutation or probe ran on scratch copies. For Cowork, the only actions were reads and a `tsc` run on scratch copies.

Contract:

- [feature #1–#4](../../features/builtin-wait-tool.md)
- [task](../tasks/builtin-wait-197.md)

Reviewed diff, limited to this task with `git diff --` plus the new files:

- `agent/tools/waitTool.ts` (new)
- `shared/timerHelper/timer.helper.ts` (only the `signal` part; the file itself is 193's)
- `agent/runtime/agentRuntime.types.ts` and `agent/runtime/hostToolExecution.ts`
- `agent/hostToolCatalog.ts`
- `agent/workflowEngine/hostIntegration.ts` (`:421`, `:427`)
- `maestroWindow.controller.ts`: the import `:46`, the registration `:1649-1651` and the two `ui_act` edits `:1858` / `:1862`. The rest of the `ui_act` diff belongs to 193.
- `scripts/maestro/check-download-destination.mjs` (`:63`, `:65`)
- `tests/maestro/builtinWaitTool.test.mjs` (new)

Excluded: 193's parts of the same files, and every other session's uncommitted work in this tree.

Conclusion: **pass**.

- No blocking finding. The code matches #1–#4.
- There are no stubs, mocks or fakes on the integration path.
- The claim "`yarn typecheck` 97 → 96, 0 diagnostics in changed files" is confirmed.
- One P2 and five P3 findings, all non-blocking. F1 (a same-message batch of `wait` with an observation tool) deserves a decision before Cowork `builtin-wait-001` copies `waitTool.ts` byte-for-byte.
- Paired completion still depends on Cowork `builtin-wait-001` and its own review.

## Findings

### F1 — P2 — non-blocking (not covered by the design) — a `wait` in the same assistant message as the observation does not delay that observation

- **Design:** `builtin-wait-tool.md` #2 `:46-47` says `wait` "pauses inside this turn and then continues". #2.1 `:52` says to observe again after waiting. Neither says anything about several tool calls in one message.
- **Code:** `waitTool.ts:72-90` declares no execution mode, and `piRuntimeProtocol.ts:57-78` (`bindPiTools`) passes none to pi. In pi 0.85.1, `toolExecution` defaults to `"parallel"` (`pi-agent-core/dist/agent.js:134`). All tool calls in one assistant message then run together through `Promise.all` (`agent-loop.js:285-291`, `:372`). A tool that declares `executionMode: "sequential"` switches that batch to in-order execution (`:287`).
  - In `src/`, only the workflow sub-agent session sets `'sequential'` (`workflowEngine/piAgentSession.ts:90`, same in Cowork). The chat session does not.
- **Evidence:** I ran pi's real `runAgentLoop` with a fake model that emits `[wait {ms:300}, page_snapshot]` in one message.
  - Today: `page_snapshot` ran at **3 ms** while `wait` ended at 304 ms.
  - With `executionMode: 'sequential'` on `wait`: `page_snapshot` ran at 304 ms.
- **Why it matters:** the model gets a snapshot from before the pause and a `{"ok":true}` from `wait`, and nothing tells it the pause did not happen. This is the same class of problem as uiact-wait-193 review N2.
- **Recommendation** (orchestrator, both repos, before `builtin-wait-001` copies the file):
  - Preferred: add an optional `executionMode?: 'sequential'` to `AgentToolSpec`, pass it through in `bindPiTools`, and declare it in `waitTool.ts`.
  - Minimum: add one sentence to the description, for example "Call wait on its own — tools called in the same message run at the same time and are not delayed by it."

### F2 — P3 — non-blocking — the description names `download_history` before that tool exists

- **Design:** #2.1 `:52` explicitly lists `download_history` as a tool to observe with. `browser-downloads.md` #6.6 defines it. Task `download-history-196` has `depends-on: [builtin-wait-197]`.
- **Code:** `waitTool.ts:75`.
- **Judgment:** the contract requires this text, so it is not a deviation. Until 196 lands, a model that follows the pointer gets pi's `Tool download_history not found` error and can recover.
  - 196 is the next task and nothing is released in between, so this is non-blocking.
  - Condition: if 196 slips past any release or merge, remove the name or ship the two tasks together. The same applies to Cowork.

### F3 — P3 — non-blocking (not covered by the design) — in a live pi session, the `ERROR:` row of #1 is mostly handled by pi before `wait` runs

- **Design:** #1 `:32`: missing `ms`, or `ms` that is not a finite number, returns `ERROR: wait needs "ms"…`.
- **Code:** `waitTool.ts:36-40, :83` does this correctly when the tool is called directly, and the unit tests cover it. However, `piRuntimeProtocol.ts:221-228` declares `ms` as a required `Type.Number()`. pi's `validateToolArguments` (`pi-ai/dist/utils/validation.js:280-310`) runs `Value.Convert` and then `Check` before the tool is called.
- **Probe with pi's real validator:**
  - `{}` and `{ms:"soon"}` are rejected by pi with its own message, for example `Validation failed for tool "wait": ms: must have required properties ms`.
  - `{ms:"3000"}` is converted to 3000.
  - `{ms:null}` is converted to **0**, and `wait` then returns `{"ok":true,"waitedMs":0}`.
- This behaviour already applies to every numeric parameter; 197 did not introduce it. The user still sees a failed call in both rejected cases: the call fails either way.
- **Recommendation:** add one line to #1 saying that the runtime validates and coerces arguments first. Then the Cowork review and the human check will not look for the exact `ERROR:` text in a live chat.

### F4 — P3 — non-blocking — the default 15 s budget on the failure path is protected by the guard, not by the unit test

- **Design:** #4 `:73` says tools without the field keep the 15 s wait. The task says "default budget unchanged for every other tool".
- **Code:** `hostToolExecution.ts:31` and `:40` are both correct. `drainDownloadNote(undefined)` falls back to `DOWNLOAD_SETTLE_BUDGET_MS`, and `drainDownloadNote(0)` does not wait at all (`downloadManager.ts:190-206`).
- **Test gap:** `builtinWaitTool.test.mjs:200-234` tests the 0-budget case on both paths, but the default budget only on the success path (`byDefault`, `:222-232`).
  - Mutation M35 changes only the failure path to `drainDownloadNote(tool.downloadSettleMs ?? 0)`. It survives the unit suite.
  - The guard (`check-download-destination.mjs:65`) catches it.
  - A mock-clock probe confirmed that the real code holds a failing tool's result for exactly 15 s.
- **Recommendation (optional):** add a throwing tool without `downloadSettleMs` to the `byDefault` block.

### F5 — P3 — non-blocking (not covered by the design) — a message the user sends during a wait is held until the wait ends (up to 60 s)

- **Design:** #1 `:31` defines abort only for Stop. Steering is not mentioned.
- **Code:** `piRuntimeSession.ts:280-307` interrupts only `bash` when a steering message is queued (`:299`). pi delivers steering only between tool batches.
- The delay is bounded at 60 s, which is not the unbounded wedge of the bash case. Whether steering should also end a wait early is a decision for later, in both repos. It is not needed for 197.

### F6 — P3 — non-blocking — the contract table writes its JSON with spaces; the code emits compact JSON

- **Design:** the #1 table shows `{"ok": true, "waitedMs": 5000}`.
- **Code:** `waitTool.ts:48-59` uses `JSON.stringify`, which gives `{"ok":true,"waitedMs":5000}`.
- A probe that reads the four rows from the contract found:
  - the **same JSON value and key order** for the normal, capped and aborted rows;
  - a byte-identical `ERROR:` text.
- Every other host tool also emits compact JSON. No code change is needed. Optionally, #1 could say "JSON value".

## Contract check

| Contract | Code | Verdict |
|---|---|---|
| #1 normal → `ok:true, waitedMs = ms` (the requested value, not the measured time) | `waitTool.ts:58`; tests `:80`, `:115-121` | ✓ |
| #1 over the cap → waits 60000 and returns `ok:false, timedOut:true, waitedMs:60000, error:"asked for Nms, capped at 60000ms — observe again and decide"` | `:18`, `:39`, `:50-57`. The dash is U+2014, the same as the contract. `waitedMs` is `plan.waitMs`, not the measured time. Tests `:82-84` (pure function) and `:123-128` (timer stub records `[60000]`). | ✓ |
| #1 exactly 60000 is not over the cap | `:50` uses `>`; test `:81` | ✓ |
| #1 aborted → `ok:false, aborted:true, waitedMs:<actual>`; abort wins over the cap | `:49`, `:88`; tests `:85-86`, `:138-153` | ✓ |
| #1 negative → 0 | `:38`; test `:73` | ✓ |
| #1 `ERROR:` only for invalid input; the text is byte-equal to `:32`, en dash U+2013 | `:21`, `:37`, `:83`; tests `:74-75`, `:87`, `:130-136`. `wait` produces no other `ERROR:`. The host classes a result as failed only by the `ERROR:` prefix (`toolResultFailure.ts:53-54`), so `timedOut` and `aborted` show as normal results, as #1 `:34` intends. | ✓ (F3 for the live path) |
| #2 not tab-bound, not in the scoped wrapper list, no browser lock | Registered on its own at `controller.ts:1651`. It falls through `:1916`: the `scoped` list `:1915` is the only browser-target list in `src/`. It never reaches `withAgentBrowserTarget`, which is the only place that takes `browserToolOwners` / `setTabControlled` (`:393-432`). `waitTool.ts` imports nothing from Maestro. Tests `:236-251`. | ✓ |
| #2 `timerHelper.delay(ms, signal)` resolves on time or on abort, never throws; resolves at once if already aborted; clears the timer and the listener | `timer.helper.ts:11-27`; test `:155-172`. The two one-argument callers from 193 are unchanged: `uiActWaitHover` passes 8/8. | ✓ |
| #2 abort works through the real host chain | Probe: `executeHostTool` → a wrapper shaped like `withToolTimeout` (`AbortSignal.any`) → the controller's spread `map` → `HostToolRegistry` (bypass and confirm) → `wait`. An abort at 50 ms gives a normal result with `aborted:true` in < 1 s. pi forwards its own signal to `execute` (`tool-definition-wrapper.js:11`, `agent-loop.js:464`). | ✓ |
| #2 `timeoutMs` 65000 | `waitTool.ts:78`; test `:94`. BL has no general per-tool timeout; `BaseAgent.ts:540` applies only a declared one. So 65 s is only a guard rail, and nothing can cut `wait` off before 60 s. | ✓ |
| #2 `downloadSettleMs` field; `wait` declares 0; the NOTE is still attached; the default is unchanged on both paths | `agentRuntime.types.ts:37-43`, `hostToolExecution.ts:23/31/40`, `waitTool.ts:80`. Tests `:189-198` (real timers: `wait {ms:30}` returns in < 1 s with the NOTE while a download is running) and `:200-234` (mock clock). The field survives every spread on its way to `executeHostTool` (probe). | ✓ (F4 for test coverage) |
| #2 `workflow_wait` and `wait` each describe the other | `hostIntegration.ts:421`, `waitTool.ts:75`; test `:253-255` | ✓ |
| #2.1: when to use; observe again afterwards; 60 s, and `timedOut` means change approach; `workflow_wait` for runs | `waitTool.ts:75`; test `:96-103` | ✓ (F1 for batching, F2 for `download_history`) |
| #3 shaped like `reloadSkillsTool.ts`, and byte-identical across repos | Same form: agent-tree style without semicolons and one exported builder. Only `@main/agent/runtime/agentRuntime.types` and `@shared/timerHelper/timer.helper` are imported; test `:247-250`. The `cmp` check waits for Cowork's copy; test `:262-265` skips with a printed "NOT compared" until the file exists, then enforces the comparison. | ✓ on BL's side |
| #3 Cowork `execute(args, { signal, confirm })` | `abortSignalOf` `:66-70`; runtime test `:139` covers both shapes. See the Cowork `tsc` probe below. | ✓ |
| #3 catalog entry | `hostToolCatalog.ts:23-31`; test `:106-113` (no "missing catalog entry"); `check-host-tools` shows `catalogTools` 40 → 41 | ✓ |
| #3 `ui_act`: the no-wait sentence, and "cannot reliably catch" | `controller.ts:1862` and `:1858`, matching the task's text exactly. Test `:256-259` also rules out the old wording. Cowork's sentence currently reads "cannot catch" (`mainWindow.controller.ts:1714`), so the identical wording can be reached there. | ✓ |
| #3 guard ④ | `check-download-destination.mjs:63`, `:65`. Both paths still must carry the NOTE; the new pattern also pins that the tool's budget is passed. | ✓ |
| Task: `hostIntegration.ts:427` `outcome.ok === false` | `WorkflowWaitResult` always has a literal boolean `ok` (`workflowWait.ts:24-29, 44-62`), so `!ok` and `ok === false` are the same. Probe: no-live-runs, unknown-runs, already-settled and accepted produce byte-identical results at HEAD and in the working tree. It removes the only TS2345 there. Cowork keeps `!outcome.ok` (it is `strict`); this cosmetic difference is allowed. | ✓ |
| #4 `yarn typecheck`, and no E2E | See Verification | ✓ |
| #4 human check (`wait {ms:3000}` then `page_snapshot` on a slow page) | Not run: Ral does this himself, and E2E is forbidden here. Because of F1, also watch whether the model sends both calls in one message. | pending |
| Style | Static alias imports and `import type`; no `forEach`, `import()` or `require`. `git diff --check` is clean. The new files end with a newline and contain no tabs or trailing spaces. ESLint: 0 errors in the changed source files. The remaining warnings are prettier-only and follow the agent tree's no-semicolon style; `reloadSkillsTool.ts` has the same kind. The test file's 6 `explicit-function-return-type` errors are the same kind every sibling `.mjs` test has (for example `uiActWaitHover` has 11). | ✓ |

## Verification (commands actually run)

| Command | Result |
|---|---|
| `node --test tests/maestro/builtinWaitTool.test.mjs` | 14 tests: 13 pass, 0 fail, 1 skipped (the Cowork `cmp`, with its reason printed) |
| `node --test tests/downloads/*.test.mjs` / `tests/maestro/uiActWaitHover.test.mjs` / `tests/workflowHost/workflowWait.test.cjs` / `tests/workflowHost/workflowActivity.test.cjs` | 6/6, 8/8, 9/9, 15/15 |
| `node --test tests/workflowHost/hostIntegration.test.cjs` | 19/20. The one failure (`local library references resolve…`) is identical at HEAD. |
| `yarn check:download-destination` | ok |
| `TYPECHECK_SURFACES_LIST_ERRORS=1 yarn typecheck`, working tree vs the HEAD export | exit 1: **96** distinct diagnostics vs **97** at HEAD. Present only at HEAD: `hostIntegration.ts(427,73) TS2345`. Present only in the working tree: nothing. Diagnostics in the task's files: 0. |
| All 54 `scripts/maestro/check-*.mjs`, working tree vs HEAD | Identical exit codes: 25/54 fail on both trees, all of them already failing. The meaningful output differences are `check-host-tools` `catalogTools` 40 → 41 and a line number in `check-embedded-host`'s stack trace (193's `_harness.mjs`). The rest is environment and timestamp noise (Cowork is not next to the scratch export; `check-demo-api`'s id). |
| 36 test files that reference the controller, host-tool modules, `hostIntegration`, `timerHelper` or `agentRuntime.types`, working tree vs HEAD | Every one of the 34 files present in both trees has identical pass / fail / cancelled counts. The failing test names and errors are identical in the 8 failing suites compared by name. `controlLoginPreviewWorkspace` hangs on both trees; I stopped my own run of it. The other two files are new here. |
| `node --test tests/skillScopes/execution.test.mjs`, both trees | 26/26 fail on both, on the same `@main/decision/jevDecision.service` |
| Contract probe (the four #1 rows read from the doc and compared with real `execute` output) | Same JSON value and key order; byte-equal `ERROR:` text; U+2014 / U+2013 match |
| Cowork `tsc` probe: a byte-identical copy of `waitTool.ts`, Cowork's `strict` compiler options and TypeScript 5.9.3, Cowork's real `@main` / `@shared` | (A) Cowork as it is today: exactly 2 errors, TS2353 (`downloadSettleMs` is not in `AgentToolSpec`) and TS2554 (`delay` takes 1 argument). These are the two Cowork changes #3 lists. (B) With those two changes in a scratch overlay: **0** diagnostics, including a caller that uses `execute({ms}, { signal, confirm })`. |
| Host-chain, pi-validation and pi-batching probes | See the table rows above and F1 / F3 |
| Mutation testing on scratch copies (`--test-timeout=20000`) | 37 mutants of `waitTool`, `timerHelper`, `hostToolExecution`, the controller, `hostIntegration` and the catalog: **36 killed**. The one survivor is M35 (F4), which the guard catches. The 6 guard mutants G1–G6 (drop or default either path, remove either NOTE) are all killed. |
| `git diff --check`; md5 of every reviewed file at the start and at the end of the review | Clean and unchanged |

Not run: `yarn build`, E2E, Electron, and a real session (repository rule).
