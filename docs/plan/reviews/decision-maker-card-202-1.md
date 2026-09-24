# `decision-maker-card-202` — independent review 1

Date: 2026-09-24. This is a read-only review by a verifier who did not implement the change. No source, task or doc was edited, nothing was staged or committed, no branch or worktree was switched or created, nothing was stashed, and no app, Electron or E2E was started. `tests/onlypreview/controlLoginPreviewWorkspace.test.mjs` was not run. This file is the only one written in the repository. Everything else ran on copies in the session scratch directory, which were deleted after the review.

An earlier review of this task was interrupted before it wrote a report. This review started again from scratch and did not reuse that reviewer's trees or conclusions.

## Scope basis

Four scratch trees, HEAD `883824e8`:

- **`head`**: a `git archive HEAD` export.
- **`wt`**: a copy of the working tree taken at 16:42:55.
- **`pre`**: `wt` with this task's hunks reverted, and nothing else. So it is the working tree as it was before 202.
  - `SessionsDrawer.vue`, `ChatPanel.less` and `task/ChatConfirmSheet.less` come from the 198 review's 15:09 snapshot. Against `wt`, each of those snapshot files differs only by 202's lines.
  - `decisionMakerCard.test.mjs` comes from the 199 review's snapshot. That is 198's 29-test file minus the two allowlist lines that 199 removed.
  - `en.ts` / `zh.ts` are `wt` minus the one `awaitingConfirmTag` line in each.
  - `diff -rq pre wt` lists exactly those six files.
- **`mut`**: a copy of `wt`, used for mutants. After each mutant the file was restored, and at the end `diff -rq mut wt` was empty.

**Attribution.** Everything is uncommitted, so hunks were attributed by content against the two snapshots above, and by file mtimes:

| File | This task's hunk | Other hunks in the file (not reviewed) |
|---|---|---|
| `SessionsDrawer.vue` (mtime 16:16:25) | `:161`, the text inside the confirm span. This is the file's only difference from the 15:09 snapshot. | none; HEAD → 15:09 had no change here |
| `ChatPanel.less` (16:16:37) | `:463` the header-dot selector split; `:470-480` the label rule and its comment | 198's amber → blue (`:452-461`, `:463-468` values) |
| `task/ChatConfirmSheet.less` (16:16:37) | `:29-31`, comment only (F5) | 198's colour and border work |
| `en.ts` `:616` / `zh.ts` `:607` | `awaitingConfirmTag` | Other sessions: Workbench → Settings (`:131-133`, `:427`, `:549-550`, `:559` in en; the same keys in zh), and `todoLimitReached`. None of these is in the 15:09 snapshot. |
| `tests/maestro/decisionMakerCard.test.mjs` (untracked, 16:28:43) | header `:14-15`; imports `:28-30`; F6 fixtures `:373-376` and asserts `:391-400`; the #3 accent test title and `:1248-1251`; the N1 block `:1318-1489` | 198's file; 199's two allowlist lines (already gone in the baseline) |

Other changes in the tree were not reviewed:

- Docs already describe the change: `docs/features/agent-decision-sheet.md` (15:52), the issue's 2026-09-24 note (15:13), and the feature's `Status:` line plus `docs/INDEX.md` (16:06). They were written before 202's source edits, are outside 202's Path, and are consistent with it.
- decision-helper-199 was still editing while I reviewed; `uiActGate.ts` changed at 16:52:38.

At 16:59:10 all six task files, plus `SessionsDrawer.less`, `TaskPart.less` and `replayEngine.ts`, were still byte-identical to the `wt` snapshot.

Task: [decision-maker-card-202](../tasks/decision-maker-card-202.md), `status: in-progress`, `depends-on: [decision-maker-card-198]` (198 is `done`).

Contract: the [feature](../../features/decision-maker-naming-and-approval-card.md) #3, 「Ral 已定(2026-09-24,审查 N1:「1A 2A」)」, `:49-54`. Also the 198 review's F5 / F6, and the BL rules in overmind `CLAUDE.md`: flat BEM, Less, `i18nHelper`, en + zh, borderless UI.

## Conclusion

**pass.**

- **Blocking: none.**
- **Non-blocking: F1 and F2, both P3.**
  - F1: the new "no background, no border" guard lets three kinds of mutant through: a `box-shadow` ring, an `outline`, and a rule in another control stylesheet.
  - F2: a pre-existing template comment still says a row has only a spinner or a dot.

What conforms:

