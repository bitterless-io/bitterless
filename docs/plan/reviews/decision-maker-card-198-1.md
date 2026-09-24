# `decision-maker-card-198` — independent review 1

Date: 2026-09-24. This is a read-only review by a verifier who did not implement the change. No source was edited, nothing was staged or committed, no branch or worktree was switched or created, nothing was stashed, and no app, Electron or E2E was started. `tests/onlypreview/controlLoginPreviewWorkspace.test.mjs` was not run. This file is the only one written in the repository; everything else ran on copies in the session scratch directory.

## Scope basis

Four scratch trees, HEAD `883824e8`:

- **`head`** — a `git archive HEAD` export.
- **`wt`** — a copy of the working tree taken at 15:09. That is the 198 state the developer handed over.
- **`base`** — `head` plus the two prerequisites that 198 builds on: `depends-on: [builtin-wait-197]`, and 197 depends on `uiact-wait-193`. Both are `status: done` but uncommitted.
  - A literal "HEAD + this task only" does not compile, because `locateTargetBox` calls 193's `locateTarget`.
  - 193's `uiActWaitHover.test.mjs` exists only in the form 198 left it. Its two 198 hunks were reverted by hand: the gate declaration list, and the `readText` stub that 198 turned into `readLabel`. The reconstruction passes 8/8, the same figure the 197 review reported.
- **`task`** — `base` plus this task's changes and nothing else. In the files shared with other work, only 198's hunks were applied:
  - `replayEngine.ts`: the `webContents` getter, `readLabel` and `locateTargetBox`;
  - `requestExec.service.ts`: the import and the gate context;
  - `message.store.ts`: one comment line;
  - `MessageItem.less`: the `act` tag;
  - the two test fixtures.
- **Checks on the mirrors.** `diff -r base task` lists 24 files, all of them 198's. `diff -r task wt` lists only other sessions' files.

**Attribution after 15:09.** Decision-helper-199 then edited `uiActGate.ts`, `jevDecision.service.ts`, `snapshotSegment.ts`, `skillScript.ts`, `uiActWaitHover.test.mjs`, and two lines of `decisionMakerCard.test.mjs`. The coordinator confirmed that attribution:

- The two lines are the `JevHandler` allowlist entry and its comment. They were removed because 199 renamed that handler, and the test's own rule deletes entries that no longer match anything.
- None of these edits is reviewed here. Line numbers below refer to the 15:09 state.
- At 16:00, every 198-only file was still byte-identical to the snapshot.

Task: [decision-maker-card-198](../tasks/decision-maker-card-198.md).

Contract: the [feature](../../features/decision-maker-naming-and-approval-card.md) #1–#5, as it read at 15:13. Apart from the pairing line it is byte-identical to Cowork's copy. It was amended during the review, and none of the amendments changes what BL has to do:

- **#2 `:27`, `:32`.** Failure messages no longer go into the card's reason. The segment note also carries only the type and status; the lead accepted that choice, which was made in BL first.
- **#3 `:49-54`.** Ral's 「1A 2A」:
  - The session-list confirm dot becomes the text 「待确认」 / `To confirm`. That is [task 202](../tasks/decision-maker-card-202.md), which waits for this review.
  - "Stalled" stays amber.
- **#4.1 `:72`.** Accepted as a known limitation: after the gate gives up waiting, the in-page locator may still scroll the page once.
- **#4.1 `:77`.** The decision input and the ERROR carry the label or the selector. BL has no ACP request.
- **#5 `:86`.** The human look adds a case: on an agent tab that has never been shown, the card must have no image, not a blank one.

Also: the [issue](../../issues/approval-card-shows-selector-instead-of-button-text.md), and the BL rules from the bitterless section of overmind `CLAUDE.md` (TS style, flat BEM, Less, `i18nHelper`, borderless UI).

Reviewed (task-only mirror, lines added / removed):

