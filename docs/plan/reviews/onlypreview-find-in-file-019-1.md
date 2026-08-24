# Independent Review Round 1 — onlypreview-find-in-file-019

Status: **BLOCKED**

Date: 2026-08-21  
Scope: Task 019 current-file Find Bar implementation, authoritative design #7.1/#7.2/#7.4/#7.5,
feature/analysis/task truth, exact Task Path source and tests, fresh non-E2E gates, and emitted build
graph. The shared worktree also contains Tasks 020–022 and unrelated owner changes; this review
restricts findings and verification claims to Task 019's declared paths. Electron/Playwright E2E,
the real app, ordinary `yarn build`, and packaged smoke were intentionally not run.

## Summary

Task 019 is blocked by two P2 contract defects:

1. an accepted Main snapshot can overwrite the controlled Find input while an IME composition is in
   progress; and
2. Monaco's case-insensitive scanner computes offsets in a length-changing lowercased string and
   applies them directly to the original model, so valid Unicode matches can be highlighted and
   revealed at the wrong location.

Both defects were reproduced with fresh in-memory probes. The committed focused tests pass because
the IME assertion checks only the presence of composition handlers and the Monaco model test uses
ASCII-only input.

The remaining Main ownership, native WebContents identity/generation/requestId fences, exact runtime
adapter handshake, pending-to-ready dispatch, rapid `a -> ab` fencing, shortcut separation, clear and
focus lifecycle, XLSX coverage, DOM readiness, image/media `none`, and two-view/no-injection contracts
are supported by source and passing tests.

The workspace code-review rules add seven P2 maintainability findings. They are **non-blocking** under
the docs-sprint definition because none changes product behavior or leaves a stub/mock/fake
integration path. They remain explicit rather than grandfathered.

## Findings

### P0

None.

### P1

None.

### P2

#### 1. [P2][blocking] A Main snapshot can erase the live IME draft

- **Contract:** Task 019 requires an IME-safe single input and accepts a queued query while capability
  is pending (`docs/plan/tasks/onlypreview-find-in-file-019.md:67-72,83-85,120-128`). The analysis
  records the delivered input as IME-safe (`docs/plan/analysis/onlypreview.md:291-295`).
- **Code:** `FindBar.vue:86-88,100-118` keeps `composing` only in the component and calls
  `setDraftQuery()` during composition. `onlyPreviewFind.store.ts:50-66,99-101` has no composition or
  draft generation fence; every accepted snapshot overwrites `query` whenever
  `pendingSubmissions === 0`. Find-state nudges call this sync independently
  (`onlyPreviewShellEvents.service.ts:134-139`).
- **Fresh proof:** initialize Main truth with query `old`, call `setDraftQuery('正在组合')`, then deliver
  one current-host snapshot. The Store changed the controlled input from `正在组合` back to `old`
  (`draftPreserved: false`). A pending-to-ready nudge, native result, or completion of an earlier
  submission can all trigger that path while the user is composing.
- **Impact:** the visible composition can be rewritten/cancelled and `compositionend` can commit the
  wrong text. `pendingSubmissions` protects only an in-flight submission; it does not protect a local
  composition draft.
- **Required fix:** make composition/draft ownership part of the Store (begin/update/end or an
  equivalent generation fence), refuse to install snapshot query/case truth over the live draft, and
  commit the latest composition value exactly once on end. Add a behavioral test that injects a
  find-state snapshot during composition, then proves the draft survives and exactly one final query
  is submitted.

#### 2. [P2][blocking] Monaco maps length-changing folded offsets onto the original model

- **Contract:** Monaco must search the complete accepted model and reveal/highlight the exact active
  literal match with the selected case mode while retaining at most one decoration
  (`docs/design/onlypreview-preview-merge-find.md:475-478,627-630`;
  `docs/plan/tasks/onlypreview-find-in-file-019.md:92-99,120-128`).
- **Code:** `onlyPreviewMonacoFind.service.ts:35-49,75-94` lowercases the entire source/query when
  case-insensitive, stores offsets from that folded string, then passes those offsets directly to
  `model.getPositionAt()` for the original source.
- **Fresh proof:** for original model `İx`, `sourceText.toLowerCase()` is `i̇x` (three UTF-16 code
  units, versus two in the source). Searching for `x` reports one match but reveals/decorates columns
  `3..4`; the correct source range starts at column `2`.
- **Impact:** count truth can be right while the only allowed active decoration and viewport reveal
  are wrong or out of range. Case-fold expansions before a match trigger the defect.
- **Required fix:** preserve a folded-to-source offset map (including end boundaries), or iterate a
  model API that returns original-model ranges without materializing all matches. Add a Unicode
  expansion regression such as `İx` / `x` and retain the 8 MiB count plus one-decoration assertions.

