---
id: submodules-nested-tree-064
scope: show submodules that declare their own submodules as a two-level tree with an expand/collapse control, 12px indent, and a search that reaches the second level
status: implemented; owner verification pending
depends-on: [submodules-list-controls-063]
verify: node --test tests/submodules/*.test.mjs && yarn build
---

# Submodules nested tree

## Objective

Some submodules are superprojects themselves — in this workspace
`projects/micromeet-knowledge-governance` declares **7** and `projects/pet-service` **1**. Surface them:

1. Scan one level down and show the children under their parent, **two levels maximum**.
2. A chevron on the parent expands and collapses its children; collapsed is the default.
3. A child row is indented **12px**.
4. A search that matches a child shows the parent *and* the matching children.

## Context

- [Submodules mini app](../../features/submodules.md) contracts #2 (inventory, now two levels) and
  #7 (order, search, expansion) are the contract; read them before changing behavior here.
- Owner request 2026-08-28.

## Decisions

- **Depth is a scanner argument, not a recursion guard.** `describeSubmodule(base, section, nested)`
  passes `nested = true` for children, so a child never reads its own `.gitmodules`. Two levels is
  enforced where the data is produced, not by the view.
- **Order stays Main's, expansion stays the view's.** `orderSubmodules` recurses into `children` with
  the same settings so both hosts agree on order; the expanded set is a renderer `Set<string>` of
  absolute paths — view state, never persisted, and unaffected by snapshot rebroadcasts.
- **Search always reveals its hits.** A match inside a collapsed parent renders the parent plus the
  matching children regardless of the collapsed state; a matched parent renders its whole subtree.
  The pure rules live in `submoduleTree.service.ts` so they are unit-testable under `node --test`.
- **A drifted child never lifts its parent.** Differ-first grouping applies inside each level, or the
  tree would reorder into something that no longer reads as a hierarchy.
- **Counts changed meaning:** the root summary now counts every row in the tree (39 here: 31 + 8),
  and `visible/total` during a search counts rendered rows, children included.
- Rows without children reserve the chevron's 18px, so first-level names stay on one vertical line.

## Verification

- `node --test tests/submodules/*.test.mjs` — 50 tests. `submoduleTree.service.test.mjs` (8) covers
  collapsed/expanded rendering, child-match keeping the parent, parent-match showing the subtree,
  non-matching parents disappearing, multi-token case-insensitive matching on either level, both
  counters, a stale expanded path, and the display-name mirror. `submoduleOrder.service.test.mjs`
  gained child ordering, input immutability, and update-time ordering for children.
- Measured on the real workspace after the change: 31 top-level + 8 nested = 39 rows, one full
  rescan **2.5 ms** (195 `stat`, 43 reads), watch targets 63 → **81**. Nesting is free in practice.
- `yarn lint` clean for the touched trees; `yarn typecheck:node` / `yarn typecheck:web` report
  nothing for these files; `yarn build` exits 0.
- `yarn check:renderer-i18n` fails on `Tray must follow Home creation`, which is **pre-existing on
  `dev/next`**: `src/main/app.main.ts` is unmodified and no longer calls
  `trayHelper.init(mainWindowHelper)`, so the script's index is `-1`. The i18n parity assertions
  (lines 89–140) pass before it.
- E2E not run (project rule: never on the agent's initiative).

## Owner verification

- `micromeet-knowledge-governance` shows a chevron; expanding lists its 7 children indented, each with
  its own branch tag, commit, and WebStorm action.
- `pet-service` shows one child (`viv-bruno`).
- Searching `gov-exec` shows `micromeet-knowledge-governance` with only that child, expanded.
- Searching `governance` shows the parent with all 7 children.
- The count reads 39 with no search.
