# Global Search Is Cold on First Use and Sits Under the PDF

Status: fixed; owner verification pending

## Symptom

Two reports about the same view:

1. `Shift+Cmd+F` with a PDF on screen shows the Global Search overlay **behind** the preview. The
   owner had reported this before and it was still occluded.
2. The first `Shift+Cmd+F` of a session is slow. The overlay is an independent renderer; the owner's
   requirement is that it be built when the OnlyPreview window opens and only toggled thereafter,
   and torn down only when OnlyPreview closes.

## Root cause

The overlay is created lazily **inside** `show()` and attached in the same synchronous turn.
`ensureView()` calls `runtime.createView()` and then fire-and-forget `void runtime.loadView(view)`;
`show()` immediately calls `attachTopmost()` and `view.webContents.focus()`. So for the entire cold
boot of that renderer the window carries a fully transparent, full-window child view that owns the
hit region and the keyboard focus while showing nothing. That is the "slow first search": not a late
panel, but a window that silently stops responding. `close()` only detaches and keeps the
`WebContentsView` alive, which is why every later search is instant.

The z-order half is not settled. The JS child order is correct — `attachTopmost()` issues the last
`addChildView` on the window — and `addChildView` on an already-attached child does reorder in
Electron 40. Two mechanisms remain consistent with the report and could not be separated from
source:

- Electron's open macOS defect #47351: a `WebContentsView` that has never fully loaded is stacked
  below views that have. The overlay is attached exactly in that state, and `attachTopmost()` is
  reachable only from `show()`, `updateBounds()` and `raiseAfterPreviewAttach()` — none tied to the
  overlay's own load — so with a PDF sitting still, nothing ever re-raises it.
- `raiseAfterPreviewAttach` (the existing second raise) is fed by `onActiveViewAttached`, which for
  a PDF only fires from the readiness path that
  [task 114](../plan/tasks/onlypreview-pdf-document-frame-readiness-114.md) has just repaired. In
  the build the owner tested, that path never fired, so the second raise was dead code.

Both are addressed; which one was operative will be visible from whether the occlusion survives the
next build.

## Repair contract

- The overlay is preloaded once the shell reports its renderer receipt with `success` — after the
  shell is interactive, so the shell's first paint is not delayed. Building it in `start()` would
  contend with the shell's own load, which is what the `first-visible` mark exists to protect.
- A `ready` flag gates attachment: `attachTopmost()` refuses while the page has not loaded, so a
  transparent unloaded overlay can never be in the child list. This removes the invisible
  click-and-keystroke sink outright.
- The overlay raises itself when its own load resolves — the signal that did not exist before — and
  focuses only then. A load that completes after a close is a no-op, fenced on the load generation.
- A raise is now a real detach-then-attach. Re-adding an attached child reorders the views tree, but
  only a detach drives the native host's attach path, which is what restacks the AppKit subviews on
  macOS.
- `close()` still only detaches, so the renderer survives for the life of the window and toggling
  stays free. `failOverlay()` and `destroy()` reset `ready`.

Delivery: [onlypreview-global-search-warm-overlay-117](../plan/tasks/onlypreview-global-search-warm-overlay-117.md).
