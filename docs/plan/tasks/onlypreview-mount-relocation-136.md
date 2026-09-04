---
id: onlypreview-mount-relocation-136
scope: move a live OnlyPreview surface between the standalone window and a Cowork tab without reloading it
status: pending
depends-on: [onlypreview-cowork-tab-mount-135]
verify: node --test tests/onlypreview/onlyPreviewMountRelocation.test.mjs && yarn typecheck:node && git diff --check
---

# Dock and undock

## Objective

With one live content surface, opening OnlyPreview from the other entry point must move it rather
than refuse or duplicate — keeping the workspace, index state, selection, scroll position and open
dialogs.

## Context

- `docs/features/onlypreview-embeddable-mount.md` (identity and instance count, PQ-1)
- Measured on Electron 40.10.6: re-parenting a container to another window succeeds, the source
  window's child list empties, and the child render process and DOM survive.

## Contract

- `relocate(surface, nextMount)`: detach from the old mount, attach to the new one, re-subscribe
  `onResize` and `onActivation`, re-derive geometry from the new `contentSize()`, and dispose the old
  mount's host-side shell (the window, or the tab) without touching the surface's views.
- No view is created, destroyed or reloaded. A relocation that would have to reload is a failure, not
  a fallback.
- Window-scoped listeners must not leak: every subscription taken from a mount is released on
  detach, and a relocation is idempotent if the target mount is already current.
- Relocating while an alert dialog or Global Search is open preserves that layer's occupancy.
- If PQ-1 is later answered "both at once", this task's seam is where the second surface appears
  instead of a relocation.

## Verification

- A relocation between two stub mounts: no view identity changes, listeners on the old mount are
  released, the new `contentSize` drives the next layout, layer occupancy is preserved.
- Double relocation to the same mount is a no-op.
