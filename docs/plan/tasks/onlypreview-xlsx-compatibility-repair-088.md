---
id: onlypreview-xlsx-compatibility-repair-088
scope: Repair invalid benchmark XLSX fixtures and normalize one producer-compatible empty-sheet OOXML form before the single Viewer load
status: in-progress
depends-on:
  - onlypreview-ooxml-viewer-runtime-repair-081
verify: focused corpus and Office session tests, directed typechecks/lint/build; no Electron/Playwright/E2E
---

# Repair XLSX fixture and empty-sheet compatibility

## Objective

Make the generated benchmark XLSX previewable and make an Excel-readable workbook whose empty
worksheet omits `sheetData` render without replacing the bounded `@silurus/ooxml` architecture.

## Context

- [OnlyPreview XLSX compatibility gaps](../../issues/onlypreview-xlsx-compatibility-gaps.md)
- [OnlyPreview format coverage](../../design/onlypreview-format-coverage.md)
- [OnlyPreview indexing benchmark](../../features/onlypreview-indexing-benchmark.md)

## Paths

- `tests/indexing/corpus.mjs`
- `tests/indexing/indexingPipeline.test.mjs`
- `src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.service.ts`
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewOfficePreflight.*`
- `src/renderer/onlypreview/preview/src/workers/`
- `tests/onlypreview/onlyPreviewOfficeOoxml.test.mjs`

## Contract

- Produce a deterministic minimal OOXML workbook once per benchmark corpus and reuse it for every
  generated `.xlsx`; change the corpus signature so old fake-byte fixtures cannot survive.
- Preserve extension-first Office routing, the hidden-preload bounded read, 25 MiB admission,
  archive preflight, lazy `@silurus/ooxml/xlsx`, model-backed Find/highlight, generation fencing,
  and no potentially large Main filesystem I/O.
- While the original archive preflight already streams each XLSX worksheet XML, count `sheetData`
  by local name. Only a non-macro workbook with exactly one worksheet and exactly one missing
  `sheetData` is a producer-compatibility candidate; multi-sheet cases and more than one
  `sheetData` are invalid. Return the marker and total-uncompressed count with the transferred
  accepted buffer instead of relying on `XlsxViewer.load()`:
  the pinned renderer stores this parser failure on the worksheet model and paints an error canvas,
  so neither a rejected load nor `onError` is available.
- For a marked workbook, transfer the accepted buffer to a disposable normalization Worker,
  dynamically load ExcelJS there, rewrite only the in-memory preview copy, reject output above
  4 MiB, and preflight it again. Before ExcelJS starts, require the original archive to be at most
  4 MiB and the preflight total-uncompressed size to be at most 8 MiB; the normal Office renderer
  retains its 25 MiB limit. The second preflight must contain exactly one `sheetData` per
  worksheet; only then construct and load one OOXML Viewer. Normalize at most once.
- The Worker contract contains opaque runtime/revision/request identity plus bytes only. It has a
  bounded non-renewing deadline; malformed messages, worker errors, message errors, disposal and
  selection replacement terminate it and cannot publish a late result.
- Do not normalize XLSM or any other format. Do not normalize before preflight, on arbitrary
  Viewer errors, or after the final load fails. Never modify the selected file.
- Keep diagnostics content-free and phase-specific. A successful compatibility repair is not a
  terminal Office failure; a normalization/final-load failure is reported once through the existing
  typed lifecycle.

## Verification

- Assert the generated `.xlsx` begins with ZIP magic, passes Office preflight, and is regenerated
  under the new corpus signature.
- Cover zero/one/multiple `sheetData` detection, single/multi-sheet and macro gates, 4 MiB / 8 MiB
  compatibility ceilings, Worker identity/transfer, normalized-size rejection,
  preflight-before-and-after ordering, normalization-once behavior, no Viewer before the final
  bytes, success with retained Find adapter, unrelated-error rejection, timeout, disposal and stale
  response fencing.
- Run focused indexing and OnlyPreview Office tests, relevant typechecks and lint/format checks,
  `git diff --check`, and the production build with Worker/chunk inspection.
- Do not run Electron, Playwright, packaged smoke, or E2E. Ral owns live acceptance of both reported
  file paths.

## Delivery

Implementation and verification pending.
