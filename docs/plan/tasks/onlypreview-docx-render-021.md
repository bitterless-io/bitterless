---
id: onlypreview-docx-render-021
scope: Render DOCX as sanitized Word-like paginated DOM inside vuePreviewView
status: implemented; owner verification pending
depends-on: [onlypreview-xlsx-grid-020]
---

# Objective

Preview `.docx` in `vuePreviewView` with `docx-preview` as a Word-like paginated document. Fetch and
ZIP-preflight the bounded OOXML asset asynchronously, render into detached body/style containers,
sanitize all generated DOM/CSS/resource references, and attach only the exact current revision.
Preserve paragraphs, lists, tables, headers/footers, page settings, and embedded images while never
executing macros, OLE, altChunk HTML, field code, script, navigation, or remote resources. Legacy
`.doc` stays explicitly unsupported and opens through the system application.

# Context

- [OnlyPreview format coverage](../../design/onlypreview-format-coverage.md) — #1, #3, #4.1, #6,
  #7, and #8/G1–G5
- [OnlyPreview dual preview views and find ownership](../../design/onlypreview-preview-merge-find.md)
  — #7.2 and #7.4 DOCX DOM find route
- [Preview guards](onlypreview-preview-guards-023.md)
- [XLSX Worker delivery](onlypreview-xlsx-grid-020.md) — reusable OOXML preflight boundary
- [OnlyPreview sub-application](../../features/onlypreview.md)

# Path

- `package.json`
- `yarn.lock`
- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts`
- `src/renderer/onlypreview/preview/src/components/DocumentPreview/` (new)
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/onlyPreviewDocument.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewDocumentCssSanitizer.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewDocumentSanitizer.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.service.ts`
- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlPreflight.type.ts` (Task 025 split)
- `src/renderer/onlypreview/preview/src/onlyPreviewOoxmlMergeScanner.service.ts` (Task 025 split)
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewDocumentPreflight.worker.ts` (new)
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewDocumentWorker.contract.ts` (new)
- `tests/onlypreview/onlyPreviewDocumentPreview.test.mjs` (new)
- `tests/onlypreview/onlyPreviewDocumentSanitizer.test.mjs` (new)
- `tests/onlypreview/onlyPreviewDocumentSession.test.mjs` (new)
- `tests/onlypreview/onlyPreviewDocumentTest.helper.mjs` (new)
- `tests/onlypreview/onlyPreviewOoxmlPreflight.test.mjs`
- `tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `docs/design/onlypreview-format-coverage.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-docx-render-021.md`

Install `docx-preview` with Yarn only and preserve every unrelated `package.json`/`yarn.lock` hunk,
including the current Electron pin. Do not parse DOCX in Main or preload.

# Delivery

1. Add `docx-preview` with Yarn. Classify `.docx` as `document`, require OOXML ZIP signature, and
   issue a finite 25MiB revision-bound asset capability. `.doc`, `.rtf`, `.odt`, `.xls`, `.ppt`, and
   `.pptx` do not enter this renderer.
2. Fetch the bounded bytes in `vuePreviewView`, transfer them through a one-shot Worker using the
   reusable pure OOXML preflight, and require normalized package paths plus DOCX parts before import.
   The renderer adapter applies a hard 10-second outer timeout to that one-shot Worker and terminates
   it after either its single response or the deadline.
   Enforce the same exact 5,000-entry, 200MiB declared-total, 128MiB per-entry, and 200:1 per-entry/
   aggregate ratio limits; reject encrypted, multi-disk, Zip64, duplicate, overlapping, traversal, or
   malformed archives. Signature/byte/ZIP failure must not load the engine.
3. Dynamically import exactly `docx-preview@0.4.0` only after all hard gates pass. Call its stable
   `renderAsync()` API with `renderAltChunks: false`, `renderChanges: false`,
   `renderComments: false`, `ignoreFonts: true`, `renderHeaders: true`, `renderFooters: true`,
   `useBase64URL: false`, `experimental: false`, and `debug: false`, targeting detached body and
   style containers. Do not split or depend on undocumented internal parse/render APIs.
4. Before mount, sanitize the detached result: remove script/iframe/frame/object/embed/link/meta/form
   and active/navigational elements; remove event attributes, `href`, unsafe `src`/`srcset`, remote/
   file/custom-scheme URLs, CSS `@import`, and every CSS `url()` not created for a verified embedded
   package image. Keep only the layout/style properties needed for docx-preview pagination, with
   property/value validation rather than attaching raw package CSS.
5. Render Word-like pages, paragraphs, lists, tables, headers/footers, page settings, and embedded
   images. On success, scan the complete detached body and style output, validate and register every
   blob URL before mount, and revoke every registered or discarded URL on normal selection change,
   stale completion, failure, or teardown. Missing fonts fall back to system fonts.
   Explicitly do not promise Word's pixel-perfect pagination, live repagination, tracked changes,
   comments, field recalculation, macros, OLE, or embedded external documents.
