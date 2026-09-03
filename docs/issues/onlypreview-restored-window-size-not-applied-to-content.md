# A Restored OnlyPreview Window Resizes but Its Content Does Not

Status: fixed; owner verification pending

## Symptom

Resize the OnlyPreview window, quit, and start again. The window comes back at the saved size, but
the Project rail and preview region are still laid out for the previous, smaller size: the content
occupies a rectangle in the top-left and the rest of the window is empty.

## Root cause

`createStandaloneWindow` builds the window, lays out the shell, shows it, and only then subscribes
to `resize`:

```text
line 726  applyInitialBounds()          shell view sized from the CONSTRUCTOR content size
line 727  this.show()                   WindowStateController.show() applies the persisted bounds,
                                        and maximize()/setFullScreen() when they were saved
line 808  window.on('resize', …)        the listener that re-lays-out the shell — registered here
```

The authoritative restore is not the constructor. `BaseWindow` only receives `width`/`height`/`x`/`y`,
while `WindowStateController.show()` is what calls `applyBounds()` and, for a saved maximized or
full-screen window, `maximize()` / `setFullScreen(true)`. That is where the window actually reaches
its restored size.

That resize happens between lines 727 and 808, when **no `resize` listener exists yet**, so nothing
re-lays-out the child views. The shell keeps the constructor-time bounds for the rest of the
session. Choosing a folder or previewing a file does not fix it because neither re-runs the layout;
only a manual resize does, which is the first event the late listener actually receives.

## Repair contract

- The `resize` listener is registered before the window is shown, so the restore-time resize is
  observed like any other.
- The layout is re-applied once immediately after `show()`. `setFullScreen(true)` and `maximize()`
  settle asynchronously on macOS, so the synchronous re-apply covers the first paint while the
  listener covers the asynchronous settle.
- `applyInitialBounds()` stays before `show()` so the first frame is never painted at the wrong
  size.
- Preview-region and Global Search bounds continue to be derived from the same content size through
  the existing clamp, so a restored window cannot leave the preview region outside its parent.
- No change to what is persisted, to the restore resolution, or to the window-state contract.

Delivery: [onlypreview-restored-window-content-layout-113](../plan/tasks/onlypreview-restored-window-content-layout-113.md).
