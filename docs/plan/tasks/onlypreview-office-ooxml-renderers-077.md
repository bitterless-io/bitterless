---
id: onlypreview-office-ooxml-renderers-077
scope: Unify XLSX/XLSM, DOCX and PPTX VuePreview rendering on bounded @silurus/ooxml viewers with persistent search highlighting
status: implemented; owner verification pending
depends-on:
  - onlypreview-xlsx-grid-020
  - onlypreview-docx-render-021
  - onlypreview-preview-guards-023
verify: focused non-Electron Office preview tests, directed typechecks, package audit, production build and output inspection; no Electron/Playwright/E2E
---

# Office OOXML renderers

## Objective

Upgrade the lazy `vuePreviewView` Office adapters without moving file I/O or parsing into Main:

- `.xlsx` / `.xlsm` use exactly pinned `@silurus/ooxml` through its `xlsx` subpath;
- `.docx` uses exactly pinned `@silurus/ooxml` through its `docx` subpath;
- `.pptx` uses exactly the same pinned `@silurus/ooxml` package through its `pptx` subpath.

All three formats remain read-only, load only after their format is selected, render inside the
existing Vue Preview surface, and retain complete model-backed Find with visible active-match
highlight, previous/next navigation, and deterministic clear-on-query/file/teardown behavior.

## Context

- [OnlyPreview format coverage](../../design/onlypreview-format-coverage.md)
- [OnlyPreview dual preview views and find ownership](../../design/onlypreview-preview-merge-find.md)
- [OnlyPreview feature contract](../../features/onlypreview.md)
- [Historical XLSX delivery](onlypreview-xlsx-grid-020.md)
- [Historical DOCX delivery](onlypreview-docx-render-021.md)

Task 077 supersedes only the renderer-engine and Office Find routes of Tasks 020/021. Their
historical delivery evidence stays unchanged.

## Path

- `package.json`
- `yarn.lock`
- `electron.vite.config.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/shared/onlypreview/onlyPreviewFind.registry.ts`
- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewAdapter.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewView.service.ts`
- `src/preload/onlypreview/search/core/classification.mjs`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/preview/src/components/OfficePreview/` (new)
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewFindAdapter.service.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.*`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewOfficePreflight.*` (new)
- focused `tests/onlypreview/` Office, rendering, protocol, Find and guard tests
- canonical docs listed above plus `docs/INDEX.md` and `docs/plan/README.md`

## Contract

### Format routing and dependency boundary

- Add `presentation` as an `OnlyPreviewKind` and classify only `.pptx` into it. Add the canonical
  PPTX MIME. Legacy `.ppt`, `.doc`, and `.xls` remain unsupported and system-openable.
- Route `sheet` to `ooxml-xlsx`, `document` to `ooxml-docx`, and `presentation` to
  `ooxml-pptx`; all three use the Vue surface and a revision-bound one-shot asset.
- Pin `@silurus/ooxml@0.83.0` exactly. Import only `@silurus/ooxml/xlsx`,
  `@silurus/ooxml/docx`, or `@silurus/ooxml/pptx` from the selected format's dynamic-import
  branch. Do not install `@aiden0z/pptx-renderer` or the unrelated unscoped `pptx-renderer`, and do
  not let any Office engine enter the Preview initial chunk.
- Replace `docx-preview` and remove it when no live import remains. Keep `exceljs` and `docx`
  because non-Preview Bitterless features still use them.
- Vite development excludes `@silurus/ooxml` from dependency optimization so its WASM URLs remain
  valid. Do not externalize the renderer into Main/preload runtime dependencies.

### Admission, resource and lifecycle safety

- Main only classifies, bounds, and signs the selected file. Fetch and OOXML work remain in the
  sandboxed Vue renderer / its workers.
- Each format keeps a 25 MiB compressed-file override and a conservative preflight envelope: 5,000
  entries, 64 MiB per entry, 128 MiB total inflated bytes, 200:1 ratio, and 10-second preflight.
  Extend required-part validation with `ppt/presentation.xml` for PPTX.
- Pass the same explicit archive limits into all three viewer constructors. The pinned 0.83.0
  viewer keeps its built-in decoded-image guards; it does not expose raster/decode options that
  Bitterless can configure. The app's stricter one-shot preflight remains authoritative before a
  dynamic import.
- `@silurus/ooxml` runs DOCX/XLSX/PPTX parsing, layout and Canvas paint in `mode: 'worker'`,
  disables Google Fonts, external hyperlinks, comments, optional Math/3D/region-map/chart-ex
  renderers, and receives the app's explicit archive resource policy. XLSM macros are never
  executed.
- Keep the existing external 30-second Vue watchdog. Every stale selection, failed load, timeout,
  unmount, or teardown aborts fetch, terminates the preflight worker, clears Find, destroys the
  exact viewer, removes generated DOM/canvas nodes, and rejects late completion by runtime +
  selection generation. No remote resource, iframe, popup, navigation, or CSP network expansion is
  permitted.
- Search work must be generation-fenced and never retain a second parsed workbook/document/deck
  model. If a viewer throws or exceeds the external deadline, fail closed with the typed format
  error and rebuild the Vue view.

### Rendering and fidelity

