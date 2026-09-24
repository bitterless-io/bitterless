# `agent-io-tool-results-205` — independent review 1

Date: 2026-09-24. This is a read-only review by a verifier who did not implement the change. No source, task or doc was edited, nothing was staged or committed, no branch or worktree was switched or created, nothing was stashed, and no app, Electron or E2E was started. This file is the only one written in the repository.

Everything else ran on copies in the session scratch directory, which were deleted after the review. Outside the repository, the only other change was cleanup: I removed three `model-io-bucket-*` directories that my copy of Cowork's model-io guard leaves in `$TMPDIR`. No permission was denied.

Task: [agent-io-tool-results-205](../tasks/agent-io-tool-results-205.md), `status: in-progress`, `depends-on: []`.

Contract:

- [builtin-tools-skip-host-result-hooks](../../issues/builtin-tools-skip-host-result-hooks.md) 「修法(已定:agent-io 补记)」 `:24-42`: the host row `:31`, 回合统计 `:33`, 已知残留 `:35-36`, 验收 205 `:39-40` and `:42`.
- The task's Objective `:13-30` and Verification `:47-54`.
- The Cowork issue of the same name, `:34` and `:46-51`.
- Port source: micromeet-cowork `apps/cowork/src/main/agent/runtime/hostToolRegistry.ts` `measuredTool` `:46-84`, read only.

## Scope basis

HEAD `883824e8`. Four scratch trees:

- **`snap`**: the four task files, the task and the issue, copied at 18:22:13.
- **`wt`**: a copy of the working tree taken at 18:28:43, without `node_modules` / `dist` / `out` / `build` / `tmp`; `node_modules` is a symlink. The four task files are byte-identical to `snap`.
- **`pre`**: `wt` with 205's hunks reverted, and nothing else. So it is the working tree as it was before 205.
  - `hostToolRegistry.ts` ← `git show HEAD:`.
  - The service loses `:2420-2440`.
  - The controller's `:937-938` goes back to HEAD's `:926`.
  - The new test is removed.
  - `diff -rq pre wt` lists exactly those four paths, and `pre`'s controller and service differ from HEAD only by the other sessions' hunks below.
- **`mut`**: a copy of `wt`, used for mutants. `diff -rq mut wt` was empty after the run.

**Attribution.** Everything is uncommitted, so hunks were attributed by hunk and by file mtimes:

| File | 205's hunk | Other hunks (not reviewed) |
|---|---|---|
| `src/main/agent/runtime/hostToolRegistry.ts` (mtime 18:12:06) | The whole diff, +54/−1: imports `:4-5`, `toPolicyTools` `:40-48`, `toRuntimeTools` `:50-55`, `measuredTool` `:57-94` | none |
| `src/main/agent/maestroAgent.service.ts` (18:13:13) | `@@ -2416,0 +2420,21`: `policyWrapHostTools` `:2420-2440` | `:46`, `:2028-2029` and `:2061`, all settings-menu-manual's `MENU/MANUAL_BUILTIN_SKILL` |
| `src/main/maestro/windows/main/maestroWindow.controller.ts` (18:13:58) | `@@ -926 +937,2`: `manageSkillInstallation` `:937-938` | `:46-47`, `:754-762`, `:1153`, `:1661-1664`, `:1869`, `:1871` and `:1874-1875`: wait / settings tools, workbench pane, auth generation, `ui_act` text |
| `tests/maestro/hostToolResultsRecorded.test.mjs` (untracked, 18:16:22) | The whole file | — |

These files have no 205 edits:

- `hostToolExecution.ts`;
- `piRuntimeAdapter.ts`, which carries 204's hook wiring;
- `piRuntimeSession.ts`, `agentRuntime.types.ts`, `hostToolCatalog.ts` and `BaseAgent.ts`;
- the decision-helper-199 files.

At 18:53:47 and again at 19:01:17, the four task files, the task and the issue were still byte-identical to `snap`.

**Changed during the review (not 205, not reviewed).** Two neighbouring files were edited after the `wt` copy, both apparently agent-io-tool-results-206 work:

- `builtinToolResultHook.ts` (18:36:10);
- `piRuntimeAdapter.ts` (19:01:59), which now defines `recordBuiltinToolResult` and passes it as the hook's `record`.

As instructed, this review uses the 18:28 snapshot. There, the hook is wired without `record`.

