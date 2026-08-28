---
id: onlypreview-search-exclusion-markers-039-1
status: blocked
reviewed_task: onlypreview-search-exclusion-markers-039
target: working-tree
base: dev/next
date: 2026-08-27
review_type: independent-contract-review
---

# onlypreview-search-exclusion-markers-039 — Review 1

- Result: **BLOCKED**
- Scope: task-scoped BrowseIndex marker computation, Browse-only contract isolation, Main/Renderer
  validation, Renderer projection/rendering, refresh policy restoration, and focused regressions.
  Unrelated dirty-worktree changes were preserved and excluded.
- E2E/live app: intentionally not run. Electron, Playwright, E2E, and the real application are
  excluded by the task contract.

## Findings

### P2 · blocking — An exact configured directory exclusion is not inherited by its browsed descendants

- Design: `docs/plan/tasks/onlypreview-search-exclusion-markers-039.md:47-57` requires every file or
  directory below an excluded ancestor to inherit exclusion while ordered workspace `!` rules may
  re-include descendants. `docs/issues/onlypreview-search-exclusion-tree-markers.md:25-35` explicitly
  requires children below configured-exclusion directories to keep the pale-orange marker.
- Code: `src/preload/onlypreview/search/core/browse-index.mjs:149-169` calculates every child marker
  only by calling `isExcludedDirectoryPath(childRelativePath)` or
  `isExcludedFilePath(childRelativePath)`. Those helpers in
  `src/preload/onlypreview/search/core/traversal.mjs:53-78` apply configured ordered globs to the
  candidate path itself; they do not carry the physically excluded state of the directory token or
  evaluate an exact-matching excluded ancestor for that child.
- Reproduction: with workspace rule `exclude: ['excluded']`, BrowseIndex emits
  `{ directory: true, child: false }` for `excluded/` and `excluded/child.txt`. Global Search
  correctly prunes the directory, but expanding it in Project makes the child look searchable.
- Existing coverage misses this contract edge: the configured test uses
  `generated/**`, which independently matches each descendant. Fixed and hidden-directory cases
  also pass because their policy checks every directory segment, so neither case proves inheritance
  from an exact configured directory rule.
- Required correction: derive each Browse entry's marker from the same physical traversal policy,
  including excluded-ancestor inheritance and ordered `!` re-inclusion, without adding filesystem
  I/O, SQLite work, Renderer ancestor scans, or per-render path scans. Add a regression for an exact
  configured directory exclusion and its loaded child.

## Reviewed boundaries without additional findings

- `searchExcluded` is isolated to `OnlyPreviewBrowseEntry`; Global Search index records and
  directory-result preview entries retain exact marker-free contracts.
- Main and Renderer browse-listing validators require the exact boolean and force symlinks to
  `searchExcluded: false`; the synthetic root is explicitly neutral.
- Renderer projection builds its marker `Set` in the same listing-to-index pass, and visible-row
  projection performs only `Set.has()` checks. No Renderer filesystem, SQLite, or ancestor scan was
  introduced.
- Excluded row CSS covers base, hover, and selected pale-orange states; both open and closed
  directory icons use `#C2410C`, while file and symlink icons retain their existing treatment.
- Candidate-refresh failure restores the prior traversal policy before publishing a fresh root
  listing; the focused rollback regression passes.

## Verification

| Command / evidence | Result |
| --- | --- |
| Task-listed focused Node suites | **PASS, 39/39** |
| Independent exact-directory exclusion probe | **FAIL as expected:** directory `true`, child `false` |
| Source/contract inspection | Browse-only type/validator/projection/CSS boundaries otherwise match the design |
| Typechecks / build | Not rerun after the blocking functional reproduction |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**BLOCKED — the primary descendant-marker contract fails for an exact configured directory
exclusion.** The task is not deliverable until the hidden preload propagates the traversal-policy
result truthfully to loaded descendants and adds the missing regression.
