---
id: eyes-on-agents-focus-only-board-054
scope: make Focus the whole EyesOnAgents board and remove every Domain UI affordance
status: implemented; owner verification pending
depends-on: [eyes-on-agents-flex-columns-023, eyes-on-agents-working-start-order-035]
---

# EyesOnAgents Focus-Only Board

## Objective

Remove the Domain board from the EyesOnAgents UI and leave one fixed 300px `Focus` column that lists
every visible thread, keeping the existing Focus comparator, `Read all` mutation, unread semantics,
and card behavior byte-for-byte intact. Move the Project filter and the inline title filter from the
retired `All` column into the Focus header.

Domain persistence stays: no SQLite migration, no `domain_id` change, no XPC handler removal.

## Context

- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents Project filter](../../features/eyes-on-agents-project-filter.md)
- [Working cards reorder during replies](../../issues/eyes-on-agents-working-order-churn.md)
- [Hide unavailable Claude Desktop Open](eyes-on-agents-hide-unavailable-claude-open-044.md)

## Required behavior

- `AgentBoard` renders exactly one Focus column: no wrapping draggable Domain list, no `All`
  column, no custom Domain columns.
- The Focus list is the visible-thread set previously rendered by `All`, sorted by the **unchanged**
  shared comparator and then narrowed by the Project filter and the title filter.
- Keep the comparator untouched: active ranks by `statusObservedAt` descending, unread and ordinary
  ranks by `lastActivityAt ?? lastCompletedAt` descending, session key ascending as the final
  tie-breaker. A metadata-only refresh must not move an active card.
- Keep `Read all` and `readableFocusThreads` semantics: only visible unread rows in a confirmed
  terminal state are acknowledged; working, waiting, and `unknown` rows keep their latent marker.
- Column box: fixed 300px width (no flex growth, no wrapping), fills the board height instead of the
  600px cap, thread list scrolls inside the column body, board no longer owns vertical scrolling.
- Focus header keeps the target glyph, plain non-editable title, `⌕` search toggle, and `Read all`.
  Remove inline title editing, the sizer span, the overflow/Delete menu, and the drag handle.
- Remove `AddDomainPopover` from `EyesOnAgentsMenuBar` and delete the component.
- Remove the ThreadCard `Move to Domain` group and card drag-and-drop. Render the overflow control
  only when it has an action (Claude preview transcript). When a row has neither Open nor an
  overflow action, render the unread red dot as a standalone marker so unread attention survives.
- Remove now-dead store surface: `domains`, `customDomains`, `uncategorizedDomain`,
  `customDomainTitle`, `threadsForDomain`, `createDomain`, `renameDomain`, `deleteDomain`,
  `reorderCustomDomains`, `moveThread`, and the matching emitter wrappers. Keep every Main, preload,
  shared-contract, and XPC Domain implementation in place.
- Prune only the i18n keys whose UI is deleted (`board.all`, `board.addDomain`,
  `board.domainPlaceholder`, `board.emptyDomain`, `domain.*`, `actions.moveTo`, `actions.create`)
  in both `en.ts` and `zh.ts`, and retarget `board.projectFilterLabel` at Focus.
- Do not rename the retained column component, its `agent-domain` BEM block, or its LESS file.
- Do not launch Electron E2E; Ral performs the visual check.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/features/eyes-on-agents-project-filter.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/issues/eyes-on-agents-working-order-churn.md`
- `docs/INDEX.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue`
- `src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.less`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/EyesOnAgentsMenuBar.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- `src/renderer/eyesOnAgents/src/components/AddDomainPopover/` (deleted)
- `src/renderer/eyesOnAgents/src/emitter/eyesOnAgents.emitter.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- `scripts/eyes-on-agents/project-filter-render.test.mjs`
- `scripts/eyes-on-agents/core.test.mjs`

## Verification

- `yarn typecheck:web` and `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:core` (comparator behavior must stay green unmodified)
- `yarn lint`
- Static source coverage asserts: one Focus column, fixed 300px width, no `AddDomainPopover`
  import, no `vuedraggable` usage in the EyesOnAgents renderer, no `moveThread` call from
  ThreadCard, Project filter and search row inside the Focus column.

## Result

Implemented. `AgentBoard` now renders a single Focus column bound to
`eyesOnAgentsStore.filteredFocusThreads`; the draggable Domain list, the `All` column, the custom
Domain columns, `AddDomainPopover`, the column header's rename/delete/drag affordances, and the
ThreadCard `Move to Domain` group are gone. The Project filter and the inline title-filter row now
live in the Focus header.

The comparator was not touched. `focusThreads` simply changed from the attention subset to
`sortThreads(this.threads)`, so active ranks still sort by `statusObservedAt` and the remaining
ranks by `lastActivityAt ?? lastCompletedAt` with the session-key tie-breaker;
`readableFocusThreads` keeps the unread-and-terminal rule, so `Read all` behavior is unchanged.

Beyond the task list:

- the store's `all*` names were renamed to their Focus equivalents (`allProjectFilter` →
  `projectFilter`, `allTitleQuery` → `titleQuery`, `filteredAllThreads` → `filteredFocusThreads`,
  and so on) because they referred to the retired column;
- the unused `eyesOnAgentsView` export was removed — it re-exported the deleted `domains` getter;
- `EyesOnAgentsMenuBar.less` lost its `.add-domain-popover__trigger` rule;
- no emitter wrappers needed deletion: `eyesOnAgents.emitter.ts` is a typed XPC proxy, so dropping
  the store call sites was enough. Main, preload, shared contract, and XPC Domain code is untouched.

Column box: `width/min-width/max-width: 300px`, `flex: 0 0 300px`, `height: 100%`, no `max-height`;
the board is a non-wrapping `display: flex` with `overflow: hidden`, and the column body scrolls.

ThreadCard's overflow control now renders only for a Claude row with a preview transcript; a row with
neither Open nor preview renders a standalone `.thread-card__unread-marker` so unread attention
survives.

Verified: `yarn typecheck:eyes-on-agents:ui`, `yarn typecheck:node`, `yarn check:renderer-i18n`,
`yarn test:eyes-on-agents` (all suites pass), `yarn build`. `yarn typecheck:web` reports only
pre-existing failures in chat, maestro, omni, onlypreview, and `src/shared/pathHelper` — no
EyesOnAgents or i18n errors. Repo-wide `yarn lint` is pre-existing red (1053 errors); scoped
`yarn eslint --quiet src/renderer/eyesOnAgents` reports only the `no-useless-escape` warning that
already exists at HEAD on the separator regex. Electron E2E was not run, per the project rule; Ral
retains the visual check.
