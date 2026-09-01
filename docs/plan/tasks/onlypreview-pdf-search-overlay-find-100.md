---
id: onlypreview-pdf-search-overlay-find-100
scope: Full-window transparent Global Search overlay plus exact PDF document-frame Find readiness
status: implemented; owner verification pending
depends-on:
  - onlypreview-global-search-floating-surface-048
  - onlypreview-find-in-file-019
  - onlypreview-pdf-network-delivery-028
verify: focused non-Electron Global Search/PDF/Find tests, node/web typechecks, i18n, lint, build, and git diff check
---

# Keep Global Search above PDF and delay PDF Find until text readiness

## Objective

Make Global Search a full-OnlyPreview transparent native overlay whose existing floating workspace
stays aligned with the Preview rectangle, and make current-file PDF Find wait for the exact built-in
document frame to finish loading.

## Context

- [PDF Search overlay and Find issue](../../issues/onlypreview-pdf-search-overlay-and-find-readiness.md)
- [Global Search design](../../design/onlypreview-global-search.md)
- [Dual Preview and Find design](../../design/onlypreview-preview-merge-find.md)

## Paths

- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/main/onlypreview/views/onlyPreviewGlobalSearchView.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewView.service.ts`
- shared/renderer Global Search layout snapshot contract only if required
- `src/renderer/onlypreview/globalSearch/src/App.vue`
- `src/renderer/onlypreview/globalSearch/src/App.less`
- obsolete Shell scrim source/styles
- focused Global Search, Preview View, and Find tests

## Contract

1. Main gives Search the complete BaseWindow content bounds and separately supplies the clamped
   current Preview rectangle as renderer-local workspace geometry. No renderer invents native
   coordinates.
2. Search HTML is fully transparent outside the existing body/workspace surface. The panel uses
   the same Preview-relative position, 24px gutter, dimensions, radius, shadow, and internal layout.
3. Search itself consumes any click outside the workspace and closes through the existing opener
   path. Shell no longer owns a dismissal scrim; transparent overlay clicks never activate Shell.
4. Every Preview attach and exact PDF document-frame-ready transition re-raises an active Search
   view. Close remains warm-detach and restores the live opener.
5. A PDF becomes ready only after `did-frame-finish-load` identifies the exact current non-main
   `WebFrameMain` at the navigation URL. Mere frame existence and main-frame completion are not
   enough; stale/foreign events cannot mutate readiness.
6. Preserve `chromium-pdf -> webcontents-find`. A query entered while PDF is pending dispatches
   exactly once after ready through the existing revision/request fences. No parser, script
   injection, OCR, or second PDF renderer is added.

## Verification

- Full-window native bounds plus exact inner Preview workspace geometry and transparent dismissal.
- Search topmost re-raise after PDF document readiness and all existing Vue/HTML attach paths.
- PDF existence-not-ready, exact frame-finish-ready, stale-frame rejection, pending-query replay,
  native result/highlight/navigation, stop/clear, and timeout behavior.
- Focused Node tests, node/web typechecks, i18n, lint, `yarn build`, and `git diff --check`.
- No Electron/Playwright/E2E; Ral owns final live PDF/Search/Find acceptance.

## Delivery

Implemented on 2026-09-01. Global Search now owns a full-window transparent native view while Main
supplies the exact Preview-relative workspace rectangle; the renderer consumes transparent-canvas
clicks and the historical Shell scrim is removed. PDF readiness now waits for the exact current
non-main document frame's `did-frame-finish-load`, then re-raises Search and lets the existing
pending→ready Find path dispatch the current query once.

[Independent review 1](../reviews/onlypreview-pdf-search-overlay-find-100-1.md) passed with no P0-P3
finding. Ral owns remaining live PDF z-order, highlight, navigation, and transparent-dismissal
acceptance.