- **Main process.**
  - `capture/debuggerCapture.ts` (+51/−31), `drive/replayEngine.ts` (+67/−0) and `drive/requestExec.service.ts` (+19/−2).
  - `drive/uiActGate.ts` (+95/−15), `decision/jevDecision.service.ts` (+42/−6), `drive/snapshotSegment.ts` (+4/−2) and `shared/agentDecision.api.ts` (+7).
- **Control renderer.**
  - `task/`: `ChatConfirm.less` (+15/−10), `ChatConfirmSheet.less` (+19/−11), `DecisionRecord.less` (+25/−2), `DecisionRecord.vue` (+9), `DecisionSheet.less` (+14), `DecisionSheet.vue` (+10) and `TaskPart.less` (+4/−1).
  - `ResponseStatus.less` (+6/−4), `ChatPanel.less` (+4/−3) and `WorkflowTaskBar.less` (+4/−1).
  - Comment-only: `ResponseStatus.vue` and `ChatPanel.vue`.
  - `MessageItem.less` (the `act` tag only) and `store/message.store.ts` (one comment only).
- **Tests.**
  - `tests/maestro/decisionMakerCard.test.mjs`: new, 1478 lines, 29 tests.
  - `uiActWaitHover.test.mjs` (+4/−2) and `skillScopes/execution.test.mjs` (+1).

Not reviewed:

- the 193 and 197 hunks in the same files;
- the other sessions' `MessageItem.less` gap and footer, `MessageItem.vue`, the `message.store.ts` scroll code, `message.type.ts`, `turn.service.ts`, `MessageList.*`, `IconBtn.less`, `MenuBar.*`, the Workbench About view and the deleted icons;
- all of 199's work.

## Conclusion

**pass.**

- **Blocking: none.**
- **Non-blocking: F1–F7, all P3.**
  - F1 and F2 each need one line from the lead in #4.1: a choice of behaviour for both repos, and a note on where BL puts the image.
  - F3 is for the #5 human look.
  - F4–F7 are small follow-ups. F4 is in the area that decision-helper-199 is migrating.

What conforms:

- Contract items #1–#4.1 are implemented as written, apart from the two points above.
- The #5 unit tests and the source guard exist. They fail without the change, and a mutation run kills 20 of 22 mutants; F6 covers the two survivors.
- Every claim in the developer's report checked out; see §2.
- Against `base`, the task-only mirror introduces no regression in any check I ran: 150 test files, 54 guards, typecheck, ESLint errors and the i18n check.
- The recording thumbnail sends byte-identical CDP parameters.
- The screenshot acts only on the tab bound to this call.

## 1. Contract check

