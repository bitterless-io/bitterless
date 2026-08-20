---
id: onlypreview-docx-render-021
scope: Render DOCX as sanitized Word-like paginated DOM inside vuePreviewView
status: pending
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
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/renderer/onlypreview/preview/src/components/DocumentPreview/` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewDocument.service.ts` (new)
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewOoxmlPreflight.service.ts`
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewOoxmlPreflight.worker.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewDocumentSanitizer.service.ts` (new)
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `tests/onlypreview/fixtures/createOnlyPreviewFixtures.ts`
- `tests/onlypreview/onlyPreviewDocumentPreview.test.mjs` (new)
- `tests/onlypreview/onlyPreviewRendering.test.mjs`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`

Install `docx-preview` with Yarn only and preserve every unrelated `package.json`/`yarn.lock` hunk,
including the current Electron pin. Do not parse DOCX in Main or preload.

# Delivery

1. Add `docx-preview` with Yarn. Classify `.docx` as `document`, require OOXML ZIP signature, and
   issue a finite 25MiB revision-bound asset capability. `.doc`, `.rtf`, `.odt`, `.xls`, `.ppt`, and
   `.pptx` do not enter this renderer.
2. Fetch the bounded bytes in `vuePreviewView`, transfer them through a one-shot Worker using the
   reusable pure OOXML preflight, and require normalized package paths plus DOCX parts before import.
   Enforce the same exact 5,000-entry, 200MiB declared-total, 128MiB per-entry, and 200:1 per-entry/
   aggregate ratio limits; reject encrypted, multi-disk, Zip64, duplicate, overlapping, traversal, or
   malformed archives. Signature/byte/ZIP failure must not load the engine.
3. Dynamically import `docx-preview` only after all hard gates pass. Call its stable `renderAsync()`
   API with `renderAltChunks: false`, `renderChanges: false`, `renderComments: false`, and
   `ignoreFonts: true`, targeting detached body and style containers. Do not split or depend on
   undocumented internal parse/render APIs.
4. Before mount, sanitize the detached result: remove script/iframe/frame/object/embed/link/meta/form
   and active/navigational elements; remove event attributes, `href`, unsafe `src`/`srcset`, remote/
   file/custom-scheme URLs, CSS `@import`, and every CSS `url()` not created for a verified embedded
   package image. Keep only the layout/style properties needed for docx-preview pagination, with
   property/value validation rather than attaching raw package CSS.
5. Render Word-like pages, paragraphs, lists, tables, headers/footers, page settings, and embedded
   images. Track and revoke every generated blob URL. Missing fonts fall back to system fonts.
   Explicitly do not promise Word's pixel-perfect pagination, live repagination, tracked changes,
   comments, field recalculation, macros, OLE, or embedded external documents.
6. `renderAsync()` has no AbortSignal. A normal selection change aborts fetch/preflight, clears the
   detached containers, revokes blobs, and rejects any late render by exact host + selection
   revision. A bounded render timeout or unresponsive Vue renderer reports to the Main Preview
   Region, which destroys/recreates `vuePreviewView`; do not falsely claim the library call was
   cancelled.
7. Publish `webcontents-find` capability only after the sanitized DOM is attached and current. Task
   019 routes Main `findInPage()` to `vuePreviewView`; no DOCX-specific text index or injected find UI
   is added.
8. Distinguish oversize, signature mismatch, ZIP limit, encrypted/corrupt, empty document, sanitizer
   failure, and render timeout states. Every failure retains file identity and system-open/reveal
   actions in the Shell toolbar; none mounts partial untrusted DOM.
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
- The renderer advertises current-file find only after safe DOM mount; production build code-splits
  `docx-preview` out of the initial Vue chunk.

# Verification

- Focused OOXML preflight, sanitizer, lifecycle, timeout, and source/build tests with crafted fixtures
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn typecheck:web` (separate unrelated baseline failures)
- `yarn check:renderer-i18n`
- Focused ESLint for changed OnlyPreview/package-adjacent files
- `yarn build` plus chunk audit
- `git diff --check`
- Electron/Playwright E2E: **do not run**; Ral performs final document/runtime verification.
