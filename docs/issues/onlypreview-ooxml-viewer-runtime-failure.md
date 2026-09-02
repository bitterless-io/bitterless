# OnlyPreview OOXML files fail after successful admission

Status: fixed in source; owner verification pending

## Symptom

A valid `.xlsx` reaches the Vue Preview Office adapter but the page falls back to
`The workbook could not be parsed.` The same integration boundary is shared by DOCX and PPTX, so
their live Viewer startup is part of the repair rather than an XLSX-only exception.

## Confirmed boundary

- The selected workbook is a valid ZIP/OOXML package.
- OnlyPreview's disposable archive preflight accepts it.
- The pinned `@silurus/ooxml@0.83.0` Node parser materializes its workbook and worksheet model.
- Production routing selects `ooxml-xlsx`; the historical ExcelJS grid is not on the active path.
- The renderer currently converts dynamic-import, Viewer construction, Worker/WASM startup,
  `load()`, and first-render failures into the same format parse code. The Viewer `onError`
  callback also discards its `Error` argument.

The visible parse wording is therefore not evidence of a parser failure. Source inspection shows
that the OOXML worker rendering path's first-frame handoff requires an
`ImageBitmapRenderingContext` and rejects Viewer load when `bitmaprenderer` is unavailable. This is
the strongest current explanation for the observed Electron failure, but the exact live exception
still requires Ral's post-fix runtime verification. The current adapter removes that evidence by
mapping every such failure to a package parse code.

## Accepted repair

- Keep XLSX/XLSM, DOCX, and PPTX on their pinned, lazy `@silurus/ooxml` subpaths. Do not restore the
  historical ExcelJS or `docx-preview` engines and do not add a Main-thread parser.
- Remove the Office `assetUrl`/Main protocol stream from the data path. The existing hidden
  `fileSearch` renderer preload asynchronously reads the exact revision-bound file through a second,
  Office-only capability; Main authorizes only the in-memory host/runtime/revision/adapter and
  performs no Office `fs` open/read/stat/realpath/stream. The hidden preload owns path containment,
  identity and content verification.
  The sandboxed Vue Preview preload exposes only a path-free current-selection read method.
- The read is single-generation, capped at 25 MiB, uses `O_NOFOLLOW` plus pre/post identity and
  containment checks, and closes its handle on success, failure, cancellation, or selection change.
  Because `electron-xpc` structured-clones every result through its Main broker, the data path is a
  serial pull protocol with a small maximum frame; it never sends a whole Office file in one XPC
  response. Only the Vue preload assembles the exact admitted buffer. Parallel reads are forbidden.
- Preserve a bounded, content-free diagnostic for read, preflight, import, Viewer construction,
  load/layout, asynchronous render, and Find failures. Include only an opaque session identity,
  exact selection revision, elapsed milliseconds, format, phase, and a safe error
  name/code/message; never include file paths, URLs, cell/document content, queries, or archive part
  names.
- Forward the actual Viewer `onError(error)` argument. A synchronous load rejection and an
  asynchronous render failure must take the same fail-closed lifecycle path without double
  reporting or leaking a Worker/viewer.
- Use each OOXML Viewer's single-pass `main` mode inside the already isolated Vue Preview
  `WebContentsView`. This means OOXML's 2D-canvas path in the preview renderer, not Electron's main
  process, and avoids the failing nested Worker bitmap handoff without a retry or second parse.
- Retain the existing 25 MB admission limit, archive/resource limits, one-shot read grant, generation
  fences, and teardown so a bounded Office file can at worst occupy its disposable preview view.
- User-facing wording must describe an Office Preview failure unless the upstream error is proven
  to be a package parse error. Do not label Worker/WASM/import/render failures as malformed files.

## Acceptance

- Representative valid XLSX/XLSM, DOCX, and PPTX files reach ready state through the real lazy
  Viewer modules; the provided workbook no longer enters the metadata failure page.
- Office selection descriptors no longer contain an asset URL and the Office selection/read path
  has no Main-process filesystem call. Existing non-Office Main `fs` paths are audited separately
  for migration rather than treated as precedent for Office.
- An actual corrupt/encrypted/invalid package still fails closed, while a Viewer runtime failure
  emits one sanitized phase-specific diagnostic and one truthful UI error.
- Disposal during import, load, layout, or render cannot publish a late ready/error state or leave
  a Viewer, Worker, canvas, DOM node, or Find highlight alive.
- Focused real-module/source tests, directed typechecks, and the production build pass. Electron,
  Playwright, packaged smoke, and E2E remain owner-run.

## Resolution

Implemented by [Task 081](../plan/tasks/onlypreview-ooxml-viewer-runtime-repair-081.md) and approved
by [independent review 1](../plan/reviews/onlypreview-ooxml-viewer-runtime-repair-081-1.md) with no
blocking P1/P2. Source tests and the production build pass; Ral retains final live acceptance for
representative XLSX/XLSM, DOCX, and PPTX rendering and Find/highlight.