| Contract item | Code (15:09 state) | Verdict |
|---|---|---|
| #1 / #2 No Jev in the session except Settings | A probe over all of `src` with **no** allowlist finds 12 hits. **Identifiers:** `jev-latest` (the relay's `model`, request body only), `JevHandler` (the xpc channel name), `jev-enabled` (the config key). **Settings → Decision:** four texts, `jevLabel` / `jevHint` × en / zh; the contract's 「三处」 is Cowork's count. **Also:** identifiers in the `DecisionSetting.vue` template, and one base64 false positive in the drawio vendor file. HEAD has 20 hits; the 8 extra are exactly the strings this task changed. No tool description, prompt or `skills/` file mentions Jev. | ✓ |
| #2 BL reasons | `uiActGate.ts:190-195`: `The decision maker could not judge it (<reason>[ <status>])`, `… was not confident enough (<c>)`, `… classified it as irreversible (<c>)` | ✓ |
| #2 Failure messages | `jevDecision.service.ts:84`, `:97`, `:151` match the contract word for word. For http, invalid and network failures the raw text goes only to `console.warn` (`:64-69`, `:125`, `:135`, `:153`). The main-process console writes to the log file (`logging/log.setup.ts:78`). | ✓ |
| #2 Segment notes | `snapshotSegment.ts:127-128`: `not segmented (decision maker <reason>[ <status>])` and `… picked none` | ✓ (contract `:32`) |
| #2 Guard keyed by file + location + value; `src/shared` and i18n scanned; no dead entry | Test `:1308-1350`: 7 entries; roots `src/main`, `src/shared`, the control renderer and `src/renderer/common/i18n`. An entry that matches nothing fails (`:1422`). Self-check at `:1457`. | ✓ |
| #3 The three cards: theme blue, no border, answered at 70 %, expired state unchanged | **`ChatConfirm.less`** `:10-16`, `:27-33`. **`ChatConfirmSheet.less`** `:4`, `:13`, `:31`, `:39-42`. **`DecisionRecord.less`** `:21`, `:31`, `:42`. **Compiled** with less 4.5.1: the only border declarations left in the three files are `border: 0`, and no `--warning-*` remains. The expired rules are byte-identical; test `:1033` pins them. | ✓ |
| #3 Bare `<button>`s declare `border: 0` | Sheet cancel `:39` and confirm `:41`; payload toggle `:14` already did. DecisionSheet's buttons already had `border: 0`. | ✓ |
| #3 Ral 已定 ①: the unsourced mark is theme blue | `ChatConfirmSheet.less:31`, primary-6 | ✓ (its comment has drifted: F5) |
| #3 Ral 已定 ②: every other "waiting on you" accent | **Status row:** dot and text, plus the background-agents row (`ResponseStatus.less:44-47`, `:59-71`). **Header:** count and dots (`ChatPanel.less:454-468`). **TaskPart hint:** border dropped (`TaskPart.less:31`). **`act` tag:** `MessageItem.less:135`. **Workflow "Waiting for you":** `WorkflowTaskBar.less:60-63`. **Amber left** in the control renderer: TaskPart "stalled" (Ral 「2A」); workflow `waiting` ("Waiting for tool") and `retrying`; the record view's HTTP 4xx chips, action kind and flags; a ContextGraph node colour. None of these is a "waiting on you" state. | ✓ (F3 for the human look) |
| #3 `name` attributes and BEM classes unchanged | Nothing removed from the 4 touched `.vue` files, the 5 untouched components those styles serve, or the 9 touched `.less` files. Added only `decision-record__image` with `name="maestro__decision_record__image"`, `decision-sheet__image` with `name="decision-sheet__image"`, and the `.decision-record--answered` rule. | ✓ |
| #4 Label order: aria-label → visible text → value → title, 120 chars; `readText` unchanged | `replayEngine.ts:254-260` finds the element with the click's `deepFindElement`. `readText` (`:236-242`, with its comment) hashes to sha256 `fe5f9251…` in HEAD, `task` and `wt`. | ✓ (test gap: F6) |
| #4.1 Same locate as the click; one shared `captureElementShot`; `false` on this path | **Locate:** `locateTargetBox` `:275-300` calls 193's `locateTarget` (`:401`). **Crop:** `captureElementShot` is exported at `debuggerCapture.ts:294-321`. **Gate:** it is called at `requestExec.service.ts:404-414` with `beyondViewport: false`. | ✓ |
| #4.1 Max edge 240, JPEG 60 | `scale = min(1, 240 / (longest CSS edge × DPR))`. Probe: 140×30 CSS at DPR 2 → 240×51, 1.4 KB. | ✓ |
| #4.1 At most 2 s; fail-open; a late shot never runs | `uiActGate.ts:48-49` and `:120-144` abort at 2 s; `requestExec.service.ts:408` checks the signal. Tests `:545` and `:885`. | ✓ |
| #4.1 No box → no image (0×0, off screen, viewport unreadable) | `replayEngine.ts:280` and `:288-293` | ✓, but a partly visible target differs from Cowork: F1 |
| #4.1 Shot only when asking; never sent to the decision maker or the model | **When:** only at `uiActGate.ts:198`, after the judgement (`:167`) and after the `off` and not-irreversible exits. **Judge input:** only `page_url` and `pending_action`. **Model:** the ERROR (`:218`) is text only. `ask_user` rebuilds questions field by field (`decisionRegistry.service.ts:88-112`), and decision cards are `custom` entries, never in the prompt (`messageClass.ts:34-36`). Test `:914`. | ✓ |
| #4.1 Shown on the card and the sheet, and after Answered | `DecisionRecord.vue:65-71` (no condition on Answered) and `DecisionSheet.vue:114-120`. The control CSP allows `img-src 'self' data:`. | ✓; placement: F2 |
| #4.1 Fit within 120×120, keep proportions, never enlarge | `DecisionRecord.less:68-76`; `DecisionSheet.less:39-47` adds `align-self: flex-start`. Rendered in real Chromium, both components: 240×51 → 120×25.5, 51×240 → 25.5×120, 40×20 → 40×20, 240×240 → 120×120, 600×200 → 120×40. | ✓ |
| #4.1 Text rule | `uiActGate.ts:52-55`, `:80-95`, `:200`. **Label found:** it wins. **No label, image:** `click this element` / `submit this form`. **Neither:** the selector. The judge input and the ERROR always carry the label or the selector. | ✓ |
| #5 typecheck and i18n check; no E2E | See Verification | ✓ |

