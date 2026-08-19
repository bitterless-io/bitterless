---
id: onlypreview-xlsx-grid-020
scope: Render .xlsx workbooks as a read-only virtualized grid inside the Preview view
status: pending
depends-on: [onlypreview-preview-header-merge-018, onlypreview-preview-guards-023]
---

# Objective

Preview `.xlsx` / `.xlsm` workbooks as a read-only grid instead of the `unsupported` state. Bytes come
from the existing `onlypreview://` asset stream; `exceljs` parses them inside the Preview renderer;
one virtualized grid renders sheet tabs, merged cells, column widths, alignment, number formats, and
basic fonts/fills. Formula cells show their cached result. Oversized workbooks report exactly what was
rendered instead of truncating silently.

# Context

- [OnlyPreview preview format coverage](../../design/onlypreview-format-coverage.md) — #1 read path,
  #2 xlsx decision, #6 truthful states, #7 engine loading
- [OnlyPreview preview view merge and find ownership](../../design/onlypreview-preview-merge-find.md)
- [OnlyPreview sub-application](../../features/onlypreview.md) — classification and rendering contract

# Path

- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/renderer/onlypreview/preview/src/components/SheetPreview/`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/onlyPreviewSheet.service.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `tests/onlypreview/`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`

# Delivery

1. Classify `.xlsx` and `.xlsm` as a new `sheet` kind with the correct MIME, keeping the existing
   asset-token flow. No new IPC channel, no absolute path in the renderer.
   Extend `matchesSignature()` so both extensions require the OOXML zip magic `50 4B 03 04`; a
   mismatch yields `SIGNATURE_MISMATCH` and no `assetUrl` (design #8 G1).
1a. Add `ONLY_PREVIEW_MAX_SHEET_BYTES` (25MiB). Beyond it, render the bounded limit state without
   parsing, and never load the engine (design #8 G2/G3): the dynamic `import()` of `exceljs` happens
   only after the signature and size gates pass.
1b. Bound zip expansion while parsing: abort with the truthful state when cumulative inflated bytes
   exceed 200MiB or entries exceed 5,000 (design #8 G4).
2. Parse in the Preview renderer: `fetch(assetUrl)` → `ArrayBuffer` → `exceljs` workbook. Reuse the
   existing generation/abort discipline from `PdfPreview.vue` so a file switch cancels in-flight work.
3. Render sheet tabs plus one virtualized grid: column widths, row heights, merged ranges, horizontal
   and vertical alignment, wrap, number/date/percent/currency formats, bold/italic, font color, and
   fill color. Row and column headers are rendered read-only.
4. Show formula cells' cached results. Do not recalculate, and do not display formula text as the cell
   value.
5. Enforce explicit limits (rows, columns, total cells). On exceeding a limit, render what fits and
   show a bounded localized notice naming the limit, with the file actions available; never truncate
   silently.
6. Handle parse failure, encrypted workbooks, and empty workbooks as distinct truthful states.
7. Load `exceljs` through the documented Preview-engine dynamic-import exception so it stays out of the
   Preview renderer's initial chunk.
8. Add localized copy for sheet tabs, limits, and error states in both `en` and `zh`.
9. Update `docs/features/onlypreview.md` classification, rendering, layout, and verification contracts
   in the same delivery.

# Acceptance

- A multi-sheet workbook opens on its first sheet; switching tabs re-renders without leaking the prior
  sheet's scroll position or selection.
- Merged cells, column widths, and number/date formats visibly match the source workbook.
- A formula cell shows its stored result; no recalculation occurs and no `=` formula text leaks.
- A workbook beyond the row/cell limit renders the allowed portion plus the localized limit notice.
- A corrupt or encrypted `.xlsx` shows the truthful failure state, not an empty grid.
- An MP4 renamed to `.xlsx` shows the extension/content mismatch state; `exceljs` is never loaded and
  no asset URL is issued.
- A workbook above 25MiB shows the limit state without parsing; a zip-bomb workbook aborts at the
  expansion cap instead of exhausting memory.
- Switching from a large workbook to another file cancels parsing and leaves no detached grid or
  pending task.
- `exceljs` does not appear in the Preview renderer's initial chunk in `yarn build` output.

# Verification

- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn check:renderer-i18n`
- Focused ESLint for the changed OnlyPreview TypeScript/Vue files
- `yarn build`
- Electron E2E (`yarn test:e2e:onlypreview`): owner-run on request. Per the overmind rule, agents must
  not launch Electron end-to-end suites unprompted; report them as not run instead.