## Code-review audit

The table lists every Task-019 scoped TS/JS/Vue file. Problem counts here cover only TS-1, TS-2,
FE-1, and FE-2; the two behavioral blockers above are not duplicated in this count.

### File list

|   # | File                                                                                      | Problems |
| --: | ----------------------------------------------------------------------------------------- | -------: |
|   1 | `src/main/onlypreview/views/onlyPreviewFind.service.ts`                                   |        0 |
|   2 | `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`                          |        1 |
|   3 | `src/main/windows/onlyPreviewWindow.helper.ts`                                            |        0 |
|   4 | `src/main/xpc/onlyPreview.handler.ts`                                                     |        0 |
|   5 | `src/shared/onlypreview/onlyPreview.types.ts`                                             |        0 |
|   6 | `src/shared/onlypreview/onlyPreview.contract.ts`                                          |        0 |
|   7 | `src/shared/onlypreview/onlyPreviewFind.registry.ts`                                      |        0 |
|   8 | `src/renderer/onlypreview/common/onlyPreviewI18n.ts`                                      |        0 |
|   9 | `src/renderer/onlypreview/shell/src/components/PreviewToolbar/PreviewToolbar.vue`         |        0 |
|  10 | `src/renderer/onlypreview/shell/src/components/FindBar/FindBar.vue`                       |        0 |
|  11 | `src/renderer/onlypreview/shell/src/onlyPreviewFind.store.ts`                             |        0 |
|  12 | `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`                            |        0 |
|  13 | `src/renderer/onlypreview/shell/src/onlyPreviewShellEvents.service.ts`                    |        0 |
|  14 | `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`                        |        0 |
|  15 | `src/renderer/onlypreview/preview/src/onlyPreviewFindAdapter.service.ts`                  |        0 |
|  16 | `src/renderer/onlypreview/preview/src/onlyPreviewMonacoFind.service.ts`                   |        0 |
|  17 | `src/renderer/onlypreview/preview/src/components/MonacoTextPreview/MonacoTextPreview.vue` |        0 |
|  18 | `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`       |        0 |
|  19 | `src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.vue`           |        2 |
|  20 | `tests/onlypreview/onlyPreviewFind.test.mjs`                                              |        0 |
|  21 | `tests/onlypreview/onlyPreviewFindRenderer.test.mjs`                                      |        0 |
|  22 | `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`                                     |        1 |
|  23 | `tests/onlypreview/onlyPreviewCore.test.mjs`                                              |        1 |
|  24 | `tests/onlypreview/onlyPreviewRendering.test.mjs`                                         |        1 |
|  25 | `tests/onlypreview/onlyPreviewSheetGrid.test.mjs`                                         |        1 |

### Problem list

#### 2. `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`

| #   | Lines  | Rule | Problem                                                                                                                                                                                   | Recommendation                                                                                                                                                                         |
| --- | ------ | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | 1-1204 | TS-1 | The scoped integration service is 1,204 lines, above the 800-line limit. It was already 820 lines at `HEAD`, but TS-1 has no grandfather exception and the current Task Path modifies it. | Extract the raw-Chromium view/session/navigation lifecycle or another cohesive Region domain into a sibling service while keeping Main ownership and revision transitions centralized. |

#### 19. `src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.vue`

| #    | Lines           | Rule | Problem                                                                                                                                                                                                                  | Recommendation                                                                                                                                                                                  |
| ---- | --------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19.1 | 391-709,727-748 | FE-1 | The business component owns async viewport coalescing, sheet activation, search generations, Worker-session query/navigation, cross-sheet reveal, and adapter result orchestration instead of binding to a `*.store.ts`. | Move session/search/activation state progression to a `SheetPreview.store.ts` controller; keep DOM refs, measurements, focus, and presentation binding in the SFC.                              |
| 19.2 | 198-201,438,555 | FE-2 | This non-generic business component emits a parameterized `error` code, which `PreviewSurface.vue:79-85` forwards to the Preview Store.                                                                                  | Report the typed error through the Preview Store/controller with the component's reporting revision and remove the parameterized business emit. The zero-argument `ready` emit is outside FE-2. |

#### 22. `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`

| #    | Lines  | Rule | Problem                                                                        | Recommendation                                                                                                                   |
| ---- | ------ | ---- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 22.1 | 1-1486 | TS-1 | The integration test is 1,486 lines, above the 800-line limit (815 at `HEAD`). | Split find/native identity tests from Region selection/view lifecycle tests while preserving the current harness and assertions. |

#### 23. `tests/onlypreview/onlyPreviewCore.test.mjs`

| #    | Lines  | Rule | Problem                                                                   | Recommendation                                                                       |
| ---- | ------ | ---- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 23.1 | 1-2265 | TS-1 | The core test is 2,265 lines, above the 800-line limit (2,174 at `HEAD`). | Split contracts/registry and source-integration assertions into cohesive test files. |