6. `renderAsync()` has no AbortSignal. A normal selection change serially resets the current adapter,
   aborts fetch/preflight, immediately settles an awaiting old preflight with the typed stale timeout,
   clears the detached containers, revokes blobs, and rejects any late render by exact runtime, host,
   and selection revision without killing a newer revision. If a transition leaves a DOCX while
   `renderAsync()` is still pending, Main closes that exact old Vue view and rotates its runtime
   before the new revision; a post-ready transition may reuse the view after serial dispose/revoke.
   Main arms one external 30-second watchdog as soon as a DOCX presentation is loading and its exact
   `vuePreviewView` + runtime token exist, including first creation after bounds arrive. Repeated
   bounds attachment or reset acknowledgement never restarts that deadline. Engine rejection,
   inability to obtain and validate the complete detached output, or timeout destroys and recreates
   that exact Vue view so orphaned renderer-owned blob URLs cannot survive. This Main timer remains
   effective if the renderer UI thread is blocked; do not falsely claim the library call was
   cancelled.
7. Report the current `docx-dom` presentation ready only after the sanitized DOM is attached and
   current, while preserving the existing selected-text capability. This task does not publish a
   find capability. Implemented task 019 consumes a ready current `docx-dom` presentation, registers
   `webcontents-find`, and routes Main `findInPage()` to `vuePreviewView`; no DOCX-specific text index
   or injected find UI is added here.
8. Distinguish oversize, signature mismatch, ZIP limit, encrypted/corrupt, and the document-specific
   typed states `DOCUMENT_PARSE_FAILED`, `DOCUMENT_EMPTY`, `DOCUMENT_SANITIZE_FAILED`, and
   `DOCUMENT_RENDER_TIMEOUT`. Every failure retains file identity and system-open/reveal actions in
   the Shell toolbar; none mounts partial untrusted DOM.
9. Keep `docx-preview` out of the Vue initial chunk. Add symmetric en/zh copy and update the feature,
   analysis, and plan contracts with the exact implementation/fidelity boundary.

# Acceptance

- A DOCX fixture with headings, lists, tables, page breaks/settings, headers/footers, and embedded
  images renders in order as Word-like pages; missing fonts degrade without failing.
- Crafted altChunk/script/iframe/object/embed/link/event attributes, `srcset`, remote links/images,
  CSS `@import`, and CSS `url()` never reach the mounted live DOM or network.
- No permission, popup, navigation, macro, OLE, field evaluation, or remote request occurs.
- Switching files during fetch/preflight/render prevents stale DOM installation and revokes every
  blob; a timed-out render rebuilds the Vue surface while preserving Shell.
- Oversize, bad signature, ZIP expansion/ratio/entry violation, encrypted/corrupt, empty, and sanitize
  failure states are distinct and actionable. `.doc` remains unsupported with system-open action.
- The renderer reports ready only after safe DOM mount and preserves selected-text reporting;
  implemented task 019 derives/registers current-file find from that ready state. Production build
  code-splits `docx-preview` out of the initial Vue chunk.

# Verification

- Focused OOXML preflight, sanitizer, lifecycle, timeout, and source/build tests with crafted fixtures
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn typecheck:web` (separate unrelated baseline failures)
- `yarn check:renderer-i18n`
- Focused ESLint for changed OnlyPreview/package-adjacent files
- `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` plus
  chunk audit
- `git diff --check`
- Electron/Playwright E2E: **do not run**; Ral performs final document/runtime verification.

# Delivery Evidence

- Focused DOCX engine/Worker/SFC tests: 11/11 passed; sanitizer tests: 8/8 passed; Main Region
  watchdog/lifecycle tests: 25/25 passed.
- Review-1 cleanup preserves the same behavior while splitting the DOCX CSS sanitizer and
  engine/Worker/SFC test harness below the 800-line source-file limit. `DocumentPreview` now keeps
  only its zero-argument `ready` emit and reports both mount failures directly to the revision-fenced
  Store.
- [Independent review round 2](../reviews/onlypreview-docx-render-021-2.md) recorded **PASS** after
  re-auditing the complete contract and review-1 cleanup. The remaining gate is Ral's real DOCX
  visual/runtime verification, so the ledger is `implemented; owner verification pending`.
- Full `node --test tests/onlypreview/*.test.mjs`: 278/278 passed.
- `yarn typecheck:node` and `yarn check:renderer-i18n`: passed.
- `yarn typecheck:web`: existing repository baseline remains at 76 diagnostics outside OnlyPreview;
  filtering `src/{main,renderer,shared}/onlypreview` produced no diagnostics.
- Focused ESLint: no errors; focused Prettier check: passed.
- Safe source build passed with isolated `docx-preview` and document-preflight Worker chunks; audit
  confirmed the engine is absent from the bootstrap entry and reached only by dynamic import.
- Task 025 preserves the DOCX-facing preflight exports while moving shared OOXML types/budgets and
  the XLSX-only merge scanner into bounded siblings. The focused OOXML pass is 18/18 and the full
  OnlyPreview suite is 318/318; the safe source build still keeps `docx-preview` and its preflight
  Worker outside the initial Vue entry.
- `package.json`/`yarn.lock` audit confirms the exact `docx-preview@0.4.0` addition, the existing
  Electron `40.10.6` pin, and unrelated version/package changes remain intact.
- `git diff --check`: passed. Electron/Playwright E2E and the real app were intentionally not run.
