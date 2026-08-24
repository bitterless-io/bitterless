# Independent Review Round 2 — onlypreview-find-in-file-019

Status: **PASS**

Date: 2026-08-21  
Scope: Task 019 after the bounded review-1 fixes, including both prior behavioral blockers, all seven
prior code-review P2 findings, the current task/design/feature/analysis truth, every newly split
source and test file, fresh non-E2E gates, and the emitted source-build graph. The shared worktree
also contains Tasks 020–022 and unrelated owner changes; this review restricts findings and
verification claims to Task 019's declared paths. Electron/Playwright E2E, the real app, ordinary
`yarn build`, and packaged smoke were intentionally not run.

## Summary

Both review-1 blockers are genuinely closed. Find input composition is now Store-owned: accepted
Main snapshots cannot overwrite an active IME draft, and `compositionend` submits the final value
once while the browser's post-composition input echo is consumed. Monaco now separates complete
model counting from active-range navigation: the count still covers the full accepted 8 MiB model,
but the active range comes from Monaco's original model, so `İx` / `x` reveals column 2, retains at
most one decoration, and never mutates editor selection.

The seven code-review P2 findings are also closed without moving authority or weakening tests. Main
still owns selection and find revisions; the extracted sibling owns only Chrome/Vue view and session
lifecycle. Sheet business progression is in a reactive Store controller, with only a zero-argument
`ready` event. Every Task-019 scoped TS/JS/Vue file is at most 800 lines, all split tests are glob
discoverable, the full suite grew from 311 to 315 tests, and there are no skipped, todo, or exclusive
tests. No new P0, P1, P2, or docs-sprint blocker was found.

## Findings

### P0

None.

### P1

None.

### P2

None.

## Review-1 blocker closure

| Review-1 blocker                                                    | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IME draft overwritten by an accepted Main snapshot                  | CLOSED | Composition state and draft ownership live in `onlyPreviewFind.store.ts:52-77,105-141`. `sync()` installs current capability/result truth but refuses to replace query/case while composing; `endComposition()` submits the normalized final value once, and `compositionCommitEcho` consumes the browser's duplicate post-composition input. `FindBar.vue` delegates composition/input events to the Store. The behavioral regression injects a current Main snapshot during composition, proves both draft and case truth survive, then proves exactly one final intent is submitted (`onlyPreviewFindRenderer.test.mjs`). |
| Monaco applied length-changing folded offsets to the original model | CLOSED | `onlyPreviewMonacoFind.service.ts:8-19,25-89` counts the complete source without collecting ranges, but obtains the active range from `model.findNextMatch()` / `findPreviousMatch()` on the original model. The `İx` / `x` regression asserts the original range at column 2. The same fresh suite counts all 8,388,608 matches in an accepted 8 MiB model, records at most one active decoration, and records zero selection writes.                                                                                                                                                                                       |

## Code-review audit

Problem counts below cover TS-1, TS-2, FE-1, and FE-2. The file list precedes the finding closure as
required by the workspace review rules.

### File list

