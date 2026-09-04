# OnlyPreview Embeddable Mount

Status: proposed

Owner request, 2026-09-04: 「重大功能优化 bitterless 中的 only preview 需要改造成可以在子窗口
（webcontentsview 打开）这样可以实现 only preview 做成 miniapp 在 bitterless /cowork 浏览器中打开
也要能单独窗口打开 需要注意快捷键 视图层级的处理」

One OnlyPreview surface, two places it can live: its own window as today, or a `WebContentsView`
region inside the Maestro (Cowork) browser window, where it becomes a Mini App the owner opens in a
tab. Shortcuts and stacking are called out because they are the two things that are decided by the
window today and must be decided by the *host* afterwards.

## What OnlyPreview is today

Not one view. A **composite of four layered `WebContentsView`s** attached directly to a
`BaseWindow`'s `contentView`, ordered by one service:

| layer    | occupant                          | attached by                                                    |
| -------- | --------------------------------- | -------------------------------------------------------------- |
| `base`   | Shell (project rail, toolbar, status) | `onlyPreviewWindow.helper.ts` at window creation            |
| `main`   | Preview surface — Vue **or** raw Chromium | `onlyPreviewPreviewView.service.ts`                    |
| `global` | Global Search, transparent, covers the content rect | `onlyPreviewGlobalSearchView.service.ts`     |
| `alert`  | Alert / confirm / progress dialogs | `onlyPreviewAlertView.service.ts`                             |

`OnlyPreviewViewLayerService` owns the order and nothing else: every show re-adds every shown view
lowest-first, because `addChildView` is documented to reorder a view it already contains to the top
(`docs/features/onlypreview-view-layers.md`). Overlay layers deliberately do **not** occlude the
layers beneath them — Global Search is `setBackgroundColor('#00000000')` and floats in a gutter.

Three further facts decide the shape of this change.

**One live content host.** Every content-side service holds a single runtime —
`private runtime: … | null` in `onlyPreviewGlobalSearchView.service.ts:78`, the same in the alert and
preview-region services — and `hostToken` is a *capability guard* (`requireRuntime(hostToken)`), not
a multiplexer key. `onlyPreviewWindow.helper.ts` likewise holds one `baseWindow`, one `shellView`,
one `standaloneHost`. OnlyPreview supports exactly one live content surface at a time. The shared
search/index backend is not the constraint: `fileSearchWindow.service.ts` is one invisible renderer
whose grants and sessions are keyed per request, not per host.

**One layout choke point.** `OnlyPreviewWindowHelper.updatePreviewBounds`
(`src/main/windows/onlyPreviewWindow.helper.ts:528`) is the only place window geometry enters the
composite. The Shell renderer measures its own preview rect and reports it; Main clamps it against
`window.getContentSize()` and distributes three rects — the measured rect to the preview region,
`{0, 0, contentWidth, contentHeight}` to Global Search and to the alert layer. Every consumer already
works in **composite-relative** coordinates with the origin at the composite's top-left.

**The content services barely know about the window.** `onlyPreviewPreviewRegion`,
`onlyPreviewGlobalSearchView` and `onlyPreviewAlertView` each receive `window: BaseWindow` in their
runtime and use it for exactly one thing: `window.isDestroyed()` as a liveness probe
(`onlyPreviewPreviewRegion.service.ts:815`, `onlyPreviewGlobalSearchView.service.ts:339,360`,
`onlyPreviewAlertView.service.ts:467,485`). No geometry is read from it — that already arrives
through `updateBounds`. So the window leaves these three services by replacing one field with
`isHostLive: () => boolean`, not by rewriting them.

**Two shortcut carriers, already focus-scoped.** `bindNativeShortcuts` installs
`before-input-event` on each view's own `webContents`, so it fires only for the view that holds
keyboard focus — correct in any host. On macOS the Find chords additionally travel the application
menu, because AppKit resolves Command chords through the menu before the key window's first
responder and a `BaseWindow` of `WebContentsView`s has no guaranteed first responder
(`src/main/menu/applicationFindMenu.service.ts`). That menu path is the one place that asks "is the
focused window *my* window": `runMenuFindCommand` returns `false` when
`window !== this.baseWindow`, and an unclaimed chord is replayed to the focused `webContents` with
`sendInputEvent` so other windows keep their own Command+F.

## What the host already offers