A read-only look at the live wiring (19:03) shows `isHostTool` still excludes host tools before recording (`builtinToolResultHook.ts:96`). So host tools are still recorded once, by 205's shell. Whether 206 is correct belongs to 206's own review.

## Conclusion

**pass.**

- **Blocking: none.** Everything the host row and 验收 205 ask for is implemented as written and pinned by the new test. Typecheck and every related suite are unchanged apart from the new test.
- **Non-blocking: F1 (P2) and F2–F5 (P3).**
  - **F1: settle before 205 is closed.** The workflow host's `web_search` / `web_fetch` go through `toRuntimeTools()` too, and three things follow:
    - each call is now recorded a second time, in a new `workflow_<run>_<agent>` agent-io directory, on top of the row the workflow worker already writes into the chat's log;
    - the call is counted in the chat's input ledger;
    - each such directory takes one of the 20 retained slots, so older chat evidence is deleted sooner.
    - Neither repo's issue mentions this path, and Cowork has the same structure, so it is a gap in the design rather than a deviation from it.
  - F2: two sentences in the `measuredTool` comment are not accurate.
  - F3: `policyWrapHostTools` is a copy of `wrapHostTools`, and its name does not say what differs.
  - F4: three of my mutants survive.
  - F5: a `(threw)` row stores the raw error text, while the model only ever sees a sanitized version. Cowork does the same.

What conforms:

