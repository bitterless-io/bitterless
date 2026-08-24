---
id: onlypreview-xlsx-grid-020
scope: Parse XLSX/XLSM in a disposable Worker and render a searchable read-only virtual workbook grid
status: implemented; owner verification pending
depends-on: [onlypreview-preview-guards-023]
---

# Objective

Preview `.xlsx` and `.xlsm` in `vuePreviewView` as a read-only virtualized workbook instead of an
unsupported state. A disposable module Web Worker performs ZIP preflight, dynamically loads
ExcelJS, owns the bounded workbook/search model, and returns only the manifest and requested visible
cell ranges to the Vue renderer. The grid supports sheets, merged cells, dimensions, alignment,
number formatting, basic fonts/fills, cached formula results, cross-sheet search, and truthful
partial coverage. It never executes macros or recalculates formulas.

# Context

- [OnlyPreview format coverage](../../design/onlypreview-format-coverage.md) — #1, #2, #6, #7, and
  #8/G1–G5
- [OnlyPreview dual preview views and find ownership](../../design/onlypreview-preview-merge-find.md)
  — #7.2 and #7.4 sheet adapter/coverage contract
- [Preview guards](onlypreview-preview-guards-023.md)
- [OnlyPreview sub-application](../../features/onlypreview.md)

# Path

- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/main/onlypreview/onlyPreviewAsset.registry.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts`
- `src/renderer/onlypreview/preview/src/components/SheetPreview/` (new)
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewSheet.worker.ts` (new)
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewSheetWorker.contract.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.service.ts` (new, pure
  `ArrayBuffer` service shared with task 021)
- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.type.ts` (new after Task 025 split)
- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlMergeScanner.service.ts` (new after Task 025 split)
- `src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewSheetResponseValidator.service.ts` (new after Task 025 split)
- `src/renderer/onlypreview/preview/src/onlyPreviewSheetSession.service.ts` (new after Task 025 split)
- `src/renderer/onlypreview/preview/src/onlyPreviewSheetFormat.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewSheetModel.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewSheetViewport.service.ts` (new)
- `src/renderer/onlypreview/preview/src/App.vue`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `tests/onlypreview/onlyPreviewSheetWorker.test.mjs` (new)
- `tests/onlypreview/onlyPreviewSheetSessionValidation.test.mjs` (new)
- `tests/onlypreview/onlyPreviewSheetDate.test.mjs` (new)
- `tests/onlypreview/onlyPreviewOoxmlPreflight.test.mjs` (new)
- `tests/onlypreview/onlyPreviewSheetGrid.test.mjs` (new)
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/onlyPreviewDocumentProtocol.test.mjs`
- `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`
- `docs/features/onlypreview.md`
- `docs/design/onlypreview-format-coverage.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-xlsx-grid-020.md`

ExcelJS is already installed; do not alter `package.json` or `yarn.lock`. Do not parse workbook bytes
in Main, preload, Shell, or the Vue UI thread. Preserve unrelated owner changes.

# Delivery

1. Classify `.xlsx` and `.xlsm` as `sheet`, require OOXML ZIP signature, and issue a finite 25MiB
   revision-bound asset capability only after descriptor gates pass. Signature mismatch, oversize,
   encrypted/corrupt, and empty workbook are distinct truthful states; no parser is loaded for
   signature/size failures. The exact asset GET/HEAD response exposes the minimal CORS header needed
   by the first-party Vue `fetch`; this does not change the document-scoped raw HTML resolver.
2. `vuePreviewView` fetches the bounded asset asynchronously, transfers the `ArrayBuffer` to one
   disposable module Worker with a transfer list, and relinquishes its copy. A reusable pure
   `ArrayBuffer` service outside the Worker-specific directory performs preflight so task 021 can
   call the same implementation. It validates the exact EOCD/central-directory/local-header closure,
   rejects trailing or ambiguous archive structures, multi-disk, Zip64, encrypted/AES records and
   data descriptors, accepts only STORE/DEFLATE, and proves every local-data interval is contained,
   non-overlapping, and outside central records. Entry names use fatal UTF-8 when the language flag
   is set and CP437 otherwise; normalized paths reject NUL/control characters, internal
   empty/dot/dot-dot segments, absolute/drive paths, backslashes, traversal, and duplicates. One
   terminal `/` is accepted only as the structural marker of a STORE, zero-compressed/zero-
   uncompressed directory entry, then removed before duplicate/segment checks; `//` and a file/
   directory namespace collision still fail. Required XLSX parts are
   `[Content_Types].xml`, `_rels/.rels`, and `xl/workbook.xml`. Exact caps are 5,000 entries, 200MiB
   declared total uncompressed bytes, 128MiB per entry, and 200:1 per-entry and aggregate compression
   ratio. Before ExcelJS is imported, stream every STORE/DEFLATE payload through a bounded
   validator: actual expanded bytes must equal the declared length, STORE and DEFLATE CRC32 must
   match, and the same single-entry/aggregate byte and ratio caps apply to actual output; exceeding
   a declared size cancels the stream immediately. For unflagged names, the canonical CP437 path
   and the workbook engine's tolerant WHATWG/JSZip UTF-8 namespace keys must all be safe and unique;
   Unicode-path override extra fields remain invalid. XLSX preflight also scans strict UTF-8
   `xl/**/*.xml` before engine import and rejects more than 100,000 merge records or more than
   500,000 aggregate cells expanded by merge ranges. A merge record must use one explicit bounded
   two-coordinate `A1:B2`-style range; a single-cell or ambiguous/entity-based reference is invalid.
   The pure service's format-neutral
   `OOXML_PREFLIGHT_TIMEOUT` is mapped by this Worker to `SHEET_RENDER_TIMEOUT`; its internal
   deadline checks are backed by the disposable Worker's 10-second hard termination timer. Reject
   malformed or ambiguous archives before ExcelJS is imported.