The Maestro window is a `BrowserWindow` whose native views are laid out over rects the Home renderer
measures from placeholder elements:

- `MaestroWindowController.setViewBounds({ operation, control })`
  (`src/main/maestro/windows/main/maestroWindow.controller.ts:1608`) is authoritative once the
  renderer mounts; `layout()` covers the first frame with `TOOLBAR_H = 78`, `SIDEBAR_W = 480`.
  `opBounds` is remembered so a tab activated later lands in the same rect without waiting.
- A tab is an `OperationTab { id, kind, view: WebContentsView, url, title, favicon, pinned, … }`.
  Tab views are attached with `contentView.addChildView(view, 0)` — index 0 keeps every tab
  underneath the chrome — and start `setVisible(false)`; `activateTab` hides the outgoing view and
  shows the incoming one.
- `kind` already discriminates first-party tabs from web pages: the pinned local Home tab
  (`buildPinnedHomeView`, a bundled renderer with its own preload) and `ai-crms`.
- The Mini Apps grid inside Maestro is the same component as the Bitterless Home grid, and its
  OnlyPreview entry calls `onlyPreviewEmitter.openOnlyPreviewWindow()` today
  (`src/renderer/maestro/workbench/src/views/WorkbenchAppsView.vue:35`).

So the host can already supply a content rect, a z-order slot below its chrome, and an
activate/deactivate signal. What it cannot do today is host a tab whose content is more than one
`WebContentsView`.

## Verified Electron behaviour

The design rests on nesting native views, which this repository has never done — every existing
`addChildView` call targets a window's `contentView`. Measured directly on this project's Electron
40.10.6, macOS 25.4, with two headless probes:

| question                                                          | result                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Can a plain `View` parent a `WebContentsView`?                    | Yes. `container.children.length` tracks the adds.                                        |
| Does re-adding a child reorder it inside a container?             | Yes. `a,b` → re-add `a` → `b,a`. The layer service's primitive is unchanged by nesting.  |
| Are child bounds parent-relative?                                 | Yes. Moving the container from `(200,100)` to `(300,150)` left `a.getBounds()` at `(10,20,800,600)` untouched. |
| Does hiding the container hide its children?                      | Yes. Child page `document.visibilityState` → `hidden`, while the child's own `getVisible()` stays `true`. |
| Does a zero-size container hide rather than break its children?   | Yes — `hidden`, `isDestroyed() === false`.                                               |
| Can a container be re-parented between windows?                   | Yes. `win2.contentView.addChildView(container)` succeeded, source window's children → 0, child render process alive, DOM intact. |
| Are children clipped to the container rect?                       | **Not established.** A child sized past its container still lays out at its full size. The design therefore never relies on ancestor clipping. |

Two consequences worth stating plainly. Hiding the container is exactly the tab-switch primitive,
and it does not disturb per-layer visibility, so the layer service and the host cannot fight over
the same flag. And because a container survives re-parenting with its render process, the surface can
*move* between hosts without reloading — which is what makes one live surface a feature rather than a
restriction.

## The design

### The surface and the mount

Introduce two names.

An **`OnlyPreviewSurface`** is the composite: the container `View`, the four layers, the Shell view,
and the layer service instance that orders them. It knows its own size and nothing about windows.

An **`OnlyPreviewMount`** is what a host implements to carry a surface:

```ts
export interface OnlyPreviewMount {
  readonly kind: OnlyPreviewMountKind; // 'standalone' | 'cowork'
  attach(container: View): void;
  detach(): void;
  /** The composite's content size, in the surface's own coordinate space. */
  contentSize(): { width: number; height: number };
  /** Fires when `contentSize` changes for any reason the host knows about. */
  onResize(listener: () => void): () => void;
  /** Fires when the surface becomes / stops being the host's foreground content. */
  onActivation(listener: (active: boolean) => void): () => void;
  /** The window this surface currently lives in — for menu arbitration and parented dialogs. */
  window(): BaseWindow | null;
  /** Window-chrome capability, so the Shell renders the controls the host can honour. */
  readonly chrome: OnlyPreviewMountChrome; // { minimize, maximize, close, dragRegion }
  requestClose(): void;
  reportTitle(title: string): void;
}
```

