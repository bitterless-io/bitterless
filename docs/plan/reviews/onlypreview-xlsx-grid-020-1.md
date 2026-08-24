# OnlyPreview XLSX Grid 020 — Independent Review 1

Status: **BLOCKED**

Date: 2026-08-20

## Verdict

The implementation has a strong isolation and admission foundation: Main issues one finite
revision-bound asset, OOXML preflight proves exact ZIP closure and actual expansion/CRC before the
dynamic ExcelJS import, the disposable Worker owns the bounded model, and the production build keeps
ExcelJS out of the Preview entry. The focused 117/117 tests and full 245/245 OnlyPreview suite pass.

It is not ready for owner verification. One P1 lifecycle defect lets an already-ready workbook remain
visibly ready after its Worker has become terminal, and seven P2 contract/UI/ledger defects remain.
The blocking items include an explicitly forbidden single-cell merge form, incorrect 1900-system
dates after the real ExcelJS load path, an unclosed viewport validation bound, a search-reveal race,
two accepted-but-unrendered alignment modes, broken multi-tab keyboard/grid semantics, and a
premature docs-sprint state transition.

## Findings

### 1. [P1][blocking] A terminal Worker failure after first render never clears Store/Main ready truth

- **Contract:** task 020 requires every error, timeout, crash, selection/surface change, or unmount to
  terminate the Worker **and clear grid/search state**, never leaving a stale ready surface
  (`docs/plan/tasks/onlypreview-xlsx-grid-020.md:140-150`; the same rule is repeated in
  `docs/design/onlypreview-format-coverage.md:156-158`).
- **Code:** `OnlyPreviewSheetSession.failWorker()` and `failTerminal()` terminate, null the manifest,
  and reject pending Promises, but expose no unexpected-terminal callback/subscription to their owner
  (`src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts:813-832`). The Store constructs
  the session without such a lifecycle channel
  (`src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts:353-365`). Layout/viewport
  rejections happen to be caught by `SheetPreview`, but `query`/`next`/`previous`/`clear`/`reveal`
  rejection is only returned to the caller (`SheetPreview.vue:558-584`), and an idle Worker `error`
  has no pending Promise at all.
- **Impact:** after the grid has reported ready, an idle Worker crash or a search request timeout can
  dispose the only model while the mounted grid, Store `loadedRevision`, and Main Preview revision all
  remain ready. The user sees stale cells and a dead search adapter instead of the required truthful
  unavailable state.
- **Minimum fix:** add a one-shot unexpected-terminal notification to `OnlyPreviewSheetSession`.
  Normal owner `dispose()` must be silent. The Store must bind the callback to the exact session,
  local generation, selection revision, and reporting revision, then clear the session/manifest/grid,
  disarm reporting, install the typed failure, and report that failure to Main only if all fences are
  still current. Add behavior tests for (1) an idle Worker error after first ready, (2) a pending
  search error/timeout, (3) stale-session failure after selection change, and (4) normal dispose
  producing no error report.

### 2. [P2][blocking] OOXML preflight accepts the explicitly forbidden `A1:A1` merge record

- **Contract:** the lexical gate permits one explicit bounded two-coordinate range but says a
  single-cell range is invalid (`docs/plan/tasks/onlypreview-xlsx-grid-020.md:91-98` and
  `docs/design/onlypreview-format-coverage.md:137-142`).
- **Code:** `mergeExpandedCellCount()` accepts any ordered rectangle whose expanded count is at least
  one, so `A1:A1` succeeds (`src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.service.ts:530-553`).
  The exact-record-cap fixture repeats `A1:A1` 100,000 times and expects admission, codifying the
  opposite contract (`tests/onlypreview/onlyPreviewOoxmlPreflight.test.mjs:577-588`).
- **Minimum fix:** reject ranges whose two endpoints are identical before returning the expanded
  count. Replace the record-cap fixture with a valid two-cell range such as `A1:B1`, add a direct
  `A1:A1 -> OOXML_ARCHIVE_INVALID` regression, and reject single-cell merges again in the
  model/response validator as defense in depth.

