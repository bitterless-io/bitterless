---
id: todo-domain-board-layout-005-1
target: working-tree-2026-07-23
compared_with: todo-domain-board-layout-005
---

# Verdict

**PASS. No P1, P2, or P3 finding was identified.**

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Evidence

- `src/renderer/todo/src/App.vue` renders one `vuedraggable` board. Focus is the fixed header slot,
  custom Domains remain the persisted draggable items, and the old fake Add Domain column, detail
  spacer, horizontal direction, left-scroll state, badge, and arrow control are absent.
- `src/renderer/todo/src/App.less` makes that draggable a wrapping flex container with a 12px gap
  and vertical board scrolling. Opening the 320px detail panel reserves `320px + 12px` at normal
  widths, the `680px` breakpoint intentionally switches to overlay behavior, and the `323px`
  fallback permits local horizontal overflow while retaining a 300px board minimum.
- `DomainColumn.less` and `FocusedColumn.less` share the requested `width: auto`,
  `min-width: 300px`, `max-width: 480px`, `flex: 1 1 300px`, and `align-self: flex-start`
  contract. Neither column root retains a fixed 300px width or disables shrinking.
- `MenuBar.vue` places one labelled Arco mini Add Domain action before Archive, uses the Tabler plus
  icon, exposes a stable `name`, localized tooltip/title and accessible label, blocks re-entry,
  disables at 17 active Domains, and delegates creation to `todoStore.createDomain()`. It detects
  the newly appended Domain, waits for Vue's next tick, and reveals the matching stable
  `data-domain-id` element vertically. At the constrained breakpoint the text label hides while
  the icon, tooltip, and accessible label remain.
- `todo.store.ts` waits for the detail-driven reflow before locating a selected Todo, brings its
  Domain into the nearest vertical board region, and retains row centering inside the Domain body.
  No historical `scrollLeft`, left-offset, or visible-horizontal-width calculation remains in the
  Todo renderer source.
- The layout contract test also locks the ordinary drag-order save, board-click close, Escape close,
  host wiring, and removal of the obsolete `AddDomainButton` files.

# Verification

- `yarn test:todo-layout` — PASS, 8/8 tests.
- `yarn typecheck:todo-web` — PASS, including generated Main/preload boundary contracts and strict
  Vue checking.
- `yarn check:renderer-i18n` — PASS.
- `git diff --check` — PASS on the latest shared working tree.

# Residual Risk

The review is source- and type-contract based. It does not replace Ral's packaged Electron visual
resize and cross-row drag check on macOS and Windows, especially for a narrow Omni miniapp surface
with the detail panel open.