`StandaloneOnlyPreviewMount` is today's behaviour, moved: it owns the `BaseWindow`, its
`WindowStateController`, bounds persistence, traffic lights, and `MIN_WIDTH`/`MIN_HEIGHT`.
`CoworkOnlyPreviewMount` is implemented on the Maestro side: it registers an `OperationTab` of a new
`kind: 'onlypreview'`, positions the container at `opBounds`, hides it with
`container.setVisible(false)` on tab switch, and maps `requestClose()` to closing that tab.

The direction of the dependency matters: OnlyPreview must not import Maestro. The mount interface
lives with OnlyPreview, Maestro implements it and hands it in — the same inversion the existing
`OnlyPreviewGlobalSearchWindowService` and `OnlyPreviewAlertWindowService` already use, where "the
helper owns the window and the view factory, the view service owns the dialog stack, and this binds
the two without either importing the other".

### Layering

`OnlyPreviewViewLayerService` keeps its algorithm exactly. Two changes:

1. `start(window)` becomes `start(container: View)`, and `resort()` calls
   `container.addChildView(...)` instead of `window.contentView.addChildView(...)`. Probe-verified
   to reorder identically.
2. It stops being a module singleton and becomes one instance per surface. The module export is
   retained only until the last call site moves, then deleted.

Inside the Cowork window the container sits where a tab view sits — `addChildView(container, 0)` —
so Maestro's chrome, control sidebar and menubar stay above the whole composite by construction, and
OnlyPreview's four layers can never interleave with Maestro's views. That is the entire z-order
story in embedded mode: **two independent stacks, one nested inside the other.**

The overlay layers are the part that needs care, because both were written as "covers the window
content rect". After this change they cover the *container* rect, which is what the existing
coordinates already say — the change is only where the numbers come from. And since ancestor clipping
is unverified, the surface asserts its own invariant: **every layer rect is contained in
`{0, 0, contentSize.width, contentSize.height}`.** `clampPreviewBounds` already does this for the
preview rect against the window's content size; the same clamp, fed by `mount.contentSize()`, now
covers all four layers, and a pure function makes it testable without Electron.

### Bounds

`updatePreviewBounds` swaps one expression: `window.getContentSize()` becomes
`mount.contentSize()`. Nothing downstream changes, because the preview region, Global Search and the
alert layer are already composite-relative.

In standalone mode `contentSize()` is the window's content size and a window `resize` listener
drives `onResize`. In Cowork mode it is `opBounds.width/height`, and `onResize` fires from the
existing `setViewBounds` report — the surface never learns that a sidebar or a tab strip exists.

### Shortcuts

Three carriers, each scoped by a different mechanism, and the important thing is that only one of
them is window-aware.

| carrier                                              | scope today                           | change |
| ---------------------------------------------------- | ------------------------------------- | ------ |
| `before-input-event` per view (`bindNativeShortcuts`) | the view that holds keyboard focus     | none — correct when nested, and an inactive tab's views are hidden so they cannot hold focus |
| macOS application-menu accelerator (Command+F, Shift+Command+F) | `window !== this.baseWindow` → not mine | must resolve through the surface registry instead of a window field |
| renderer keydown inside the Shell                     | the Shell's own DOM                    | none |

The menu path becomes: given the focused `BaseWindow` and the focused `webContents`, find the live
surface that should receive this chord —

1. the focused `webContents` belongs to one of the surface's four views → that surface; else
2. the focused window is the surface's mount window **and** the surface is the mount's active
   foreground content → that surface; else
3. no surface claims it, and the existing replay to the focused `webContents` runs unchanged.

Rule 1 alone handles most cases and is host-agnostic. Rule 2 is what makes Command+F work when the
OnlyPreview tab is active but focus sits in Maestro's address bar or nowhere at all — without it the
chord would be replayed into the address bar. Rule 3 is why Maestro's own Command+F (find in page)
and every other window's keep working: an unclaimed accelerator is still re-delivered.

The collision list, resolved by that order: **Command+F** — OnlyPreview find-in-file when an
OnlyPreview view or the active OnlyPreview tab has it, otherwise Maestro's find-in-page.
**Shift+Command+F** — OnlyPreview Global Search, unclaimed elsewhere. **Command+W / Command+T /
Command+L / Command+R** — always Maestro's, never claimed by OnlyPreview; in embedded mode
Command+W must close the *tab*, which is `mount.requestClose()`, not the composite's own teardown.
The delete, copy-path and copy-name chords stay on `before-input-event` and so are already
focus-scoped. The DevTools chord stays gated on the debug/E2E predicate it has today.