### 3. [P2][blocking] The real ExcelJS load path cannot render the promised 1900 date-system values

- **Contract:** display and Worker search must share one formatter, including Excel's 1900 leap-day
  quirk (`docs/plan/tasks/onlypreview-xlsx-grid-020.md:123-130` and
  `docs/design/onlypreview-format-coverage.md:160-161`).
- **Code:** the numeric formatter has a serial-60 special case
  (`src/renderer/onlypreview/preview/src/onlyPreviewSheetFormat.service.ts:174-184`), but the exported
  formatter sends `Date` values directly through `formatDate()`
  (`onlyPreviewSheetFormat.service.ts:219-230`). The model passes ExcelJS's already-decoded
  `cell.value` to that branch (`onlyPreviewSheetModel.service.ts:380-395`).
- **Reproduction:** a real ExcelJS write/load round trip for numeric serial `60` with an Excel date
  format produces a `Date` of `1900-02-28T00:00:00.000Z`; the app therefore displays `2/28/1900`,
  while invoking the same formatter with raw numeric `60` displays the promised `2/29/1900`.
  Serial `59` is likewise decoded one day early. Existing tests cover normal modern `Date` values and
  direct numeric formatting, not this engine round trip.
- **Minimum fix:** preserve or recover the raw numeric serial before ExcelJS converts it to `Date`
  (the fake day cannot be reconstructed unambiguously from the decoded `Date` alone), then feed the
  same normalized value to display and search. Add real workbook round-trip assertions for 1900
  serials 59, 60, and 61, plus search parity for their rendered strings; retain a 1904-system
  control.

### 4. [P2][blocking] The viewport validator does not bound the merge expansion work performed by Vue

- **Contract:** every Worker response is to be runtime-validated against the model caps, a viewport
  covers at most 50,000 coordinates, and mounted work/DOM must stay proportional to that viewport
  (`docs/plan/tasks/onlypreview-xlsx-grid-020.md:100-106,123-127,158-165`).
- **Code:** validation only limits `merges.length` to `viewportArea`; it does not bound aggregate
  merge/viewport intersections or reject overlapping ranges
  (`src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts:361-417`). Vue then expands every
  returned merge over every intersecting row and column
  (`src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.vue:245-264`).
- **Reproduction:** the actual validator accepted four identical full-viewport merges for a 2x2
  viewport: `viewportArea=4`, `mergeCount=4`, aggregate intersection work `=16`. At the allowed
  50,000-coordinate boundary, an abnormal response can therefore induce area-squared iteration even
  though the shape validator claims to close the Worker boundary. The real Worker normally emits
  non-overlapping preflighted merges; that does not make the renderer's explicit defense-in-depth
  validator complete.
- **Minimum fix:** while validating, sum each merge's intersection area with the requested viewport
  and reject once the sum exceeds `viewportArea`; also reject overlapping ranges, duplicate masters,
  and single-cell merges. A legitimate Excel merge model is non-overlapping and naturally satisfies
  this bound. Add exact-bound and one-past/overlap response tests using the real session validator.

### 5. [P2][blocking] A concurrent resize/scroll viewport refresh can cancel a valid sheet activation and search reveal

- **Contract:** an accepted offscreen/cross-sheet search result must switch sheets, reveal the target,
  and highlight it, while stale responses must not install
  (`docs/plan/tasks/onlypreview-xlsx-grid-020.md:134-139,157-165`).
- **Code:** every `requestVisibleViewport()` increments one shared `viewportGeneration` and returns
  `false` when any newer viewport request exists
  (`src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.vue:344-394`).
  `performActivateSheet()` interprets that `false` as activation failure (`SheetPreview.vue:404-449`),
  and `revealCellForGeneration()` permanently abandons the target after either activation or its own
  explicit viewport request returns false (`SheetPreview.vue:514-549`). Resize and scroll can start
  the competing request (`SheetPreview.vue:481-490,602-604`).
