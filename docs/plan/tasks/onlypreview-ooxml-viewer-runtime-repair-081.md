---
id: onlypreview-ooxml-viewer-runtime-repair-081
scope: Repair the sandboxed OOXML Viewer startup and move bounded Office file reads into the hidden renderer preload
status: implemented; owner verification pending
depends-on:
  - onlypreview-office-ooxml-renderers-077
verify: focused real-module and Office session tests, directed typechecks, production build and output inspection; no Electron/Playwright/E2E
---

# OOXML Viewer runtime repair

## Objective

Make valid XLSX/XLSM, DOCX, and PPTX files load through the existing lazy
`@silurus/ooxml@0.83.0` Viewer path and replace the adapter's catch-all parse failure with bounded,
phase-specific evidence and truthful failure handling.

## Context

- [OnlyPreview format coverage](../../design/onlypreview-format-coverage.md)
- [OOXML Viewer runtime failure](../../issues/onlypreview-ooxml-viewer-runtime-failure.md)

## Path

- `src/renderer/onlypreview/preview/src/onlyPreviewOfficeSession.service.ts`
- `src/preload/fileSearch/fileSearch.preload.ts`
- `src/preload/onlypreview/onlypreviewContent.preload.ts`
- `src/main/fileSearch/fileSearchWindow.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/shared/onlypreview/onlyPreviewOfficeReadRuntime.types.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewAdapter.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewView.service.ts`
- `tests/onlypreview/onlyPreviewOfficeOoxml.test.mjs`

## Contract

- Preserve the Task 077 format routing, resource policy, sandbox, CSP,
  Find/highlight behavior, 30-second outer watchdog, and generation-fenced teardown.
- Read the exact current Office selection asynchronously in the existing hidden `fileSearch`
  renderer preload. The visible Vue Preview remains sandboxed and receives only a narrow
  `readCurrentOfficeBytes({ selectionRevision })` bridge: it cannot supply or observe a path,
  capability, workspace root, or database path. Main validates only the current in-memory
  host/runtime/revision/adapter and performs no Office `fs` open/read/stat/realpath/stream; the
  hidden preload owns containment, metadata, identity and content verification.
- Bind Office reads to an independent unguessable XPC capability, an exact runtime/revision and a
  one-shot grant. The reader must use `O_NOFOLLOW`, regular-file/containment and pre/post identity
  checks, a 25 MiB hard ceiling, one active generation, asynchronous chunked reads and deterministic
  cancellation/handle close. Office signature and compound/encrypted-container checks happen after
  the preload read, not in Main.
- Existing `electron-xpc` does not transfer an `ArrayBuffer`; every result is structured-cloned
  through the Main broker. Therefore the hidden reader exposes a sequential pull session with a
  small fixed maximum frame, never a whole-file XPC result. The Vue preload alone preallocates the
  exact admitted buffer, pulls frames serially, validates EOF/length, and returns the completed
  buffer inside the Vue renderer. Allow at most one Office read and never retain stale full buffers.
- Treat read, preflight, module import, Viewer construction, load/layout, and asynchronous render
  as distinct internal phases. Report at most one terminal failure for a session.
- Sanitize Viewer errors to bounded name/code/message metadata and correlate each emitted failure
  with an opaque session identity, exact selection revision, and elapsed milliseconds from session
  start. Never log paths, asset URLs, queries, file contents, cell/document text, archive part
  names, or arbitrary serialized objects.
- Forward `onError(error)` from all three Viewers. Preserve an upstream typed OOXML parse/resource
  error where it is identifiable; otherwise use a truthful format render/runtime failure rather
  than claiming the package could not be parsed.
- Use one `mode: 'main'` OOXML load in the isolated Vue Preview `WebContentsView` for all three
  formats. This is the library's 2D-canvas path in a disposable renderer—not Electron main-process
  work and not a Worker-failure fallback—and must not introduce a second parse, legacy renderer,
  remote asset, or expanded network/CSP permission.

## Verification

- Add focused tests for real import/configuration compatibility plus session tests covering each
  phase, error sanitization, one-shot reporting, queued Viewer errors, teardown, and all three
  formats.
- Re-run the existing Office routing, preflight, lifecycle, Find, and source-boundary tests.
- Add focused reader/bridge tests for exact capability and revision binding, no arbitrary path API,
  maximum XPC frame size, sequential offsets/EOF, cancellation/latest-only allocation,
  size/identity/symlink rejection, and path-free errors.
- Run directed renderer/preload typechecks, formatting, `git diff --check`, and a production build with
  Office WASM/worker asset inspection.
- Do not run Electron, Playwright, packaged smoke, or E2E. Ral performs live XLSX/DOCX/PPTX
  rendering and Find acceptance.

## Delivery

- XLSX/XLSM, DOCX, and PPTX now load their exact lazy `@silurus/ooxml@0.83.0` subpath and use
  `mode: 'main'` for host 2D painting inside the disposable Vue Preview renderer; package OOXML/WASM
  parsing remains in its parser Worker. Model-backed Find/highlight remains enabled for all three
  formats.
- Office admission and bytes now come from the hidden `fileSearch` preload. Main performs only
  in-memory capability/runtime/revision authorization and relays serial frames capped at 512 KiB;
  it performs no Office filesystem operation and never receives one whole Office file in one XPC
  response.
- Reads are one generation at a time, capped at 25 MiB, use `O_NOFOLLOW`, containment and complete
  pre/open/post-open/EOF identity checks, and close deterministically on EOF, error, replacement,
  timeout, cancellation, ready, or terminal render error.
- Phase-specific diagnostics and truthful read/preflight/import/construction/load/layout/render
  errors replace the former catch-all parse message without exposing paths or document content.
- Independent [review 1](../reviews/onlypreview-ooxml-viewer-runtime-repair-081-1.md) passed with no
  blocking P1/P2. Its eight focused suites passed 107/107; targeted ESLint, Prettier, Node
  typecheck, and `git diff --check` passed. The production build passed and emitted separate
  XLSX/DOCX/PPTX chunks, parser WASM/render workers, and the Office preflight Worker.
- Web typecheck remains blocked only by unrelated existing Poker/Home/Connector/shared-path
  diagnostics; no Task 081 file appears in those errors. Electron, Playwright, packaged smoke, and
  E2E were not run by request. Ral's live XLSX/XLSM/DOCX/PPTX render and Find acceptance remains.