#### 24. `tests/onlypreview/onlyPreviewRendering.test.mjs`

| #    | Lines  | Rule | Problem                                                                                                                                                 | Recommendation                                                                                   |
| ---- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 24.1 | 1-1089 | TS-1 | The renderer integration test is 1,089 lines, above the 800-line limit (599 at `HEAD`; the current shared delta includes Tasks 020–022 as well as 019). | Split model-adapter/find integration from document/media and character-count rendering coverage. |

#### 25. `tests/onlypreview/onlyPreviewSheetGrid.test.mjs`

| #    | Lines | Rule | Problem                                                                                                                                                | Recommendation                                                               |
| ---- | ----- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 25.1 | 1-864 | TS-1 | The sheet-grid test is 864 lines, above the 800-line limit. It is shared Task-020 code but is explicitly in Task 019's Path for XLSX find integration. | Split pure workbook/model tests from mounted virtual-grid/search-race tests. |

No TS-2 issue was found. The one scoped `function` expression assigns a `scrollTo` DOM prototype
stub and depends on dynamic `this`; replacing it with an arrow would change its semantics. No other
FE-1/FE-2 issue was found in the scoped Vue files.

These seven code-review findings are P2 **non-blocking** under docs-sprint: they are workspace-rule
violations and should be cleaned up, but they do not contradict the Task-019 behavior contract or
leave a fake integration path (`.agents/skills/docs-sprint/references/delivery-plan.md:91-101`).

## Contract audit

| Requirement                                                        | Result      | Evidence                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| One Shell Find Bar; no third find view/window                      | PASS        | Find UI is under `shell/components/FindBar`; `PreviewToolbar.vue` mounts that one Store-owned bar. Region still owns exactly Chrome and Vue Preview content views. Safe-build outputs have the existing `shell`, `preview`, `settings`, and `guide` entries and no find/search renderer entry.                                                                     |
| Exhaustive capability registry and runtime truth                   | PASS        | `onlyPreviewFind.registry.ts:14-25` exhaustively maps HTML/PDF/Markdown/DOCX to native, Monaco/XLSX to content adapters, and image/audio/video/unsupported to `none`; Main derives pending/ready/unavailable from exact presentation and XLSX coverage (`onlyPreviewFind.service.ts:268-300`).                                                                     |
| Main-only `findRevision`, selection, surface, and capability       | PASS        | Main increments/accepts revision and rejects stale intent/result identity (`onlyPreviewFind.service.ts:191-221,243-264,303-317`). Renderer-visible types contain no `webContentsId`; Region requires the host/runtime before delegating (`onlyPreviewPreviewRegion.service.ts:493-515,681-687`).                                                                   |
| Native identity/generation/requestId and destroy/throw containment | PASS        | Main stores WebContents object, generation, Electron requestId, selection, surface, and find revision, then checks all of them (`onlyPreviewFind.service.ts:320-407`). Destroyed targets and thrown `findInPage()` demote truth; `stopFindInPage()` teardown is contained (`:338-361,410-458`). Focused negative tests pass.                                       |
| Exact content-adapter/runtime handshake                            | PASS        | Main readiness demands the registry's exact adapter and XLSX coverage (`onlyPreviewPreviewRegion.service.ts:583-614`). The Vue bridge validates exact shape/host/selection/adapter/monotonic revision and fences async generation; result reporting returns through exact runtime capability (`onlyPreviewFindAdapter.service.ts:28-60,82-146`).                   |
| Pending query dispatches once at exact ready                       | PASS        | `syncPresentation()` dispatches only on current pending-to-ready transition (`onlyPreviewFind.service.ts:133-165`); the focused once-only regression passes (`onlyPreviewFind.test.mjs:250-291`).                                                                                                                                                                  |
| Rapid `a -> ab` and IME input                                      | **BLOCKED** | Submission fetch generations preserve `ab` against an older completion (`onlyPreviewFindRenderer.test.mjs:189-267`), but finding 1 proves a state snapshot overwrites a composition-only draft. The current IME test is source matching only (`:269-322`).                                                                                                         |
| Cmd/Ctrl+F, Shift project search, Esc, and focus restore           | PASS        | Exact non-repeat/no-Shift and Shift predicates remain separate; Main focuses Shell on open, closes on plain Escape, and focuses current content afterward (`onlyPreviewWindow.helper.ts:114-143,231-264,730-757`; Region `:518-524`).                                                                                                                              |
| Narrow Preview toolbar                                             | PASS        | The 43px toolbar truncates identity first; container rules hide path/badge at 520px and identity at 440px, while the input retains a 38px minimum (`PreviewToolbar.less:1-92`; `FindBar.less:1-93`).                                                                                                                                                               |
| Monaco complete count and one decoration                           | **BLOCKED** | The 8,388,608-match focused regression passes and decoration count never exceeds one (`onlyPreviewFindRenderer.test.mjs:100-187`), but finding 2 proves the active range is wrong after a Unicode case-fold expansion.                                                                                                                                             |
| XLSX complete/partial/cross-sheet truth                            | PASS        | The Worker accepted model owns full search and coverage; tests traverse to an offscreen second sheet, return across sheets, expose partial caps, reveal/highlight one active cell, and invalidate stale reveal (`onlyPreviewSheetGrid.test.mjs:148-250,264-374,416-858`).                                                                                          |
| Markdown/DOCX native readiness and selected-count isolation        | PASS        | Markdown reports ready only after its mounted selection gate; DOCX reports after connected sanitized DOM. Both registry entries route native find. Find-state snapshot suppression is revision/surface/adapter fenced and broadcasts neutral character truth without accepting native highlight selection (`onlyPreviewPreview.store.ts:118-130,181-195,225-278`). |
| Image/media/error/oversize have no fake find                       | PASS        | Registry assigns `none`; unavailable never opens the session and never produces `0/0` (`onlyPreviewFind.service.ts:181-188,268-300`). Focused registry/native-failure tests pass.                                                                                                                                                                                  |
| Selection, watch/reload, crash, workspace clear revoke old find    | PASS        | Region begins transition before view teardown/error/workspace replacement and rotates view/runtime generations; both crash regressions pass (`onlyPreviewPreviewRegion.service.ts:660-705,786-815,1007-1023`; tests `onlyPreviewPreviewRegion.test.mjs:602-635,1387-1438`).                                                                                        |
| No raw injection/preload or aggregate search                       | PASS        | Chrome view is sandboxed with no preload/Node/XPC and a fresh partition (`onlyPreviewPreviewRegion.service.ts:943-961`); Main uses `findInPage()`, never `executeJavaScript`; build/source audit found no raw-page find injection or third find entry.                                                                                                             |
| Docs, Path, and status truth                                       | PASS        | Every Task `# Path` exists. Task and plan remain `implemented; independent review pending`; design/feature/analysis consistently defer owner verification until a passing independent review. This reviewer did not advance status.                                                                                                                                |

