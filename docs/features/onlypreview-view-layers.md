# OnlyPreview View Layers

Status: implemented; owner verification pending

Owner request, 2026-09-03: give every child view of the OnlyPreview window an explicit **layer**,
keep track of which view occupies each layer, and re-sort on every show instead of trying to raise a
single view. 「每次显示一个 view 都经过一个排序函数 重新排序，排序的方法就是按顺序调用 addchildview，最上面的最后被调用」

## Why a manager instead of one more raise

Three rounds of fixes for "Global Search is under the PDF" all failed, and each failed for the same
structural reason: **every view raises itself, so no code owns the resulting order.** Today three
places call `contentView.addChildView` on this window —

| caller | view | when |
| --- | --- | --- |
| `onlyPreviewWindow.helper.ts` | shell | once, at window creation |
| `onlyPreviewPreviewView.service.ts` `attachActiveView` | Vue **or** Chrome preview | on every selection, and on every surface swap |
| `onlyPreviewGlobalSearchView.service.ts` `attachTopmost` | Global Search | on show, on bounds change, and on `raiseAfterPreviewAttach` |

— and each one only knows how to put *itself* on top. `raiseAfterPreviewAttach` exists purely to
undo the preview's raise, which means the correct order is currently maintained by one service
calling another back after the fact. Any path that attaches the preview without that callback
silently leaves the overlay buried, and the only reason it usually looks right is that the callback
happens to be wired to the paths that were known about.

`addChildView` is documented to do exactly what is needed — *"If the same View is added to a parent
which already contains it, it will be reordered such that it becomes the topmost view"*
(`electron.d.ts`) — so the primitive is not the problem. What is missing is a single place that
decides the whole order.

Settings and the Agent Skill guide are separate `BrowserWindow`s, not child views, so they are out
of scope. Maestro, Omni and Todo have their own windows and their own attach code; this design covers
the OnlyPreview window only.

## Layers

Bottom to top:

| layer | occupant | occludes below | notes |
| --- | --- | --- | --- |
| `base` | the shell | no | attached once at window creation; the project rail, toolbar and status bar |
| `main` | the preview surface — Vue **or** Chrome | no | inset inside the shell, so the shell stays visible around it |
| `global` | Global Search | no | covers the window content rect, with a transparent background |
| `alert` | *(none yet)* | no | reserved for the future alert/modal overlay |

`base` is included so a re-sort is total and produces a known order from any starting state, even
though nothing ever moves it.

**No layer hides another.** An earlier version of this design had `global` and `alert` hide
everything beneath them, reasoning that a full-window overlay makes the layers under it pointless.
That was wrong, and the owner caught it in one look: the Global Search view is created with
`setBackgroundColor('#00000000')` and its panel floats inside a transparent canvas with a 24px
gutter, so the project rail and the preview are *supposed* to stay visible around it. Hiding them
turned the overlay into an opaque sheet that blanked the window.

Visibility is therefore each owner's own business. This service owns the order and nothing else,
except for hiding a view it has just dropped from the order or replaced.

## One occupant per layer

A layer is held by an **owner**, not by a view. `show(layer, owner, view)`:

- The layer is free, or held by this same owner → record the view and re-sort. An owner may swap its
  own view freely, which is what the preview region does every time it moves between the Vue and
  Chrome surfaces. This is why the occupant is keyed by owner rather than by view: keying by view
  would refuse the surface swap.
- The layer is held by a **different** owner → **return `false` and change nothing.** No implicit
  close, no queue, no stacking two views in one layer.

Concretely, using the owner's own example: if Settings ever became a child view in the `global`
layer, then with Global Search open, opening Settings does nothing at all — Search must be closed
first. The refusal is a return value so the caller can report it; it is never a thrown error, because
a refused show is an ordinary outcome, not a fault.

Owners in this design: `shell`, `preview`, `globalSearch`.

## The sort

```
resort():
  for layer of ['base', 'main', 'global', 'alert']:
    view = occupant(layer)?.view
    if view is missing or destroyed: continue
    window.contentView.addChildView(view)      # documented reorder; last call wins
  applyOcclusion()

applyOcclusion():
  topOccluding = highest shown layer whose `occludes` is true
  for layer below topOccluding: occupant.view.setVisible(false)
  for every other shown layer:  occupant.view.setVisible(true)
```

Three properties this has and the current code does not:

1. **A full re-sort, not a single raise.** Showing a `main`-layer view while a `global` view is open
   must not put the preview on top. A single `addChildView` on the changed view always raises it;
   re-sorting restores the invariant no matter which layer changed. `raiseAfterPreviewAttach` and the
   `onActiveViewAttached` callback it hangs on both disappear — the preview's own show re-sorts, so
   there is nothing left to undo.
2. **No `removeChildView` in the sort.** Detaching throws away the documented "already contains it"
   reorder and takes the fresh-attach path instead, which is the path where a not-yet-painted view
   sorts to the bottom on macOS. A previous attempt detached before re-adding and is the likeliest
   reason the overlay stayed under the PDF after that change landed.
