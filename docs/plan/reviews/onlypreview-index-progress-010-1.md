---
id: onlypreview-index-progress-010-1
status: blocked
reviewed_task: onlypreview-index-progress-010
target: working-tree-at-722971ff7b13e567532d4955eb415a329e7cd5b4
base: 722971ff7b13e567532d4955eb415a329e7cd5b4
date: 2026-08-10
review_type: independent-source-and-node-no-electron
---

# Verdict

**BLOCKED — one P2 layout finding violates the required Project-bottom rail placement.**

The counted search-index path itself is sound: Main uses the same FIFO breadth-first traversal for
counting and generation, caps it at 100,000 and depth 20, emits bounded progress, and keeps
`listDirectory` independent. The event surface is host/revision-scoped and metadata-free; Shell
fences stale events and clears the matching rail on settlement or failure. The 63-test Node suite,
node typecheck, renderer-i18n check, focused ESLint, and diff check all pass.

# Findings

## P2 blocking — an empty active projection places the rail below Search, not at the Project bottom

The Project pane is a column flex container (`src/renderer/onlypreview/shell/src/App.less:187-194`).
Only the rendered tree and the rendered empty/no-results state consume the remaining height: the
tree has `flex: 1` (`App.less:271-277`), while the empty/no-results rules also have `flex: 1`
(`App.less:358-369`). During an active build with zero visible rows, however, neither element is
rendered. The tree branch requires `visibleRows.length`, and the no-results branch explicitly
requires `!indexLoading` (`src/renderer/onlypreview/shell/src/App.vue:156-234`). The progress element
then follows directly after Search (`App.vue:236-260`), and its style has only a fixed 2px flex basis
with no bottom anchoring or auto top margin (`App.less:404-410`).

Consequently, an empty folder — which has a real progress test and emits `counting` followed by
`indexing 0/0` (`tests/onlypreview/onlyPreviewCore.test.mjs:583-600`) — briefly renders the active
rail immediately under the Search control rather than at the bottom edge of the Project pane. The
same failure can occur when an active projection has a non-empty query but no current search rows.
This conflicts with the task's required bottom placement and accepted feature contract
(`docs/plan/tasks/onlypreview-index-progress-010.md:73-77`;
`docs/features/onlypreview.md:470-474`).

Required closure: bottom-anchor the active rail for every content state, including zero rows (for
example, retain a flexing Project body or make the rail consume the remaining flex gap with an auto
top margin), without reserving height when the rail is absent. Add a UI/source regression guard for
the zero-row active-build layout; the existing assertion checks only the marker, 2px size,
animation, and reduced-motion declarations (`tests/onlypreview/onlyPreviewCore.test.mjs:1342-1350`),
so it cannot detect this placement failure.

## P3 non-blocking — Shell progress lifecycle evidence remains source-pattern only

The service progress tests execute real implementations, including a changed filesystem between
passes, empty output, the 100,000 cap, depth 20, and independent browsing
(`tests/onlypreview/onlyPreviewCore.test.mjs:534-710`). Shell exact-payload filtering, host/revision
fencing, monotonic rejection, new-build supersession, and settlement/failure cleanup are instead
verified by regular expressions over source (`tests/onlypreview/onlyPreviewCore.test.mjs:1258-1357`).
Those checks do not drive malformed, stale, reordered, failed, completed, refreshed, settings, or
workspace-replacement events through store state. Static audit finds the current guards correct,
so this is not a second blocker, but a lightweight bundled-store harness would turn these race
contracts into behavioral evidence.

## P3 non-blocking — the task Path omits its revision validator file

Constraint 1 requires validation of the new opaque revision, and the implementation adds
`parseOnlyPreviewIndexRevision` in `src/shared/onlypreview/onlyPreview.contract.ts:51-56`. The 010
task's Path lists the shared types file but not this changed contract file
(`docs/plan/tasks/onlypreview-index-progress-010.md:37-51`). Add the contract path when closing the
task so its declared scope matches the delivery.

