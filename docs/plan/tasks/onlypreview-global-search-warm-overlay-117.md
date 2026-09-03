---
id: onlypreview-global-search-warm-overlay-117
scope: preload the Global Search overlay, keep it out of the child list until loaded, and raise it on its own readiness
status: implemented; owner verification pending
depends-on: [onlypreview-pdf-document-frame-readiness-114]
---

# Warm Global Search Overlay

## Objective

Make the first `Shift+Cmd+F` as fast as every later one, and stop the overlay from being attached in
a state where it can be occluded or can swallow input.

Issue: [`onlypreview-global-search-overlay-cold-and-occluded.md`](../../issues/onlypreview-global-search-overlay-cold-and-occluded.md).

## Required behavior

1. `OnlyPreviewGlobalSearchViewService.preload(hostToken)` builds the view through the existing
   idempotent `ensureView()`. It is called from the shell's `renderer-receipt` / `success` branch,
   after the startup lease settles — not from `start()`, which runs before the shell's own load.
2. A `ready` flag is set only when `loadView` resolves for the current view and generation.
   `attachTopmost()` refuses while it is false, so an unloaded transparent full-window overlay is
   never in the child list.
3. That same resolve raises and focuses the overlay when it is active, which is the only signal the
   overlay itself produces and did not previously exist.
4. `attachTopmost()` detaches before attaching.
5. `close()` still only detaches; `failOverlay()` and `destroy()` reset `ready`.
6. `onlyPreviewGlobalSearchWindowService` exposes `preload` and `isActive` — the latter so the
   Main-owned copy shortcuts (task 116) do not steal keys from the search field.

## Verification

- `onlyPreviewGlobalSearchView.test.mjs` asserts the overlay is absent from the child list until the
  load resolves, that the raise is `bounds → remove → add`, and that re-showing a warm overlay is
  synchronous and reuses the same view.
- `yarn build`, `tsc --noEmit -p tsconfig.node.json` and `vue-tsc --noEmit` are clean for OnlyPreview.
- Electron E2E excluded. The owner verifies by pressing Shift+Cmd+F immediately after opening
  OnlyPreview, and again with a PDF on screen to confirm the overlay floats above it.