3. **Idempotent.** Re-sorting with nothing changed issues the same calls in the same order and is
   safe to call from a bounds update, a readiness callback, or a focus change.

## Readiness stays a precondition of `show`, not of the sort

The current overlay has a `ready` flag so an unloaded, transparent, full-window view is never
attached — it would otherwise swallow every click and keystroke while its renderer boots. That stays,
but as the caller's precondition: an owner calls `show` when its view is ready to be seen. The sort
never inspects readiness, so it cannot silently skip a layer.

## What the call sites become

| today | after |
| --- | --- |
| `window.contentView.addChildView(shellView)` at creation | `layers.show('base', 'shell', shellView)` |
| `attachActiveView`'s `addChildView` + `onActiveViewAttached()` | `layers.show('main', 'preview', view)` |
| `detachActiveView` | `layers.hide('main', 'preview')` |
| `attachTopmost`'s add + `setPreviewHidden(true)` | `layers.show('global', 'globalSearch', view)` |
| `close`/`failOverlay`/`destroy`'s detach + `setPreviewHidden(false)` | `layers.hide('global', 'globalSearch')` |
| `raiseAfterPreviewAttach` and `onActiveViewAttached` | deleted |
| `setPreviewHidden` on the region and view services | deleted — occlusion is the `global` layer's property |

`hide` keeps the view alive and simply drops it from the sort; it is not a teardown. Global Search
already relies on that — its renderer survives a close so the next open is instant.

## Shortcut scoping is a constraint on any future fix

Owner requirement, 2026-09-03: OnlyPreview's shortcuts must fire **only** while OnlyPreview has the
key. Pressing `Cmd+F` with EyesOnAgents focused must not reach OnlyPreview.

The current mechanism already guarantees that, and it is worth stating why: the shortcuts are bound
per `WebContents` through `before-input-event`, and each binding captures the host it was bound for.
A keystroke delivered to another Bitterless window, or to another application, physically cannot
reach them.

Two tempting fixes would break it, and both are refused by a source guard in
`onlyPreviewFindRenderer.test.mjs`:

- `globalShortcut` registers system-wide and fires with any application focused.
- An application `Menu` accelerator fires for any window of *this* app, so it would need an explicit
  check that the focused window is the OnlyPreview `BaseWindow` before acting.

This matters because the leading hypothesis for "Cmd+F does nothing on a PDF" is that the keystroke
never reaches Main at all — the PDF renders in an out-of-process viewer frame — and the obvious
remedy for that is exactly one of the two channels above.

## Diagnostics

One record per sort, through the existing `[onlypreview]` channel:

```
event=view-layers order=base,main,global hidden=main
```

Layer names only — no view identity, path, workspace or capability token. This is the record that
would have answered the overlay question three rounds ago: it says what the order actually was, not
what the code intended.

## Verification

- A unit test over the sort with a fake window: order for every subset of layers; the same-owner
  swap is allowed; a different owner is refused with `false` and no calls issued; `hide` restores
  the order and the visibility of the layers below; re-sorting is idempotent; a destroyed view is
  skipped rather than throwing.
- A source guard that `contentView.addChildView` and `removeChildView` appear in exactly one
  OnlyPreview file — the layer service — so no view can start raising itself again.
- The existing global-search and preview-view suites keep their behaviour, with their attach
  assertions rewritten against the layer service.
- Electron E2E excluded, as always. The owner verifies by opening a PDF and pressing Shift+Cmd+F.

## Resolved: what "shell" is, and why it is a layer

The owner asked whether the shell is a `WebContentsView`, expecting the project tree to be rendered
by the OnlyPreview window itself.

It cannot be. The window is a **`BaseWindow`**, and `BaseWindow` has no web contents of its own —
there is not a single `webContents` member on it in `electron.d.ts`. So every pixel in the window
comes from a child `WebContentsView`, including the shell (`src/renderer/onlypreview/shell/`), which
fills the window and renders the project rail, toolbar, status bar and find bar.

That settles the layer naming: the shell is a real view and belongs in the stack as `base`, and
`main` is the window's main *content* area — the preview surface. One occupant per layer then holds,
and the PDF view is an ordinary `show('main', 'preview', view)`.

## Confirmed while implementing

- **Both Global Search and the Chrome preview are already children of the same `BaseWindow`.** Both
  runtimes receive the same `window` object from `onlyPreviewWindow.helper.ts`, and both attach to
  `window.contentView`. Nothing was nested in the wrong parent.
- **Switching PDFs is never blocked.** The layer is keyed by owner, so the `preview` owner replaces
  its own view freely; only a *different* owner is refused. The outgoing view is hidden on swap —
  it stays attached until its own teardown closes it, and without that the previous document showed
  through underneath the new one. That was a real bug in the first migration pass, caught by the
  layer service's own test.
