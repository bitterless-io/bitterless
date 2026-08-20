---
id: onlypreview-xlsx-grid-020
scope: Parse XLSX/XLSM in a disposable Worker and render a searchable read-only virtual workbook grid
status: pending
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
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/renderer/onlypreview/preview/src/components/SheetPreview/` (new)
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewSheet.worker.ts` (new)
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewSheetWorker.contract.ts` (new)
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewOoxmlPreflight.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewSheetFormat.service.ts` (new)
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `electron.vite.config.ts` (only if required for the existing ES module Worker pipeline)
- `tests/onlypreview/fixtures/createOnlyPreviewFixtures.ts`
- `tests/onlypreview/onlyPreviewSheetWorker.test.mjs` (new)
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`

ExcelJS is already installed; do not alter `package.json` or `yarn.lock`. Do not parse workbook bytes
in Main, preload, Shell, or the Vue UI thread. Preserve unrelated owner changes.

# Delivery

1. Classify `.xlsx` and `.xlsm` as `sheet`, require OOXML ZIP signature, and issue a finite 25MiB
   revision-bound asset capability only after descriptor gates pass. Signature mismatch, oversize,
   encrypted/corrupt, and empty workbook are distinct truthful states; no parser is loaded for
   signature/size failures.
2. `vuePreviewView` fetches the bounded asset asynchronously, transfers the `ArrayBuffer` to one
   disposable module Worker with a transfer list, and relinquishes its copy. A reusable pure
   ArrayBuffer preflight validates EOCD, central/local records, offsets/non-overlap, normalized entry
   paths, duplicates, encryption, multi-disk/Zip64 rejection, and required XLSX package parts before
   importing ExcelJS. Exact caps are 5,000 entries, 200MiB declared total uncompressed bytes, 128MiB
   per entry, and 200:1 per-entry and aggregate compression ratio. Reject malformed or ambiguous
   archives before ExcelJS.
3. Dynamically import ExcelJS inside the Worker only after byte/signature/ZIP gates pass. The Worker
   owns the parsed workbook and search model. It sends the renderer a bounded manifest (sheet names,
   dimensions, merges, coverage) and requested viewport/overscan cell ranges, never the unrestricted
   workbook object.
4. Build an explicit model cap of the first 64 sheets in workbook order, at most 100,000 row
   coordinates and 512 column coordinates per accepted sheet, and 500,000 accepted non-empty cells
   across the workbook. Acceptance is deterministic in sheet order then row/column order. Byte/ZIP/
   preflight failure is `unavailable` with no partial model. Only a workbook that passed all hard
   gates and exceeded one of those model caps may become `ready` with
   `coverage.partial(reason='sheet-model-cap', acceptedSheets, acceptedCells)`.
5. Render a self-owned read-only virtual grid with fixed row/column headers, sheet tabs, row heights,
   column widths, merged ranges, horizontal/vertical alignment, wrapping, number/date/percent/
   currency formats, bold/italic, font color, and fill color. Keep DOM proportional to viewport plus
   overscan rather than workbook dimensions. Use one pure formatter for both displayed text and
   Worker search text, so date/number/cached-formula matching cannot disagree with the visible grid.
6. Show formula cells' cached displayed result only. Do not evaluate formulas, expose formula source
   as the displayed value, execute links/macros/OLE, or claim support for charts, pivots, conditional
   formatting, comments, data validation, sparklines, or floating images.
7. Keep complete search data for every accepted cell in the Worker, independent of the virtual DOM.
   Expose a revision-fenced local sheet adapter that matches displayed/cached values under the
   requested case mode, returns total/active/coverage plus sheet-row-column targets, and can switch
   sheet, scroll the cell into view, and apply an active-cell highlight. Task 019 connects it to the
   common Shell Find Bar.
8. On selection/workspace/surface change, error, timeout, crash, or unmount, terminate the Worker,
   revoke the asset, clear grid/search state, and ignore stale messages by exact host + selection
   revision. Dropping Promise callbacks alone is not cancellation.
9. Load ExcelJS only in its Worker chunk; it must not enter the Vue Preview initial chunk. Update en/
   zh copy and the feature/analysis/plan contracts with exact limits and truthful coverage wording.

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
- `yarn build` plus chunk audit
- `git diff --check`
- Electron/Playwright E2E: **do not run**; Ral performs final workbook/runtime verification.