|   # | File                                                                                      | Lines | Problems |
| --: | ----------------------------------------------------------------------------------------- | ----: | -------: |
|   1 | `src/main/onlypreview/views/onlyPreviewFind.service.ts`                                   |   464 |        0 |
|   2 | `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`                          |   797 |        0 |
|   3 | `src/main/onlypreview/views/onlyPreviewPreviewView.service.ts`                            |   548 |        0 |
|   4 | `src/main/windows/onlyPreviewWindow.helper.ts`                                            |   770 |        0 |
|   5 | `src/main/xpc/onlyPreview.handler.ts`                                                     |   509 |        0 |
|   6 | `src/shared/onlypreview/onlyPreview.types.ts`                                             |   362 |        0 |
|   7 | `src/shared/onlypreview/onlyPreview.contract.ts`                                          |   430 |        0 |
|   8 | `src/shared/onlypreview/onlyPreviewFind.registry.ts`                                      |    29 |        0 |
|   9 | `src/renderer/onlypreview/common/onlyPreviewI18n.ts`                                      |   361 |        0 |
|  10 | `src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts`                      |   125 |        0 |
|  11 | `src/renderer/onlypreview/shell/src/components/PreviewToolbar/PreviewToolbar.vue`         |    69 |        0 |
|  12 | `src/renderer/onlypreview/shell/src/components/FindBar/FindBar.vue`                       |   127 |        0 |
|  13 | `src/renderer/onlypreview/shell/src/onlyPreviewFind.store.ts`                             |   212 |        0 |
|  14 | `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`                            |   790 |        0 |
|  15 | `src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts`                    |   140 |        0 |
|  16 | `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`                        |   721 |        0 |
|  17 | `src/renderer/onlypreview/preview/src/onlyPreviewFindAdapter.service.ts`                  |   150 |        0 |
|  18 | `src/renderer/onlypreview/preview/src/onlyPreviewMonacoFind.service.ts`                   |   111 |        0 |
|  19 | `src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue` |   137 |        0 |
|  20 | `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`       |   223 |        0 |
|  21 | `src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.vue`           |   519 |        0 |
|  22 | `src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.store.ts`      |   411 |        0 |
|  23 | `tests/onlypreview/onlyPreviewFind.test.mjs`                                              |   719 |        0 |
|  24 | `tests/onlypreview/onlyPreviewFindRenderer.test.mjs`                                      |   466 |        0 |
|  25 | `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`                                     |   764 |        0 |
|  26 | `tests/onlypreview/onlyPreviewPreviewRegionTest.helper.mjs`                               |   514 |        0 |
|  27 | `tests/onlypreview/onlyPreviewPreviewView.test.mjs`                                       |   307 |        0 |
|  28 | `tests/onlypreview/onlyPreviewCore.test.mjs`                                              |   230 |        0 |
|  29 | `tests/onlypreview/onlyPreviewCoreTest.helper.mjs`                                        |    73 |        0 |
|  30 | `tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs`                                     |   543 |        0 |
|  31 | `tests/onlypreview/onlyPreviewAppWiring.test.mjs`                                         |   565 |        0 |
|  32 | `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`                                 |   450 |        0 |
|  33 | `tests/onlypreview/onlyPreviewAdapterSource.test.mjs`                                     |   428 |        0 |
|  34 | `tests/onlypreview/onlyPreviewRendering.test.mjs`                                         |   122 |        0 |
|  35 | `tests/onlypreview/onlyPreviewRenderingTest.helper.mjs`                                   |   435 |        0 |
|  36 | `tests/onlypreview/onlyPreviewRenderingAdapters.test.mjs`                                 |   377 |        0 |
|  37 | `tests/onlypreview/onlyPreviewCharacterCount.test.mjs`                                    |   176 |        0 |
|  38 | `tests/onlypreview/onlyPreviewSheetGrid.test.mjs`                                         |   317 |        0 |
|  39 | `tests/onlypreview/onlyPreviewSheetGridTest.helper.mjs`                                   |   141 |        0 |
|  40 | `tests/onlypreview/onlyPreviewSheetGridMounted.test.mjs`                                  |   457 |        0 |
|  41 | `tests/onlypreview/onlyPreviewSheetController.test.mjs`                                   |    76 |        0 |

The one scoped `function` expression remains the mounted-DOM `HTMLElement.prototype.scrollTo`
stub. It depends on dynamic `this`, so conversion to an arrow would change semantics and is not a
TS-2 finding. No other scoped function declaration/expression, FE-1 flow, or FE-2 event was found.

### Review-1 code-review finding closure

| Review-1 finding                               | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS-1: 1,204-line Preview Region                | CLOSED | Region is 797 lines and retains selection revision, presentation, capability, find authority, runtime validation, and transition fences. `onlyPreviewPreviewView.service.ts` is a 548-line sibling limited to Vue/Chrome WebContents, session, navigation, attachment, watchdog, and teardown lifecycle. Its callbacks are fenced by exact runtime/view/generation/revision, and the focused Region/View suites pass. |
| FE-1: Sheet business workflow lived in the SFC | CLOSED | `SheetPreview.store.ts` (411 lines) owns async layout/viewport coalescing, activation, search generations, cross-sheet reveal, adapter execution, ready-once, and error reporting. `SheetPreview.vue` (519 lines) retains DOM refs, measurement, scroll/focus projections, and thin event bindings (`:178-230`). Mounted race and controller tests pass.                                                              |
| FE-2: parameterized Sheet business error event | CLOSED | `SheetPreview.vue:178-183` declares only `defineEmits<{ ready: [] }>()`. The controller maps terminal errors and calls `onlyPreviewPreviewStore.reportSurfaceError()` with its reporting revision; no parent error forwarding remains. The two controller/source regressions pass.                                                                                                                                    |
| TS-1: 1,486-line Preview Region test           | CLOSED | The Region harness/test and extracted View lifecycle test are 514/764/307 lines. Native identity, pending/ready, runtime, crash, navigation, selection, refresh, and teardown negative cases remain executable and pass.                                                                                                                                                                                              |
| TS-1: 2,265-line Core test                     | CLOSED | Core/helper/workspace/app-wiring/source-integration are 230/73/543/565/450 lines. Host/workspace/protocol, allowlist, startup, app/build wiring, and source-boundary assertions remain present and glob discoverable.                                                                                                                                                                                                 |
| TS-1: 1,089-line Rendering test                | CLOSED | Rendering/helper/adapter-source/rendering-adapters/character-count are 122/435/428/377/176 lines. Markdown, native selection isolation, adapter mounting, model search, media/image, and character-count assertions remain present and pass.                                                                                                                                                                          |
| TS-1: 864-line Sheet Grid test                 | CLOSED | Pure grid/helper/mounted/controller files are 317/141/457/76 lines. Full-model and cross-sheet search, partial coverage, bounded DOM, active-cell reveal, stale resize/query/sheet races, and controller ownership remain asserted and pass.                                                                                                                                                                          |