- P0 blocking: none.
- P1 blocking: none.
- P2 blocking: the Project-bottom placement finding above.
- P3 non-blocking: lifecycle behavioral-test hardening and the missing task Path entry above.

# Contract Assessment

- `build()` emits `counting`, runs a non-collecting traversal, emits `indexing 0/total`, then runs
  the collecting traversal with the counted bound. It reports each 256 entries and the final count
  (`src/main/onlypreview/onlyPreviewIndex.service.ts:109-148`). Both passes share the same FIFO queue,
  visibility, exclusions, non-recursed symlink leaves, containment checks, depth-20 queue rule, and
  entry-bound check (`onlyPreviewIndex.service.ts:159-270`). Filesystem shrinkage between passes is
  covered by a real test and produces a final completed value below the earlier total without
  inventing rows.
- The real fixtures verify strict breadth-first order, hidden/exclusion/symlink rules, `0/0`,
  throttled monotonic progress, a generated prefix of exactly 100,000, silent depth-20 cutoff, and
  complete demand-loaded listing beyond either search bound. `listDirectory` calls only the shared
  one-directory reader and has no global entry/depth limit.
- The exact shared event union carries only `hostId`, `indexRevision`, `phase`, and, for indexing,
  `completed`/`total` (`src/shared/onlypreview/onlyPreview.types.ts:128-140`). Main validates the
  revision, requires a content host, and broadcasts that exact host/revision plus the internal
  progress union (`src/main/xpc/onlyPreview.handler.ts:112-129`).
- Shell runtime validation requires exactly three counting keys or five indexing keys, safe bounded
  integers, the current host, and the current revision. It rejects decreasing completion and
  changing totals (`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:75-99,501-527`). A
  new projection assigns its revision before the request, and matching generation/revision guards
  clear progress after success or failure while preventing an old request from clearing a newer
  one (`onlyPreviewShell.store.ts:623-679`). Workspace removal also clears the revision and rail
  (`onlyPreviewShell.store.ts:548-572`).
- The rail itself has no text or icon, exposes only a localized non-visible accessible label, uses
  indeterminate/determinate states, clamps the determinate ratio, and disables animation/transition
  under reduced motion (`src/renderer/onlypreview/shell/src/App.vue:236-260,341-345`;
  `src/renderer/onlypreview/shell/src/App.less:404-437,503-516`). Its conditional DOM makes idle
  height zero. The only failure is its active zero-row vertical placement.
- Visible truncated/index-ready/index-partial/status copy is removed. The selected-character,
  file-type, and size metadata remains in the fixed 25px right-aligned status rail, and Preview
  geometry code remains unchanged (`src/renderer/onlypreview/shell/src/App.vue:288-303`;
  `src/renderer/onlypreview/shell/src/App.less:469-500`).

# Scope Audit

The working tree is cumulative over task 009 and task 010. This review attributed only the revision
validator omission above to 010; the changed settings test and backlog file belong to the preceding
layered-index delivery. No dependency, absolute-path renderer authority, full-text indexing,
watcher, write path, or browse limit was introduced by 010.

# Verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/*.test.mjs` | PASS — 63/63; includes real two-pass, empty, 100k, depth, browse, containment, and settings cases |
| `yarn typecheck:node` | PASS |
| `yarn check:renderer-i18n` | PASS — `[check-renderer-i18n] ok` |
| Focused `yarn eslint --no-cache --quiet` over all touched TS/Vue/MJS files | PASS |
| `git diff --check` | PASS |

An attempted `yarn test:onlypreview:node` was rejected because no such package script exists; the
task-prescribed direct Node command above was then run successfully. No Electron, Playwright,
full-app E2E, build, complete application, branch, commit, or push operation was run.

# Current Status

This review wrote only `docs/plan/reviews/onlypreview-index-progress-010-1.md`. It did not modify
source, tests, configuration, task status, accepted feature/analysis documents, prior reviews, or
Git state.

# Conclusion

**blocked**
