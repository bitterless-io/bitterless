---
id: omni-todo-cell-002
scope: dedicated Todo and EyesOnAgents mini-app views inside Omni layout cells
status: implemented; owner verification pending
depends-on: []
verify:
  - layout mode exposes Website and Mini App in a dropdown immediately before the pane close button
  - Mini App mode shows an opaque, scrollable app list capped at 500px high
  - the app list shows Todo and EyesOnAgents with an icon-left, name-right layout
  - selecting Todo renders the existing local Todo renderer inside that Omni cell
  - selecting EyesOnAgents renders the existing local EyesOnAgents renderer inside that Omni cell
  - Todo cell chrome displays bl://miniapp/todo as a read-only URL
  - switching between Website and Todo preserves the website URL and persists through omni_layout
  - existing multi-website cells keep their current runtime and navigation behavior
  - every Todo renderer refreshes from local SQLite after a committed mutation broadcast
  - a focused Todo renderer reloads local data as an eventual-consistency fallback
  - every horizontal and vertical layout divider shows a centered 4px bright-blue diamond drag indicator
  - owner performs runtime verification
---

# Omni Local Mini-App Cells

## Objective

Add the first two local mini-app targets to Omni. Each layout leaf is managed by the Omni layout
store and can select its existing Website runtime, the Todo renderer, or the EyesOnAgents renderer.
Each target gets a newly created, dedicated operation `WebContentsView` with its own preload; mini
apps do not open or depend on their standalone windows.

## Constraints

- Put the Website/Mini App dropdown directly before the per-pane close button in layout mode.
- In Mini App mode, center an opaque app list in the pane preview. Cap it at 500px high, allow
  vertical scrolling, keep it 320px wide without an outer border, and lay out each bordered item
  with its icon on the left and application name on the right.
- Show Todo and EyesOnAgents as enabled targets in the list.
- Preserve each leaf's website URL while Todo is selected so switching back is non-destructive.
- Display `bl://miniapp/todo` in both layout mode and the live cell chrome while Todo is active.
- Make the Todo pseudo-URL read-only and reject browser navigation commands for Todo cells.
- Use the Todo renderer with `todo.js` and the EyesOnAgents renderer with `eyesOnAgents.js`, both
  already produced by Electron Vite. Never reuse the Website view or its remote-content preload for
  a mini app.
- Keep browser session, navigation, multi-cell creation, and URL persistence behavior unchanged for
  Website cells.
- Center a 4px bright-blue diamond on horizontal and vertical layout dividers without changing the
  divider drag target.
- Persist the content mode in the existing `omni_layout` tree. Treat legacy leaves without a mode as
  Website cells.
- Keep this delivery limited to Todo and EyesOnAgents; do not add arbitrary renderer/preload paths.
- Runtime testing is handed to the owner by request; this delivery performs code inspection and
  static diff checks only.

## Paths

- `src/shared/omni/omni.types.ts`
- `src/main/windows/omniWindow.helper.ts`
- `src/preload/omni/omni.preload.ts`
- `src/preload/todo/todo.preload.ts`
- `src/preload/eyesOnAgents/eyesOnAgents.preload.ts`
- `src/renderer/omni/omniCell/**`
- `src/renderer/omni/omniControl/**`
- `src/renderer/todo/**`
- `src/renderer/eyesOnAgents/**`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
