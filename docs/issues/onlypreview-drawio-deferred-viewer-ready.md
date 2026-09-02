# OnlyPreview rejects a valid Draw.io file while its mount is not visible

Status: fixed in source; owner verification pending

## Symptom

`workflows/mcu/implement/mcu-workflow.drawio` cannot be previewed even though it is a normal
diagrams.net document. The visible result can look like a parse failure.

## Confirmed boundary

- The file is 14,024-byte UTF-8 XML with one direct, uncompressed `<mxGraphModel>`, 39 cells, and
  no embedded or external image resource.
- `xmllint` accepts it and the current bounded Draw.io Worker preflight returns one page and 39
  cells.
- The pinned local `viewer-static.min.js` renders the same document when its mount has a non-zero
  width.
- The installed stable `/Applications/Bitterless.app` is an older 2026-08-20 build whose ASAR does
  not contain `DrawioPreview`, the preflight Worker, or `viewer-static`; that package cannot support
  Draw.io until a newer build is installed.

The current source also has a real renderer timing bug. The official viewer deliberately defers
initialization through a `MutationObserver` while its mount has zero width. This occurs during
`WebContentsView` attachment/visibility transitions. `renderOnlyPreviewDrawio()` restores the
global initialization callback and checks its result immediately after `processElements()` returns,
so a deferred valid viewer is misclassified as `DIAGRAM_PARSE_FAILED`.

## Accepted repair

- Keep `.drawio` on the existing iframe-free `vuePreviewView` adapter and pinned local official
  viewer. Do not add the editor, an online service, an iframe, or a second wrapper library.
- Treat viewer initialization as an asynchronous lifecycle event. Wait for the exact mount's
  `viewerInitialized` callback within a finite renderer deadline instead of requiring a synchronous
  callback.
- Give the component store a cancellation authority. File/revision replacement and unmount must
  settle the pending mount, restore the previous global callback, remove owned DOM/listeners, and
  prevent late ready/error publication.
- Preserve Main's existing non-renewing 30-second Draw.io watchdog and full Vue-view rebuild fence.
  The renderer wait must be shorter and non-renewing; it must not poll, spin, or keep a hidden view
  alive indefinitely.
- Preserve the current 20 MiB file cap, Worker structural limits, image-resource rejection, offline
  CSP, and `find: none` contract.

## Acceptance

- The supplied direct/uncompressed Draw.io shape reaches ready after a zero-width/deferred viewer
  initialization and renders through the local official viewer.
- Synchronous viewer initialization remains supported.
- Unmount, rapid selection change, deferred timeout, viewer rejection, and a late callback cannot
  leak a graph, callback, listener, DOM node, or stale ready/error state.
- Focused Node tests, type checks, renderer i18n, source lint, and the production build pass.
  Electron, Playwright, packaged smoke, and E2E remain owner-run.

## Resolution

Implemented by [Task 099](../plan/tasks/onlypreview-drawio-deferred-viewer-ready-099.md).
[Independent review 1](../plan/reviews/onlypreview-drawio-deferred-viewer-ready-099-1.md) passed
after the original global-callback approach was replaced by the bounded pre-vendor visibility gate.
