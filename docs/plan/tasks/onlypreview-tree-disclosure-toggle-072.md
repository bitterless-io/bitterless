---
id: onlypreview-tree-disclosure-toggle-072
scope: Project-tree directory arrow single-click disclosure without changing row selection semantics
status: implemented; owner verification pending
depends-on:
  - onlypreview-global-search-concurrency-directory-ux-040
verify: focused non-Electron tree/source tests, relevant Renderer typecheck/lint/format, yarn build, git diff --check; no Electron/Playwright/E2E
---

# OnlyPreview tree disclosure toggle

## Objective

Make the directory arrow an explicit one-click disclosure target while preserving the established
row contract: the rest of a directory row selects on one click and expands or collapses only on a
double click.

## Context

- [OnlyPreview directory selection and Global Search file scope](../../issues/onlypreview-directory-selection-and-global-file-scope.md)
- [OnlyPreview Global Search and result preview](../../design/onlypreview-global-search.md)
- [OnlyPreview feature contract](../../features/onlypreview.md)
- [Task 038](onlypreview-directory-selection-search-scope-038.md)

This is a pointer-only follow-up to task 038. It is independent of the active indexing work in
tasks 070 and 071; their status and behavior remain unchanged.

## Delivery Surface

- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs`
- `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`
- existing focused Project-tree tests

## Interaction Contract

- Keep the existing focusable tree-row button as the one tree item. Do not nest another button
  inside it. The directory arrow uses a named, pointer-addressable span that is not a separate Tab
  stop; the row continues to own `role="treeitem"`, `aria-selected`, and `aria-expanded`.
- The first ordinary arrow click, including a programmatic click with `detail === 0`, selects and
  focuses the directory, reports it as Current directory, and toggles expansion exactly once. The
  synthetic root row follows the same rule.
- Stop the arrow's click propagation. Ignore click details greater than one, and stop/prevent the
  resulting double-click event, so a rapid double click neither toggles twice nor reaches the row's
  double-click handler.
- A click on the directory row outside the arrow still selects without toggling. A double click on
  that area still toggles once. File preview, keyboard `Space`/`Enter`/`ArrowLeft`/`ArrowRight`,
  context menu, copy shortcuts, and Global Search scope semantics remain unchanged.
- Keep the current 13px chevron artwork. Give it a restrained approximately 17×21px pointer hit
  target and existing Royal-soft hover feedback without introducing a dependency, process, card,
  animation, or new color system.

```text
┌─ directory tree item button ────────────────────────────────┐
│ [arrow hit target] [folder] directory name                    │
│  click: select + toggle   row body click: select only         │
│                           row body double click: toggle once  │
└───────────────────────────────────────────────────────────────┘
```

## Verification

- Add source/UI assertions for the named arrow target, stopped click/double-click boundary,
  click-detail fence, preserved row handlers, and preserved tree ARIA ownership.
- Run the focused search-shell UI, source-integration, and Project-tree Node tests.
- Run the relevant renderer TypeScript, lint, and formatting checks, then `yarn build` and
  `git diff --check`.
- Do not run Electron, Playwright, packaged-app smoke, or any other E2E suite. Owner performs the
  live pointer verification.

## Delivery

- The directory chevron now lives inside a named, non-focusable 17×21px span within the existing
  treeitem button. Its 13px net row width, ARIA ownership, roving tabindex, and keyboard contract
  remain unchanged.
- The arrow click stops at that span and uses the existing entry-activation path to select/focus the
  directory, report Current directory, and toggle once. Click details greater than one are ignored,
  and the resulting double-click is prevented and stopped.
- The directory row body still selects on one click and toggles on one double click. File preview,
  context menu, copy shortcuts, root-directory behavior, and demand-loaded browsing are unchanged.

## Verification Results

- Focused Project-tree/source tests: **PASS, 17/17** in independent review; root verification of the
  three directly affected suites: **PASS, 14/14**.
- `yarn typecheck:node`: **PASS**.
- `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false`: **PASS**.
- Focused ESLint: **PASS, 0 errors**. Shared-worktree Prettier warnings outside task 072's hunks
  remain pre-existing and non-blocking.
- `yarn build`: **PASS**; the validation-only package-name mutation was restored afterward.
- `git diff --check`: **PASS**.
- [Independent review 1](../reviews/onlypreview-tree-disclosure-toggle-072-1.md): **PASS**, with no
  P1/P2/P3 or blocking finding.
- Electron, Playwright, E2E, packaged smoke, and the real application were not run, as required.

## Owner Verification

- Single-click several collapsed and expanded directory arrows, including the workspace root, and
  confirm each click both selects the directory and changes expansion exactly once.
- Rapidly double-click an arrow and confirm it changes expansion only once. Then click the row body
  to confirm it only selects, and double-click the row body to confirm it toggles once.
