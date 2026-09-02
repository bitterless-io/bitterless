# onlypreview-project-selection-blue-091 — Review 1

- Date: 2026-08-31
- Scope: independent review of the current-worktree implementation against
  `docs/plan/tasks/onlypreview-project-selection-blue-091.md` and
  `docs/issues/onlypreview-project-selection-blue-too-muted.md`.
- Method: task/issue/design/source/diff inspection, CSS specificity audit, focused source-contract
  tests, targeted lint/build evidence, and task-scoped `git diff --check`. Electron,
  Playwright/E2E, packaged smoke, and application launch were not run.

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None. The first review pass found that the test locked
  excluded-selected after ordinary selected-hover but not after the equal-specificity
  excluded-hover selector. A second ordering assertion was added and independently re-reviewed
  before this verdict.

## Requirements evidence

| Requirement                                            | Evidence                                                                                                                                                                                                                                                                   | Result |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Ordinary selected rows are visibly bluer               | `App.less` changes the shared selected file/directory surface from `#e3e6f1` to `#d6e4ff` while keeping `#303858` text and the existing Royal trailing rail.                                                                                                               | pass   |
| Selection survives ordinary hover                      | The explicit `.onlypreview-shell__tree-row--selected:hover` rule has equal specificity to ordinary `.onlypreview-shell__tree-row:hover`, appears later, and repeats `#d6e4ff`.                                                                                             | pass   |
| Search-excluded meaning remains orange                 | The existing excluded default `#fff4e8`, hover `#ffead3`, selected `#f9dfc2`, and accent-orange directory icon remain unchanged. The combined excluded-selected rule appears after both competing hover rules and therefore wins while retaining the Royal selection rail. | pass   |
| Focus, geometry, typography and behavior are unchanged | Focus still uses the existing `2px` `--onlypreview-focus` outline. No Vue markup, store, row dimensions, typography, icons, selection state, expansion behavior, renderer process, or filesystem path changed.                                                             | pass   |
| Regression coverage locks the cascade                  | `onlyPreviewSourceIntegration.test.mjs` asserts the ordinary selected/selected-hover surfaces, selected text, focus outline, all excluded colors, both cascade-order relationships, the orange directory icon, and the Royal rail.                                         | pass   |

## Verification

- `node --test tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`: **passed, 5/5**.
- `yarn build`: **passed** during independent review.
- Targeted ESLint: **0 errors**. Five whole-file Prettier warnings are unchanged from `HEAD` and
  outside the Task 091 additions.
- Task-scoped `git diff --check`: **passed** after the test correction.
- Electron, Playwright/E2E, packaged smoke, and application launch: **not run**, as required. Ral
  owns final live visual acceptance.

## Conclusion

**PASS — no P1/P2/P3 findings remain.**

The ordinary Project selection is now a clearly brighter light blue and remains stable under
hover. Search-excluded orange, focus, typography, geometry, and interaction behavior are
unchanged.
