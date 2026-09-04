---
id: onlypreview-shortcut-arbitration-133
scope: resolve the macOS Find accelerators through a surface resolver so they reach an embedded OnlyPreview and still fall through to every other window
status: pending
depends-on: [onlypreview-surface-registry-132]
verify: node --test tests/onlypreview/onlyPreviewApplicationFindMenu.test.mjs && node --test tests/onlypreview/onlyPreviewShortcutArbitration.test.mjs && yarn typecheck:node && git diff --check
---

# Which surface owns this chord

## Objective

Make the one window-aware shortcut carrier host-aware instead, so Command+F and Shift+Command+F work
when OnlyPreview is a Cowork tab without taking those chords from Maestro or from any other window.

## Context

- `docs/features/onlypreview-embeddable-mount.md` (the three-rule resolver and the collision list)
- `src/main/menu/applicationFindMenu.service.ts` (accelerator, dispatch, replay fallback)
- `src/main/windows/onlyPreviewWindow.helper.ts` `runMenuFindCommand`, `bindNativeShortcuts`,
  `executeNativeCommand`, `resolveFocusedOrigin`
- `tests/onlypreview/onlyPreviewApplicationFindMenu.test.mjs`

## Contract

- A pure `resolveShortcutSurface({ focusedWindow, focusedContents, surfaces })` applies, in order:
  1. the focused `webContents` belongs to a surface's views → that surface;
  2. the focused window is a surface's mount window **and** that surface is the mount's active
     foreground content → that surface;
  3. otherwise none, and the existing replay to the focused contents runs unchanged.
- `runMenuFindCommand` uses the resolver in place of `window !== this.baseWindow`. Returning `false`
  must keep meaning "not claimed", so the replay path is untouched.
- `bindNativeShortcuts` is unchanged: `before-input-event` is already scoped to the focused view, and
  a background tab's container is hidden so its views cannot hold focus.
- Chords that must never be claimed by OnlyPreview in either mount: Command+W, Command+T,
  Command+L, Command+R. In the Cowork mount, the composite's own close request is
  `mount.requestClose()` — closing the tab, not tearing down the window.
- The alert-layer swallow rule and the DevTools gate keep their current behaviour.

## Verification

- The resolver is tested for: focus inside a surface view; focus in the host chrome with the surface
  active; focus in the host chrome with the surface in a background tab (not claimed); no surface at
  all; a revoked surface.
- The existing find-menu test passes, including the unclaimed-chord replay.
