import type { WebContentsView } from 'electron'
import type { ViewRect } from '@maestro-shared/coach.api'

/**
 * Per-view redundant-bounds suppression.
 *
 * ResizeObserver can report the same native rect repeatedly during a layout pass. Each view
 * service owns one applier so native relayout only runs when its rounded bounds actually change.
 */
export const createBoundsApplier = (): ((view: WebContentsView | null, rect: ViewRect) => void) => {
  const lastBounds = new WeakMap<WebContentsView, string>()
  return (view, rect) => {
    if (!view || view.webContents.isDestroyed()) return
    const bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height))
    }
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`
    if (lastBounds.get(view) === key) return
    lastBounds.set(view, key)
    view.setBounds(bounds)
  }
}
