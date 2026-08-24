# OnlyPreview debug DevTools skip the raw Chromium view, which also has no Inspect menu

Status: reported by Ral 2026-08-21; repair pending owner confirmation of the contract below

## Report

Two debug affordances are missing:

1. Opening the OnlyPreview window in debug should show DevTools for the window's views, not only for
   one of them.
2. When content is rendered by the raw Chromium content view, right-clicking that view should show a
   context menu whose Inspect entry opens DevTools for that view.

This surfaced while diagnosing
[the blank PDF preview](onlypreview-pdf-blank-in-memory-partition.md): the failure lives entirely
inside the raw Chromium view, and there is currently no in-app way to inspect it.

## Current Behavior

- `shouldAutoOpenOnlyPreviewDevTools()`
  (`src/main/windows/onlyPreviewWindow.helper.ts:145`) is true only in `VITE_MODE=debug` outside
  `BITTERLESS_E2E`, and its single use (`:689`) auto-opens detached DevTools for the **Vue preview
  view** alone. The Shell view and the raw Chromium content view never auto-open DevTools.
- The raw Chromium view does receive the keyboard toggle: `bindChromeShortcuts` (`:627`) calls
  `bindOnlyPreviewDevToolsShortcut` (`:165`), gated by `isOnlyPreviewDevToolsEnabled()` (`:148`).
  That path needs the view to hold focus and to deliver `before-input-event`, so it is unusable
  exactly when the view paints nothing.
- No OnlyPreview view handles the `context-menu` event at all, so right-click produces nothing.
  The only such handler in the app belongs to a different surface
  (`src/main/maestro/windows/main/maestroBrowserView.service.ts:512`).

## Fix Contract

1. In debug-enabled builds only (`shouldAutoOpenOnlyPreviewDevTools()`), also auto-open detached
   DevTools with `activate: false` for the Shell view, and for each raw Chromium content view at the
   moment it is created for a selection. Keep `BITTERLESS_E2E` excluded and packaged builds
   untouched.
2. Handle `context-menu` on the raw Chromium content view and the Vue preview view when
   `isOnlyPreviewDevToolsEnabled()` is true, showing a native menu whose Inspect entry calls
   `webContents.inspectElement(params.x, params.y)` and opens DevTools detached. No menu at all when
   the gate is false.
3. The menu is debug tooling, not a product surface: it must not add reload, navigation, download,
   save-as, print, or open-in-browser entries, and it must not weaken the view's denied popups,
   fenced navigation, refused downloads, or denied permissions.
4. Menu labels follow the project i18n rule — keys for every language under
   `src/renderer/common/i18n/`, resolved through `i18nHelper`, no literal strings in Main.
5. A destroyed or replaced view must not leave a listener, an orphan DevTools window, or a menu bound
   to a dead `WebContents`; selection teardown already destroys these views and must stay authoritative.

## Acceptance

1. Run the debug build and open OnlyPreview: Shell and Vue Preview DevTools appear detached without
   stealing focus.
2. Select a `.pdf` or `.html` file: DevTools for the raw Chromium content view appears the same way,
   and its frame tree is inspectable.
3. Right-click inside the raw Chromium content view: the menu appears and Inspect opens DevTools on
   the clicked position.
4. Switch to another file and back: exactly one DevTools window per live view, none left behind.
5. Run a packaged/release build: no auto DevTools, no context menu, no new keyboard behavior.
6. Owner runtime verification on macOS; Electron E2E only if the owner asks for it.
