---
id: onlypreview-restored-window-content-layout-113
scope: lay the OnlyPreview content out against the restored window size instead of the constructor size
status: implemented; owner verification pending
depends-on: [window-state-persistence-001]
---

# Restored Window Content Layout

## Objective

A window restored to its saved size must show its content at that size. Today the child views keep
the constructor-time bounds, so a restored window paints its Project rail and preview region into a
smaller rectangle with empty space around them.

Issue: [`onlypreview-restored-window-size-not-applied-to-content.md`](../../issues/onlypreview-restored-window-size-not-applied-to-content.md).

## Required behavior

1. `createStandaloneWindow` registers the `resize` listener before `this.show()`, so the resize that
   `WindowStateController.show()` produces — `applyBounds()`, and `maximize()` / `setFullScreen(true)`
   for a saved maximized or full-screen window — is observed.
2. `applyInitialBounds()` still runs before `show()`, so the first frame is never painted at the
   wrong size, and runs once more immediately after `show()` to cover the synchronous part of the
   restore.
3. The listener body is unchanged: shell bounds from `getContentSize()`, and the preview region plus
   Global Search bounds re-derived through the existing `clampPreviewBounds`.
4. Nothing about what is persisted, how a saved state resolves, or the window-state contract
   changes.

## Verification

- Source coverage in `onlyPreviewOpenDiagnostics.test.mjs` pins the ordering: the `resize` listener
  is registered before `show()`, the first layout precedes `show()`, and a second layout follows it.
  This ordering has already regressed once and is invisible at runtime until a window is restored.
- `yarn typecheck:node` passes and `yarn build` succeeds.
- Electron E2E is excluded; the owner verifies by resizing, quitting, and relaunching.