- Each contract item is implemented and pinned: one row plus a ledger entry for each success and each thrown result; confirm tools are measured; `signal` and `extra` pass through; a denial is recorded as `(threw)`; the Skills page records nothing while policy still applies.
- It matches Cowork's `measuredTool` statement by statement, except for the signature BL's type requires (#4).
- A probe through the real pi AgentSession loop shows two things:
  - rows land in the right chat, even with two chats running at once;
  - `turn_end` reports real numbers, where `pre` reports `0 tok / 0 次`.
- Policy behaviour is identical `pre` → `wt` (probe), and the policy code is byte-identical to HEAD.
- Typecheck is 93 before and 93 after, with the same set. Every related suite is identical except for the new test. ESLint reports 0 new errors.

## 1. Contract check

| Contract | Code | Evidence | Verdict |
|---|---|---|---|
| `toRuntimeTools()` wraps **every** tool, not only `confirm` ones | `:54` `.map((tool) => this.measuredTool(tool))` over the stored tools | Test 1 (bypass) and test 4 (confirm) each get a row; mutant K2 (only bypass tools measured) is killed | ✓ |
| Result → text: a string as is, anything else `JSON.stringify(out ?? '')` | `:79` | Test 3: an object is recorded as its JSON, `undefined` as `""` | ✓ |
| `inputBudget.record(name, utf-8 bytes, subjectOf(args))` | `:76`, `:80` | Test 1 uses a multi-byte fixture. Probe ② (real pi loop): the ledger shows 4031 B, which is 4019 + 12 B, the two rows. | ✓ |
| `modelIoLog.append({ kind: 'tool_result', name, subject, text, turn })` | `:83`, with `turn: inputBudget.turnIndexNow` | The tests read the real `session.jsonl`; `turn` is 2 after two `turnStart()` calls | ✓ |
| The original result is returned unchanged | `:84` | Test 3: `object === payload` | ✓ |
| A thrown error → `<name> (threw)` with its message, then the **same** error rethrown | `:85-91`. The ledger keeps the plain name, as Cowork `:77` does | Test 2: `err === failure` | ✓ |
| `execute(args, signal, extra)` passes all three through | `:75`, `:78` | Test 5 checks the identity of all three; mutant K40 is killed | ✓ (but the comment's reason is wrong: F2) |
| The shell sits outside `confirmedTool`, so a denial becomes a `(threw)` row | `:35` stores `confirmedTool(...)`, and `:54` wraps what was stored | Tests 4 and 6 have the denial row; mutant K1 (shell moved inside the policy layer) is killed | ✓ |
| UI calls are not measured: `toPolicyTools()` does what the old `toRuntimeTools()` did | `:45-48`, whose body is HEAD's `toRuntimeTools` body; service `:2425-2439`; controller `:938` | Test 7. Test 8 runs the real `manageSkillInstallation`, cut out by AST: no row in `unattributed`, 0 ledger calls, `disabled` gives the existing error, `confirm` calls `onConfirm`. | ✓ |
| Agent sessions keep `wrapHostTools` | Controller `:1638`, unchanged. All four `buildTools` go through `buildPiTools` (service `:484`, `:513`, `:1756`, `:1793`). | Test 9 runs the real `wrapHostTools` and pins `buildPiTools` by source | ✓ (the workflow host path: F1) |
| Keep the file's style; `for…of`; static imports; the guards can still load the file | `hostToolRegistry.ts` has 0 semicolon-terminated lines, no new loops, and top-of-file imports only | `check-agent-runtime` / `check-agent-activity` never load this file: they stub BaseAgent's imports, and their output is identical `pre` → `wt`. `check-host-tools` loads the file through its `@main/` resolver and passes. | ✓ |
| `BaseAgent.ts` is not edited, and `turn_end` becomes real | `BaseAgent.ts` is not in `git status` | Probe ②, real pi loop: `turn #1: 本轮工具结果 1K tok / 2 次 · 会话累计 1K tok / 2 次 · 最大来源 probe_read(…)`. `pre` shows `0 tok / 0 次`. | ✓ (concurrency caveat: O2) |
| Guards and session-io tests: no new failures against the baseline. Typecheck: 0 new diagnostics. No E2E. | — | See Verification | ✓ |

## 2. Which tools are measured, and how often (brief items 2–4)

| Path | Where | Measured? | Where the row lands |
|---|---|---|---|
| Chat turn, per session and `default` | `buildTools` → `buildPiTools` → `wrapHostTools` → `toRuntimeTools()` | Once. The tools inside (workflow chat tools, drill, file, decision, …) are plain specs, with no nested registry. | The chat's bucket. The turn runs inside `runInAgentSession(sessionKey)` (service `:1985`). Probe ① (real pi loop, two chats at once) and probe ③ (a session built outside any context) both attribute every row correctly, and nothing lands in `unattributed`. |
| Drill continuation turns | `drillTools.host.ts:344` → controller `:1596-1614` → `sendAgentMessage` → `:1985` | Once | The drill owner's chat |
| DelegateAgent | service `:513`, `:1793` → `buildPiTools` | Once | `unattributed`, if it is ever called. `delegateMessage` (`:1594-1606`) has no `runInAgentSession` (O3). |
| Workflow subagents' `web_search` / `web_fetch` | service `:334-345` `toRuntimeTools()`, executed by `hostIntegration.ts:91-105` | **Once by the shell, on top of the worker's own diagnostic** | The shell's row goes to the `workflow:<run>:<agent>` bucket, one directory per agent. The worker's row (pre-existing) goes to the chat bucket. The chat ledger counts the call as well. **F1** |
| Skills page (UI) | controller `:935-941` → `policyWrapHostTools` → `toPolicyTools()` | No | None ✓ |
| pi built-in tools (`bash` / `read` / …) | Not host tools | No. That is 206's job; in the 18:28 snapshot, 204's hook is wired without `record` (see "Changed during the review"). | None |

**Other writers.** In the 18:28 snapshot, the only other code in `src` that writes `tool_result` or calls `inputBudget.record` is the workflow worker's `piAgentSession.ts:188`. It reaches the chat bucket through `agent.worker.ts:50` → `supervisor.ts:463` → `hostIntegration.ts:83-86`. `contextExport.service.ts:138` builds the `/view_context` export, not agent-io. The live tree now also has 206's in-progress `recordBuiltinToolResult`, which is for built-in tools only.

**Other direct `execute(...)` calls on wrapped tools** in `src/main`:

- Controller `:940`: the Skills page, which is now policy-only.
- `hostIntegration.ts:102`: the workflow host (F1).
- The rest are the wrappers' own chain: `buildPiTools`'s mapping `:1909-1938`, `BaseAgent.ts:546/551` and `hostToolExecution.ts:31`.
- No XPC handler, MCP bridge or timer calls a wrapped tool.

## 3. The developer's claims

| Claim | Verified |
|---|---|
| `hostToolRegistry.ts` is +54/−1 with no semicolons; it adds the `inputBudget, subjectOf` and `modelIoLog` imports; `toRuntimeTools()` wraps each tool outside `confirmedTool`; `toPolicyTools()` is the old `toRuntimeTools()` | ✓ `git diff --stat` shows 54/1, and the file has 0 lines ending in `;`. `toPolicyTools`'s body equals HEAD's `toRuntimeTools` body; only the name differs. `add()`, `confirmedTool` and `checkCatalogCoverage` are byte-identical to HEAD. |
| `measuredTool`: `(args, signal, context)` passed through; string as is, otherwise JSON; utf-8 bytes; a `tool_result` row; the original value returned; on a throw, the ledger uses the plain name, agent-io uses `(threw)`, and the same error object is rethrown | ✓ `:72-94`, checked statement by statement against Cowork `:62-84` (#4) |
| Service: one hunk only, `@@ -2416,0 +2420,21`. `policyWrapHostTools` is `wrapHostTools` except that it ends in `toPolicyTools()`. Three other hunks belong to other sessions. | ✓ Diffing the two method bodies shows only the name and the final call differ. The other hunks are `:46`, `:2028-2029` and `:2061`. |
| Controller: one hunk only, `@@ -926 +937,2`. The agent's `buildPiTools` at `:1638` is untouched. Seven other hunks. | ✓ |
| 9 test cases | ✓ 9/9 on `wt`, and 9/9 on the live tree at 18:53. On `pre` the file fails at load, because `policyWrapHostTools` does not exist there. |
| Typecheck: 93 before and after, same set, 0 new | ✓ |
| The seven listed tests are word-for-word the same as before; the first four already failed | ✓ for counts and failing test names. After normalizing paths and timings the logs are identical, except that `builtinWaitTool` gains one `[model-io] 落点未配置…` line (O7). |
| The three guards behave as before | ✓ Same exit codes and failures. `check-host-tools` gains the same single warning line. |
| All 19 mutants killed | Not checkable: the developer's mutants and scripts were not left behind. I ran 9 of my own: 7 new ones, one sanity revert, and one that probably overlaps the developer's set. 5 were killed and 4 survived (F4). |

## 4. Differences from Cowork's `measuredTool`

| Item | Cowork (`:46-84`) | BL (`:50-94`) | Verdict |
|---|---|---|---|
| Behaviour | Text, bytes, `subject` taken before the call, `turn` read at append, the `(threw)` suffix, the error text `(err as Error)?.message \|\| String(err)`, the ledger under the plain name, `throw err`, `return out`, all tools wrapped, outside `confirmedTool` (`:66-80`) | The same (`:76-90`) | Identical statement by statement. `inputBudget.ts` is byte-identical between the two repos; `modelIoLog.ts` differs only in comments. |
| Signature | `(args, context)`, where `context` carries the `signal` | `(args, signal, context)` | Required by BL's `AgentToolSpec.execute` (`agentRuntime.types.ts:26`) |
| Doc comment | 「记下…字节数和一个短标签，**不记内容**」. This is stale: the code does write the text. | 「agent-io(`modelIoLog`)记原文」 | BL's is accurate. Cowork's comment could get the same fix; optional, Cowork-side. |
| Imports | Host neighbours are relative, with a header explaining why | HEAD's `@main/…agentRuntime.types` (type-only) and `../hostToolCatalog` are kept. The new imports are the same `@main/…` paths Cowork uses. | No BL guard loads this file with a raw `require` (#1), so the header is not needed |
| `toPolicyTools()` | — | New | A BL-only UI path. Cowork's `wrapHostTools` has agent callers only (`mainWindow.controller.ts:1991`, `coworkAgent.service.ts:2235`). |

## 5. Findings

### Blocking

None.

### Non-blocking

#### F1 — P2 · non-blocking (design gap, same as Cowork; settle before closing 205) — workflow host tools: recorded twice, counted in the chat's ledger, and each agent gets a directory that pushes old evidence out

- **Where:**
  - `maestroAgent.service.ts:334-345`: the workflow host's `tools` is `new HostToolRegistry(...).toRuntimeTools()`, so it is now measured.
  - It runs in `workflowEngine/hostIntegration.ts:91-105`, under `runInAgentSession(workflowToolScope(request))`, whose key is `workflow:<runId>:<agentId>` (`:45-46`).
  - The worker already logs the same call into the **chat's** bucket: `piAgentSession.ts:185-188` `diagnostic('tool_result', …)` → `agent.worker.ts:50` → `supervisor.ts:463` → `hostIntegration.ts:83-86`. That code carries the comment "Resource ownership uses workflow:<run>:<agent>; diagnostics belong to the chat".
- **Evidence** (probes `als.mjs` ④ and `evict.mjs`, with the real registry, modelIoLog and ALS):
  - **Duplication and ledger.** On `wt`, 3 workflow agents create 3 new directories, `…-workflow_run1_a{1,2,3}`. The chat bucket gets no row from the shell. The process ledger, which the chat's `turn_end` reads, shows `turn.calls = 3`. On `pre`: 0 directories and 0 calls.
  - **Retention.** Starting from 20 older chat directories, 3 such agents leave 17, and 8 agents leave 12. `pre` keeps all 20.
    - BL_PREVIEW's agent-io is at exactly 20 directories today. So on that install, every workflow agent that calls a web tool deletes one real chat log.
    - The new directories are exempt while the process lives, because `handles` never shrinks (`modelIoLog.ts:366-370`). After a restart they are the newest, so they outlive the chats.
  - **Nothing pins this path, either way.** Mutant K7 (`:344` → `toPolicyTools()`) survives every test.
- **Contract:**
  - The host row (`:31`) exempts only UI calls. Its reason for doing so, 「否则 agent-io 会多出 … 记录，正在跑的回合的统计也会被算进去」, applies here too, and so does 206's 「不重复记」 (`:32`).
  - Neither repo's issue mentions this path. Cowork's issue even says `tool_result` is 「只由 `HostToolRegistry.measuredTool` 写」 (`:34`).
  - Cowork has the identical structure: `coworkAgent.service.ts:392-403`, its `hostIntegration.ts:87-90` / `:95-110`, and `piAgentSession.ts:188`. So this is 「口径与 Cowork 相同」, not a deviation, which is why it is not blocking. In BL, though, it is new with 205.
- **Fix** (recommended; for the lead or Ral to decide, because it goes beyond 205's Path and pairs with Cowork):
  - BL: change `:344` to `return registry.toPolicyTools()`, with one line saying why. The worker's own diagnostic already puts the result in the chat bucket. Measuring here as well copies it into a per-agent bucket and into the chat's ledger.
  - Add the path to the issue's table.
  - Pin it in the new test: either assert that the workflow host's tools come from `toPolicyTools()`, or run `executeTool` as the probe does.
  - Cowork: the same defect exists today. It needs its own issue, because Cowork's registry has no `toPolicyTools()` yet (paired-development rule).

#### F2 — P3 · non-blocking (comment accuracy) — two statements in the `measuredTool` comment do not hold

- **`hostToolRegistry.ts:66-68`** says 「三个参数原样透传 —— … `context.confirm` 是 `deferConfirmation` 工具 … 请求确认的通道 … 壳丢了它确认就无声失效」. Two facts contradict it:
  - The shell sits **outside** `confirmedTool`. So a confirm-policy tool's `context.confirm` is created inside it (`:111-122`) and never passes through the shell.
  - Nothing in production passes a third argument to the shell:
    - `hostToolExecution.ts:31` passes `(params, signal)`;
    - `BaseAgent.ts:546/551` forwards the `context` it was given by that call, which is undefined;
    - `hostIntegration.ts:102` passes `(request.args)`;
    - the controller at `:940` passes one argument.
  - **Evidence:** mutant K40 (the shell drops the third argument) is killed only by test 5, which supplies `extra` itself. Test 6, the real confirm path, still passes under K40.
  - Passing all three through is still right, because a wrapper should be transparent. Only the stated reason is wrong.
  - **Fix**, for example: 「三个参数原样透传：这是透明的计量层，签名与 `AgentToolSpec` 相同。confirm 策略下 `deferConfirmation` 工具的 `context.confirm` 由里层 `confirmedTool` 生成，不经过这层。」
- **`:61-63`** says 「本仓原来没有这一层，于是 agent-io 一条 `tool_result` 都没记过」.
  - In the code this is not so: the workflow diagnostic has written `tool_result` rows all along (`piAgentSession.ts:188`, see F1).
  - On disk the sentence happens to hold: the 31 BL jsonl files contain 0 such rows.
  - The issue's 「整个仓里没有写 `tool_result`…的地方」 (`:12`) has the same gap.
  - **Fix:** 「聊天回合的宿主工具结果原来一条都不进 agent-io…」

#### F3 — P3 · non-blocking (readability) — `policyWrapHostTools` is a 15-line copy of `wrapHostTools`, and neither new name says what differs

- **Where:** service `:2425-2439` compared with `:2404-2418`. The two bodies differ only in the method name and in the final call, `toPolicyTools()` against `toRuntimeTools()`. `toPolicyTools()` (`hostToolRegistry.ts:45`) has the same naming problem.
- **Evidence:**
  - Mutant K9 (the copy loses `onWarning`) survives every test, so the two copies can drift apart without anything noticing.
  - Both new names describe what the variants share, policy, which `wrapHostTools` applies too. A reader cannot tell which to call without reading the JSDoc.
- **Why it happened:** the task allowed 「the sibling method only」, so `wrapHostTools` could not be touched.
- **Fix** (the lead's call):
  - One private builder, `private hostToolRegistry(scope, tools)`, with two one-line callers. That changes one existing line, the final `return …toRuntimeTools()`.
  - Rename both to say what differs, for example `toPolicyOnlyTools()` and `wrapHostToolsForUi()`. The test's `method(SERVICE, 'policyWrapHostTools')` and the regex at `:352` would follow.

#### F4 — P3 · non-blocking (test hardening) — three of my mutants survive

- **K3:** `await modelIoLog.append(...)` on the success path, which makes every tool result wait for the disk write.
  - `modelIoLog.ts:279-282` requires the opposite: 「同步返回，异步落盘 —— 这条在模型调用的热路径上」. No test pins it.
  - Optional: a slow `appendFile` stub would pin it, but that costs more than the property is worth.
- **K7** (F1) and **K9** (F3): pinning them is part of those fixes.
- K23 survives too: `confirmedTool` loses its abort check after approval. That is pre-existing policy code that 205 did not change. My policy probe shows the behaviour is identical `pre` → `wt`.

#### F5 — P3 · non-blocking (data boundary; same as Cowork) — `(threw)` rows keep the raw error, not what the model saw

- **Where:** `hostToolRegistry.ts:86-89` records `err.message` verbatim. The model instead gets `sanitizeRuntimeError(message, 'tool')` plus the NOTE (`hostToolExecution.ts:35-40`). The sanitizer (`errorSanitizer.ts:1-26`):
  - redacts JWT, Bearer and secret JSON fields;
  - collapses an HTML error page to one line;
  - caps the text at 300 characters.
- **Effect:** agent-io can hold credentials the model never saw. `modelIoLog.ts:17-19` describes the log as 「模型真实看到的内容」. The data stays in the local userData.
- **Scope:** Cowork is identical (`hostToolExecution.ts:36-40`, `hostToolRegistry.ts:76-79`), so this matches the contract's 「口径与 Cowork 相同」.
- **Fix:** decide in both repos whether `(threw)` should store the sanitized text, which is also what the model saw. The NOTE would still be missing, as the issue already documents.

### Observations, no finding (same as Cowork, or pre-existing)

- **O1 — tool timeouts.** `BaseAgent.withToolTimeout` sits outside the shell (`BaseAgent.ts:475`, `:536-561`).
  - On a timeout the model gets `ERROR: tool "x" timed out after Ns — …`.
  - Agent-io instead records `x (threw)` with "This operation was aborted", which comes from the tool's own abort.
  - Shown by probe `timeout.mjs`, which uses the real method cut out of `BaseAgent.ts`. Cowork is the same (`BaseAgent.ts:488`, `:546`).
  - This could be added to the issue's 已知残留 (`:35-36`).
- **O2 — one ledger shared by all turns.** `inputBudget` is a process singleton, and up to 4 turns run at once (`turn.service.ts:31`). Each `BaseAgent.prompt` calls `turnStart()` (`:579`), and each `reset()` calls `inputBudget.reset()` (`:751`), both for everyone.
  - Example: chat B starts while chat A is mid-turn. A's `turn_end` then reads `turn #2: 本轮工具结果 2K tok / 2 次`: B's `web_fetch` is counted in it, and A's first `page_snapshot` is not.
  - `inputBudget.ts` is byte-identical to Cowork's, so this predates 205. 「就是真数」 (`:33`) holds only while one turn runs at a time, and the issue could say so.
- **O3 — `delegateMessage`.** It (`service:1594-1606`) runs outside `runInAgentSession`, so its tool rows would land in `unattributed`.
  - BL has no renderer caller for it, only the XPC contract `coach.api.ts:135` and the handler `coach.handler.ts:325-326`.
  - Cowork wraps it (`coworkAgent.service.ts:1497-1502`). This is a pre-existing gap between the repos; fixing it is optional.
- **O4 — measuring inside the `try`.** If measuring itself throws, a successful call is reported as failed.
  - Example: `JSON.stringify` on a circular object. `pre` returns the object; `wt` throws "Converting circular structure to JSON" (probe `circular.mjs`).
  - This is hypothetical in BL: `execute` is typed `Promise<string>`, and every tool typechecks. Cowork is the same.
  - It still goes against 「落盘失败绝不影响回合」 (`modelIoLog.ts:214`). If the code is touched again, measure after the `try`, inside a guard of its own.
- **O5 — volume and retention, checked, not changed.**
  - Each session has one `session.jsonl`. It is never rolled over or truncated, and there is no per-session cap, by design.
  - History is capped at 20 directories or 200 MB, whichever is reached first (`modelIoLog.ts:58`, `:75`). Live buckets are exempt. Pruning runs when a bucket opens and every 8 MB (`:56`, `:210`, `:316-319`).
  - BL's `modelIoLog.ts` differs from Cowork's only in comments. Cowork's own behaviour guard, `check-behavior-model-io-log.mjs`, copied and pointed at BL's file, passes 50/50.
  - Real volume:
    - BL_PREVIEW's pi sessions: 58 tool results, 93 KB in total, the largest 13 KB (a `page_snapshot`).
    - Cowork, which already records: 276 `tool_result` rows, about 1 MB across 20 directories, the largest 33 KB.
  - The 200 MB cap is not a concern. F1 is the retention risk.
- **O6 — the session-io tests are stale.** They have been since the 2026-09-23 one-file change:
  - `maestroSessionIoPath.test.mjs:96` still looks for `part-NNN.jsonl`;
  - `sessionIoInitialization.test.mjs` reads `src/main/agent/coworkAgent.service.ts`, which does not exist in BL.
  - Both fail identically before and after 205, so they give no signal about it. The new test reads `session.jsonl` directly.
- **O7 — a new warning line.** `check-host-tools.mjs` and `builtinWaitTool.test.mjs` now print one `[model-io] 落点未配置 …` line, because the shell appends without a configured root. Exit codes are unchanged. The app configures the root at `app.main.ts:282`.
- **O8 — style.**
  - `hostToolRegistry.ts` has no semicolons, as the lead decided. The overmind `CLAUDE.md` bitterless rules ("Statements end with semicolons") and `.prettierrc.yaml` (`semi: true`) both say otherwise, so the new lines add 13 Prettier `Insert ;` warnings, the same kind as the file's existing 33.
  - `:83` and `:89` are 116 and 134 characters, over the 100-character print width. They are verbatim from Cowork's `:73` / `:79`, which keeps the two files easy to diff, so no action is recommended.

### Not verifiable here — left for Ral's real-session acceptance (issue `:42`)

- In the real Electron app: whether agent-io's `tool_result` count equals the number of tool calls in the pi session, and whether `turn_end` is no longer 0. The probes run the real pi loop and the real modules, but not the app.

## Verification (commands actually run)

| Command | Result |
|---|---|
| Built `snap` (18:22:13), `wt` (rsync at 18:28:43), `pre` (205's hunks reverted, see Scope basis) and `mut` | `diff -rq pre wt` shows exactly the four task paths. `mut == wt` after the mutant run. |
| `TYPECHECK_SURFACES_LIST_ERRORS=1 yarn typecheck` on `pre` and on `wt`, then `sort -u` and `comm` | 93 and 93; `comm` is empty both ways. The only diagnostic in a touched file is `maestroAgent.service.ts(1157,44)` TS2339. It is present in `pre` and outside 205's lines. |
| `node scripts/typecheck/surfaces.mjs main` on `mut`, once with a type error injected at `hostToolRegistry.ts:79` and once with a typo at controller `:938` | The first gives 3 new errors at `:79/:80/:83`; the second gives TS2551 at `(938,36)`. So the surface does check both places. Both files were restored. |
| `node --test --test-timeout=60000 tests/maestro/hostToolResultsRecorded.test.mjs` | `wt`: 9/9. Live tree at 18:53: 9/9. On `pre`: the file fails at load. R0 (only `hostToolRegistry.ts` back to HEAD): 1/9. |
| `suite.mjs`: 14 test files and 4 guards, one process each, `pre` against `wt` | Identical counts and failing names apart from the new test. Normalized logs are identical, except for one extra warning line in `builtinWaitTool` and `check-host-tools` (O7). |
| Same run: results for each file | `settingsMenuManual` 6/6, `builtinWaitTool` 14/14 (+1 skip), `installerHost` 5/5, `piAgentSession` 13/13, `relaySdk` 2/2. |
| Same run: pre-existing failures, identical on `pre` | `sessionIoInitialization` 0/7, `maestroSessionIoPath` 3/6, `maestroConcurrentTurns` 4/18, `maestroContextExport` (fails at load), `maestroChatTabIndependence` 0/8, `maestroQueuedSteering` 0/14, `creator` (fails at load), `requestParity` 1/3. |
| Same run: guards | `check-agent-runtime` exits 1 (2 pre-existing failures), `check-agent-activity` exits 1 (pre-existing), `check-context-graph` exits 1 (pre-existing), `check-host-tools` exits 0. |
| `probe/als.mjs`, `wt` and `pre`: the real pi `AgentSession` with a scripted `streamFn`; the real registry → `bindPiTools` → `executeHostTool`; the real modelIoLog, inputBudget and ALS | `wt`: two chats at once each get their own 2 rows (A's include `probe_boom (threw)`), with 0 in `unattributed`. A session built outside any context lands in its prompt's bucket. `turn_end` shows `本轮工具结果 1K tok / 2 次`. `pre`: 0 rows and `0 tok / 0 次`. |
| `probe/als.mjs` ④ and `probe/evict.mjs 3 / 8`, `wt` and `pre` | `wt`: 3 `workflow_run1_a*` directories, 0 shell rows in the chat bucket, chat ledger 3 calls. 20 old chat directories drop to 17 (3 agents) and to 12 (8 agents). `pre`: 0 directories, 20 stay. |
| `probe/policy.mjs`, `pre` against `wt` | Byte-identical JSON:<br>• `disabled`: the tool is absent.<br>• bypass: the tool runs, `confirm` is never called, and it receives the signal.<br>• `confirm`: allow and deny both behave as before.<br>• Aborted during approval, or already aborted: AbortError, and the tool does not run.<br>• `deferConfirmation`: allow and deny both work, and the tool receives the confirm channel and the signal. |
| `probe/timeout.mjs` (the real `withToolTimeout` from `BaseAgent.ts`, cut out by AST) | The model gets `ERROR: tool "probe_fetch" timed out …`; agent-io gets `probe_fetch (threw)` "This operation was aborted". |
| `probe/circular.mjs`, `pre` / `wt` | `pre` returns the object; `wt` throws "Converting circular structure to JSON". |
| The real `inputBudget`, two interleaved turns | A's line: `turn #2: 本轮工具结果 2K tok / 2 次 · 会话累计 12K tok / 3 次 …` |
| Cowork's `scripts/check-behavior-model-io-log.mjs`, copied to scratch, with `APP` pointed at `wt` | 50 ok, 0 fail. I then removed the three `model-io-bucket-*` directories it leaves in `$TMPDIR`. |
| `mutate.mjs`: 9 mutants on `mut`, each checked to have changed its file, each run against the new test (plus `builtinWaitTool`, `installerHost`, `settingsMenuManual`, `piAgentSession`, `relaySdk` and `check-host-tools` for the registry and workflow mutants), then restored and checked with `cmp` | **5 killed:**<br>• K1, measuring inside the policy layer: 3 tests fail.<br>• K2, only bypass tools measured: 2 tests fail.<br>• K4, `executionMode` dropped: killed by `builtinWaitTool`, not by the new test.<br>• R0, registry back to HEAD: 8/9 fail.<br>• K40, third argument dropped: killed by test 5 only.<br>**4 survived:**<br>• K3, `await` on the append.<br>• K7, workflow tools → `toPolicyTools`.<br>• K9, the copy loses `onWarning`.<br>• K23, abort check removed from `confirmedTool`, which is policy code 205 did not touch. |
| ESLint `--no-cache` on the three source files, `pre` against `wt` | Errors unchanged: service 7, controller 1, registry 0. The registry's new warnings are only Prettier's `Insert ;` (+13) and two re-wraps at `:83` and `:89`. The service goes from 1034 to 1037 Prettier warnings; the controller stays at 987. |
| `git diff --check` on the three tracked files | Clean |
| Counts from on-disk data (read-only; counts only, no content) | BL agent-io: 31 jsonl files, 0 `tool_result`, and BL_PREVIEW at 20 directories. BL_PREVIEW pi sessions: 58 tool results, 93 KB, the largest 13 KB. Cowork `COWORK_TEST_DEBUG` agent-io: 276 rows, about 1 MB, the largest 33 KB, and no workflow directories. |
| `cmp` of the task files, the task and the issue against `snap`, at 18:53:47 and 19:01:17 | Unchanged |

Not run: E2E, Electron, the app itself, `yarn build`, and Cowork's suites. The only Cowork code run was its model-io guard, copied and pointed at BL's file. The real-session check in issue `:42` remains with Ral.
