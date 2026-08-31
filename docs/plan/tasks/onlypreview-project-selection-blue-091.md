---
id: onlypreview-project-selection-blue-091
scope: Increase the OnlyPreview Project tree selected-row blue contrast without changing behavior
status: implemented; owner verification pending
depends-on:
  - onlypreview-directory-selection-search-scope-038
  - onlypreview-search-exclusion-markers-039
verify: focused non-Electron Shell source tests, directed lint/format, yarn build, and git diff checks; no Electron/Playwright/E2E
---

# Brighter Project tree selection

## Objective

Make the currently selected Project file or directory immediately recognizable with a clearer
light-blue surface while preserving every existing tree interaction and Search-exclusion signal.

## Context

- `docs/issues/onlypreview-project-selection-blue-too-muted.md`
- `docs/design/onlypreview-global-search.md`
- `docs/design/colors.md`

## Path

- `src/renderer/onlypreview/shell/src/App.less`
- focused `tests/onlypreview/` Shell source coverage
- the documentation listed above plus `docs/INDEX.md` and `docs/plan/README.md`

## Contract

- Change only the ordinary `.onlypreview-shell__tree-row--selected` surface from muted grey-blue
  `#e3e6f1` to the clearer light blue `#d6e4ff`.
- Apply the same state to files and directories through the existing shared row class. Do not add
  node-kind branching or new renderer state.
- Add the explicit selected-hover selector needed to beat the ordinary hover selector's higher
  specificity. Keep the Royal Blue trailing rail, `#303858` text, focus-visible outline, row
  dimensions, typography, icons, and all selection/expansion behavior.
- Keep Search-excluded rows orange in default, hover, and selected states. Their selected state
  remains visible through the existing Royal Blue trailing rail.

## Verification

- Add or update focused source coverage for the exact ordinary selected surface and the preserved
  excluded-selected orange/Royal-rail contract.
- Run the focused Node tests, directed ESLint/Prettier checks, `yarn build`, and task-path
  `git diff --check`.
- Do not run Electron, Playwright, packaged smoke, or E2E. Ral owns live visual acceptance.

## Delivery

- Ordinary selected files and directories now share the clearer `#d6e4ff` surface with the existing
  `#303858` text and Royal trailing rail.
- An explicit selected-hover rule fixes the previous specificity bug that let ordinary hover hide
  the selected surface. Search-excluded default, hover, selected and orange-icon treatments remain
  unchanged and continue to win through their later combined selector.
- Focused source coverage locks the selected colors, focus outline, Royal rail, excluded colors and
  both equal-specificity cascade orderings. The first independent review pass found one missing
  excluded-hover ordering assertion; it was added before the final
  [review 1](../reviews/onlypreview-project-selection-blue-091-1.md) **PASS**.
- The focused source suite passed 5/5, `yarn build`, targeted ESLint with zero errors, and task-scoped
  `git diff --check` passed. Electron, Playwright/E2E, packaged smoke, and application launch were
  not run; Ral owns the live visual check.

## Owner verification

- Select an ordinary file and directory and confirm both use the brighter blue surface through
  pointer hover and keyboard focus.
- Select a Search-excluded file/directory and confirm its pale-orange status remains visible while
  the Royal trailing rail still marks it selected.