- **Impact:** during cross-sheet search, V1 may be the activation's viewport request and V2 a resize
  refresh. V2 invalidates V1, so the activation Promise resolves false and the search reveal exits;
  V2 may still install cells, but no code retries the still-current target or applies its highlight.
  The mounted harness checks resize while layout is absent (`onlyPreviewSheetGrid.test.mjs:618-637`),
  not the V1-resolved/V2-pending activation window.
- **Minimum fix:** coalesce/serialize current-sheet viewport requests, or distinguish "superseded by a
  newer valid current-sheet request" from logical sheet-activation failure and await that successor.
  Preserve/retry the exact target under the current search and sheet generations. Add a mounted
  cross-sheet-search test that triggers ResizeObserver after layout but before V1 settles and proves
  the final active sheet, target cell, scroll, and highlight.

### 6. [P2][blocking] `fill` and `justify` are accepted alignment modes but do not render their Excel semantics

- **Contract:** the delivered grid claims horizontal alignment support
  (`docs/plan/tasks/onlypreview-xlsx-grid-020.md:123-127`).
- **Code:** the Worker contract, extractor, and response validator accept `fill` and `justify`
  (`src/renderer/onlypreview/preview/src/workers/onlyPreviewSheetWorker.contract.ts:63-65`,
  `onlyPreviewSheetFormat.service.ts:250-257`, and `onlyPreviewSheet.service.ts:320-327`). In the cell
  CSS, `fill` falls through to `flex-start`; `justify` becomes `justify-content: space-between`, but
  each cell contains only one span, so that declaration has no visible effect
  (`src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.vue:211-242` and
  `:100-120`).
- **Minimum fix:** either implement the real visible semantics with bounded rendering, or remove
  these two values from the accepted type/extractor/validator and state the supported subset
  truthfully. Add mounted style/visual-contract assertions for every accepted horizontal value.

### 7. [P2][blocking] Sheet tabs cannot traverse reliably by keyboard, and the focused element is not the ARIA grid

- **Code:** arrow/Home/End changes the active sheet but never moves DOM focus to the newly active tab
  (`src/renderer/onlypreview/preview/src/components/SheetPreview/SheetPreview.vue:13-27,500-512`).
  Focus stays on the old button after it receives `tabindex=-1`; another ArrowRight still calculates
  from the old sheet ID, so a workbook with three or more sheets cannot be traversed normally. The
  element with `role="grid"` owns the row/column counts, while a nested role-less viewport owns
  `tabindex`, keyboard handling, and `aria-activedescendant` (`SheetPreview.vue:37-44,84-123`). Thus
  assistive technology focus is not on the composite that owns the active descendant, and the
  `gridcell` elements are not organized under `row` containers.
- **Minimum fix:** use roving-tab refs and focus the newly active tab after activation. Put
  `role="grid"`, `tabindex`, `aria-activedescendant`, counts, and the grid key handler on one focus
  owner, and expose valid virtual `row`/`gridcell` semantics. Add mounted three-sheet keyboard tests
  for Left/Right/Home/End and focused active-descendant/row ownership assertions.

### 8. [P2][blocking] The docs ledger skips the required independent-review state

- Task frontmatter and the plan row already say `implemented; owner verification pending`
  (`docs/plan/tasks/onlypreview-xlsx-grid-020.md:1-5` and `docs/plan/README.md:40`). The format design
  and analysis likewise claim 020 is implemented and awaiting owner runtime verification
  (`docs/design/onlypreview-format-coverage.md:6-15,24-30`,
  `docs/design/onlypreview-preview-merge-find.md:627-635,679-682`, and
  `docs/plan/analysis/onlypreview.md:218-226`).
