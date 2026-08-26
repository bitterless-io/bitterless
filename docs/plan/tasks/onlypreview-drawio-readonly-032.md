---
id: onlypreview-drawio-readonly-032
scope: No-iframe locally bundled read-only Draw.io rendering with adapter-lazy Vue format components
status: implemented; owner verification pending
depends-on:
  - onlypreview-design-completion-025
  - onlypreview-find-in-file-019
verify: node --test tests/onlypreview/*.test.mjs && yarn typecheck:node && yarn typecheck:web && yarn check:renderer-i18n && node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build
---

# Read-only Draw.io preview with lazy Vue adapters

## Objective

Route ordinary `.drawio` files to a new `drawio-viewer` adapter in `vuePreviewView`. Render them
read-only by mounting the locally bundled official draw.io static viewer directly into an owned DOM
element—without an iframe, online service, editor runtime, preload parser, or Main-process parser.
Keep ordinary Preview startup small by loading every Vue format component only when its adapter is
active; load the approximately 4MiB Draw.io viewer runtime only after the current file passes a
bounded Worker preflight.

This phase includes pages, layers, fit/zoom, truth-preserving errors, and lifecycle isolation. It
does not add Draw.io current-file text search: the adapter registers `find: none` until a later task
can search the complete bounded cell-label model and locate/highlight exact cells across pages and
layers.

## Source and design basis

- [OnlyPreview format coverage](../../design/onlypreview-format-coverage.md) — #7 dynamic component
  boundary and #9 Draw.io contract.
- [OnlyPreview dual preview views and find ownership](../../design/onlypreview-preview-merge-find.md)
  — Shell toolbar, mutually exclusive content views, adapter registry, and teardown.
- [OnlyPreview sub-application](../../features/onlypreview.md) — capability, asset, renderer, and
  truthful failure contracts.
- draw.io Desktop Quick Look mounts `GraphViewer` into an ordinary `.mxgraph` element and bundles
  `viewer-static.min.js` locally; its main editor also uses a direct local BrowserWindow rather than
  an iframe.

Pin the viewer from draw.io commit
`85a95c9066d8db7e90a2a2aa25f1179945d08ab6`:

- `viewer-static.min.js` SHA-256:
  `2fabaaa3e28d5f80f943285a2ce19c22cf870857203255f1e0347ef93693a297`
- Apache-2.0 `LICENSE` SHA-256:
  `43070e2d4e532684de521b885f385d0841030efa2b1a20bafb76133a5e1379c1`

An integrity mismatch fails tests. Do not download or track an unpinned `dev` artifact at runtime.

## Path

- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/shared/onlypreview/onlyPreviewFind.registry.ts`
- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewAdapter.service.ts` (new)
- `src/main/onlypreview/views/onlyPreviewPreviewView.service.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/common/onlyPreviewPresentation.service.ts`
- `src/renderer/onlypreview/preview/index.html`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/components/DrawioPreview/` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewDrawio.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewDrawioPreflight.service.ts` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewDrawioSelection.store.ts` (new)
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewDrawioPreflight.worker.ts` (new)
- `src/renderer/onlypreview/preview/src/workers/onlyPreviewDrawioWorker.contract.ts` (new)
- `src/renderer/onlypreview/preview/src/vendor/drawio/viewer-static.min.js` (new)
- `src/renderer/onlypreview/preview/src/vendor/drawio/LICENSE` (new)
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `tests/onlypreview/`
- `docs/design/onlypreview-format-coverage.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-drawio-readonly-032.md`
- `docs/plan/reviews/onlypreview-drawio-readonly-032-1.md`

Preserve unrelated working-tree edits, especially current Maestro files. Do not change branches,
use npm/pnpm, or run Electron/Playwright E2E.

## File-size policy

Replace scattered format-limit selection with one shared, typed adapter policy:

```ts
const DEFAULT_FILE_SIZE_LIMIT_BYTES = 10 * 1024 * 1024;

const FILE_SIZE_LIMIT_OVERRIDES = {
  monaco: 8 * 1024 * 1024,
  'markdown-dom': 1 * 1024 * 1024,
  'html-page': 1 * 1024 * 1024,
  'chromium-pdf': 100 * 1024 * 1024,
  'xlsx-grid': 25 * 1024 * 1024,
  'docx-dom': 25 * 1024 * 1024,
  'drawio-viewer': 20 * 1024 * 1024,
  image: 100 * 1024 * 1024,
  audio: null,
  video: null
} satisfies Partial<Record<OnlyPreviewPreviewAdapterId, number | null>>;
```

`null` is the explicit streaming policy: no product cap, but the capability still uses the finite
verified selected-file size. A missing adapter override falls back to 10MiB. Classifier admission
and asset issuance must call the same helper so their limits cannot drift. Preserve current limits
for existing formats; the migration is structural, not a silent behavior change.

## Delivery contract

1. Extend the exhaustive shared model with `kind: diagram` and adapter `drawio-viewer`; route only
   `.drawio` by extension. Do not reinterpret PNG/SVG embedded Draw.io metadata in this phase.
2. Apply the shared size policy before reading content. `.drawio` uses the 20MiB override; an
   oversize file receives a typed truth state and never fetches bytes, starts a Worker, or loads the
   viewer. Asset capability and bounded stream revalidate the same finite maximum against growth or
   replacement.
3. Replace every static format-component import in `PreviewSurface.vue` with adapter-selected
   `defineAsyncComponent()`/dynamic imports. The Shell and common store may remain eagerly loaded,
   but Monaco, Markdown, Sheet, Document, Image, Media, Draw.io, and unsupported presentation
   components must be separate on-demand component chunks. Never preload Draw.io from another
   adapter.
4. Fetch the exact revision-bound Draw.io asset in `vuePreviewView`, transfer its `ArrayBuffer` to a
   one-shot module Worker, and terminate that Worker on success, error, selection switch, component
   unmount, or a non-renewing 10-second deadline. No Main or preload XML/decompression/parser work.
5. Worker preflight decodes fatal UTF-8, rejects empty/non-Draw.io XML and `DOCTYPE`/`ENTITY`, and
   validates `mxfile`/`diagram` or an `mxGraphModel`. It scans outer XML in fixed chunks. For
   compressed pages, it streams URL-safe base64 quartets through
   `DecompressionStream('deflate-raw')`, a streaming percent/fatal-UTF-8 decoder, and a bounded XML
   scanner without constructing whole base64, inflate, URI, or page copies. Before semantic
   inspection, bounded raw tags receive one strict XML predefined/numeric character-reference
   canonicalization pass; unknown entities and illegal XML code points fail parsing. Reject more
   than 32MiB expanded XML, 128 pages, or 20,000 `mxCell` records. Validate every page; return no
   partial model.
6. Only after preflight succeeds, dynamically load the pinned same-origin viewer asset. Define the
   viewer callback before the first load, create a fresh owned `.mxgraph` mount, assign
   `data-mxgraph` through DOM APIs (never `innerHTML`), and invoke `GraphViewer.processElements()`.
   Configure read-only rendering with page/layer/zoom controls, centered auto-fit, resize, and no
   edit/navigation mode.
7. Keep the existing preview CSP frame-free and remote-free. The viewer may access only packaged
   same-origin assets and the validated model; block remote fonts/stencils, popups, downloads,
   external navigation, and permissions. Phase one rejects every image-bearing graph before viewer
   load—including embedded raster/SVG/data/blob resources, external image URLs, image shapes or
   sources, and `mxImage`/`image`/SVG markup—with `DIAGRAM_LIMIT`. HTML labels are untrusted.
8. Reset/destroy viewer state, generated DOM, owned listeners, Worker, pending fetch, and revision
   data before another adapter mounts. If the pinned viewer cannot prove complete document-global
   cleanup, destroy/recreate the exact `vuePreviewView` on Draw.io exit. Main arms one non-renewing
   30-second watchdog for an exact loading Draw.io runtime; a blocked renderer cannot extend it or
   affect a newer revision.
9. Add typed empty/parse/limit/render-timeout failures with symmetric en/zh copy and the standard
   relative-only metadata surface. Do not mount partial DOM. Preserve Shell-owned Open/Reveal and
   other native actions.
10. Register `drawio-viewer` with `find: none` for phase one. `Cmd/Ctrl+F` remains truthfully
    unavailable for Draw.io; do not use `findInPage()` or inject a search UI.

## Layout

```text
Shell Preview toolbar (unchanged)
┌──────────────────────────────────────────────────────┐
│ viewer-owned compact controls: Pages Layers Zoom/Fit │
├──────────────────────────────────────────────────────┤
│                                                      │
│              centered diagram canvas                 │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Reuse the existing neutral Preview content surface. Do not add a second Bitterless toolbar, card,
header, or iframe. Loading and failure reuse the existing metadata/error language.

## Acceptance

- Standard uncompressed and compressed multi-page `.drawio` fixtures render read-only with working
  page, layer, fit, and zoom controls; no editor command or mutation path is present.
- Vue startup and nonmatching adapters do not load unused format components. The Draw.io component
  is absent until `drawio-viewer` is active, and the pinned viewer runtime is absent until preflight
  succeeds.
- Default limit fallback is exactly 10MiB; existing adapter limits remain unchanged; Draw.io accepts
  a valid fixture over 10MiB up to 20MiB without weakening expanded/page/cell/time limits.
- Oversize, malformed XML, entity/doctype input, base64/inflate/URI failure, image-bearing content,
  entity-obfuscated image semantics, expanded-size overflow, page overflow, cell overflow, Worker
  timeout, viewer rejection, and Main watchdog timeout are typed terminal states with no partial
  mount or stale ready event.
- Rapid file/adapter switching terminates stale work and prevents old DOM, globals, callbacks,
  controls, graph instances, or ready/error results from reaching the current revision.
- Tests pin the official asset/license hashes and prove the viewer has no runtime remote dependency
  permitted by CSP/session policy.
- Draw.io current-file Find stays unavailable in this phase.

## Verification

- Focused classifier/size-policy, adapter registry, Region lifecycle/watchdog, Worker preflight,
  viewer loader/teardown, CSP, lazy-component, and pinned-asset integrity tests.
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn typecheck:web` (record unrelated baseline separately; zero new OnlyPreview diagnostics)
- `yarn check:renderer-i18n`
- Focused error-level ESLint and Prettier checks for changed source files
- `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`, then
  audit output chunks to prove component and viewer lazy boundaries
- `git diff --check`
- Electron/Playwright E2E and live app launch: **do not run**. Ral performs final runtime/visual
  acceptance.

## Owner verification

- Open ordinary, compressed, multi-page, multi-layer, and greater-than-10MiB `.drawio` files. Check
  fidelity, controls, resizing, switching, and sustained responsiveness.
- Switch quickly among Draw.io, text, Markdown, PDF, image, workbook, and DOCX files. Confirm no
  previous diagram DOM/control remains and ordinary previews are not slowed by the viewer runtime.
- Try one >20MiB file, one image-bearing graph, and one diagram exceeding a Worker structural
  limit. Confirm a quick truthful failure with Shell file actions still available and no hang or
  memory spiral.
- Confirm `Cmd/Ctrl+F` does not open a misleading current-file search for Draw.io in this phase.

## Verification evidence

- Implemented the shared typed adapter size-policy dictionary with a 10MiB fallback, preserved
  existing format limits, and added the 20MiB `drawio-viewer` override. Classifier admission and
  revision-bound asset issuance consume the same helper.
- Implemented `.drawio` routing, `find: none`, typed failures, one-shot transferable Worker
  preflight, immediate pending-promise settlement on dispose, the 10-second Worker deadline, and
  the exact Main-owned 30-second watchdog/rebuild fence. Outer XML, base64, DEFLATE, percent/UTF-8,
  and page XML are scanned as bounded streams with a 32MiB expanded cap; image-bearing graphs are
  rejected as `DIAGRAM_LIMIT` before viewer/GPU work.
- Vendored the pinned official viewer and Apache-2.0 license. SHA-256 verification passed with
  `2fabaaa3e28d5f80f943285a2ce19c22cf870857203255f1e0347ef93693a297` and
  `43070e2d4e532684de521b885f385d0841030efa2b1a20bafb76133a5e1379c1` respectively.
- Implemented iframe-free, offline, read-only direct DOM mounting with pages/layers/zoom/fit and
  deterministic graph/DOM/listener teardown. Leaving Draw.io always destroys the exact Vue Preview
  view so document-global viewer state cannot reach another adapter.
- Converted all Vue format SFCs to adapter-selected async components. The debug-dev build passed
  and emitted independent format chunks: a 20.08kB preflight Worker, 2.83kB JS plus 0.26kB CSS
  `DrawioPreview` chunks, and a separate 4,151.72kB viewer asset with no viewer preload in Preview
  HTML.
- `node --test --test-reporter=spec tests/onlypreview/*.test.mjs`: **PASS — 360/360**, with zero
  failed, cancelled, skipped, or todo tests. Focused Draw.io coverage passed 22/22, including valid
  greater-than-10MiB input, hostile image resources and extreme dimensions, a real
  greater-than-32MiB compressed expansion rejection, mixed decimal/hex/zero-padded entity payloads
  in direct/outer-escaped/compressed pages, streaming source guards, TS-1 line caps, and executed
  viewer mount/rejection/external-event/idempotent teardown behavior.
- `yarn typecheck:node`, focused error-level ESLint, focused Prettier, viewer/license hashes,
  `git diff --check`, and the debug-dev build: **PASS**.
- `yarn typecheck:web` remains blocked by existing Poker test globals, Connector/Home/Chat/Maestro/
  Omni window typings, and shared path-helper diagnostics; the final output contains zero
  OnlyPreview diagnostics. `yarn check:renderer-i18n` remains blocked by the unrelated existing
  `Tray must follow Home creation` assertion.
- Electron/Playwright E2E and the real app are intentionally not run; Ral owns the runtime/visual
  checklist above. Review 1 recorded **BLOCKED** on bounded compressed-page processing, image
  resource admission, TS-1 file sizes, and SFC/controller ownership; those findings are remediated.
  Review 2 recorded **BLOCKED** on numeric-entity image-semantic bypasses and source-only viewer
  lifecycle coverage. Strict single-layer tag canonicalization and a jsdom/GraphViewer behavioral
  harness remediate both findings. The final
  [independent review 3](../reviews/onlypreview-drawio-readonly-032-3.md) recorded **PASS** with no
  remaining correctness, security, performance, or device-freeze blocker; owner runtime/visual
  verification remains pending.
