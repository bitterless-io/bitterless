---
id: eyes-on-agents-focus-search-clear-064
scope: add a native clear action and Submodules-style focus border to the always-visible Focus search input
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-header-search-062]
---

# EyesOnAgents Focus Search Clear

## Objective

Make the always-visible Focus search input as quick to reset and as visually consistent as the
Submodules search input: show Arco's native clear action while text is present, and use the native
Arco border/focus treatment instead of the EyesOnAgents-only outline.

## Context

- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [Focus header search](eyes-on-agents-focus-header-search-062.md)
- `SubmodulesListControls.vue` / `.less` — the existing compact search-input reference

## Required behavior

- Enable Arco's native `allow-clear` affordance. The clear icon is absent for an empty input and
  appears only while the input contains text.
- Clicking clear immediately resets both the visible draft and the committed title query, then keeps
  focus in the input. A pending 120ms trailing commit must not restore the old query.
- `Escape` keeps its existing clear-and-refocus behavior; `Cmd+F` / `Ctrl+F` still only focuses the
  input.
- Use the same native Arco border/focus treatment as the Submodules search input. Remove the custom
  border suppression, shadow suppression, and 2px `:focus-within` outline; do not add a custom clear
  icon or another focus decoration.
- Keep the EyesOnAgents background/color integration and mini sizing. Do not change Focus membership,
  matching, throttling, ordering, `Read all`, cards, or empty states.
- No new i18n key is needed: the clear affordance is supplied by Arco and the search input retains its
  existing localized accessible label.
- Do not launch Electron E2E; Ral performs the end-to-end visual check.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `scripts/eyes-on-agents/ui-source.test.mjs`
- `scripts/eyes-on-agents/focus-board-store.test.mjs`

## Verification

- Focused source coverage asserts `allow-clear`, the clear event, and the absence of the retired
  EyesOnAgents-only border/focus overrides.
- Store coverage proves an immediate clear resets draft and query and a trailing scheduler run cannot
  restore the old query.
- `yarn test:eyes-on-agents:ui`
- `yarn typecheck:eyes-on-agents:ui`
- `yarn check:renderer-i18n`
- `yarn build`
- `git diff --check`

## Result

Implemented. The Focus header input now enables Arco's native `allow-clear` affordance and routes its
`clear` event through the same `clearTitleSearch()` path as `Escape`. That path clears `titleDraft`
and `titleQuery` immediately, then refocuses the input; the existing store regression proves a pending
trailing scheduler run can only publish the already-cleared draft.

The EyesOnAgents-only `border: 0`, `box-shadow: none`, and custom `:focus-within` outline were removed
from the search wrapper. Its EyesOnAgents background/color and mini size remain, while its border and
focused state now come from the same native Arco input treatment used by Submodules. No custom icon,
new i18n key, or filtering/state change was introduced.

Verified: focused store/source tests (40 assertions), `yarn test:eyes-on-agents:ui` (69 assertions),
`yarn typecheck:eyes-on-agents:ui`, `yarn check:renderer-i18n`, `yarn build`, and
`git diff --check`. Electron E2E was not run; Ral retains the end-to-end visual check.
