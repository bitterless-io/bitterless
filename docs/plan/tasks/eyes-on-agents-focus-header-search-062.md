---
id: eyes-on-agents-focus-header-search-062
scope: replace the Focus header title with an always-visible search input and reduce Cmd+F to focusing it
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-filter-performance-060]
---

# EyesOnAgents Focus Header Search

## Objective

Give the search input the header row: drop the target glyph and the `Focus` title, drop the `⌕`
toggle and the `×` close control, and leave one always-visible input beside `Read all`. `Cmd+F` /
`Ctrl+F` simply focuses that input.

## Context

- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [Focus search affordance](eyes-on-agents-focus-search-affordance-057.md) and
  [Focus search toggle](eyes-on-agents-focus-search-toggle-058.md) — the toggle/close era this replaces

With a single column the title says nothing the window title does not, and a filter that has to be
opened before use costs one interaction per search.

## Required behavior

- Header contents, left to right: the search input taking the remaining width, then `Read all`. No
  target glyph, no `Focus` heading, no `⌕` toggle, no `×` close control, and no separate filter row
  below the header.
- The input is always visible and always accepts typing; there is no open/closed state left in the
  column.
- `Cmd+F` / `Ctrl+F` suppresses the native page Find and focuses the input. Pressing it again just
  refocuses; nothing toggles, opens, or closes.
- `Escape` inside the input clears the query and keeps focus in the input, so there is still a
  keyboard way to reset without a visible control.
- The placeholder discloses the platform shortcut — `Search titles (⌘F)` on macOS, `Search titles
  (Ctrl+F)` on Windows — reusing the existing platform strings so the affordance from task 057
  survives without a button. The accessible label stays the plain search label.
- Retire the now-unused `board.titleSearchPlaceholder` and `actions.closeTitleSearch` strings in both
  locales, and drop the `agent-domain__title*`, `agent-domain__search-row`,
  `agent-domain__search-trigger`, and `agent-domain__search-close` styles.
- Everything behind the input is unchanged: draft/throttle commit, memoized matching, token
  semantics, ordering, `Read all` rules, the activation tint, and the empty states.
- Do not launch Electron E2E; Ral performs the visual check.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/App.vue`
- `src/renderer/eyesOnAgents/src/components/AgentBoard/AgentBoard.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:ui`
- `yarn check:renderer-i18n`
- `yarn build`
- Static coverage asserts the header input, the absent title/toggle/close controls, the focus-only
  shortcut path, the platform placeholder, and the retired strings and styles.

## Result

Implemented. The Focus header is now `[search input] [Read all]` inside one `role="search"` element.
Removed: `IconTargetArrow`, the `<h2>` title and the `title` prop, the `⌕` toggle with its tooltip,
the `×` close control, the separate filter row, and every trace of open/closed state
(`titleSearchOpen`, `openTitleSearch`, `closeTitleSearch`, `toggleTitleSearch`, `aria-expanded`,
`aria-controls`).

`Cmd+F` / `Ctrl+F` now walks `App.vue` → `AgentBoard.focusTitleSearch()` →
`DomainColumn.focusTitleSearch()`, which only focuses the input. `Escape` inside the input clears the
query and keeps focus there, which is the only visible-control-free reset left.

The placeholder carries the platform shortcut through the existing `actions.searchTitlesMac` /
`actions.searchTitlesWindows` strings, so task 057's discoverability survives without a button. A
small `IconSearch` prefix sits inside the input. Retired strings: `board.titleSearchPlaceholder`,
`board.focus`, `actions.closeTitleSearch` (and the older `actions.clearTitleSearch`). Retired styles:
`agent-domain__title`, `agent-domain__title-row`, `agent-domain__search-row`,
`agent-domain__search-trigger`, `agent-domain__search-close`.

Draft/throttle commit, memoized matching, token semantics, ordering, `Read all` rules, the activation
tint, and the empty states are untouched.

Verified: `yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents:ui` (67 assertions),
`yarn check:renderer-i18n`, `yarn build`. Electron E2E not run; Ral retains the visual check.