## 2. The developer's claims

| Claim | Verified |
|---|---|
| `captureElementShot(wc, {rect, maxEdge?, devicePixelRatio?, beyondViewport?})` is exported; the recording path is unchanged (640×480, scale 1, `true`) | ✓ `recording-parity.mjs` compares HEAD's private method with the export over 10 rects × 3 replies. The CDP method, the params as JSON text (so key order counts) and the return values are identical in all 30 cases: `{"format":"jpeg","quality":60,"clip":{"x":5,"y":6,"width":640,"height":480,"scale":1},"captureBeyondViewport":true,"fromSurface":true}`. The call site passes only `{ rect }` (`:800`), behind the unchanged `shouldShoot()` gate. |
| `replayEngine.ts` only adds `webContents`, `readLabel` and `locateTargetBox`; `readText` unchanged | ✓ base → task is +67/−0; `readText` hash identical |
| Gate: `readLabel`; `{text, shown}`; "The decision maker …"; 2 s abort; image on `questions[0].image` | ✓ |
| `shootTarget` passes `false`, checks the signal, and acts on the bound `targetReplay`, never the foreground engine or `activeTabId` | ✓ **Binding:** `targetReplay` (`requestExec.service.ts:122-132`) resolves the AsyncLocalStorage target that `withBrowserTarget` sets (`:118-120`). The scoped `ui_act` wrapper always enters it (`maestroWindow.controller.ts:1924`), and the engine's `webContents` is that tab's view. **Fallback:** with no stored target the getter falls back to `_state.replayEngine`, but then so does the click, so the shot and the click always use the same engine. **Test:** `:829` fails on any read of the foreground engine or of `activeTabId`. |
| `jevDecision` wording; raw text only through `console.warn` | ✓ Test `:241` checks both warn lines |
| Segment note: type and status only | ✓ The contract now says so (`:32`) |
| Optional `image` on `AgentDecisionQuestion` | ✓ `agentDecision.api.ts:37-43` |
| The three `.less` files use `--primary-*` and have no border | ✓ |
| Image in DecisionRecord / DecisionSheet, 120×120 | ✓, including the real-browser render |
| Other "waiting on you" accents changed; deliberate amber kept | ✓ See the #3 rows |
| 29 tests; fixtures in `uiActWaitHover` and `execution` | ✓ 29/29 on `task` and `wt`. Red without the change: on HEAD and on `base`, 23 of 29 fail. The six that pass are the `readText` pin, the structure pin, the guard's self-check, and three cases that already hold at HEAD. |
| Guard: 7 entries, keyed by file + declaration path + value; scanned roots | ✓ |
| Pre-existing: `uiActSelectorMiss` 0/3 | ✓ On HEAD, `base` and `task`: `gateUiActions is not defined`. With a pass-through gate bound, all three trees pass 3/3, so the failure hides nothing from 198. |
| Pre-existing: `skillScopes/execution` 0/26, since `6bf96d09` | ✓ **All three trees:** `Unexpected fixture dependency: @main/decision/jevDecision.service`; `git log -S` dates that import to `6bf96d09`. **Probe:** with the three pre-existing gaps stubbed (jevDecision ×2, `snapshotSegment`, `uiActGate`), `base` and `task` both pass 25/26 and stop at the same next gap (`documentReader.service`). The new `debuggerCapture` mapping is exercised there and is sufficient. |
| Pre-existing: `confirmCardSurvivesRestart` 7/8 | ✓ The same assertion fails in all three trees (the `!answer` gate) |
| Pre-existing: `yarn check:renderer-i18n` exits 1 | ✓ All four trees stop at the same first assertion. Run to completion with soft asserts, HEAD and `task` have the same three failures: `maestroControl` ×2 and `maestroTabAlias` ×1. |
| typecheck: 96 before and after, same set | ✓ HEAD 97, `base` 96, `task` 96, `wt` 96; `base`, `task` and `wt` have identical sets; 0 diagnostics in 198's files |