- Every line of #3 ① is implemented as written, and ② holds: the stalled hint is byte-identical to HEAD, and 198's test pins it.
- Compiled CSS: the task changes only the label rule and the selector list it used to share with the header dot. The header dot's declarations are unchanged. In a real browser the header dot, unread dot and spinner compute identically before and after.
- F5 is comment-only; the compiled declarations are byte-identical once comments are stripped. F6 kills the two mutants that survived the 198 review.
- The new tests fail without the change. 36 of 41 mutants are killed.
- Every related suite, typecheck and the i18n check are identical before and after, apart from the two new tests.

## 1. Contract check

| Contract (`:50-54`) | Code | Evidence | Verdict |
|---|---|---|---|
| ① The confirm dot becomes blue text 「待确认」 / `To confirm` | `SessionsDrawer.vue:161` `{{ i18nHelper.maestroControl.chat.awaitingConfirmTag }}`; `en.ts:616` `'To confirm'`; `zh.ts:607` `'待确认'`, both under `maestroControl.chat` | The SSR render gives `To confirm` / `待确认` (N1 test `:1418`, and my probe). Typecheck sees the key: dropping it from `en.ts` gives 2 new errors, `zh.ts(607)` and `SessionsDrawer.vue(161,48)`. | ✓ |
| 11px, medium weight, theme blue | `ChatPanel.less:474-480`: `color: rgb(var(--primary-6)); font-size: 11px; font-weight: 500` | Chromium: `rgb(78, 88, 130)`, i.e. BL's primary-6 `#4e5882`; 11px; 500 | ✓ |
| **No background, no border** | The label rule has none. No other selector anywhere in `src` contains `history-item-confirm`; the only other hits are `SessionsDrawer.vue` itself and the tests. Compiled Arco has no generic `.arco-btn span` rule; the only descendant rule is `.arco-btn > a:only-child`. | Chromium, en and zh, on the normal, cursor, active and hovered rows: `background-color rgba(0,0,0,0)`, `background-image none`, border widths 0, `border-radius 0`, `box-shadow none`, `outline none`, padding 0 | ✓ (guard gap: F1) |
| Same place: before the spinner and the unread dot | `:156-161` `v-if="item.awaitingConfirm"`, then `:162` `v-else-if="item.running"`, then `:168` `v-else-if="item.unread"`; unchanged | N1 `:1410-1415` chain; `:1425-1429` the previous sibling is `__history-item-body` | ✓ |
| Keep `name`, the BEM class and the 「等你确认」 tooltip | `name="maestro__history-item-confirm"`, `class="chat-panel__history-item-confirm"`, `:title="…awaitingConfirmSession"` (zh 「等你确认」) | The file's only hunk is `:161`; the `name` / class sets are identical to HEAD | ✓ |
| The title truncates to make room; the label never wraps | Label `flex: 0 0 auto; white-space: nowrap`. `SessionsDrawer.less` is byte-identical to HEAD: select button `min-width: 0`, body `flex: 1 1 auto; min-width: 0`, title ellipsis. | Chromium, 280px drawer: the label is one line, not clipped, inside the button (en 57.0px, zh 31.7px). A long title shrinks from 194px to 145px (en) or 170.3px (zh) and truncates; "Short" does not. | ✓ |
| Unread is still a blue dot, running still a spinner | `ChatPanel.less:490-510`, identical to `pre`; `SessionsDrawer.vue:162-173` unchanged | Chromium pre vs wt, identical: unread 8×8, `rgb(22, 93, 255)`, 999px; spinner 12×12, 2px, `chat-panel-spin` | ✓ |
| The header is unchanged (dot + count) | `ChatPanel.vue:748-756` has no hunk vs HEAD in this area. The dot's rule `:463-468` keeps 198's four declarations. | Compiled pre → wt: the only change to this rule is the selector list. Chromium pre vs wt: dot 8×8, 999px, `rgb(78, 88, 130)`, block; count `rgb(78, 88, 130)`, 11px, 600, inline-flex, gap 4px. | ✓ |
| `SessionSearchModal` unchanged | `SessionSearchModal.vue` / `.less`: no diff vs HEAD. It still shows only spinner / unread (`:97`), as the task says. | — | ✓ |
| ② Stalled stays amber | `TaskPart.less:32` `.task-part__stall` is byte-identical to HEAD (`--warning-1/-3/-8`) | 198's `:1265` `isAmber(…stall.background)` kills a blue stall (mutant N7) | ✓ |

The task's own Verification list is covered in full. A source test checks the i18n text, primary-6, no background / border / radius, the chain order, and both locales. Typecheck gives 0 new diagnostics, the i18n check is unchanged, and no E2E was run.

**BL rules.**