3. Dynamically import ExcelJS inside the Worker only after byte/signature/ZIP gates pass. The Worker
   owns the parsed workbook and search model. It sends the renderer a bounded manifest (sheet names,
   dimensions, coverage) and requested viewport/overscan cell and intersecting-merge ranges, never
   the unrestricted workbook object or the full merge list. The renderer session validates every
   cross-Worker response at runtime against the manifest/model caps and exact request identity;
   malformed messages terminate the session as `SHEET_PARSE_FAILED`. One viewport request covers at
   most 50,000 row-column coordinates, and its returned cells/merge masters remain bounded by that
   requested rectangle and the workbook model caps. Returned merges must be non-overlapping, use
   unique masters, cover more than one cell, and have aggregate intersection work no greater than
   the requested viewport area.
4. Build an explicit model cap of the first 64 sheets in workbook order, at most 100,000 row
   coordinates and 512 column coordinates per accepted sheet, 500,000 accepted non-empty cells,
   the first 100,000 merge records inspected with no more than 100,000 ranges accepted, 500,000
   explicit row/column dimension records, 1,048,576 UTF-16
   code units in one formatted cell, and 16,777,216 accepted formatted UTF-16 code units across the
   workbook. Acceptance is deterministic in workbook sheet order, then row/column order. A cell over
   the per-cell text cap is skipped intact and scanning continues; text is never truncated. Once the
   aggregate text or accepted-cell cap would be crossed, no later sheet/cell is accepted. Workbook
   parse plus bounded-model construction has one 30-second deadline. Byte/ZIP/preflight failure is
   `unavailable` with no partial model. Only a workbook that passed all hard gates and exceeded one
   of these model caps may become `ready` with
   `coverage.partial(reason='sheet-model-cap', acceptedSheets, acceptedCells)`; merge/dimension
   truncation uses that same truthful partial reason rather than silently claiming complete
   coverage. The 30-second Worker termination is a parse-CPU cancellation boundary, not an
   independent-process OOM guarantee; ZIP actual-expansion and merge-expansion admission gates must
   therefore run before ExcelJS allocation.
5. Render a self-owned read-only virtual grid with fixed row/column headers, sheet tabs, row heights,
   column widths, merged ranges, horizontal left/center/right and vertical top/middle/bottom
   alignment, wrapping, number/date/percent/currency formats, bold/italic, font color, and fill
   color. Excel `fill` and `justify` horizontal modes are not accepted until bounded visible
   semantics exist. Keep DOM proportional to viewport plus overscan rather than workbook dimensions.
   Use one pure formatter for both displayed text and Worker search text, so date/number/cached-
   formula matching cannot disagree with the visible grid.
   Date/time support is deliberately basic and deterministic: common year/month/day/weekday,
   hour/minute/second, and AM/PM token order is preserved, including Excel's 1900 leap-day quirk;
   when ExcelJS materializes a date-formatted cell as `Date`, the formatter first recovers its serial
   under the workbook's 1900/1904 epoch so serials 59/60/61 remain truthful. Arbitrary locale/
   calendar and conditional custom-number-format fidelity is not claimed.
6. Show formula cells' cached displayed result only. Do not evaluate formulas, expose formula source
   as the displayed value, execute links/macros/OLE, or claim support for charts, pivots, conditional
   formatting, comments, data validation, sparklines, or floating images.
7. Keep complete search data for every accepted cell in the Worker, independent of the virtual DOM.
   Expose one renderer-local, revision-fenced sheet session with literal `query`, `next`, `previous`,
   `clear`, and `reveal` operations. It matches the same pure formatted display strings under the
   requested case mode and returns total/active/coverage plus sheet-row-column targets. Reveal may
   switch sheets, scroll the cell into view, and apply the active-cell highlight. The session is not
   an XPC/public Shell API; task 019 connects it to the common Shell Find Bar.
8. On selection/workspace/surface change, error, timeout, crash, or unmount, terminate the Worker,
   revoke the asset, clear grid/search state, and ignore stale messages by exact host + selection
   revision + renderer-local runtime nonce + Worker generation. The Main/Vue XPC runtime capability
   is never copied into Worker messages. After a manifest is installed, an unexpected terminal
   session event is reported once to its Store owner; the Store clears ready/model truth and reports
   Main only when the exact session, local generation, selection revision, and reporting revision
   are still current. Normal owner disposal and load failure are silent on that observer. Dropping
   Promise callbacks alone is not cancellation.
