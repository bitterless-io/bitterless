# OnlyPreview Filter Directory Reveal 031 — Independent Review 1

Status: **PASS**

Date: 2026-08-24

## Verdict

Task 031 satisfies the ordinary local-filter reveal contract. A first click marks a visible matched
directory even when it was expanded before the query, reuses the existing one-directory lazy browse
path, and admits only currently loaded descendants whose path-segment ancestor chain contains a
marked root. A second click or ArrowLeft collapse clears the exact and nested reveal markers.

The implementation adds no filesystem/Main/Project Search work, recursive preload, timer, retained
row list, API, XPC, persistence, or visual marker. Per-row reveal membership is independent of the
number of marked roots. No P0-P2 finding remains.

Electron/Playwright E2E, the real app, and live pointer/keyboard verification were not run.

## Findings

| Severity | Blocking | Count |
| -------- | -------- | ----: |
| P0       | blocking |     0 |
| P1       | blocking |     0 |
| P2       | blocking / non-blocking |     0 |

## Contract audit

| Required behavior | Result | Independent evidence |
| ----------------- | ------ | -------------------- |
| Ordinary local filter only | **PASS** | Reveal state is private to `OnlyPreviewTreeFilter` and is consumed only by Shell's ordinary `visibleRows` computation (`src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts:87-92,178-192`; `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:87-89`). Project Search entry clears reveal roots before its existing `enter()` flow (`onlyPreviewShell.store.ts:391-395`). |
| First click reveals, including a pre-query expanded directory | **PASS** | While a query is active, the first unmarked click adds the root and expansion and returns `true`; Shell then calls the existing `loadDirectory(relativePath)` path (`onlyPreviewTree.service.ts:134-142`; `onlyPreviewShell.store.ts:327-330`). The executable test begins with both `docs` and `docs-a` already expanded and proves the first `docs` click reveals its non-matching loaded children (`tests/onlypreview/onlyPreviewSearchShell.test.mjs:286-298`). |
| Existing lazy load only | **PASS** | The toggle requests exactly the clicked directory through the existing Browse Projection loader. That loader returns immediately when the exact listing is already loaded and otherwise issues one exact `browseDirectory` request; no descendant loop was added (`src/renderer/onlypreview/shell/src/onlyPreviewBrowseProjection.service.ts:109-146`). Nested reveal remains user-driven and is covered separately (`onlyPreviewSearchShell.test.mjs:299-303`). |
| Second click/collapse clears exact and nested markers | **PASS** | `collapseDirectory()` removes the expansion at the clicked path, obtains roots indexed at that ancestor, deletes every exact/nested root, and removes each reverse-index membership and empty bucket (`onlyPreviewTree.service.ts:152-165`). The pure test collapses `docs`, reopens it, and proves `docs/nested` is no longer marked (`onlyPreviewSearchShell.test.mjs:305-311`). ArrowLeft routes expanded directories through the same cleanup (`onlyPreviewShell.store.ts:295-303`). |
| Segment-safe descendant membership | **PASS** | `hasOnlyPreviewRevealAncestor()` repeatedly computes the parent and performs `revealRoots.has(current)`; it contains no prefix check or reveal-root iteration (`onlyPreviewTree.service.ts:14-24`). Executable assertions prove `docs/child` and `docs/nested/child` match while `docs-a/child` does not, and source assertions pin `while + Set.has` with no `startsWith`, `for`, or `.some()` (`onlyPreviewSearchShell.test.mjs:336-345`). |
| Frozen snapshot cannot leak through actual expansions | **PASS** | The traversal may reflect current `expandedPaths`, but normal matches are evaluated only from `visiblePathSnapshot`, and normal returned rows must also be in that snapshot. A row outside it can pass only through an ancestor reveal marker (`onlyPreviewTree.service.ts:41-78`). The frozen-row test expands a formerly collapsed directory and appends a new matching file after query start; neither leaks into results (`onlyPreviewSearchShell.test.mjs:204-259`). |
| Exact raw query change clears before recomputation | **PASS** | `transition()` clears both reveal structures whenever two active raw values differ, including normalized-equivalent values (`onlyPreviewTree.service.ts:116-131`). Store calls it before assigning the new reactive query (`onlyPreviewShell.store.ts:193-197`). The executable `docs` to `docs ` case proves revealed descendants disappear before normalized row recomputation (`onlyPreviewSearchShell.test.mjs:312-317`). |
| Query end and workspace/Project Search lifecycle | **PASS** | `end()` clears markers and restores exactly the pre-query expansion snapshot (`onlyPreviewTree.service.ts:106-114`). `rows()` captures a changed workspace before computing its rows, and `capture()` clears both marker indexes (`onlyPreviewTree.service.ts:99-104,178-185`). Tests cover expansion restoration and workspace replacement (`onlyPreviewSearchShell.test.mjs:318-334`); Project Search entry clears markers as noted above. |
| Marker cleanup and memory bound | **PASS** | `clearRevealRoots()` clears both the root Set and ancestor Map together; collapse removes all reverse-index memberships for affected nested roots and deletes empty Map buckets (`onlyPreviewTree.service.ts:129-132,152-175`). Retention is bounded to user-marked loaded directories for one query session plus their path ancestors, O(sum of marked path depths); no rows, index entries, or file bodies are retained by reveal state. |
| No new I/O/API/UI/persistence | **PASS** | Task logic is renderer-local state and row computation. Shell reuses the existing browse call only after an explicit directory click. The scoped implementation adds no Main/preload/shared contract, XPC event, filesystem read/traversal, Project Search request, badge/control, persistent setting, or body materialization. |
| Performance/device safety | **PASS** | Row construction remains O(index entries + currently traversed rows). Membership is O(path depth) per candidate through parent traversal and `Set.has`, never O(rows × reveal roots). Marker insertion/removal is O(path depth) per affected marked root, query/workspace teardown is bounded collection clearing, and lazy loading remains one directory per interaction. No recursive preload, timer, process, worker, or unbounded retained row list can drive device memory/CPU growth. |