## 3. Differences from the Cowork implementation

| Difference | Verdict |
|---|---|
| The gate asks through `agentDecisionRegistry`; the image rides on the question and shows in DecisionRecord / DecisionSheet | **Acceptable.** BL's BJ3 has asked this way since it landed. BL's `ChatConfirm` / `ChatConfirmSheet` are the task approvals, which have no image source; they got the colour change only. #4.1's 「带到哪」 row names only Cowork's components (F2). |
| The image comes after the one-paragraph question | A contract deviation, but explained: F2 |
| At most 2 parameters, so the signatures differ | **Acceptable** (BL rule) |
| Cancel button primary-2 / primary-3; TaskPart hint primary-2 | **Acceptable:** same blue family, no border. Primary-1 (#f3f5fc) would not show on the task card's #f8f9fc. |
| "Cowork has not caught up with F2 / F5 / F6 / F8" | Stale, as the brief says. Not treated as a BL issue. |
| **Not in the developer's list:** a target larger than the viewport | F1 |

## 4. Findings

### Blocking

None.

### Non-blocking

#### F1 — P3 · non-blocking (lead decides) — a target larger than the viewport gets a cropped image in BL and no image in Cowork

- **Design doc:** #4.1 截不到 (`:72`) says 「元素不在可视区域内 → 不带图」, but not whether a partly visible element counts.
- **Code:**
  - BL `replayEngine.ts:288-293` intersects the element's box with the viewport and shoots the visible part. Test `:614` pins that behaviour.
  - Cowork `apps/cowork/src/main/drive/replayEngine.ts:356-360` returns no box unless the element is wholly inside the viewport (1 px tolerance).
- **Evidence:** probe A3 puts a 1400×200 target in an 800×600 viewport.
  - BL returns the box `{x:300, y:2600, width:800, height:200}` and a 240×60 image that is entirely the target's colour.
  - Cowork's rule gives no image, so its card falls back to the label or the selector.
- **Scope:** only elements larger than the viewport. The locator centres every smaller target first.
- **Why it matters:** the pairing rule wants one behaviour, and today the same page produces different cards in the two apps.
- **Fix:** the lead picks one and writes it into #4.1; the other repo aligns (a few lines plus its test).
  - Recommendation: keep BL's crop. For an oversized card or row it still shows the right element.
  - Tradeoff: the visible part may leave out the bit that identifies the element.

#### F2 — P3 · non-blocking (doc) — the image sits after the reason, not between title and reason; the BL prompt renders as one run-on line

- **Design doc:** #4.1 怎么显示 (`:75`) says 「放在标题与原因之间」 (between the title and the reason). `:5` says the two repos differ only in #3's paths.
- **Code:**
  - `uiActGate.ts:205` builds one string, `Run this action?\n<action>\n\n<why>`.
  - `DecisionRecord.vue:61` and `DecisionSheet.vue:106` render it in one span, and its class sets no `white-space`, so the newlines collapse: 「Run this action? click "Delete all" The decision maker classified it as irreversible (0.9)」. That rendering predates this task; it has been this way since BJ3.
  - The image follows the span (`DecisionRecord.vue:65`, `DecisionSheet.vue:114`).
- **Judgment:** acceptable.
  - "Between" can't be done without moving the reason into its own field: a new `AgentDecisionQuestion` field plus both templates.
  - The image already sits directly under the action text and above the options.
- **Fix:**
  - Record BL's placement in #4.1. In the same edit, name BL's DecisionSheet / DecisionRecord in the 「带到哪」 row.
  - Optional, outside this task: `white-space: pre-line` on `.decision-record__prompt` / `.decision-sheet__prompt` would put the three parts on separate lines. It would help `ask_user` prompts too.

#### F3 — P3 · non-blocking (for the #5 human look) — on BL's slate palette, "waiting on you" is one shade away from "running"

- **Design doc:** #3 Ral 已定 ② turns the status row's wait tone theme blue. That is done.
- **Code** (`theme.ts`: arcoblue-5 #606b9d, arcoblue-6 #4e5882, arcoblue-7 #323955):

  | Element | run | wait |
  |---|---|---|
  | Status dot (`ResponseStatus.less:66-67`) | #606b9d, pulsing | primary-6 #4e5882, static |
  | Status text (`:70-71`) | #4e5882 | #323955 |
  | Background-agents row (`:44-47`) | #4e5882 | #323955; same icon, no pulse on either |

  - Under `prefers-reduced-motion: reduce` the run dot stops pulsing (`:76-78`). That leaves only the shade.
- **Before this task:** the wait tone was amber (#f7ba1e / #b25e09). Now the difference rests on the wording ("Needs your call · …" vs "Thinking…") and on the pulse.
- **Cowork:** same design (blue-400 breathing vs blue-600), accepted in its review 2. BL's desaturated palette makes the step smaller.
- **Fix:** nothing, under the contract. Look at it during the #5 check. If the two rows read alike, the change is Ral's to choose, for example a different icon or weight for wait.

#### F4 — P3 · non-blocking (contract gap; for decision-helper-199) — the skill-script `jev` binding still hands the relay's raw error text to scripts

- **Design doc:** #1 `:16` — tool results say "decision maker" too. #2 `:32` applies "type + status only" to the card's reason and the segment note, nowhere else.
- **Code:** `skillScript.ts:205-212` returns `jevJudge`'s `JevResult` unchanged. For `http`, its `message` is the relay's error body (`jevDecision.service.ts:118-131`); the code keeps it "for programs".
- **Effect:** a generated script that prints `r.message` puts upstream text, possibly containing "jev", into the `run_skill_script` result. The path is narrow.
- **Fix:** not 198's. Decision-helper-199 is renaming this binding to `decision` and moving it onto the helper. Decide there whether scripts get `message` for http / network / invalid failures, or only the type and status.

#### F5 — P3 · non-blocking — the `ChatConfirmSheet.less` comment contradicts the contract and overstates the collapsed row

- **Stale status.** `:29` says the unsourced colour is "not decided yet (Ral, 2026-09-24)". #3 Ral 已定 ① decided it: theme blue, no red.
- **Overstated cue.** `:30` says "the risk still reads from … the "N unsourced" count on the collapsed row". In BL that count is plain 10 px `--color-text-3` text inside `.chat-confirm-sheet__risk` (`:19`, `ChatConfirmSheet.vue:89-95`), not bold. Cowork's collapsed count is bold. This gap predates this task.
- **Fix:** reword the comment to cite ①. Optionally give the count a bold class to match Cowork; that is the lead's call.

#### F6 — P3 · non-blocking — the label test does not pin "visible text before value and title"

- **Design doc:** #4 (`:60`) gives the order aria-label → visible text → value → title. The bug being fixed is exactly a `value` hiding a button's text.
- **Evidence:** 22 mutants on a scratch copy, 20 of them killed. Two survive:
  - M5 moves the title before the visible text;
  - M5b moves the value before the visible text.
  - They survive because no fixture element has both text and a value or title: `e25` has no `value` attribute, and `e27` / `e28` have no text.
- **Fix:**
  - Add two elements to `LABEL_PAGE` (`:360`): `<button data-coach-ref="e33" value="1">Delete</button>` expecting `Delete`, and `<a data-coach-ref="e34" title="tip">Open</a>` expecting `Open`.
  - Optionally pin the recording call's whole params object with `deepEqual`, as Cowork's test does. Test `:727` pins only the clip and the flag; the key order was verified here by probe instead.

#### F7 — P3 · non-blocking (docs) — the status lines lag behind

- Feature doc `:3` still says 「实现未开始」 (not started). The task is `status: in-progress`. The issue still says 「修法已定」 (fix decided).
- The lead updates all three after acceptance.

### Not verifiable here — left for the #5 human look

- **An agent tab that has never been shown** (#5 `:86`).
  - Hidden views produce no frames (`issues/ui-act-on-background-tab-stalls-and-click-has-no-effect.md`, root cause 2).
  - If `Page.captureScreenshot` hangs, the 2 s limit turns that into "no image", which is what #5 wants.
  - A stale or blank frame, however, would pass the `data:image/` check (`uiActGate.ts:138`). The card would then say "click this element" over an empty thumbnail.
  - If the look shows that, the cheapest guard is to read `document.visibilityState` in the metrics call that `locateTargetBox` already makes (`replayEngine.ts:281-286`), and return no box when the page is hidden. Whether Electron reports such a view as hidden is not verified.
- **The real card in Electron 40 (Chromium 144):** colours, no border, 120×120, 70 %. The probe used Chrome for Testing 153.

### Checked, no finding

- **Security and exposure.**
  - The skill-script `page` object is a locked facade, so scripts cannot reach the new `webContents` getter (`skillScript.ts:137-175`).
  - `debuggerCapture.ts` does not import `requestExec.service`, so the new import creates no cycle.
  - The image rides the decision broadcast to every renderer. One capped image per pending approval keeps it small.
- **Style.**
  - Imports are static aliases, type-only imports use `import type`, and no `forEach`, `import()` or `require` was added. No function has more than 2 parameters.
  - Semicolons follow each file's local style. `uiActGate`, `jevDecision` and `snapshotSegment` use them; `debuggerCapture`, `replayEngine`, `requestExec.service` and `agentDecision.api` are semicolon-free and stay that way.
  - The new Less is flat BEM. `WorkflowTaskBar.less`'s `&` nesting is that file's existing style.
  - No `<style>` block was added.
  - No trailing whitespace; the new file ends with a newline.
- **i18n.**
  - No renderer text was added, so there are no new `i18nHelper` keys and nothing to add to en / zh.
  - The new card strings (`click this element`, `submit this form`) are main-process English, like the gate's existing strings.
- **The session-list confirm dot vs the unread dot.**
  - In BL they differ in hue: #4e5882 against #165dff.
  - Ral's 「1A」 replaces the dot with text anyway, in task 202.

## Verification (commands actually run)

| Command | Result |
|---|---|
| Built the mirrors: `git archive HEAD` → `head`; working-tree copy at 15:09 → `wt`; `build-mirrors.mjs` → `base` (HEAD + 193 + 197) and `task` (`base` + 198 only) | `diff -rq base task`: 24 files, all 198's. `diff -rq task wt`: only other sessions' files. |
| `node --test tests/maestro/decisionMakerCard.test.mjs` | `task` 29/29 and `wt` 29/29. The same file copied into HEAD: 6/29; into `base`: 6/29. |
| `TYPECHECK_SURFACES_LIST_ERRORS=1 node scripts/typecheck/surfaces.mjs`, in all four trees | HEAD 97; `base` 96 (197 removed `hostIntegration.ts(427)` TS2345); `task` 96; `wt` 96. The `base`, `task` and `wt` sets are identical. 0 diagnostics in 198's files; the 4 in `skillScript.ts(188)` are pre-existing. |
| `node scripts/renderer-i18n/check-renderer-i18n.mjs`, all four trees; then the same script with soft asserts, HEAD and `task` | Exit 1 everywhere, at "maestroControl must start language initialization before evaluating product UI". Run to completion: 3 failures on both HEAD and `task` (`maestroControl` ×2, `maestroTabAlias` ×1), identical. |
| 155 test files, one process each (`--test-timeout=90000`, 180 s hard cap), in all four trees. Set: all of `tests/maestro`, `skillScopes`, `skillsThreeSources`, `workflowHost`, `workflowUi`, `workflowEngine`, `downloads`; five related `tests/onlypreview` files; `scripts/auth/customer-authentication.test.mjs`. `controlLoginPreviewWorkspace` excluded. | HEAD 148 files, 45 failing; `base` 150 / 45; `task` 151 / 45; `wt` 155 / 44. No timeouts. **`base` → `task`:** identical exit code, counts and failing test names in all 150 shared files; tests 1107 → 1136, passes 934 → 963, which is the new file. **`task` → `wt`:** only `queuedMessageOutlivesTheTurn` differs (3/4 → 4/4), from another session's edit to that test. |
| The three pre-existing test failures the developer listed, on HEAD, `base` and `task` | Identical in all three: `uiActSelectorMiss` 0/3, `skillScopes/execution` 0/26, `confirmCardSurvivesRestart` 7/8, with the reasons given in §2 |
| Probes for regressions hidden behind those failures | `uiActSelectorMiss` with a pass-through gate bound: 3/3 on HEAD, `base` and `task`. `execution` with the pre-existing gaps stubbed: 25/26 on `base` and `task`, the same remaining gap in both. |
| All 54 `scripts/maestro/check-*.mjs`, in HEAD, `base` and `task` | The same 25 non-zero exits in all three, all pre-existing. `base` → `task` output is identical once timings are normalised. |
| ESLint (`--no-cache`) on the 11 changed source files, `base` vs `task` | Error counts identical per file, all pre-existing. Warnings are Prettier-only and follow each file's semicolon style; `jevDecision` drops from 3 warnings to 0. New test file: 37 `explicit-function-return-type`, the same kind the sibling `.mjs` tests have. |
| `lessc.cjs` (less 4.5.1) on the 9 touched `.less` files, `base` and `task` | All compile. In the three card files the only border declarations are `border: 0`, and no `--warning-*` is left. |
| `recording-parity.mjs` | The recording CDP call is identical in 30/30 cases (§2) |
| `jev-probe.mjs` over all of `src`, no allowlist | `task` 12 hits, HEAD 20 (§1) |
| sha256 of `readText` with its comment | `fe5f9251…` in HEAD, `task` and `wt` |
| `probe-shot.mjs`, run with Chrome for Testing 153 (headless shell) through `playwright-core` with `viewport: null`, so no device-metrics override. The probe sends its CDP calls on a separate session of its own and sets DPR 2 with a launch flag. It drives the **real** `locateTargetBox` and `captureElementShot` from `task`, and renders the **real** `DecisionRecord.less` / `DecisionSheet.less`. Not the app, not Electron. | **A1:** the crop is the red button, 240×51, 1.4 KB. During the gate shot: 0 `resize`, 0 `mouseleave`, 0 `mouseenter`. The same crop with `true`: 1 `resize`. **A3:** see F1. **B:** see the #4.1 fit row. |
| `mutate.mjs` / `mutate2.mjs`: 22 mutants on a scratch copy of `task`. The first M2 run hit a comment, so it was redone on the code line. | 20 killed. Two survive, M5 and M5b (F6). |
| `name` / BEM sets of 9 `.vue` files (4 touched, 5 related) and selector sets of the 9 `.less` files, HEAD vs `task` | Additions only (§1) |
| Trailing-whitespace and final-newline check on the task-only diff | Clean |
| `cmp` of every 198-only file, the 15:09 snapshot against the working tree at 16:00 | Unchanged. `decisionMakerCard.test.mjs` differs only by 199's two lines. |

Not run: E2E, Electron, the app itself, `controlLoginPreviewWorkspace.test.mjs` (it hangs), `yarn build`, and Cowork's suites. Cowork's code was only read. The #5 human look remains with Ral.