## Fresh verification

| Command / audit                                                                                             | Result                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node --test tests/onlypreview/onlyPreviewFind.test.mjs tests/onlypreview/onlyPreviewFindRenderer.test.mjs` | PASS — 11/11                                                                                                                                                                      |
| IME snapshot-during-composition in-memory probe                                                             | **FAIL contract** — draft changed from `正在组合` to `old`; `draftPreserved: false`                                                                                               |
| Monaco Unicode folded-offset in-memory probe                                                                | **FAIL contract** — `İx` / `x` returned one match but revealed columns `3..4`, expected start column `2`                                                                          |
| `node --test tests/onlypreview/*.test.mjs`                                                                  | PASS — 311/311                                                                                                                                                                    |
| `yarn typecheck:node`                                                                                       | PASS                                                                                                                                                                              |
| `yarn typecheck:web`                                                                                        | Expected repository baseline failure — 76 diagnostics outside OnlyPreview; 0 OnlyPreview diagnostics                                                                              |
| `yarn check:renderer-i18n`                                                                                  | PASS                                                                                                                                                                              |
| Scoped ESLint over exact Task-019 TS/Vue/tests                                                              | PASS — 0 errors/warnings                                                                                                                                                          |
| Scoped Prettier over exact Task-019 source/tests/docs                                                       | PASS                                                                                                                                                                              |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`                  | PASS — 22.0 s                                                                                                                                                                     |
| Emitted entry/chunk/preload audit                                                                           | PASS — no find/search renderer entry; DOCX remains a dynamic `docx-preview` chunk; ExcelJS is referenced only by `onlyPreviewSheet.worker`; raw Chrome constructor has no preload |
| TS-1/TS-2/FE-1/FE-2 adversarial audit                                                                       | 7 explicit non-blocking P2 findings; no TS-2 finding                                                                                                                              |
| Task Path and cross-ledger status audit                                                                     | PASS                                                                                                                                                                              |
| `git diff --check`                                                                                          | PASS                                                                                                                                                                              |
| Electron/Playwright E2E, real app, ordinary `yarn build`, packaged smoke                                    | NOT RUN — explicitly prohibited for this review; Ral owns final runtime/visual verification after blockers close                                                                  |

## Conclusion

**BLOCKED.** Fix the IME draft/snapshot race and the Monaco folded-offset mapping, add behavioral
regressions for both, then run a new independent review. The code-review findings remain explicit
P2 non-blocking debt. Task status was not advanced by this reviewer.