## Code Review report

- Scope: Task 031 production and executable/source tests on `dev/next`
- Date: 2026-08-24

### File list

| # | File | Lines | Findings |
| -: | ---- | ----: | -------: |
| 1 | `src/renderer/onlypreview/shell/src/onlyPreviewTree.service.ts` | 196 | 0 |
| 2 | `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts` | 793 | 0 |
| 3 | `tests/onlypreview/onlyPreviewSearchShell.test.mjs` | 733 | 0 |
| 4 | `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` | 611 | 0 |

### Problems

None under the workspace `code-review` rules. All four TS/JS files are at most 800 lines (TS-1),
and no replaceable `function` declaration/expression appears (TS-2). Task 031 adds no Vue SFC
business flow or business `emit`, so FE-1 and FE-2 are not applicable. There are no backend rules.

## Fresh verification

| Check | Result |
| ----- | ------ |
| `node --test tests/onlypreview/onlyPreviewSearchShell.test.mjs tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` | **PASS — 22/22**, zero failed/cancelled/skipped/todo |
| `node --test tests/onlypreview/*.test.mjs` | **PASS — 338/338**, zero failed/cancelled/skipped/todo |
| `yarn typecheck:web` | **KNOWN UNRELATED BASELINE — exit 2**, 76 existing diagnostics and zero OnlyPreview matches; affected areas are connector, Poker test globals, Home, Maestro, Omni, and shared path code |
| `yarn check:renderer-i18n` | **PASS** |
| focused `yarn eslint --quiet` over the four scoped code/test files | **PASS**, zero errors |
| `git diff --check` | **PASS** |
| `yarn build` | **PASS** — Main 1,664, preload 1,039, client 10,428 modules |

The build emitted only the existing unrelated mixed static/dynamic-import warnings for Maestro
ExcelJS, EyesOnAgents, and Home router. The broad worktree contains many unrelated in-progress
changes; this review isolated the Task 031 files and did not modify or revert those changes.

## Owner-only live acceptance

Ral still owns the environment-dependent verification intentionally excluded from this review:

- with an ordinary Project-tree query active, click a visible matched directory that was collapsed
  before the query and one that was already expanded; confirm each first click reveals loaded
  non-matching children and performs at most the expected single-directory lazy load;
- reveal a nested directory, then click/ArrowLeft-collapse its reveal ancestor and confirm the exact
  and nested temporary reveals disappear; verify `docs-a` never appears as a child reveal of `docs`;
- change the raw query (including a whitespace-only raw change), clear it, replace the workspace,
  and enter Project Search; confirm temporary reveal state clears and the original expansion snapshot
  is restored when the ordinary query ends;
- repeat on a large tree and confirm interaction remains responsive and no recursive loading occurs.

## Delivery handoff

The delivery owner should transition the task/feature/design/analysis/README ledger only after this
review is incorporated. This independent review intentionally edited none of those files.

## Conclusion

**PASS.** Directory reveal is query-scoped, segment-safe, lazy, snapshot-preserving, and bounded;
all task-specific non-E2E checks pass, with only the known unrelated web-typecheck baseline remaining.
