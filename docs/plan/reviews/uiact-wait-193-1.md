# `uiact-wait-193` — independent review 1

Date: 2026-09-24. This is a read-only review by a verifier who did not implement the change. No source was edited, nothing was staged or committed, no branch was switched, nothing was stashed, and no app or E2E was started. Every "at HEAD" comparison below ran on copies made with `git show HEAD:<path>` or `git archive HEAD` into the session scratch directory, never in this working tree.

## Scope basis — the scope changed twice during the review

The brief was the original task: hover, `wait` and `wait_for`, with timeout feedback. While the review was running, the orchestrator relayed two decisions by Ral. Both are now recorded in the feature doc's Request (`:21-29`) and in the rewritten task file:

1. **10:51** — `ui_act` drops `{"action":"wait"}`. Timed waits become the generic built-in `wait` tool (`features/browser-downloads.md` #6.7).
2. **Later the same day** — 「Wait for 先不要保留了，等后面我觉得需要这个东西的时候再做吧」 (drop wait_for for now; do it later if Ral finds he needs it). `wait_for`, including `until`, is deferred.

This review is against the **revised** contract: feature doc #1, #2 (hover only), #2.3–#2.5 and #6 as they read at review time, plus the revised `docs/plan/tasks/uiact-wait-193.md`. The code was written against the original scope, so everything it has for `wait` / `wait_for` now falls outside the contract (F1). The rest of the original checklist is reviewed as briefed: timerHelper, hover, BJ3, target tab and the alias allowlist.

Contract:

- [feature #1 / #2 / #2.3–#2.5 / #6](../../features/ui-act-wait-hover-jev.md)
- [task](../tasks/uiact-wait-193.md)

Reviewed diff, limited to this task with `git diff --`:

- `drive/humanMouse.ts`, `drive/replayEngine.ts`, `drive/requestExec.helper.ts`, `drive/requestExec.service.ts` and `windows/main/maestroWindow.controller.ts`.
- The new files `src/shared/timerHelper/timer.helper.ts` and `tests/maestro/uiActWaitHover.test.mjs`.
- Also read: `drive/uiActGate.ts` and `scripts/maestro/_harness.mjs` (both unchanged), and the `docs/INDEX.md` entry.
- Excluded as other sessions' work: Control `MessageList` / `message.store`, the branding test, the deleted icons, the scroll-to-bottom issue and its test, and `download-history-196`.

Conclusion: **blocked**. Three findings are blocking:

- **F1** — `wait` and `wait_for` are still parsed, executed, described and tested. The revised contract removes both.
- **F2** — `@shared/timerHelper/` is not in `hostAliasPrefixAllowlist`, so the Maestro alias guard gains two violations.
- **F3** — the `ui_act` description lacks the #2.5 sentence "pass the same `tab_id` as the snapshot you read".

What stays in scope is implemented correctly:

- timerHelper;
- hover, including the extraction of `locateTarget`;
- zero Jev calls in BJ3;
- target-tab routing.

No stub, mock or fake is on a production path, and no changed file adds a typecheck diagnostic. F4–F7 are non-blocking.

## Contract check

| Revised contract item | Code | Verdict |
|---|---|---|
| #1 `timerHelper = { delay }` in `src/shared/timerHelper/timer.helper.ts`, written with async/await; negative / NaN → 0 | `timer.helper.ts:7-13` | ✓ `ms > 0 ? ms : 0` maps NaN to 0. The doc snippet's `Math.max(0, ms)` would pass NaN through, so the code follows the bullet at `:73` rather than the snippet. Covered by test `uiActWaitHover.test.mjs:145`. |
| #1 local `wait()` in `replayEngine.ts` / `humanMouse.ts` → `timerHelper.delay`; no other file's sleep and no page-side sleep touched | `replayEngine.ts:184, 214, 233`; `humanMouse.ts:48, 57, 67`. Untouched: `requestExec.service.ts:430, 653` and the in-page `sleep` in `clickLocator` / `browserStepRunner` | ✓ Neither file has a `wait(` left. |
| #1 `'@shared/timerHelper/'` added to `hostAliasPrefixAllowlist` | `scripts/maestro/_harness.mjs:93-103`, unchanged | ✗ **F2** |
| #2 hover: `clickLocator` evaluation extracted into a private `locateTarget` shared by click and hover; `HumanMouse.moveTo`; no press; `ok:true` + `target` | `locateTarget` `replayEngine.ts:362-388`. Click `:316-336`: behaviour unchanged, same box and same fallback error. Hover `:341-358`, routed at `:298`. `humanMouse.ts:33-51` sends only `mouseMoved` with `buttons: 0`. | ✓ |
| #2 / #6 not located → `ok:false`, error starting with `hover target not located`, batch stops | `replayEngine.ts:346-352`; `runUiActions` breaks on `!ok` (`:213`) | ✓ (wording nit: F6) |
| #6 parse: `hover` accepted; `wait` / `wait_for` treated as unknown actions | `requestExec.helper.ts:227-272` accepts both | ✗ **F1** |
| #2.3 BJ3 makes zero Jev calls for hover | `uiActGate.ts:40-41, 93-94`, unchanged: only click / submit reach `describeUiAction` / `jevJudge` | ✓ Code, plus test `:446` (`jevCalls.length === 0`) |
| #2.4 description gains hover's parameters; `allowed` and the "no valid actions" text stay in sync | `maestroWindow.controller.ts:1852, 1856`; `requestExec.helper.ts:227`; `requestExec.service.ts:375` | The hover part is ✓. The wait / wait_for text is ✗ **F1**. |
| #2.5 hover acts on this call's target tab, never the foreground tab | The chain is: `controller.ts:1912-1927` → `withAgentBrowserTarget` `:392-426` → `requestExec.withBrowserTarget` `:118-120` → `targetReplay` `:122-132` (validated ALS store) → per-view `new ReplayEngine(view.webContents)` (`maestroBrowserView.service.ts:800`). `HumanMouse` is bound to that same `wc`. | ✓ |
| #2.5 the description says "use the same `tab_id` as the snapshot" | Not in `controller.ts:1850-1860`, and not in the wrapper suffix `:1916` | ✗ **F3** |
| Injected scripts keep the existing injection form, and nothing keepNames-wrapped reaches the page | Hover adds no injected script. `locateTarget` evaluates the same `(${clickLocator})(${JSON.stringify(step)}, ${deepFindElement})` that `clickStep` already used. | ✓ See Verification for the keepNames evidence. |
| Style: const arrows, `for…of` rather than `forEach`, static top-of-file alias imports | The new imports at `replayEngine.ts:3, 6` and `humanMouse.ts:15` are static aliases. No `forEach`, dynamic `import()` or `require` was added. Class methods stay method shorthand. | ✓ (semicolons: F7) |

## Findings

### F1 — P1 — blocking — `wait` and `wait_for` are still implemented, described and tested, but the revised contract drops both

- Design doc:
  - Request `:21-29`: both 改定 (revisions), marked 「以此为准」 (this one governs).
  - 不做什么 (out of scope) `:55`.
  - #2 `:82`: `hover` is the only new action.
  - #2.1 / #2.2: struck out.
  - #6 `:208`: 「`wait` / `wait_for` 不再被接受(当作不认识的动作)」 (no longer accepted; treated as unknown actions).
- Task `:23`: "Both are unknown actions to the parser. Remove any code/tests/description already written for them."
- Why P1: shipped as is, `ui_act` would still expose `wait`, capped at 10 s, alongside the generic built-in `wait` tool being built in `download-history-196` (browser-downloads #6.7, capped at 60 s). The agent would get two ways to wait with two different limits. It would also expose `wait_for`, which Ral has explicitly deferred.

What to remove or revert. All of it comes from this change.

| File | Remove / revert |
|---|---|
| `requestExec.helper.ts` | In `allowed` (`:227`), remove `'wait'` and `'wait_for'`. Remove the caps (`:228-231`), the wait branch (`:238-243`) and the wait_for branch (`:250-272`); the last includes the `until` refusal at `:255` and the `state` refusal at `:258`. The return shape `{ actions, error? }` (`:225, 281`) no longer has anything that produces `error`, so revert it to `AgentUiAction[]`. In `describeUiActionResult` (`:284-295`), revert the optional `selector` and the `text` / `waitedMs` fallbacks. |
| `requestExec.service.ts` | At `:372-373`, go back to `const actions = parseAgentUiActions(parsed)`. At `:375`, keep `hover` in the action list and drop the `wait` / `wait_for` alternatives; per task `:25`, keep any example JSON valid. |
| `replayEngine.ts` | On `AgentUiAction`: drop `'wait' \| 'wait_for'` (`:56`), the fields `ms`, `text`, `state`, `timeoutMs` and `requestedMs`, and the `''` note on `selector` (`:57-70`). On `AgentUiActionResult` (`:76-89`): make `selector` required again and drop `text`, `timedOut`, `waitedMs` and `note`. That restores the result shape that `issues/ui-act-selector-miss-diagnosis.md` says to keep (task Context). Also drop: the doc sentence at `:193-194`, the branches at `:200-201`, `waitStep` / `waitForStep` (`:390-444`), and the injected `waitForCondition` (`:792-807`). |
| `maestroWindow.controller.ts` | Drop the wait, wait_for and loading/timeout sentences (`:1857-1859`). |
| `tests/maestro/uiActWaitHover.test.mjs` | Delete `:227-347` (every `wait_for` / `wait` test) and `:467-495` (timeout as JSON). Rewrite `:167-225` as "hover accepted; `wait` / `wait_for` dropped as unknown". `:360-375` uses `{action:'wait'}` as the follow-up action; use a click instead. In `:431-444`, drop the wait_for refusals and keep the "no valid actions" assertion. Reduce `:446-465` to hover only. In the harness at `:65-66`, drop `waitForCondition`, `waitStep` and `waitForStep`. |

Keep: `timerHelper`, `hover`, `locateTarget`, `UiStep`, the `Box` import, and the three `timerHelper.delay` replacements in `replayEngine.ts`. Those belong to #1, not to wait.

For the record, the removed `wait_for` matched the contract it was written against. It polled every 120 ms through `deepFindElement` and applied the visibility rule. It matched text after normalising whitespace, without regard to case. It returned the #2.2 timeout error verbatim, stopped the batch, and produced plain JSON with no `ERROR:` prefix. Its tests passed. **This code exists only in the uncommitted working tree.** If Ral may want `wait_for` later, save the diff before deleting it.

### F2 — P2 — blocking — `@shared/timerHelper/` is missing from `hostAliasPrefixAllowlist`

- Design doc #1 `:74-76`: 在 `hostAliasPrefixAllowlist` 加 `'@shared/timerHelper/'` (add it to the allowlist). Task `:41` also lists `scripts/maestro/_harness.mjs` among the paths.
- Code: the new imports are at `replayEngine.ts:6` and `humanMouse.ts:15`. `scripts/maestro/_harness.mjs:93-103` is unchanged.
- Evidence, from running `assertMaestroAliasBoundary()` directly:
  - **HEAD: 64 violations.** The guard was already red before this task, and none of those 64 come from it.
  - **Working tree: 66.** The only two new ones are `main/drive/humanMouse.ts` and `main/drive/replayEngine.ts: forbidden host alias @shared/timerHelper/timer.helper`.
  - `check-embedded-host.mjs` output differs from HEAD by exactly those two lines.
  - Because the guard was already red for 64 other reasons, nothing turns newly red, which is how this can slip through unnoticed. `humanMouse.ts:8-10` records that the same guard once forced the algorithm helper back into the Maestro tree.
- Fix: add `'@shared/timerHelper/'` to `hostAliasPrefixAllowlist` next to the i18n / theme prefixes, with a one-line reason: it is a cross-cutting utility.

### F3 — P2 — blocking — the `ui_act` description lacks the #2.5 sentence "pass the same `tab_id` as the snapshot"

- Design doc #2.5 `:112`: 工具说明里写明一句：用哪个 tab 拍的快照，就带同一个 `tab_id`(ref 只在拍它的那个页面里有效). That is: the description must say to pass the `tab_id` of the tab whose snapshot you read, because a ref is valid only on that page. Task `:25` asks for the same: add "use the same tab_id as the snapshot you read".
- Code: neither the base description (`controller.ts:1850-1860`) nor the scoped wrapper suffix (`:1916`, "Targeting: omitted tab_id uses this chat's selected operation tab…") says that a ref is valid only on the page whose snapshot produced it.
- Why it matters: the `snapshot` epoch check does not cover this case.
  - An agent can read `page_snapshot tab_id=X`, then hover or click `e5` without passing `tab_id`. That action runs on the default target tab.
  - Epochs are per-document counters that start at `s1` (`debuggerCapture.ts:1389-1394`). Two tabs that have each been observed once both report `s1`.
  - So the check passes, and `e5` lands on whatever `e5` is on the other page.

### F4 — P2 — non-blocking — the `tests/skillScopes/execution.test.mjs` fixture now also trips on the new import

- Design doc: not covered (test infrastructure).
- Code:
  - The loader at `tests/skillScopes/execution.test.mjs:12-22` throws on any import it has no mapping for.
  - `:31` loads `replayEngine.ts` with only `./humanMouse` mapped.
  - So the new value import `@shared/timerHelper/timer.helper` (`replayEngine.ts:6`) throws.
- Evidence:
  - **HEAD:** 26/26 fail, all with `Unexpected fixture dependency: @main/decision/jevDecision.service`. That failure is pre-existing and comes in through `skillScript.ts`.
  - **Working tree:** 26/26 fail. 25 now stop earlier, on `…@shared/timerHelper/timer.helper`; 1 still stops on jevDecision.
  - The pass/fail set is identical. But once someone fixes the jevDecision mapping, 25 institution-scope and logout guards ("second UI side effect is blocked…") will stay red because of this change.
- Fix: add one entry to that `load` map. Either `'@shared/timerHelper/timer.helper': load('shared/timerHelper/timer.helper.ts')`, or a no-op `delay` stub.

### F5 — P3 — non-blocking, pre-existing — `uiActSelectorMiss.test.mjs` fails 3/3 for a reason unrelated to this change

- Task Verification `:48` asks: "Existing `tests/maestro/uiAct*.test.mjs` still pass (report pre-existing failures separately)." This finding is that separate report.
- Code: `tests/maestro/uiActSelectorMiss.test.mjs:26` compiles `toolUiAct` without binding `gateUiActions`. The BJ3 commit added that call (`requestExec.service.ts:398`, `:397` at HEAD).
- Evidence:
  - The test fails identically on HEAD copies of the four files it reads: `ReferenceError: gateUiActions is not defined`, 3/3.
  - With a pass-through gate bound (in scratch copies only), it passes 3/3 on both HEAD and the working tree. So the ReferenceError is not hiding a second regression from this change.
  - The "passed 3/3" line in `issues/ui-act-selector-miss-diagnosis.md` has been stale since BJ3 landed.
- Suggestion: fix the fixture with a one-line change, outside 193.

### F6 — P3 — non-blocking — the hover failure text says "click" in the 0×0 case

- Design doc: #6 `:209` and task `:21` require the error to start with `hover target not located`, and it does. The #2 table (`:87`) still shows the bare literal string. Changing that cell to match #6 (以 … 开头, "starts with …") would stop Cowork from implementing a different string.
- Code: `replayEngine.ts:349` appends the reason from `clickLocator`. For a zero-size box that reason is `element has no box (0x0); cannot click by coordinate` (`:767`), so hover reports "…cannot click by coordinate". Cosmetic only.

### F7 — P3 — non-blocking — semicolons

- The task (`:8`) and the doc (`:7`) say "semicolons", and `.prettierrc.yaml` sets `semi: true`.
- The touched Maestro files are semicolon-free throughout. The new lines follow each file's local style: none of the added lines ends in `;`. The new `timer.helper.ts` does use semicolons.
- Matching local style is correct under the workspace rule for surgical changes. No change is requested; this is recorded so the task's style line is not read as violated.

## Verification (commands actually run)

| Command | Result |
|---|---|
| `node --test tests/maestro/uiActWaitHover.test.mjs` | 16/16 pass, including the tests that F1 removes. |
| `node --test tests/maestro/uiAct*.test.mjs` | 19 tests: 16 pass, 3 fail. All 3 failures are `uiActSelectorMiss` and pre-existing (F5). |
| `uiActSelectorMiss.test.mjs` on HEAD copies: `git show HEAD:…` of the test, `requestExec.service.ts`, `requestExec.helper.ts` and `traceTimeline.ts`, copied into scratch | 3/3 fail with the same ReferenceError. With a stub gate bound, 3/3 pass on both HEAD and the working tree. |
| `yarn typecheck` | 97 distinct diagnostics. None is in a changed or new file. |
| `TYPECHECK_SURFACES_LIST_ERRORS=1 node scripts/typecheck/surfaces.mjs`, in the working tree and in a `git archive HEAD` export | 97 = 97, and the set difference is empty in both directions, so the developer's "all pre-existing" claim holds. The only consumer of the changed exports, `skillScript.ts`, has 4 diagnostics at `:188` (`SkillApiSafetyDecision \| void`). They are pre-existing and unrelated. |
| `assertMaestroAliasBoundary()`, HEAD export vs working tree | 64 vs 66 violations. The two new lines are F2. |
| All 53 `scripts/maestro/check-*.mjs`, HEAD export vs working tree | Identical pass/fail: 24 fail on both, all pre-existing. The only difference in output is the two F2 lines in `check-embedded-host`. `check-injected-cursor` passes. |
| `node --test tests/skillScopes/execution.test.mjs`, HEAD export vs working tree | 26/26 fail on both. The causes are in F4. |
| `node --test tests/maestro/maestroAgentBrowserSession.test.mjs`, HEAD export vs working tree | File-level failure `Dynamic require of "fs" is not supported` on both. Pre-existing and unrelated. |
| `git diff --check` on the task files; trailing-whitespace and final-newline check on the new files | Clean. |

- **keepNames:**
  - The main `esbuild` block in `electron.vite.config.ts` sets only `tsconfigRaw`, and the word `keepNames` appears nowhere in the file.
  - The built `out/main/app.main.js` (2026-09-23) contains no `__name(` calls.
  - So `String(fn)` injection is safe in bl, and hover injects nothing new.
  - Pre-existing and outside this diff: `inject/mouseOverlay.inject.ts:7` says bl has not enabled keepNames (「bl 没有开 keepNames」), while `:15` says main has `keepNames: true` (「main 开着 keepNames: true」). The config supports `:7`.
- **Build resolution:** the main build aliases `@shared` to `src/shared`, and other main-process code already imports values from `@shared/*`. `yarn build` was not run.
- **Not run:** E2E, Electron, and a real session (repository rule).
- **Paired side:** `micromeet-cowork` (`dev/next`) has no `hoverStep`, `locateTarget` or `timerHelper` yet; its task `uiact-wait-001` has status ready. The feature doc's 「与 Cowork 形状一致」 (same shape as Cowork) could not be compared. The common work is not complete until that side lands.
- **After the fixes, re-check:**
  - the trimmed `uiActWaitHover` suite and `uiAct*`;
  - `yarn typecheck`, with 0 diagnostics in changed files;
  - the alias guard, which should return to the 64 pre-existing lines with no `timerHelper` entry;
  - `ui_act` with `[{"action":"wait"}]`, which should now return "no valid actions".
