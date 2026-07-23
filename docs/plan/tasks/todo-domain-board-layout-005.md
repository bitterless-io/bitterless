---
id: todo-domain-board-layout-005
scope: Todo menubar Domain creation and flexible wrapping Domain board
status: done
depends-on: [todo-sync-refresh-identity-004]
---

# Todo Flexible Domain Board

## Objective

Move the Todo Add Domain action from its fake board column into the menu bar and replace the
fixed-width horizontal board with an EyesOnAgents-style wrapping flex layout. Keep every Focus and
Domain column between 300px and 480px, share complete-row space, and wrap a whole column when less
than its minimum width remains.

## Context

- `docs/features/todo-layout.md`
- `docs/features/todoist-sync.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/tasks/eyes-on-agents-flex-columns-023.md`
- `docs/plan/tasks/eyes-on-agents-menubar-domain-guide-014.md`
- `docs/INDEX.md`

## Path

- `src/renderer/todo/src/App.vue`
- `src/renderer/todo/src/App.less`
- `src/renderer/todo/src/components/MenuBar/MenuBar.vue`
- `src/renderer/todo/src/components/MenuBar/MenuBar.less`
- `src/renderer/todo/src/components/DomainColumn/DomainColumn.less`
- `src/renderer/todo/src/components/FocusedColumn/FocusedColumn.less`
- `src/renderer/todo/src/components/AddDomainButton/`
- `src/renderer/todo/src/store/todo.store.ts`
- `scripts/todo/todo-column-layout.test.mjs`
- `package.json`
- `build/release_note.md`
- the referenced docs and review artifact

## Verification

- Static UI contract proves one wrapping container, Focus in the draggable header slot, visible
  Todo/EyesOnAgents/Omni behavior unaffected, and no Add Domain board column or horizontal-jump UI.
- Static CSS contract proves both column types use `flex: 1 1 300px`, `min-width: 300px`,
  `max-width: 480px`, and rejects fixed 300px widths plus `flex-shrink: 0`.
- Menu-bar contract proves the Arco/Tabler Add Domain action retains loading, limit, localization,
  accessibility, and the existing store mutation path.
- `yarn test:todo-layout`
- `yarn typecheck:todo-web`
- `yarn check:renderer-i18n`
- `yarn test:todoist-sync`
- `yarn audit:sqlite-migrations`
- `yarn build`
- `git diff --check`
- Independent source review passes before production packaging begins.

## Completion

- The board now uses one wrapping draggable with Focus fixed in its header slot and active Domains
  retaining their persisted order across wrapped rows.
- The fake Add Domain column and historical horizontal-navigation controls are removed. A labelled
  Arco mini action in the menu bar preserves the existing one-click `Untitled` creation flow.
- Focus and Domain columns share the 300–480px flexible-width contract. Normal detail mode reserves
  the right 320px panel; constrained embedded mode intentionally overlays it.
- Todo selection waits for the detail-driven reflow before vertically revealing the Domain and
  centering its row.
- `docs/plan/reviews/todo-domain-board-layout-005-1.md` records the independent PASS with no
  P1/P2/P3 findings.
