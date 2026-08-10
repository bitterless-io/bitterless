# E2E Target-display Routing

Status: Fixed

## Problem

The Maestro and OnlyPreview Playwright fixtures launch the complete Electron application. Their
top-level windows currently use normal production placement, so a local E2E run can open on the
display containing Codex and cover the active conversation.

Ral's local test display is `DELL S2721QS`. Local E2E windows should appear there without changing
production window placement or committing a machine-specific preference.

## Configuration boundary

Display routing is enabled only when the Electron child has `BITTERLESS_E2E=1`.

The Playwright fixtures resolve one optional display label in this order:

1. non-empty `BITTERLESS_E2E_DISPLAY_LABEL` in the Playwright runner environment;
2. the first trimmed line of the ignored `local/e2e-display-label` file;
3. no configured label, which leaves normal window placement unchanged.

The resolved value is copied explicitly into the fixtures' isolated Electron environment. The
local file is developer-machine state, is ignored by Git, and must never be read by production
Main. CI and Windows hosts without either configuration retain the existing behavior.

## Placement contract

For every registered user-visible top-level window:

1. Main reads the configured label only while `BITTERLESS_E2E=1`.
2. `screen.getAllDisplays()` is searched by exact `Display.label` equality. Display ids and partial,
   case-insensitive, or fuzzy label matches are forbidden.
3. A configured label with no exact match fails fast. The error may list available display labels
   only as diagnostics; it must not silently select the primary or another secondary display.
4. The window keeps its current normal size, shrinking to the target work area without going below
   its declared minimum size, and is centered in the available area. If a work area is smaller than
   that minimum, the minimum wins and the window is anchored at the target work-area origin rather
   than moved to another display. Negative display coordinates are valid.
5. The target normal bounds are applied immediately before the first `show()`. This reassertion is
   required on macOS because construction-time secondary-display bounds can be discarded.
6. E2E placement always starts normal: neither persisted maximized nor fullscreen mode is applied.
7. The override is process-local. It does not replace or write a production window-state entry.

`WindowStateController` is the shared placement boundary because it owns the before-show sequence
for registered `BrowserWindow` and `BaseWindow` instances. One E2E-only
`browser-window-created` listener applies the same placement immediately and again at
`ready-to-show` for detached DevTools and any future unregistered ephemeral `BrowserWindow`.
Parent-relative child windows remain on the parent's target display. Permanently hidden worker and
artifact windows may be repositioned by this safety listener but remain hidden.

## Platform boundary

Electron display labels and work-area bounds provide the same routing contract on macOS and
Windows. The configured label is machine-specific.

Electron does not expose a supported API for assigning a window to a numbered macOS Mission
Control Space. This issue routes windows to the target physical display's currently active Space;
it does not promise Desktop 8 or use UI automation, private Space APIs, or external window-manager
tools.

## Acceptance

- Production and E2E runs without a configured label preserve existing placement.
- Both Playwright fixtures pass an environment override or ignored local preference to Electron.
- An exact `DELL S2721QS` match produces centered bounds within that display, including when its
  coordinates are negative.
- A missing configured display fails with the requested label and available labels in the error.
- Unit coverage proves E2E gating, exact matching, size constraints, normal-mode forcing, and the
  `setBounds`-before-`show` order.
- Electron integration verifies every visible registered top-level window belongs to the selected
  display before test interaction.
