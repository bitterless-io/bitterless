# `uiact-wait-193` — independent review 2

Date: 2026-09-24. This re-review keeps the constraints of [review 1](uiact-wait-193-1.md): read-only, no source edits, nothing staged or committed, no branch switched, nothing stashed, and no app or E2E started. Every "at HEAD" comparison ran on a `git archive HEAD` export in the session scratch directory. Every "apply" or "probe" ran on scratch copies, never in this working tree.

Contract, as it reads now:

- [feature #1 / #2 / #2.3–#2.5 / #6](../../features/ui-act-wait-hover-jev.md). The #2 table now says the error **starts with** `hover target not located` and is followed by the locator's reason.
- [task](../tasks/uiact-wait-193.md)

The rework claims were relayed by the orchestrator and are checked one by one below. There is also a paired comparison with Cowork `uiact-wait-001`, limited to the conventions the two repos must share; that implementation itself is being reviewed separately.

Reviewed diff, limited to this task with `git diff --`:

- `drive/humanMouse.ts`, `drive/replayEngine.ts`, `drive/requestExec.helper.ts`, `drive/requestExec.service.ts` and `windows/main/maestroWindow.controller.ts`.
- `scripts/maestro/_harness.mjs` and `tests/skillScopes/execution.test.mjs`.
- `src/shared/timerHelper/timer.helper.ts`, which is unchanged since round 1.
- The rewritten `tests/maestro/uiActWaitHover.test.mjs`.
- Also reviewed: the archive at overmind `areas/agent-runtime/browser-use/wait-for-prototype-2026-09-24.patch`.
- Excluded: the same files from other sessions as in round 1, plus the new `builtin-wait-tool` and `download-history` docs, tasks and INDEX entries.

Conclusion: **pass**.

- All three blocking round-1 findings (F1–F3) are resolved. F4 and F6 are fixed.
- F5 is pre-existing and outside 193. F7 was accepted and is unchanged.
- No new blocking finding. Four P3 notes are non-blocking.
- All of the review's code checksums were identical at the start and at the end of the review.

Paired completion still depends on the separate Cowork review.

## Round-1 findings: what the developer claimed, and what was verified

| R1 | Claim | Verified by | Status |
|---|---|---|---|
| F1 (P1) | `wait` / `wait_for` removed. `parseAgentUiActions` returns `AgentUiAction[]` again. `allowed` is HEAD plus `hover`. Result types are back to HEAD. Alone they give "no valid actions"; in a mixed batch they are skipped silently. | No `wait_for`, `waitStep`, `waitForCondition`, `timedOut`, `waitedMs`, `requestedMs` or `until` is left in the five source files. `git diff --numstat`: helper 1/1 (only `allowed` at `:223`) and service 1/1 (only the error text at `:374`). The signature is `): AgentUiAction[] =>` at `:221`. `AgentUiActionResult` is byte-identical to HEAD, and so is `describeUiActionResult`. Tests: `:149-165` (mixed batch skips them; `[wait, wait_for until]` → `[]`) and `:269-277` (alone, including `until`, gives the exact "no valid actions" text and runs nothing). | ✓ resolved |
| F2 (P2) | `'@shared/timerHelper/'` added to `hostAliasPrefixAllowlist`; violations back to 64, same as HEAD. | `_harness.mjs:103-105`. `assertMaestroAliasBoundary()`: HEAD 64, working tree 64, identical sets, zero `timerHelper` lines. All 53 `check-*.mjs`: identical pass/fail (24/53 on both, all pre-existing) and, unlike round 1, **no** output differences at all (`check-embedded-host` included). | ✓ resolved |
| F3 (P2) | The tab_id sentence follows the `snapshot` sentence. | `controller.ts:1854`. Same meaning as #2.5 `:112`. | ✓ resolved (wording nit: N3) |
| F4 (P2) | The skillScopes load map maps timerHelper; failures now match HEAD. | Mapping at `execution.test.mjs:31`. HEAD and working tree both fail 26/26 on `…@main/decision/jevDecision.service`; in round 1, 25 of them failed on timerHelper. Probe on scratch copies with a jevDecision stub: both trees stop at the next pre-existing gap, identically (25 × `@maestro-main/drive/uiActGate` plus 1 × jevDecision). The `replayEngine.ts` load, which needs the new mapping, succeeds before that, so nothing from 193 hides behind the pre-existing failures. | ✓ resolved |
| F5 (P3) | Not in scope. | `uiActSelectorMiss` is still 3/3 `ReferenceError: gateUiActions is not defined`. With a stub gate bound in a scratch copy, the reworked code passes 3/3, so there is no hidden regression. | Unchanged; pre-existing, outside 193. |
| F6 (P3) | The 0×0 hover error is in hover terms; click's text is unchanged. | `replayEngine.ts:318-321`. Test `:197-210` pins the exact text and `doesNotMatch(/click/)`. Test `:228` pins click's `…cannot click by coordinate`. The string-replace coupling to `clickLocator` is therefore guarded by the test. | ✓ resolved (cross-repo text: N1) |
| F7 (P3) | Semicolons. | Unchanged. The new lines still follow each file's local style. | Accepted in R1 |
| Archive | Prototype exported to overmind; `git apply --check` passes. | Present: 40,356 bytes, untracked in overmind and not ignored, so the next overmind sync carries it. The header records source, reason, contract, dependencies and how to apply. It applies to a scratch repo seeded with the **current hover-only files**, as its header says. It does not apply to HEAD, which is expected: it builds on `UiStep` / `locateTarget`. After a scratch `git apply`, its own suites (`uiActWaitFor` + `uiActWaitHover`) pass 19/19. No secret patterns. | ✓ |

## Contract check (current code)

| Contract item | Code | Verdict |
|---|---|---|
| #1 `timerHelper.delay`; negative / NaN → 0 | `timer.helper.ts:7-13`; test `:127` | ✓ |
| #1 local `wait()` → `timerHelper.delay` in both drive files only | `replayEngine.ts:161, 184, 203`; `humanMouse.ts:48, 57, 67`. Page-side `sleep` and `requestExec.service.ts` `:429` / `:652` are untouched, per task `:18-19`. | ✓ |
| #1 allowlist | `_harness.mjs:103-105` | ✓ |
| #2 hover: one `locateTarget` shared with click, `HumanMouse.moveTo`, no press, `ok:true` + `target` | `locateTarget` `:334-360`, `clickStep` `:286-306`, `hoverStep` `:311-330`, routed at `:268`. Tests `:167`, `:212`. | ✓ |
| #2 / #6 not located → `ok:false`, error starting with `hover target not located` followed by the reason, batch stops | `:318-324`; test `:178` (Selector not found, no move, next click not run); test `:197` (0×0) | ✓ |
| #6 parse: `hover` accepted; `wait` / `wait_for` handled as unknown actions | `requestExec.helper.ts:223, 229` | ✓ (see N2) |
| #2.3 BJ3: zero Jev calls for hover | `uiActGate.ts` unchanged. Test `:279-294`: two hovers → 0 calls; hover + click → exactly 1, so the stubbed gate is live. | ✓ |
| #2.4 description, `allowed`, "no valid actions" text | `controller.ts:1852, 1857`; helper `:223`; service `:374`. The example object uses HEAD's alternation notation and still reduces to valid JSON. | ✓ |
| #2.5 hover acts on this call's target tab | Same chain as in R1: scoped wrapper → `withAgentBrowserTarget` → ALS `targetReplay` → per-view `ReplayEngine(view.webContents)`. The rework did not touch it. | ✓ |
| Result shape (task Context: selector-miss issue) | `AgentUiActionResult` identical to HEAD | ✓ |
| Style | Static alias imports. No `forEach`, `import()` or `require` added. `git diff --check` clean. | ✓ |

## Paired conventions vs Cowork `uiact-wait-001` (its uncommitted `dev/next` working tree)

| Convention | bl | Cowork | Verdict |
|---|---|---|---|
| hover error prefix | `hover target not located: <reason>`, bare when there is no reason (`replayEngine.ts:321`) | same (`apps/cowork/src/main/drive/replayEngine.ts:473`) | ✓ same |
| unknown actions, including `wait` / `wait_for` | same `allowed` array (`helper:223`); silent `continue` (`:229`); none left → "no valid actions" | same array (`requestExec.service.ts:662`); same `continue` (`:669`); error text (`:692`) **byte-identical** to bl `:374` | ✓ same |
| tab_id sentence | "Use the same `tab_id` as the page_snapshot you read the refs from (omit it only if that snapshot omitted it too): a ref is valid only on the page whose snapshot produced it …" (`controller.ts:1854`) | "Act on the tab you observed: pass the same tab_id you gave page_snapshot (none if you gave none) — refs only exist on the page they were read from." (`mainWindow.controller.ts:1717`) | ✓ same meaning; wording differs, which is allowed |
| hover description sentence | `controller.ts:1857` | `mainWindow.controller.ts:1716` | ✓ byte-identical |
| BJ3 | `needsJudgement` = click / submit | same | ✓ |
| `locateTarget` | private; shared by click and hover; validates internally and returns `{ok:true, box}` or `{ok:false, …}` | private; already existed (`3c75234`); returns the raw locator value; shared by click, `pointAt` and hover | Same decomposition. The return types differ for historical reasons, which the paired rule allows ("no wholesale refactor of historical differences"). |
| 0×0 reason text | `…; nothing on screen to move the pointer onto` | `…; cannot click by coordinate`, passed through from `clickLocator.inject.ts:57` | ≠ → **N1** |
| `timerHelper` | `ms > 0 ? ms : 0` | `Math.max(0, Number(ms)) \|\| 0` | Equivalent for negative, NaN, `undefined` and `null`. Not byte-identical, and not required to be: `builtin-wait-tool.md` #3 requires only `waitTool.ts` to be byte-identical. Task 197 edits both copies anyway, to add abort support. |

## Findings (round 2)

### N1 — P3 — non-blocking — the 0×0 hover reason now differs between the repos

- Design: the #2 table requires the `hover target not located` prefix followed by the reason, and both repos conform. The paired rule (overmind `CLAUDE.md`, *bitterless + micromeet-cowork — paired development*) says common behaviour stays aligned.
- Code: bl rewrites the `clickLocator` reason at `replayEngine.ts:318`. That rewrite exists because of round-1 F6. Cowork passes the reason through (`replayEngine.ts:473`). This is the only case where the two texts differ.
- Recommendation: mirror bl's one-line `replace` in Cowork, or record the divergence as accepted. The miss text that Cowork's recovery block keys on (`Selector not found`) is unaffected either way.

### N2 — P3 — non-blocking (matches the contract; both repos) — a `wait` inside a mixed batch is dropped silently

- Design: #6 `:208` says to treat `wait` / `wait_for` as unknown actions. Unknown actions have always been skipped silently, at HEAD and in Cowork.
- Risk: in `[click A, {"action":"wait","ms":2000}, click B]`, A and B run 180 ms apart. The result JSON lists only A and B, so the model cannot tell that its pause never happened. Round 1 advertised `{"action":"wait"}`, and the generic `wait` tool is only now arriving (197), so models may still try the action form. The wait tool's own description points (`builtin-wait-tool.md` #2.1) say nothing about `ui_act`.
- Suggestion: the orchestrator decides, for 197 and in both repos. Either add one clause to `ui_act`, such as "there is no wait action — to pause, call the `wait` tool between ui_act calls", or report skipped entries.

### N3 — P3 — non-blocking — the new tab_id sentence overstates one point

- Code: `controller.ts:1854` says "the `snapshot` check cannot catch a ref used on another tab". That is not quite right. `requestExec.service.ts:390-393` does fire when the two tabs' epochs differ (claimed `s3` vs live `s1`), although its message then blames staleness. It misses when the epochs coincide (both `s1`, `debuggerCapture.ts:1389-1394`) or when the target tab has never been observed (`live === ''`).
- Optional wording fix: "cannot reliably catch". Cowork's sentence makes no such claim.

### N4 — P3 — non-blocking (orchestrator's docs) — pointers to the generic `wait` tool go one hop out

- `ui-act-wait-hover-jev.md:25` still says the spec is in browser-downloads #6.
- `:43`, `:55`, `:96`, the INDEX `ui_act` entry and the archive header all cite `browser-downloads.md` #6.7.
- The contract now lives in [`builtin-wait-tool.md`](../../features/builtin-wait-tool.md). #6.7 forwards to it (`browser-downloads.md:299-301`), so every link still resolves. Point them directly at `builtin-wait-tool.md` on the next edit.

### Note for Ral's real-session acceptance (#6) — no finding

`hover` is nothing but `HumanMouse.moveTo`, so on an agent-opened, never-shown tab it inherits the known stall ([background-tab issue](../../issues/ui-act-on-background-tab-stalls-and-click-has-no-effect.md) `:33-35`): about 5 s per `mouseMoved`, which is 145–181 s for one pointer path, and probably without effect. This is out of scope per the feature's 不做什么 (out of scope). But the planned hover-menu acceptance run should use a tab that is actually shown, or its result will say nothing about hover. The fix proposed in that issue (give up on the pointer path if the first `mouseMoved` takes more than about 300 ms) would cover hover automatically.

## Verification (commands actually run)

| Command | Result |
|---|---|
| `node --test tests/maestro/uiActWaitHover.test.mjs` | 8/8 pass |
| `node --test tests/maestro/uiAct*.test.mjs` | 11 tests: 8 pass, 3 fail. All 3 failures are `uiActSelectorMiss` and pre-existing (F5). |
| `uiActSelectorMiss` with a stub gate, on a scratch copy of the reworked files | 3/3 pass |
| `yarn typecheck` | exit 1, with 97 distinct diagnostics |
| `TYPECHECK_SURFACES_LIST_ERRORS=1 node scripts/typecheck/surfaces.mjs`, working tree vs `git archive HEAD` export | 97 = 97. The set difference is empty in both directions. No task file has a diagnostic. |
| `assertMaestroAliasBoundary()`, HEAD export vs working tree | 64 vs 64, identical sets |
| 53 `scripts/maestro/check-*.mjs`, HEAD export vs working tree | Identical outcomes: 24/53 fail on both, all pre-existing. No output differences apart from known environment noise. `check-injected-cursor` ok. |
| `node --test tests/skillScopes/execution.test.mjs`, both trees, plus the jevDecision-stub probe on scratch copies | See F4: identical at every layer. |
| Archive: `git apply --check` / `git apply`, then its two suites, on scratch repos | Applies to the current hover-only state, not to HEAD (expected). 19/19 pass. |
| Cowork comparison | Read-only `git diff`, `grep` and byte comparisons in `projects/micromeet-cowork/apps/cowork` |
| `git diff --check`; trailing whitespace and final newline on the new files; md5 of every reviewed file before and after the review | Clean, and unchanged |

Not run: `yarn build`, E2E, Electron and a real session (repository rule).
