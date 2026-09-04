# EyesOnAgents Search Shortcut Dies When Another Omni View Holds Focus

Status: diagnosed; repair pending owner choice

## Symptom

In the EyesOnAgents Mini App hosted inside the Omni window, `Cmd+F` intermittently does nothing —
no Search modal appears. Restarting Bitterless restores it. Closing and reopening the Omni window
does not.

The owner's reasonable expectation — "this is basically a pure front-end search, it should not be
able to break" — is correct about the matching itself. Matching is a renderer-local getter over the
snapshot already in the store (`eyesOnAgents.store.ts` `threadSearchResults`). The failing step is
earlier: the chord never reaches the renderer that owns the handler.

## Evidence

- The shortcut is a renderer-local `window` listener, registered only in the EyesOnAgents renderer:
  `src/renderer/eyesOnAgents/src/App.vue:107` (`handleWindowKeydown`) bound in `onMounted` at
  `src/renderer/eyesOnAgents/src/App.vue:123`. Nothing in Main routes `Cmd+F` to this Mini App.
- In the Omni host that renderer is one `WebContentsView` among many. A `WebContentsView` receives
  `keydown` only while it holds Chromium keyboard focus.
- Omni never gives a cell's content view keyboard focus. The only `focus()` call in
  `src/main/windows/omniWindow.helper.ts:357` is `window.focus()` on the `BaseWindow`. "Active cell"
  is *derived from* the content view's own focus event
  (`src/main/windows/omniWindow.helper.ts:1846`), and for browser cells also from the cell
  menubar's focus event (`src/main/windows/omniWindow.helper.ts:1667`) — so focus is only ever
  acquired by a real user click inside that view.
- The competing focus owners in the same window are the top menubar view, the Omni control overlay
  (which claims only `Escape`, `src/main/windows/omniWindow.helper.ts:1135`), the browser cell's
  menubar view, and the browser cell's content view. Only the last of those does anything with
  `Cmd+F`, and what it does is open Chromium's own find bar inside that web page.
- Owner session log (`~/Library/Logs/Bitterless_PREVIEW/main.log`, build `260903122011`) shows the
  reported sequence and the restored layout: `12:17:56Z baseWindow closed, cleaning up` →
  `12:18:00Z … Restored saved layout with 6 cells` /
  `phase=restore totalCount=6 browserCount=1 miniAppCount=5` →
  `12:18:12Z app Cleaning up resources…` (full restart). The reopened window was alive for ~12
  seconds, and its opening sequence logs `waiting for initial mounted chrome, browser cells: 1` —
  i.e. focus had not been placed in the EyesOnAgents cell at all during that window's lifetime.

## Root cause

The Search shortcut is owned by one renderer's `window` `keydown` handler, but in the Omni Mini App
host that renderer only sees key events while its own `WebContentsView` holds keyboard focus, and
nothing ever focuses it except a direct user click inside the board. Any prior interaction with the
Omni chrome, the control overlay, or the browser cell leaves focus outside the EyesOnAgents view,
and `Cmd+F` is then silently consumed by whatever does hold focus.

This explains both owner observations without any stuck renderer state:

- **Restart appears to fix it.** A fresh session ends with the owner clicking into the board, which
  is exactly the act that gives the view focus.
- **Closing and reopening Omni does not fix it.** A cold Omni window again starts with focus outside
  the Mini App cell, so the very first `Cmd+F` after reopening is lost the same way. (Cell content
  views *are* destroyed and recreated on close/reopen — `cleanupAllViews`,
  `src/main/windows/omniWindow.helper.ts:514` — so no renderer state survives that cycle. The
  surviving cause is the focus model, not stale state.)

The standalone EyesOnAgents window is not affected: a `BrowserWindow`'s single `webContents` holds
focus whenever the window is focused.

## Not the cause (checked)

- Token matching, throttling, and lifecycle-revision guards in `eyesOnAgents.store.ts`
  (`setTitleDraft` / `commitTitleQuery` / `threadSearchResults`) have no state that survives a
  keystroke pause longer than the 120 ms throttle window; the `leading` edge always publishes.
- `threadSearchVisible` starts `false` in a recreated renderer, so a stuck-open flag cannot explain
  a failure that persists across an Omni reopen.
- The Arco `popup-container` resolution self-heals (`useTeleportContainer` re-resolves on the
  `visible` transition), so the modal cannot be permanently teleported nowhere.
- The application-level `Cmd+F` menu accelerator
  (`src/main/menu/applicationFindMenu.service.ts`) is **not** in the owner's running build — the log
  contains zero `menu-installed` / `menu-find` lines. It is, however, a second delivery path for the
  same chord in the current tree and must be considered by the repair.

## Open verification step

Not provable from logs, which carry no key-event trace: that the modal never opened, rather than
opening and matching nothing. The discriminating check takes seconds — with the failure present,
click the Search icon in a Domain column header
(`src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue:6`) instead of pressing
`Cmd+F`. Under this diagnosis the button always works, because clicking it focuses the view.

## Repair contract (options, pending owner choice)

1. **Main-owned routing (thorough).** Deliver the Search chord from Main to the EyesOnAgents view,
   the way OnlyPreview already owns its own native commands, so the shortcut no longer depends on
   which Omni view holds DOM focus. Has to compose with the `Cmd+F` application menu accelerator so
   OnlyPreview keeps its Find and the browser cell keeps Chromium's.
2. **Focus the active cell's content view (smallest change).** When a Mini App cell becomes the
   active cell, give its content view keyboard focus. Fixes every renderer-local shortcut in every
   Mini App at once, but changes Omni focus behavior for browser cells too, so it needs an explicit
   decision about typing focus after a layout restore.
3. **Affordance-only mitigation.** Keep the shortcut as is and make the always-available Search
   button obvious in the Omni host. Does not repair the reported behavior; only makes the failure
   recoverable without a restart.

Regardless of choice: matching, throttling, selection, modal lifecycle, Open behavior, and the
standalone window's shortcut behavior must remain unchanged.