One rule that is easy to get wrong and cheap to state: a hidden container's views cannot hold focus,
so an OnlyPreview surface in a background tab receives no chords through any carrier. No
"is my tab active" check is needed in the per-view path.

### Overlays

Both overlays are already child views in layers, not windows — the `*Window.service.ts` files are
binding seams, not window owners. So neither becomes a child window, and modality keeps working the
way it does today: `executeNativeCommand` already swallows Find and Global Search while the alert
layer is open. In embedded mode "modal" means modal to the composite, not to the Cowork window —
the owner can still switch tabs with a confirm dialog open, and the dialog is still there when they
come back, because hiding the container preserves per-layer visibility.

Settings and the Agent Skill guide stay separate `BrowserWindow`s. They take their parent from
`mount.window()` instead of `this.baseWindow`.

### Chrome and window commands

`minimizeWindow`, `toggleMaximizeWindow` and `closeWindow` currently call
`requireStandaloneWindow(hostToken)`. They route through the mount instead, and the Cowork mount
declares `minimize: false, maximize: false, close: true` so the Shell renders only what the host can
honour. The Shell learns this the same way it learns everything else about its host — a new
`--onlypreview-chrome=window|cowork` additional argument surfaced on `onlyPreviewEnv`
(`src/preload/onlypreview/onlyPreviewEnv.preload.ts`), which is already how `hostToken`, `hostId`,
`mode` and `platform` arrive. No new IPC.

### Lifecycle and identity

`hostToken` stays the identity of a surface, and the host registry stays the authority. The window
helper's single-surface fields (`baseWindow`, `shellView`, `standaloneHost`) become a
`Map<hostToken, OnlyPreviewSurface>` from the start, even though policy admits one live content
surface — so raising that limit later is a policy change in one place plus per-service
multiplexing, not a re-architecture.

The policy: **one live content surface, in whichever mount the owner last asked for.** Opening
OnlyPreview from inside Cowork while a standalone window is open *relocates* the surface into a tab
— the container re-parents, the workspace, index state, selection and scroll position all survive,
because the render processes are never torn down (probe-verified). Opening from the Bitterless Home
grid relocates it back into a window. This is strictly less work than N instances and reads as
dock/undock rather than as a restriction.

## What does not change

The whole OnlyPreview feature contract: browsing, the project rail and its persisted width, the
preview surfaces (Monaco, Markdown, XLSX, DOCX, PPTX, Draw.io, image, audio, video, PDF, contained
HTML), Global Search, alert dialogs and delete progress, browse history, find-in-file, the
`bitterless-preview://` protocol and its session, the invisible `fileSearch` renderer and its
capability model, and every XPC contract. Standalone mode keeps its window state, bounds
persistence, minimum size and traffic lights.

## Rejected alternatives

**Attach the four layers straight into the Cowork window as siblings of its tab views.** Interleaves
two independent stacks in one ordered list, so every Maestro tab activation and every OnlyPreview
re-sort would have to agree about the other's layers. This is precisely the failure the layer service
was built to end — "every view raises itself, so no code owns the resulting order."

**Collapse Shell + Global Search + Alert into one renderer so a tab is one `WebContentsView`.**
Tempting, and it would make embedding trivial, but it discards deliberate separations: the alert
layer's dialogs are separate so they survive Shell reloads and can sit above a raw Chromium preview
that the Shell's DOM cannot reach over; Global Search is a separate renderer so it can be preloaded
without contending with the Shell's first paint (`reportShellMounted`). Nesting costs one container
`View`; this costs a rewrite of three renderers and loses two properties.

**Give Cowork a generic "composite tab" API.** Speculative. One host, one composite, one seam; a
second composite mini-app can generalise it with evidence.

## Pending questions

| id   | question | why it is parked | default if unanswered |
| ---- | -------- | ---------------- | --------------------- |
| PQ-1 | Should a standalone OnlyPreview window and a Cowork OnlyPreview tab be able to be open **at the same time**? | Needs the owner's expectation, not evidence. Multiplexing every content service is a materially larger change than relocation. | One live surface, relocated between mounts. Registry is already a Map so the limit can be raised. |
| PQ-2 | Does the Cowork OnlyPreview tab appear as an ordinary closable tab, or as a second pinned tab next to local Home? | Product placement. | Ordinary closable tab, opened from the Mini Apps grid. |
