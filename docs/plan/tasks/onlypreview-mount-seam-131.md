---
id: onlypreview-mount-seam-131
scope: introduce OnlyPreviewMount with a standalone implementation, route the single bounds choke point through it, and clamp every layer inside the composite rect
status: pending
depends-on: [onlypreview-surface-container-130]
verify: node --test tests/onlypreview/onlyPreviewMountSeam.test.mjs && node --test tests/onlypreview/onlyPreviewPreviewBounds.test.mjs && yarn typecheck:node && git diff --check
---

# The mount seam

## Objective

Make the composite ask its host for geometry and window services instead of holding a `BaseWindow`,
with today's window as the first implementation and no behaviour change.

## Context

- `docs/features/onlypreview-embeddable-mount.md` (the `OnlyPreviewMount` interface)
- `src/main/windows/onlyPreviewWindow.helper.ts:528` (`updatePreviewBounds`, the one choke point)
- `src/main/windows/onlyPreviewWindow.helper.ts` `clampPreviewBounds`, `MIN_WIDTH`, `MIN_HEIGHT`
- `src/main/windows/windowState.service.ts`

## Contract

- `OnlyPreviewMount` is declared next to the surface, not next to any host: `kind`, `attach`,
  `detach`, `contentSize`, `onResize`, `onActivation`, `window`, `chrome`, `requestClose`,
  `reportTitle`. Hosts implement it; OnlyPreview never imports a host.
- `StandaloneOnlyPreviewMount` moves today's window ownership: `BaseWindow` creation and options,
  `WindowStateController`, bounds persistence, `MIN_WIDTH`/`MIN_HEIGHT`, `resize` → `onResize`,
  window focus → `onActivation`.
- `updatePreviewBounds` reads `mount.contentSize()` instead of `window.getContentSize()`. The three
  distributed rects and their consumers are unchanged.
- Containment is an invariant, not an assumption: a pure `clampSurfaceLayout(measured, contentSize)`
  returns the preview rect **and** the overlay rect, both contained in
  `{0, 0, contentSize.width, contentSize.height}`. Nothing may rely on a parent view clipping its
  children — that is unverified on this Electron build.
- Settings and the Agent Skill guide windows take their parent from `mount.window()`.
- `minimizeWindow` / `toggleMaximizeWindow` / `closeWindow` route through the mount.

## Verification

- A stub mount drives the surface: resize propagates, `contentSize` feeds all three rects.
- `clampSurfaceLayout` is exhaustively tested including zero and negative sizes, an oversized
  measured rect, and a rect whose origin is outside the composite.
- Standalone geometry, minimum size and window-state persistence are unchanged.
