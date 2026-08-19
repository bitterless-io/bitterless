---
id: eyes-on-agents-focus-search-consolidation-055
scope: fold the global EyesOnAgents search modal into the Focus column's own title filter
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-only-board-054]
---

# EyesOnAgents Focus Search Consolidation

## Objective

Delete the global search modal and make `Cmd+F` / `Ctrl+F` activate and focus the Focus column's
inline title filter, which narrows the real Focus card list. The inline filter adopts the modal's
separator-insensitive token matching instead of the previous plain substring test.

## Context

- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [EyesOnAgents global title search](../../issues/eyes-on-agents-global-title-search.md)
- [Token title search](eyes-on-agents-token-title-search-032.md)
- [Search result Domain context](eyes-on-agents-search-result-domain-033.md)

Tasks 031–033 delivered the modal, token matching, and two-line result rows. This task retires the
modal surface and its result-row/selection contract while keeping token matching as the Focus filter
semantics.

## Required behavior

- `Cmd+F` / `Ctrl+F` prevents native Find, expands the Focus search row when collapsed, and focuses
  its input. Repeating the shortcut refocuses the input and preserves the current query.
- `Escape` inside the row clears the query and collapses the row; the explicit clear button empties
  the query and keeps the row open and focused.
- Focus filtering uses token matching: `NFKC` normalize, lowercase, split query and title on
  whitespace plus `-`, `_`, `.`, `/`, `\`, `:`, `|`; every query token must be contained in some
  title token, order-independent. An empty, whitespace-only, or separator-only query is not a filter.
  Only `thread.title` is matched. A thread with no title never matches a non-empty query.
- Title and Project filters compose; the empty state names the active narrowing reason.
- Delete `ThreadSearch.vue` / `ThreadSearch.less` and the store's modal state and actions:
  `threadSearchVisible`, `threadSearchQuery`, `threadSearchSelectedSessionKey`, `threadSearchResults`,
  `hasThreadSearchQueryTokens`, `openThreadSearch`, `closeThreadSearch`, `setThreadSearchQuery`,
  `selectThreadSearchResult`, `moveThreadSearchSelection`, `openSelectedThreadSearchResult`,
  `openThreadSearchResult`, `reconcileThreadSearchSelection`.
- Keep the tokenizer helper; it becomes the Focus filter's matcher.
- Prune the now-unused `search.*` i18n keys in `en.ts` and `zh.ts`, keeping the Focus row's
  placeholder, clear label, and empty-state keys.
- No result list, keyboard result selection, `Enter`-to-open, or modal remains anywhere in the app.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/issues/eyes-on-agents-global-title-search.md`
- `docs/INDEX.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadSearch/` (deleted)
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/global-title-search.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- `yarn typecheck:web` and `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:ui`
- `yarn lint`
- Token-matching unit coverage moves onto the Focus filter: `ops git` matches `ops-git`, separator-only
  queries are not filters, untitled threads never match, and title plus Project filters compose.
- Static source coverage asserts no `ThreadSearch` component, no `a-modal` search surface, and that
  the `Cmd+F` handler targets the Focus column input.

## Result

Implemented immediately after 054 in the same serial pass on `dev/next`, with one combined
verification run.

`ThreadSearch.vue`/`.less` are deleted and every modal store member is gone
(`threadSearchVisible`, `threadSearchQuery`, `threadSearchSelectedSessionKey`,
`threadSearchResults`, `hasThreadSearchQueryTokens`, `openThreadSearch`, `closeThreadSearch`,
`setThreadSearchQuery`, `selectThreadSearchResult`, `moveThreadSearchSelection`,
`openSelectedThreadSearchResult`, `openThreadSearchResult`, `reconcileThreadSearchSelection`).
`Cmd+F` / `Ctrl+F` now calls `App.vue` → `AgentBoard.openTitleSearch()` →
`DomainColumn.openTitleSearch()`, which expands the row and focuses its input while preserving the
current query.

The tokenizer survived and became the Focus matcher, renamed `tokenizeThreadSearchText` →
`tokenizeThreadTitle` (and `THREAD_SEARCH_SEPARATOR_PATTERN` → `THREAD_TITLE_SEPARATOR_PATTERN`)
since the modal vocabulary is gone. `filteredFocusThreads` and `isTitleFiltered` both use it, so a
separator-only query is not a filter and an untitled thread never matches a non-empty query.

Test files: `global-title-search.test.mjs` was replaced by
`scripts/eyes-on-agents/focus-board-store.test.mjs` (12 assertions covering membership,
`Read all` eligibility, the three ordering guards ported from task 035, token matching,
title-only matching, filter composition, and the Open contract), and `package.json`'s
`test:eyes-on-agents:ui` script points at the new file. `ui-source.test.mjs` lost its modal,
`All`-column, and Domain-management tests and gained `Focus is the whole board…`,
`Cmd+F activates the Focus title filter…`, `the Focus title filter is token-based…`,
`the board renders one fixed 300px Focus column…`, and
`no Domain affordance remains in the EyesOnAgents renderer` (which also asserts that the XPC
handler and `eyes_on_agents_domain` persistence are still present).

Verified with the same run recorded in task 054: `yarn test:eyes-on-agents` green (66 UI
assertions plus every core/repository/bridge/Claude suite), typechecks, i18n check, and
`yarn build`. Electron E2E not run.
