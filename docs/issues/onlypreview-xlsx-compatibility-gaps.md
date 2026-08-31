# OnlyPreview XLSX compatibility gaps

Status: in progress

## Symptoms

Two independent inputs currently reach misleading dead ends:

1. The generated indexing benchmark path `entry-mn.xlsx` is rejected as an extension/signature
   mismatch when selected from Global Search.
2. A real-world, Excel-readable workbook reaches `@silurus/ooxml/xlsx` but fails with
   `MCE-processed worksheet must contain exactly one sheetData`.

## Confirmed causes

- `tests/indexing/corpus.mjs` currently writes every opaque extension, including `.xlsx`, as a
  repeated arbitrary byte. The reported benchmark file is therefore not an XLSX package at all;
  its current error is truthful, but the fixture is unsuitable for Preview acceptance.
- The reimbursement workbook is a bounded ZIP/OOXML package and ExcelJS opens it as one empty
  worksheet. Its `xl/worksheets/sheet1.xml` omits `sheetData` entirely. The pinned
  `@silurus/ooxml@0.83.0` MCE worksheet path rejects that producer-compatible empty-sheet form
  before the Viewer can render it.

## Accepted repair

- Generate one deterministic, minimal, valid XLSX package for benchmark `.xlsx` entries and reuse
  its bytes inside a corpus run. Bump the corpus signature so existing cached arbitrary-byte XLSX
  fixtures are not reused.
- Keep `@silurus/ooxml/xlsx` as the only final XLSX renderer and retain its model-backed
  Find/highlight behavior.
- Extend the existing bounded worksheet preflight to count `sheetData` by local XML name while it
  already streams each worksheet part. Normalize only a non-macro `.xlsx` with exactly one
  worksheet and exactly one missing `sheetData`; multi-sheet compatibility cases and a worksheet
  with more than one `sheetData` remain invalid rather than rewriting a complex workbook.
- Before loading ExcelJS, apply a compatibility-only 4 MiB archive / 8 MiB total-uncompressed
  ceiling. Apply the 4 MiB ceiling to normalized output too. The ordinary OOXML renderer retains
  its existing 25 MiB admission; these tighter bounds constrain only the exceptional full-workbook
  rewrite and prevent unused shared strings, styles, or package parts from causing large heap growth.
- Preflight the normalized bytes again and require every worksheet to contain exactly one
  `sheetData`; then construct and load the `@silurus/ooxml/xlsx` Viewer once. This detection must
  happen before Viewer construction because the pinned library records this parser error in its
  worksheet model and paints an error canvas instead of rejecting `load()` or invoking `onError`.
- The compatibility Worker receives only the already authorized `ArrayBuffer`; it never receives a
  path and never performs disk I/O. Main remains outside the data and parser path. The original file
  is never modified.
- Keep the existing 25 MiB ordinary Office ceiling, enforce the tighter compatibility ceilings, terminate the
  Worker on completion/error/disposal/timeout, and never run normalization for XLSM, DOCX, PPTX,
  invalid ZIPs, encrypted packages, archive-limit failures, arbitrary Viewer failures, or a second
  load failure.
- Transfer, rather than clone, the working buffers between renderer and Worker. No OOXML Viewer is
  created until the final admitted bytes are ready, so there is never a failed compatibility Viewer
  or a second Viewer load.

## Acceptance

- A newly generated benchmark corpus contains a ZIP/OOXML `.xlsx`, and selecting its XLSX search
  result reaches the normal Office Preview path.
- The reported single-empty-sheet reimbursement workbook renders through the normal OOXML Viewer after at
  most one pre-Viewer compatibility normalization; current-file Find remains owned by that Viewer.
- A non-ZIP `.xlsx`, encrypted workbook, resource-limit violation, multi-sheet missing-`sheetData`
  case, unrelated OOXML failure, Worker timeout, oversized normalized result, or failed final Viewer
  load still fails closed with its existing typed error.
- Replacement or disposal cannot publish a stale normalization result, retain either full buffer, or leave a
  Viewer/Worker alive.
- Focused source/unit tests, typechecks, lint/format checks, and the production build pass. Electron,
  Playwright, packaged smoke, and E2E are not run; Ral performs live verification.

## Delivery

[Task 088](../plan/tasks/onlypreview-xlsx-compatibility-repair-088.md) owns the implementation and
independent verification.
