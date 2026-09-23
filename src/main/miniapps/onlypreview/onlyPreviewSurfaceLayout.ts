import type { Rectangle } from 'electron';
import type { OnlyPreviewBounds } from '@shared/onlypreview/onlyPreview.types';

/**
 * The composite's own chrome, and the one place that turns a reported preview rect into the rects
 * its layers occupy.
 *
 * These numbers describe OnlyPreview's own surface — the MenuBar strip, the preview toolbar, the
 * status bar and the narrowest the project rail may become — not a window. They lived in the
 * standalone window helper while a window was the only thing that could carry the composite; they
 * belong here now that a Cowork tab can carry it too, because both hosts need the same arithmetic
 * from a different source of extent.
 */
export const ONLY_PREVIEW_MIN_SIDEBAR_WIDTH = 180;
export const ONLY_PREVIEW_RESIZE_HANDLE_WIDTH = 5;
export const ONLY_PREVIEW_MENU_BAR_HEIGHT = 32;
export const ONLY_PREVIEW_PREVIEW_TOOLBAR_HEIGHT = 32;
export const ONLY_PREVIEW_STATUS_HEIGHT = 25;

export interface OnlyPreviewSurfaceSize {
  width: number;
  height: number;
}

export interface OnlyPreviewSurfaceLayout {
  /** Where the preview surface goes, inset inside the shell. */
  preview: Rectangle;
  /** The full composite rect, which the Global Search and alert layers cover. */
  overlay: Rectangle;
}

// The historical clamp, unchanged. Kept as its own function so the containment pass below is
// visibly additive: for any extent at or above the composite's own chrome this returns exactly what
// the window helper returned before the composite could be hosted anywhere else.
const clampWithinChrome = (
  value: OnlyPreviewBounds,
  contentWidth: number,
  contentHeight: number
): Rectangle => {
  const x = Math.min(
    Math.max(value.x, ONLY_PREVIEW_MIN_SIDEBAR_WIDTH + ONLY_PREVIEW_RESIZE_HANDLE_WIDTH),
    contentWidth
  );
  const minimumY = ONLY_PREVIEW_MENU_BAR_HEIGHT + ONLY_PREVIEW_PREVIEW_TOOLBAR_HEIGHT;
  const y = Math.min(
    Math.max(value.y, minimumY),
    Math.max(minimumY, contentHeight - ONLY_PREVIEW_STATUS_HEIGHT)
  );
  return {
    x,
    y,
    width: Math.min(value.width, Math.max(0, contentWidth - x)),
    height: Math.min(value.height, Math.max(0, contentHeight - y - ONLY_PREVIEW_STATUS_HEIGHT))
  };
};

/**
 * Every layer rect, guaranteed to lie inside the composite.
 *
 * The containment pass is not defensive tidying. The layers are children of the composite's
 * container `View`, and whether Chromium clips a child to its parent's bounds is **not established**
 * on this Electron build — measured, not assumed. So the composite never relies on it: a rect that
 * would leave the container is brought back inside here, which makes ancestor clipping irrelevant
 * rather than load-bearing.
 *
 * It only ever engages below the composite's own chrome. A standalone window enforces
 * `minWidth: 800`/`minHeight: 600` and can never get there; a Cowork tab shrinks with its window
 * minus the chat sidebar and can, so this is where an embedded surface degrades to zero size
 * instead of hanging a layer outside its host's rect.
 */
export const clampOnlyPreviewSurfaceLayout = (
  measured: OnlyPreviewBounds,
  size: OnlyPreviewSurfaceSize
): OnlyPreviewSurfaceLayout => {
  // A host may measure its rect in the renderer and report fractions; a native rect is integral.
  const width = Math.max(0, Math.round(size.width));
  const height = Math.max(0, Math.round(size.height));
  const inset = clampWithinChrome(measured, width, height);
  const x = Math.min(Math.max(0, inset.x), width);
  const y = Math.min(Math.max(0, inset.y), height);
  return {
    preview: {
      x,
      y,
      width: Math.max(0, Math.min(inset.width, width - x)),
      height: Math.max(0, Math.min(inset.height, height - y))
    },
    overlay: { x: 0, y: 0, width, height }
  };
};