- Flat BEM, no `&`, and the rule is in Less. No `<style>` block or inline style was added.
- `i18nHelper` is used, never `$t()`, and the key is in both `en.ts` and `zh.ts`.
- No border.
- Style follows each file's local conventions: single quotes and the file's semicolon style. The only new ESLint output is Prettier noise that every line of these files already has, and two `explicit-function-return-type` errors on the new test helpers, the same kind as the file's other 37.
- No `forEach`, and no dynamic import.

**Load path.** `control/index.html` → `control.ts` → `ControlAuthApp.vue`, which loads `ControlApp.vue` with `import()` (`:80-81`). `ControlApp.vue` imports `ChatPanel.vue` (`:24`) and `SessionsDrawer.vue` (`:26`) statically. `ChatPanel.vue:34` imports `./ChatPanel.less`, and `SessionsDrawer.vue:10` imports `./SessionsDrawer.less`. So the label's rule, which lives in `ChatPanel.less`, loads in the same async chunk as the drawer, whether or not a session is open. That structure predates this task.

## 2. The developer's claims

| Claim | Verified |
|---|---|
| `SessionsDrawer.vue`: the span gets the text; its chain position, `name`, class and `:title` are unchanged | ✓ Exactly one line changed (`:161`) |
| `en.ts` / `zh.ts`: one `awaitingConfirmTag` line each | ✓ `:616` / `:607`. The other hunks in those files belong to other sessions (see the attribution table). |
| The shared rule is split; the header dot is untouched; the label becomes text (`flex: 0 0 auto`, primary-6, 11px, 500, nowrap); compiled, only these two rules differ | ✓ lessc 4.5.1, with the vite options (`modifyVars: theme`, `javascriptEnabled`): the `pre` → `wt` diff of `ChatPanel.css` is the selector split plus the four added declarations. The header dot's compiled declarations are identical, and so is its computed style in Chromium. |
| F5: `ChatConfirmSheet.less` comments only; compiled declarations byte-identical | ✓ The compiled CSS differs only inside the `/* */` comment, and is byte-identical with comments stripped. The new text is accurate: the marker has an icon and a label (`ChatConfirmSheet.vue:104-107`), and `__field-source` is 650 (`.less:27`). BL's `__risk` count is plain grey 10px (`:19`, `.vue:89-95`), while Cowork's is `font-semibold` (`ChatConfirmSheet.vue:130`). |
| F6: e33 (value vs text) and e34 (title vs text) added to `LABEL_PAGE` | ✓ `:375-376`, asserted at `:391-400`. M5 (title before text) and M5b (value before text) pass the `readLabel` test with 198's fixtures, and fail it with 202's. `pageWith` (`:347-353`) gives `<button>` a real `value` getter, so e33 genuinely exercises the value branch. |
| New `#3 N1` render test (SSR + linkedom, en / zh) and a Less test; the old dot assertion changed to `color` | ✓ `:1386` renders the real SFC and reads the real en / zh tables. Every import must be stubbed, or it fails loudly (`:1378`). `:1442` is the Less test. `:1249` now pins `color`, not `background`. |
| 31/31; M5 / M5b and 14 N1 mutants killed | 31/31 ✓, on `wt` and on the live tree at 16:59. The developer's mutant copies were not left behind, so I ran my own 41: 36 killed, 5 survived (§4 F1). M5 and M5b die. |
| typecheck: 92 before and after, same set; 0 in the changed files | ✓ `pre` 92 and `wt` 92; `comm` of the sorted lists is empty both ways; none is in the six files |
| `check:renderer-i18n`: exit 1 before and after, same failure | ✓ `head`, `pre` and `wt` all stop at "maestroControl must start language initialization before evaluating product UI". Run to completion with soft asserts, all three have the same 3 failures (`maestroControl` ×2, `maestroTabAlias` ×1). |
| Title truncation measured in headless Chromium (the Playwright cache's, not Electron) | The developer's run could not be checked, but my own run reproduces the result; see the §1 truncation row |

## 3. Differences from the Cowork implementation (003)

| Difference | Verdict |
|---|---|
| Colour: Cowork `text-blue-600` (`#155dfc`); BL `rgb(var(--primary-6))` (`#4e5882`) | **As specified.** #3's table names primary-6 for BL. The label now also differs from the unread dot `#165dff` in hue, not only in shape. |
| Locales: Cowork has four (en / id / zh-CN / zh-TW); BL has en / zh | **As specified.** BL has two locales, and `zh: typeof en` makes typecheck enforce the pair. |
| `shrink-0 whitespace-nowrap` vs `flex: 0 0 auto; white-space: nowrap` | Equivalent |
| Guard strength | BL's test also scans compound selectors (hover, active and nested rules are caught) and `width` / `height`. It shares Cowork 003 F1's blind spot for `box-shadow` / `outline` and for other stylesheets: F1. |
| Cowork 003 F2 (docs still said 黄点) | Already done in BL: the feature doc, the issue and `INDEX.md` are current. Only the template comment remains: F2. |

## 4. Findings

### Blocking

None.

### Non-blocking

#### F1 — P3 · non-blocking (test hardening) — the "no background, no border" guard is blind to rings, outlines and other stylesheets

- **Where:** `tests/maestro/decisionMakerCard.test.mjs:1454-1463`. It checks only `ChatPanel.less` and `SessionsDrawer.less`, and only props matching `/^(?:background|border|width|height)/`.
- **Evidence:** four mutants stay at 31/31.
  - **L9:** `box-shadow: 0 0 0 1px …` on the label.
  - **L10:** `outline: 1px solid …` on the label.
  - **L11:** a rule in `ControlApp.less` giving the label a background and a radius. That file is loaded in the same chunk, so it would reach the label.
  - **S9:** an extra, unnamed `<span class="chat-panel__history-item-confirm">` before the title column. The test finds the label by `name`, so it never sees the extra span.
  - **The contract's reason covers the first three.** A ring or an outline reads as a border, and 「有底色会像按钮」 applies to them too.
- **The implementation itself is clean.** A browser probe confirms it (§1).
- **Fix** (test only, a few lines):
  - Widen the regex to `/^(?:background|border|width|height|box-shadow|outline)/`.
  - Scan every `.less` under `src/renderer/maestro/control/src/`, not two named files.
  - Optionally, assert that each row has at most one `.chat-panel__history-item-confirm`.
  - Optionally, pin the spinner's `animation` too. Mutant N8 (spinner without animation) also survives. The contract says "running is still a spinner", but that rule is outside this task's hunks and byte-identical to `pre`.

#### F2 — P3 · non-blocking (comment; pre-existing) — the list comment still says a row shows only a spinner or a dot

- **Where:** `SessionsDrawer.vue:132-133`: 「行内右侧只有一个指示物:转圈(在跑)或蓝点(未读)」. It dates from HEAD and never mentioned the confirm indicator. With the confirm indicator now a text label placed first in the chain, the comment misleads further.
- **Fix:** optional, one line. For example: 「待确认(文字，排最前)、转圈(在跑)或蓝点(未读)，同一时间只显示一个」. This is the same optional item as Cowork 003 F2.

### Observations, no finding

- **Contrast of the label (`#4e5882`):**
  - 6.9:1 on white;
  - 5.58:1 on the keyboard-cursor row (`#e2e7f5`);
  - ≈6.5:1 on the hover fill.
  - All pass WCAG AA for 11px text. Cowork's label was 4.28:1 on its cursor row.
- **Status bookkeeping:** the task is `status: in-progress`, and the feature's `Status:` line says 「card-202 进行中」. The lead flips both after acceptance.

### Not verifiable here — left for the #5 human look

- The real control window in Electron 40 (Chromium 144): whether 「待确认」 reads as plain text and is clearly not the unread dot. The probe used Chrome Headless Shell 153.

## Verification (commands actually run)

| Command | Result |
|---|---|
| Built `head` (`git archive HEAD`), `wt` (copy at 16:42:55), `pre` (from the 15:09 / 199-review snapshots, see Scope) and `mut` | `diff -rq -x node_modules pre wt`: exactly the six task files. Each snapshot source differs from `wt` only by 202's lines. |
| `node --test --test-timeout=60000 tests/maestro/decisionMakerCard.test.mjs` | `wt` 31/31; the live working tree at 16:59: 31/31; `pre` with its own file: 29/29. `wt`'s file on `pre`'s sources: 28/31. Exactly three tests fail: the #3 accent test (`:1249`, colour), N1 render ("en has the key") and N1 Less (`color` undefined). |
| lessc 4.5.1 via `less.render` (`modifyVars: theme`, `javascriptEnabled`), on `ChatPanel.less`, `SessionsDrawer.less` and `task/ChatConfirmSheet.less` in `head` / `pre` / `wt` | All compile. `ChatPanel.css` `pre` → `wt`: the selector split and the 4 declarations, nothing else. `SessionsDrawer.css` is byte-identical in all three trees. `ChatConfirmSheet.css` differs only in the comment and is identical with comments stripped. |
| `mutate.mjs`: 41 mutants on `mut`, one at a time, each checked to have changed its file, the whole test file run each time | **36 killed.** Survivors: L9 box-shadow, L10 outline, L11 `ControlApp.less` rule, S9 an extra unnamed span (F1), and N8 spinner animation (outside the task's hunks). Killed: back to the dot (source and Less); hard-coded text; wrong key; chain reordered or moved; tooltip; `name`; extra class; unread with text; background, border, radius + padding, width / height, compound, hover, nested and `SessionsDrawer.less` rules; − nowrap; shrinkable; primary-7; `#165dff`; 600; 12px; header-dot damage; header dot amber; unread without background; title without ellipsis; body or select without `min-width: 0`; stall blue; zh `To confirm` / `等你确认`; en key dropped; M5; M5b. |
| M5 / M5b with `--test-name-pattern=readLabel`, against 198's and against 202's fixtures | 198's fixtures: pass (the mutants survive). 202's: fail (killed). |
| `TYPECHECK_SURFACES_LIST_ERRORS=1 node scripts/typecheck/surfaces.mjs` on `pre` and `wt`; sorted, then `comm` | 92 / 92, identical sets, 0 in the six task files |
| Same, `--kind=web`, on `mut` with the `en.ts` key removed | 2 new errors, `zh.ts(607,7)` TS2353 and `SessionsDrawer.vue(161,48)` TS2339, so the surface does check this template |
| `node scripts/renderer-i18n/check-renderer-i18n.mjs` in `head` / `pre` / `wt`; then a copy with soft asserts | Exit 1 everywhere at the same `maestroControl` assertion. Soft run: the same 3 failures on all three trees. |
| `suite.mjs`: 35 test files and 5 guards, one process each (`--test-timeout=60000`, 180 s cap), on `head` / `pre` / `wt` | Identical exit, counts and failing names on all three trees, except `decisionMakerCard` (`pre` 29 → `wt` 31). **The four named files:** `agentDecisionSheet` 13/13, `maestroSessionsDrawerLifecycle` 8/8, `maestroSessionManagement` 16/16, and `decisionMakerCard` as above. **Also green:** `chatHistoryRowIsNarrow` 4/4, `historyAcceptRestoresFocus` 4/4, `controlWarmSurface` 3/3, `toolApprovalHasAButton` 4/4, `settingsMenuManual` 6/6. **Pre-existing failures, identical on `head`:** `sessionSearchShortcuts` 6/15 (`registerWindowCloseShortcut is not a function`), `maestroSessionIoPath` 3/6, `maestroComposerWorkspaceUi` 4/11, `maestroHomeAppList` 0/6, `maestroCompactionStatus` 0/1, `confirmCardSurvivesRestart` 7/8, `onlyPreviewAppWiring` 8/13, `trenchOmniEmbedding` 5/6, `translatorCopy` 0/1, `translatorErrorDetail` 3/9, `trench-index-layout` 16/19, `trench-sniping-layout` 12/13, `eyes-on-agents/ui-source` 26/28, `notificationTest` 10/11; guards `check-chat-composer` and `check-context-graph` (exit 1); `check-download-destination` and `check-empty-turn-copy` ok. |
| `check-chat-composer.mjs` with soft asserts, `pre` / `wt` (it reads `ChatPanel.less` and `en.ts` but stops early) | Identical: the only failure is the pre-existing "ChatPanel should use Arco Button…"; every `ChatPanel.less` / `en.ts` assertion passes |
| Layout probe: Chrome Headless Shell 153.0.8010.12 from the Playwright cache (not Electron, not the app), through `playwright-core`. The real `SessionsDrawer.vue` was SSR'd with the real Arco `Button` and the real `IconBtn`, and styled with the real compiled Arco (`arco.less` + theme) and control CSS. 280px drawer, `pre` and `wt`, en and zh, plus one hovered row. | See the §1 rows: the label's look and size, one line, the title truncating, and unchanged header dot, unread dot and spinner |
| ESLint `--no-cache` on the 4 lintable task files, `pre` vs `wt` | 0 errors in `.vue` / `.ts` both times. The new warnings are Prettier's quote style on the changed lines, which every line of these files already has. The test file goes from 37 to 39 `explicit-function-return-type` errors. |
| `git diff --check` (tracked files) and `git diff --no-index --check` (`pre` → `wt`, all six files) | Clean; the test file ends with a newline |
| `cmp` of the task files and their neighbours, live tree vs `wt`, at 16:59:10 | Unchanged |

Not run: E2E, Electron, the app itself, `controlLoginPreviewWorkspace.test.mjs`, `yarn build`, and Cowork's suites. Cowork's review was only read. The #5 human look remains with Ral.