Split integrity was checked directly rather than inferred from line counts: every new helper is
imported by a glob-discoverable `*.test.mjs` owner, critical test names and negative assertions remain,
and `node --test tests/onlypreview/*.test.mjs` reports 315 tests, 315 passes, 0 skipped, and 0 todo.
Review 1 reported 311 tests; the four additions are the two behavioral blocker regressions plus the
two Sheet controller/zero-parameter-event regressions. No deleted, skipped, exclusive, or weakened
case was found.

## Regression contract audit

| Requirement                                                    | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One Shell Find Bar; no third current-file-find view/window     | PASS   | `PreviewToolbar` mounts the one `FindBar`; the Region/View pair owns exactly Vue and Chrome Preview content views. The existing hidden Project Search `fileSearch` owner is unchanged and is not a current-file-find UI or third Preview surface.                                                                                                                                                                          |
| Exhaustive capability and Main-only authority                  | PASS   | `onlyPreviewFind.registry.ts` maps HTML/PDF/Markdown/DOCX to native find, Monaco/XLSX to exact content adapters, and image/media/unsupported to none. `onlyPreviewFind.service.ts:120-165,191-221,303-317` is the sole `findRevision`, accepted intent, selection, surface, and capability authority. Renderers receive no WebContents identity.                                                                           |
| Native WebContents identity/generation/requestId fences        | PASS   | Main binds the actual WebContents plus generation and accepts `found-in-page` only when exact WebContents, current target, generation, Electron requestId, selection, surface, and find revision all match (`onlyPreviewFind.service.ts:105-118,320-407`). Destroyed targets and thrown `findInPage()` become truthful unavailable; `stopFindInPage('clearSelection')` teardown is contained (`:338-361,410-457`).         |
| Exact Vue adapter/runtime handshake and pending-to-ready once  | PASS   | Region requires current host/selection/runtime and the registry's exact adapter, with XLSX coverage mandatory (`onlyPreviewPreviewRegion.service.ts:443-493`). The bridge validates exact command identity and monotonic revision, fences async generations, and reports only through the current runtime. A queued query dispatches only on the exact pending-to-ready transition (`onlyPreviewFind.service.ts:151-165`). |
| Rapid `a -> ab`, IME, and stale snapshots                      | PASS   | Fetch generations keep `ab` when the older `a` snapshot resolves last. Store composition ownership preserves an in-progress draft across a Main snapshot and commits the final composition once. Both behavioral regressions pass.                                                                                                                                                                                         |
| Cmd/Ctrl+F versus Shift Project Search, Esc, and focus restore | PASS   | Shortcut predicates reject repeat/Alt/extra modifiers and distinguish exact platform modifier+F from modifier+Shift+F. Shell, Vue, and raw Chrome bindings open/focus the Shell bar. Plain Escape and XPC close clear find then restore the current active content; the explicit close handler performs both operations (`onlyPreview.handler.ts:282-288`).                                                                |
| Narrow Preview pane                                            | PASS   | The fixed 43px toolbar truncates/hides identity before controls at the declared container breakpoints; the input retains its bounded compact minimum, so the bar does not grow or cover content. Source assertions and scoped style checks pass.                                                                                                                                                                           |
| Monaco complete count, exact original range, one decoration    | PASS   | The adapter counts the complete accepted model, navigates through original-model match ranges, writes at most one decoration, calls reveal on that range, and never changes editor selection. Dense 8 MiB and Unicode-expansion regressions pass.                                                                                                                                                                          |
| XLSX complete/partial and cross-sheet behavior                 | PASS   | Search runs in the Worker-owned accepted cell model. Complete coverage navigates offscreen and across sheets with one active cell; cap-limited models report `partial` with exact accepted sheet/cell truth. Mounted tests fence stale viewport, sheet, resize, query, reveal, and clear completions.                                                                                                                      |
| Markdown/DOCX native readiness and selected-count isolation    | PASS   | Markdown reports readiness after mounted DOM/selection setup; DOCX reports after connected sanitized DOM. Both then use native `findInPage()`. Preview Store suppresses native-find-induced selected-count reporting for the exact host/selection/surface/adapter and broadcasts neutral count truth; Monaco find never mutates selection.                                                                                 |
| Image/media/error/oversize have no fake find                   | PASS   | Registry mode is `none`; unavailable content does not open a session or publish false `0/0`. Source and focused registry/failure tests pass.                                                                                                                                                                                                                                                                               |
| Selection/reload/crash/workspace clear revoke old find         | PASS   | Region calls `beginTransition()` before revoking capability, detaching/destroying views, rotating revisions/runtime, or publishing the replacement. Vue and Chrome crash, stale callback, reload/watch, selection, workspace-clear, and host teardown cases pass.                                                                                                                                                          |
| No raw injection, raw preload, or aggregate search             | PASS   | Raw Chrome uses a fresh partition, sandbox/context isolation, no Node, denied windows/permissions/downloads/remote schemes/proxy, and exact navigation. It has no preload or renderer XPC. Current-file find calls `findInPage()` and contains no `executeJavaScript`, DOM injection, `<mark>` mutation, raw-page UI, or cross-WebContents aggregation.                                                                    |
| Docs, Path, and status truth                                   | PASS   | All 45 Task Path entries exist. Task, plan, design, feature, and analysis remain consistent with `implemented; independent review pending`; this reviewer did not advance task status.                                                                                                                                                                                                                                     |