- XLSX/XLSM: show workbook tabs, merged cells, row/column sizing, saved formula results, styles,
  images and supported charts through the OOXML canvas viewer. Never execute macros or run a
  general workbook recalculation engine. Record the upstream exception explicitly: the selected
  `@silurus/ooxml` version renders volatile `TODAY()` / `NOW()` using the current time and exposes
  no disable option; do not misstate those two functions as cached-only. Do not promise
  Excel-perfect calculation or pixel identity.
- DOCX: show a virtualized, Word-like page list with selectable text, tables, headers/footers,
  images and supported charts. Do not promise Word-perfect pagination, OLE/altChunk execution,
  field recalculation, tracked-change UI, comments, or remote fonts.
- PPTX: show the `PptxScrollViewer` virtualized slide list with supported text, shapes, tables,
  images and charts. Do not promise animations/transitions, notes, OLE, equations, or complete
  EMF/WMF fidelity. A slide/node failure must not crash the process; report the format failure or
  retain bounded partial state only when the library explicitly supports it.
- Visual styling remains subordinate to document content: neutral Preview background, bounded
  scroll container, no competing toolbar inside the content component, and no unrelated Shell or
  Global Search restyle.

### Find and highlight

- Register all three Office adapters as `content-adapter: office`; DOCX no longer uses
  `findInPage()` because its output is Canvas/virtualized.
- XLSX/DOCX/PPTX call their viewer's `findText(query, { caseSensitive })`, `findNext()`,
  `findPrev()`, and `clearFind()`. `findText()` installs all-match highlights; the adapter then
  calls next/previous once for a new query so one active match is navigated and distinctly
  highlighted. Report `matches`, one-based active ordinal, final update, and truthful complete
  coverage.
- Empty query, Find close, query A to query B, selection change, load failure, and teardown clear all
  highlights. A stale selection revision, find revision, search promise, virtual-page callback, or
  viewer instance may never update result counts or reinstall an old highlight.
- Search covers formatted cells across sheets, text across DOCX pages, and text runs across all
  PPTX slides, including content outside the currently mounted virtualized viewport.

## Acceptance

- XLSX/XLSM and DOCX no longer load the former Preview engines; PPTX no longer falls through to
  Monaco/text classification.
- Representative workbook, document, and deck fixtures reach ready state inside the same lazy Vue
  Preview region. Switching between them does not leave a worker, viewer, canvas, slide DOM, blob
  URL, or stale ready/error callback alive.
- Each format proves initial Find, visible active highlight, next, previous, clear, query
  replacement, and selection teardown. Cross-sheet/page/slide matches navigate and highlight even
  when the target was not mounted before the search.
- Oversize, signature mismatch, corrupt/encrypted archive, ZIP resource overflow, missing required
  part, parse failure, empty content, and timeout fail closed with file identity and system-open /
  reveal actions retained.
- Production output contains separate lazy Office chunks plus same-origin WASM/worker assets;
  `@silurus/ooxml` is absent from the Preview bootstrap chunk. CSP is not broadened except for a proven
  same-origin WASM execution requirement, with source and built-output assertions updated together.
- Exact package pins, dependency audit, directed typechecks, focused tests, production build,
  output inspection, task-scoped formatting/lint, line-count guard and `git diff --check` pass.

## Verification

- Run focused Node/source/mounted-component tests for classification, preflight, adapters,
  readiness, renderer lifecycle, Find generation fencing and all three highlight paths.
- Run desktop dependency packaging audit, Node/Web typechecks and a production build. Inspect the
  resulting chunk graph and Office WASM/worker assets.
- Do not launch Electron, Playwright, packaged smoke, or E2E. Ral performs live fidelity and Find
  acceptance.

## Delivery

- `.xlsx` / `.xlsm`, `.docx`, and `.pptx` now use the exact pinned `@silurus/ooxml@0.83.0`
  `xlsx`, `docx`, and `pptx` subpaths. The three viewers retain model-backed Find/highlight and
  load only after the selected Office format passes the disposable preflight Worker.
- Viewer `onError`, Find deadlines, selection teardown, and Main's Vue rebuild path fail closed.
  Legacy `.doc` / `.xls` / `.ppt` are explicit unsupported metadata-only files rather than text.
- Admission is capped at 25 MiB compressed, 5,000 entries, 64 MiB per inflated entry, 128 MiB
  aggregate inflation, 200:1 ratio, and ten seconds; the same archive limits reach every viewer.
- Focused non-Electron tests passed (149/149 in the final implementation batch; independent review
  round 2 repeated 128/128), package audit passed 18/18, Node typecheck and production build passed,
  and `git diff --check` passed. The built Preview bootstrap is 1,325 bytes and contains no OOXML
  engine; XLSX/DOCX/PPTX emitted separate lazy chunks, parser WASM, render workers, and the separate
  preflight Worker.
- Web typecheck remains blocked only by pre-existing Poker, old Home, Maestro, connector, and
  path-helper diagnostics; no Task 077 file is reported. Electron/Playwright/E2E was not run by
  request. Independent [round 2 review](../reviews/onlypreview-office-ooxml-renderers-077-2.md)
  passed with no remaining P1/P2/P3; Ral's live fidelity, scrolling, Find/highlight, and minimum-
  device acceptance remain.
