import type { View } from 'electron';

/**
 * Child-view stacking for the OnlyPreview composite, in one place.
 *
 * Before this, three services each called `contentView.addChildView` and each only knew how to put
 * *itself* on top, so no code owned the resulting order. `raiseAfterPreviewAttach` existed purely to
 * undo the preview's raise — the correct order was maintained by one service calling another back
 * after the fact, and any attach path that missed that callback left the Global Search overlay
 * buried. Three rounds of fixes failed on that structure rather than on the primitive.
 *
 * The primitive is fine. Electron documents it: "If the same View is added to a parent which already
 * contains it, it will be reordered such that it becomes the topmost view." So every show re-adds
 * every shown view in layer order, lowest first, and the last call wins.
 *
 * The parent is the composite's own container `View`, not the window: the four layers are children
 * of one relocatable native view so the whole surface can be carried by a host that is not a window
 * of its own. Measured on Electron 40.10.6 before this change — a plain `View` parents a
 * `WebContentsView`, the re-add reorder behaves identically inside a container, and child bounds are
 * parent-relative, so nothing about the algorithm or the coordinates below changes with the move.
 */
export const ONLY_PREVIEW_VIEW_LAYER_ORDER = ['base', 'main', 'global', 'alert'] as const;

export type OnlyPreviewViewLayer = (typeof ONLY_PREVIEW_VIEW_LAYER_ORDER)[number];

/**
 * A layer is held by an owner, never by a view.
 *
 * Keying by view would refuse the preview region's ordinary surface swap between Vue and Chrome, and
 * would block switching from one PDF to the next. Keying by owner lets an owner replace its own view
 * freely while still refusing a *different* owner — one Settings-style view cannot appear on top of
 * Global Search in the same layer.
 */
export type OnlyPreviewViewLayerOwner = 'shell' | 'preview' | 'globalSearch' | 'alert';

/**
 * No layer hides another.
 *
 * An earlier version had `global` and `alert` hide everything beneath them, on the theory that a
 * full-window overlay makes the layers under it pointless. That was wrong and the owner caught it:
 * the Global Search view is created with `setBackgroundColor('#00000000')` and its panel floats
 * inside a transparent canvas with a gutter, so the project rail and the preview are *supposed* to
 * stay visible around it. Hiding them turned the overlay into an opaque sheet that blanked the
 * window.
 *
 * Visibility is therefore each owner's own business, and this service only owns the order.
 */
const isDeadView = (view: View): boolean => {
  const webContents = (view as { webContents?: { isDestroyed(): boolean } }).webContents;
  return !!webContents && webContents.isDestroyed();
};

interface LayerOccupant {
  owner: OnlyPreviewViewLayerOwner;
  view: View;
}

export class OnlyPreviewViewLayerService {
  private container: View | null = null;
  private readonly occupants = new Map<OnlyPreviewViewLayer, LayerOccupant>();
  private lastRecord = '';

  start(container: View): void {
    this.container = container;
    this.occupants.clear();
    this.lastRecord = '';
  }

  /**
   * Put a view in its layer and re-assert the whole order.
   *
   * Returns `false` when a different owner already holds the layer, and changes nothing — a refused
   * show is an ordinary outcome, not a fault, so the caller decides what to say about it.
   */
  show(layer: OnlyPreviewViewLayer, owner: OnlyPreviewViewLayerOwner, view: View): boolean {
    const current = this.occupants.get(layer);
    if (current && current.owner !== owner && !isDeadView(current.view)) return false;
    // An owner swapping its own view — one PDF to the next, or the Vue surface to the Chrome one —
    // leaves the outgoing view attached until its own teardown closes it. Hiding it here is what
    // stops the previous document showing through underneath the new one.
    if (current && current.view !== view) this.setVisible(current.view, false);
    this.occupants.set(layer, { owner, view });
    this.resort();
    return true;
  }

  /** Drops the view from the order and hides it. Not a teardown: the view stays alive and attached. */
  hide(layer: OnlyPreviewViewLayer, owner: OnlyPreviewViewLayerOwner): void {
    const current = this.occupants.get(layer);
    if (!current || current.owner !== owner) return;
    this.occupants.delete(layer);
    this.setVisible(current.view, false);
    this.resort();
  }

  ownerOf(layer: OnlyPreviewViewLayer): OnlyPreviewViewLayerOwner | null {
    return this.occupants.get(layer)?.owner ?? null;
  }

  /**
   * Re-add every shown view, lowest layer first.
   *
   * A full re-sort rather than a single raise: showing a `main`-layer view while a `global` view is
   * open must not put the preview on top, and only re-asserting the whole order guarantees that
   * whichever layer changed. Never `removeChildView` — detaching throws away the documented
   * "already contains it" reorder and takes the fresh-attach path, which is where a not-yet-painted
   * view sorts to the bottom on macOS.
   */
  resort(): void {
    // `View` has no `isDestroyed()`, so liveness is the container's presence: the owner clears it in
    // `stop()` during teardown, which is the same moment the window check used to start failing.
    const container = this.container;
    if (!container) return;
    const shown: OnlyPreviewViewLayer[] = [];
    for (const layer of ONLY_PREVIEW_VIEW_LAYER_ORDER) {
      const occupant = this.occupants.get(layer);
      if (!occupant) continue;
      if (isDeadView(occupant.view)) {
        this.occupants.delete(layer);
        continue;
      }
      container.addChildView(occupant.view);
      this.setVisible(occupant.view, true);
      shown.push(layer);
    }
    this.record(shown);
  }

  stop(): void {
    this.container = null;
    this.occupants.clear();
    this.lastRecord = '';
  }

  private setVisible(view: View, visible: boolean): void {
    try {
      view.setVisible(visible);
    } catch {
      // A view torn down between the sort and here needs no visibility.
    }
  }

  // Layer names only — no view identity, path, workspace or capability token. Recorded on change so
  // a bounds-driven re-sort cannot flood the log, and guarded because a diagnostic must never be
  // able to break the thing it describes.
  private record(shown: OnlyPreviewViewLayer[]): void {
    try {
      const line = `order=${shown.join(',') || 'none'}`;
      if (line === this.lastRecord) return;
      this.lastRecord = line;
      console.info(`[onlypreview] event=view-layers ${line}`);
    } catch {
      // The sort itself already happened.
    }
  }
}

export const onlyPreviewViewLayerService = new OnlyPreviewViewLayerService();
