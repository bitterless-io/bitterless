---
id: onlypreview-surface-container-130
scope: give the OnlyPreview composite its own container View and make the layer service order children inside it, one instance per surface
status: pending
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewViewLayer.test.mjs && node --test tests/onlypreview/onlyPreviewSurfaceContainer.test.mjs && yarn typecheck:node && git diff --check
---

# One container View under the four layers

## Objective

Stop attaching OnlyPreview's four layers to a window. Attach them to a container `View` that the
composite owns, so the whole surface can later be placed anywhere a native view can go, and keep
standalone behaviour identical.

## Context

- `docs/features/onlypreview-embeddable-mount.md`
- `src/main/onlypreview/views/onlyPreviewViewLayer.service.ts`
- `src/main/windows/onlyPreviewWindow.helper.ts` (shell attach at window creation)
- `tests/onlypreview/onlyPreviewViewLayer.test.mjs` (existing stub-window ordering test)

## Contract

- The window helper creates and owns the container `View`, keeps it filling the window's content
  rect, and attaches the Shell into it. The module-level `onlyPreviewViewLayerService` singleton
  stays a singleton in this task — per-surface instancing arrives with the registry in task 132, and
  splitting it here would drag the three `*Window` binding seams into a container change.
- `OnlyPreviewViewLayerService.start(container: View)` replaces `start(window: BaseWindow)`, and
  `resort()` calls `container.addChildView(view)`. The re-add-to-reorder algorithm, the
  owner-keyed occupancy, the refusal return value, the no-occlusion rule and the change-only
  `event=view-layers` record are unchanged.
- Liveness: `View` has no `isDestroyed()`, so the service must not invent one. `start(container)`
  records the container, `stop()` clears it, and `resort()` is a no-op with no container. Dead
  *child* detection keeps using the existing `webContents.isDestroyed()` probe.
- The container is created with no background colour, so it cannot paint a rectangle over the host.
- Standalone mode attaches the container to `window.contentView` filling the content rect, so the
  four layers keep the coordinates they have today.

## Verification

- The existing layer test passes against a stub container instead of a stub window: order, refusal,
  owner swap, dead-view eviction, no-occlusion.
- A new test proves the container fills the standalone content rect and that a disposed surface
  performs no further attaches.
- Nothing calls `window.contentView.addChildView` for an OnlyPreview layer any more.