- That contradicts the established 023/024 docs-sprint baseline: before a passing independent review,
  implementation state is `implemented; independent review pending`; owner verification is the
  post-PASS handoff. This review is blocked, so the current wording also overstates delivery truth.
- **Minimum fix:** while addressing these findings, return the task/plan/design/analysis status to
  independent-review pending. Advance all ledgers atomically to owner verification only after a
  later independent review records PASS. The task's actual `# Path` is otherwise exact; the
  concurrent package-version and Omni files are correctly absent and must remain outside task 020.

## Accepted boundaries

- **Main asset/CORS/revoke:** sheet asset issuance is revision-bound and size/signature gated; the
  exact GET response exposes only the needed CORS allowance and the Region lifecycle revokes the
  capability. No broader document resolver authority was introduced.
- **OOXML admission:** apart from the single-cell merge contradiction above, exact EOCD/central/local
  closure, STORE/DEFLATE actual inflation, CRC32, declared/actual size and ratio caps, encrypted/
  Zip64/data-descriptor rejection, strict/tolerant namespace collision checks, and required package
  parts are enforced before engine import.
- **Worker/model:** the Worker is created only after renderer byte/signature/size checks; OOXML
  preflight precedes dynamic ExcelJS import; bytes use a transfer list; hard timers terminate rather
  than merely drop callbacks; request identity includes host, selection revision, runtime nonce, and
  Worker generation. Sheet/cell/text/dimension caps and truthful `sheet-model-cap` partial coverage
  are otherwise internally consistent. Cached formula display and search share the accepted formatted
  string and do not expose formula source or recalculate.
- **Response validation:** manifest, layout, cell, search, coverage, identity, and exact-key checks are
  strong except for the merge-work bound in finding 4.
- **Ready-after-unmount probe:** the initially suspected post-`nextTick()` stale `ready` event was
  exercised through the compiled component and real Vue runtime. Vue's component `emit()` suppresses
  emission once the old keyed instance is unmounted, so it is not recorded as a finding. A focused
  regression for the resolve -> render-flush -> selection-change window would still make that
  framework-dependent boundary explicit.
- **Task scope:** the task Path accounts for the 020 implementation. Concurrent Omni work,
  `package.json` versioning, and other owner changes were preserved and excluded from this review.

## Independent verification

| Check                                             | Result                                                                                                                                             |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| focused 020/core/protocol/region/rendering suite  | PASS — 117/117                                                                                                                                     |
| `node --test tests/onlypreview/*.test.mjs`        | PASS — 245/245                                                                                                                                     |
| `yarn typecheck:node`                             | PASS                                                                                                                                               |
| `yarn typecheck:web`                              | FAIL — only the pre-existing connector, poker test-global, RigChat, Home, Maestro, Omni, and `pathHelper` baseline; no OnlyPreview/XLSX diagnostic |
| `yarn check:renderer-i18n`                        | PASS                                                                                                                                               |
| scoped ESLint over exact 020 TS/Vue/tests         | PASS — 0 errors; 4 existing shared-rendering-harness warnings                                                                                      |
| scoped Prettier over exact 020 files              | PASS                                                                                                                                               |
| `debug_dev` Electron Vite source build            | PASS — Preview entry 1,508 bytes, Worker 59,809 bytes, separate ExcelJS 1,446,082 bytes; only the Worker references ExcelJS                        |
| adversarial real-ExcelJS 1900-date probe          | FAIL as described in finding 3                                                                                                                     |
| adversarial runtime viewport-validation probe     | FAIL as described in finding 4                                                                                                                     |
| `git diff --check`                                | PASS                                                                                                                                               |
| Electron/Playwright E2E, real app, packaged smoke | NOT RUN — explicitly prohibited; Ral owns runtime/visual acceptance                                                                                |

## Conclusion

**BLOCKED.** Close the P1 terminal-truth defect and all P2 findings, update the docs ledger back to
the independent-review gate, add the specified focused regressions, and request a fresh independent
review before owner verification.