9. Load ExcelJS only in its Worker chunk; it must not enter the Vue Preview initial chunk. Update en/
   zh copy and the feature/analysis/plan contracts with exact limits and truthful coverage wording.
10. Use the typed terminal errors `OOXML_ARCHIVE_LIMIT`, `OOXML_ENCRYPTED`,
    `OOXML_ARCHIVE_INVALID`, `SHEET_PARSE_FAILED`, `SHEET_EMPTY`, and `SHEET_RENDER_TIMEOUT` in
    addition to the existing signature/size failures. A timeout, selection/workspace/surface change,
    unmount, Worker error, or stale host/runtime/selection generation must terminate the Worker and
    must never install its later response.

# Acceptance

- A fixture with multiple sheets, merges, dimensions, alignment, formats, fonts/fills, dates,
  percentages, currency, and formulas renders correctly; formulas show cached results and never
  recalculate or expose macro behavior.
- Sheet switching resets that sheet's viewport/selection predictably and does not leak stale cells.
- The mounted cell DOM remains bounded while scrolling a large accepted workbook.
- Search finds accepted cells outside the viewport and on other sheets, switches/reveals the target,
  and reports partial coverage when and only when the model cap truncated an otherwise valid
  workbook.
- Oversize, bad-signature, malformed-ZIP, expansion/entry/ratio-limit, encrypted, corrupt, and empty
  fixtures each produce the right state without loading ExcelJS early or crashing the Vue surface.
- Switching away terminates the Worker and prevents any stale manifest/range/search response from
  installing.
- Production build emits a separate Worker/ExcelJS chunk and keeps ExcelJS out of the initial Vue
  Preview chunk.

# Verification

- Focused Worker/ZIP/model/search/grid service tests with real generated workbook fixtures
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn typecheck:web` (separate unrelated baseline failures)
- `yarn check:renderer-i18n`
- Focused ESLint for changed OnlyPreview files
- `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` plus
  Rollup entry/Worker/ExcelJS chunk audit
- `git diff --check`
- Electron/Playwright E2E: **do not run**; Ral performs final workbook/runtime verification.

# Delivery Evidence

- 2026-08-20 review-fix red tests first reproduced the blocked single-cell merge, real ExcelJS
  1900-date, unsupported alignment, terminal-session, viewport-merge, resize/reveal, and multi-tab
  keyboard/ARIA contracts. The final focused OOXML/date/grid/session/Worker/rendering suite passes
  64/64, including real ExcelJS 1900 serials 59/60/61, the 1904 epoch, display/search parity, exact
  Store generation/revision fences, and mounted three-sheet/resize/search behavior.
- `node --test tests/onlypreview/*.test.mjs` passes 253/253. The suite also covers adversarial
  ZIP/OOXML fixtures, a browser-target module Worker, transfer-list ownership, bounded
  model/search/viewport math, runtime response validation, and mounted DOM bounds.
- `yarn typecheck:node` and `yarn check:renderer-i18n` pass. `yarn typecheck:web` remains red only on
  the repository's pre-existing connector, poker GTO test-global, RigChat, Home, Maestro, Omni, and
  `pathHelper` baseline; it reports no OnlyPreview/XLSX diagnostics.
- Focused ESLint over every changed 020 TS/Vue/test source passes with zero errors. Four existing
  component/prop-shape warnings remain in the shared `onlyPreviewRendering.test.mjs` harness.
  Scoped Prettier verification passes.
- The required safe source build passes:
  `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`.
  Production output emits `onlyPreviewSheet.worker-Dpe6nSb7.js` (60,354 bytes) and a separately
  loaded `exceljs.min-Bo_U2qcd.js` (1,446,082 bytes). Only the Worker asset references that ExcelJS
  chunk; the Preview entry `onlypreview/preview-DBR43qD8.js` (1,508 bytes) contains no ExcelJS code.
- `git diff --check` passes. Electron/Playwright E2E, the real app, and packaged smoke were
  intentionally not run. All eight independent-review-1 findings now have focused regression
  evidence. Independent reviews 2 through 4 found only docs-ledger blockers, all now corrected.
- Task 025 splits the shared OOXML preflight into a 742-line facade plus public types/budgets and a
  streaming merge scanner, and splits the Sheet runtime into a compatibility facade, response
  validator, and session lifecycle module. The public exports, Worker protocol, one-shot asset
  ownership, model limits, and existing assertions are unchanged; focused split coverage passes
  66/66 and the combined OnlyPreview suite passes 318/318 with no skip/only/todo.
- 2026-08-20: [Independent review 5](../reviews/onlypreview-xlsx-grid-020-5.md) recorded **PASS**.
  Task, plan, design, and analysis ledgers advanced atomically to
  `implemented; owner verification pending`; Ral owns the remaining real-app workbook and visual
  verification.
