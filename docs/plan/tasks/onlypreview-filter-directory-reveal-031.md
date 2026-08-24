---
id: onlypreview-filter-directory-reveal-031
scope: Query-scoped descendant reveal roots for the ordinary Project tree filter
status: implemented; owner verification pending
depends-on: [onlypreview-project-search-shortcut-030]
verify: node --test tests/onlypreview/onlyPreviewSearchShell.test.mjs tests/onlypreview/onlyPreviewSearchShellUi.test.mjs && yarn typecheck:web && yarn check:renderer-i18n && yarn build
---

# Reveal a matched directory inside the local Project filter

## Objective

When the ordinary Project field matches a directory, clicking that visible directory temporarily
reveals its loaded descendants even when their names do not match the query. Keep the reveal as an
internal query-session marker, clear every marker as soon as the search text changes, and preserve
the existing pre-query expansion snapshot when filtering ends.

This does not change file-only Project Search, its SQLite index, or its scopes.

## Context

- [`../../features/onlypreview.md`](../../features/onlypreview.md) — current Project tree, ordinary
  filter, and Project Search distinction.
- [`../../design/onlypreview-preview-merge-find.md`](../../design/onlypreview-preview-merge-find.md) —
  Shell ownership of the local directory filter.
- [`onlypreview-search-scope-watch-013`](onlypreview-search-scope-watch-013.md) — frozen visible-row
  filter and scoped Project Search contract.
- [`onlypreview-project-search-shortcut-030`](onlypreview-project-search-shortcut-030.md) — latest
  search-entry interaction update.

## Path

- `src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `tests/onlypreview/onlyPreviewSearchShell.test.mjs`
- `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs`
- `docs/features/onlypreview.md`
- `docs/design/onlypreview-preview-merge-find.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-filter-directory-reveal-031.md`
- `docs/plan/reviews/onlypreview-filter-directory-reveal-031-1.md`

## Interaction Flow

```text
local query Q starts
    ↓ capture pre-query visible paths + expansion
matching/ancestor directory D is clicked
    ↓ revealRoots.add(D) + lazy load D's existing browse listing
row R is rendered when an ancestor lookup finds D in revealRoots
    ↓ clicking deeper directories loads/reveals one level at a time
query changes Q → Q2
    ↓ revealRoots.clear()
old non-matching descendants disappear; the frozen session evaluates Q2
```

## Contract

1. Reveal markers belong only to one non-empty ordinary Project-filter session. They are an
   internal `Set` of normalized relative directory paths; no badge, new control, renderer API, XPC,
   filesystem capability, or persistent state is added.
2. Clicking a visible directory while a local query is active reveals it instead of collapsing it
   when it has not yet been marked, even if it was expanded before the query. Main-tree expansion
   then uses the existing lazy `browseDirectory` path. It never recursively loads the directory.
3. A currently loaded file or directory bypasses the name/snapshot filter only when its ancestor
   chain contains a marked reveal root. The marked root remains visible through the normal match or
   context-ancestor rule. Clicking a revealed directory again collapses it and removes markers at
   that path and below it.
4. Descendant membership uses path-segment parent traversal plus `Set.has()`. It is O(path depth)
   per candidate and independent of the number of marked directories; raw prefix matching and an
   O(rows × reveal roots) scan are forbidden, so `docs-a` can never be treated as a child of `docs`.
5. Any exact search-input value change while the query stays non-empty clears all reveal markers
   before rows are recomputed. Previously revealed descendants therefore disappear unless they
   independently match the new query or are its context ancestors.
6. Clearing the query restores the expansion snapshot captured before the filter began. Workspace
   replacement, filter teardown, and Project Search entry also clear the temporary markers. The
   ordinary filter still never searches relative paths or unloaded/collapsed descendants.
7. The computation remains renderer-local and body-free: no filesystem traversal, file read,
   Project Search query, Main work, timer, or unbounded retained row list is introduced.

## Verification

1. Pure tree-filter tests cover a matched directory whose non-matching child is initially hidden,
   first-click reveal, deeper lazy expansion, collapse/removal, query-change reset, and pre-query
   expansion restoration.
2. Boundary tests prove a similarly prefixed sibling is not admitted and that membership walks
   ancestors through `Set.has()` rather than scanning every reveal root.
3. Shell source/behavior tests pin local-filter-only ownership, existing lazy directory loading,
   Project Search separation, and no visible marker/API/XPC addition.
4. Run focused tests, web typecheck, renderer i18n, focused error-level ESLint, `git diff --check`,
   and `yarn build`.
5. Electron/Playwright E2E is not run. Ral owns live pointer/keyboard verification on large trees.

## Verification Evidence

- Focused TreeFilter and Shell source tests: **PASS — 22/22**.
- `node --test tests/onlypreview/*.test.mjs`: **PASS — 338/338**, with zero failed,
  cancelled, skipped, or todo tests.
- Renderer i18n, focused error-level ESLint, `git diff --check`, and `yarn build`: **PASS**.
- `yarn typecheck:web` retains the existing unrelated 76-diagnostic baseline and reports zero
  OnlyPreview diagnostics.
- [Independent review 1](../reviews/onlypreview-filter-directory-reveal-031-1.md) recorded **PASS**
  with no P0-P2 or workspace code-review finding. It independently confirmed O(path depth)
  membership, bounded marker cleanup, lazy loading, and snapshot isolation.
- Electron/Playwright E2E, the real app, and live pointer/keyboard checks were intentionally not
  run.

## Owner Verification

- In the ordinary Project field, match and click one initially collapsed directory and one that was
  already expanded before the query. Confirm the first click reveals their non-matching loaded
  children without recursively loading the subtree.
- Reveal a nested directory, then click or ArrowLeft-collapse its reveal ancestor. Confirm exact and
  nested temporary reveals disappear and a similarly prefixed sibling such as `docs-a` is never
  treated as a descendant of `docs`.
- Change the raw query, including a whitespace-only raw change, and confirm all previously revealed
  non-matching descendants disappear immediately. Clear the filter and confirm the pre-query
  expansion snapshot returns.
- Replace the workspace and enter Project Search while a reveal is active; confirm the temporary
  marker does not survive. Repeat on a large tree and confirm interaction stays responsive.