## Fresh verification

| Command / audit                                                                                                                    | Result                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused registry/parser, Main/native/content, Region/View, Store/IME, UI-source, Sheet-controller/mounted, and integration command | PASS — 64/64, 0 skipped/todo                                                                                                                                                                                                       |
| `node --test tests/onlypreview/*.test.mjs`                                                                                         | PASS — 315/315, 0 skipped/todo, 5.6 s                                                                                                                                                                                              |
| `yarn typecheck:node`                                                                                                              | PASS                                                                                                                                                                                                                               |
| `yarn typecheck:web`                                                                                                               | Expected repository baseline failure — 76 diagnostics outside OnlyPreview; 0 OnlyPreview diagnostics                                                                                                                               |
| `yarn check:renderer-i18n`                                                                                                         | PASS                                                                                                                                                                                                                               |
| Scoped `yarn eslint --no-cache` over exact Task-019 source/tests                                                                   | PASS — 0 errors/warnings                                                                                                                                                                                                           |
| Scoped `yarn prettier --check` over exact Task-019 source/tests/docs                                                               | PASS                                                                                                                                                                                                                               |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`                                         | PASS — 22.9 s                                                                                                                                                                                                                      |
| Emitted entry/chunk/preload audit                                                                                                  | PASS — visible OnlyPreview entries remain guide/settings/shell/preview; DOCX is a dynamic `docx-preview` chunk; ExcelJS stays behind `onlyPreviewSheet.worker`; raw Chrome has no preload; no current-file-find renderer was added |
| TS-1/TS-2/FE-1/FE-2 and line-count audit                                                                                           | PASS — 0 findings; maximum scoped file is Region at 797 lines, maximum scoped test is 764 lines                                                                                                                                    |
| Test-split, 45-path, diff, and cross-ledger audits                                                                                 | PASS                                                                                                                                                                                                                               |
| `git diff --check`                                                                                                                 | PASS                                                                                                                                                                                                                               |
| Electron/Playwright E2E, real app, ordinary `yarn build`, packaged smoke                                                           | NOT RUN — explicitly prohibited; Ral owns final runtime/visual verification                                                                                                                                                        |

## Non-blocking observations

- Repository-wide `typecheck:web` still has 76 pre-existing diagnostics in Connector, Poker, Home,
  Maestro, Omni, and shared paths; none is under OnlyPreview or caused by Task 019.
- Runtime/visual checks for HTML/PDF/Markdown/DOCX native highlight, Monaco/XLSX navigation,
  selected-character isolation, narrow-pane layout, and focus restoration remain Ral's explicit
  handoff because this review was prohibited from launching Electron or E2E.

## Conclusion

**PASS.** Both behavioral blockers and all seven review-1 code-review P2 findings are closed, and no
new P0, P1, P2, docs-sprint contract mismatch, stub, mock, or fake integration path was found. Task
status was not advanced by this reviewer.
