---
id: onlypreview-layered-index-browse-009-2
status: pass
reviewed_task: onlypreview-layered-index-browse-009
target: working-tree-at-722971ff7b13e567532d4955eb415a329e7cd5b4
base: 722971ff7b13e567532d4955eb415a329e7cd5b4
date: 2026-08-10
review_type: independent-second-source-and-node-no-electron
---

# Verdict

**PASS — both prior P2 blocking findings are closed and no new blocking regression was found.**

Depth 20 now silently limits only search discovery, `truncated` is emitted only when the exact
100,000-entry prefix omits another visible in-scope entry, the accepted hidden-file default is
consistent, and the task Path includes the changed settings test.

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: the first review's Shell behavioral-test hardening remains applicable. The
  service tests execute real BFS/limit/depth/listing behavior, while renderer generation and
  projection guarantees are still primarily source-pattern guards. Static review found the current
  implementation correct, and this does not block this delivery.

# Prior Blocking Closure

## Depth-only cutoff is silent and no longer impersonates the 100,000-entry bound

`build()` now queues a directory only when its entry depth is below 20 and simply stops queueing at
the boundary. It has no boundary-directory scan and returns `truncated: false` after normal queue
exhaustion (`src/main/onlypreview/onlyPreviewIndex.service.ts:99-148`). The only
`truncated: true` return is immediately after `entries.length >=
ONLY_PREVIEW_MAX_INDEX_ENTRIES`, before another visible child would be appended
(`src/main/onlypreview/onlyPreviewIndex.service.ts:119-127`).

The real depth fixture now proves all three required facts: depth-21 search metadata is absent,
`truncated` remains false, and demand-loaded listings at depth 20 and 21 still return their complete
children (`tests/onlypreview/onlyPreviewCore.test.mjs:576-623`). The independent real 100,000-file
fixture still returns exactly 100,000 entries with `truncated: true` while a directory omitted from
that search prefix remains fully listable (`tests/onlypreview/onlyPreviewCore.test.mjs:527-574`).

This matches the task's no-depth-warning rule and the feature rule that only reaching the search
entry bound produces `INDEX PARTIAL` copy
(`docs/plan/tasks/onlypreview-layered-index-browse-009.md:42-62`;
`docs/features/onlypreview.md:237-258`).

## Hidden default and task scope metadata are consistent

The Settings Contract now declares the ordered defaults as `light`, `13`, `false`, `true`, and
`true`, matching the browse/search table and `DEFAULT_ONLY_PREVIEW_SETTINGS.showHiddenFiles`
(`docs/features/onlypreview.md:228-235,337-353`;
`src/shared/onlypreview/onlyPreview.contract.ts:26-32`). The settings test keeps a valid persisted
`showHiddenFiles: false`, so the new/default-profile change does not overwrite an existing valid
preference (`tests/onlypreview/onlyPreviewSettings.test.mjs:63-77`).

The task Path now explicitly includes `tests/onlypreview/onlyPreviewSettings.test.mjs`
(`docs/plan/tasks/onlypreview-layered-index-browse-009.md:22-38`).

# Regression Audit

- `listDirectory` remains independent of both search bounds and returns complete immediate children
  after host/workspace ownership, normalized-relative-path, directory type, symlink, realpath
  containment, fixed-exclusion, visibility, natural-sort, and permission checks.
- Search remains strict FIFO breadth-first across naturally ordered sibling listings. Root entries
  all precede level two; level two precedes level three. The entry cap remains exactly 100,000 and
  depth remains exactly 20.
- Shell still clears listing/load/expansion state for refresh, workspace replacement, and hidden
  policy changes; loads the root before selected ancestors and the background search index; rejects
  stale workspace/generation/listing identities; uses only loaded listings for empty-query browse
  rows and only the bounded index for non-empty search rows.
- Explicitly selected hidden files and their ancestors remain discoverable when a valid saved
  preference hides ordinary dotfiles. Fixed `.git`, dependency, cache, and build directories remain
  excluded, and symlinks remain non-recursed leaves.
- The exact XPC surface adds only content-host-scoped `listDirectory({ hostToken, workspaceId,
  relativePath })`. Standalone-only architecture, Preview bounds, recent-directory flow, native
  refresh, selection-count fencing, and read-only file authority are unchanged.

# Verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/*.test.mjs` | PASS — 60/60; real 100k and silent depth-20 cases included |
| `yarn typecheck:node` | PASS |
| `yarn check:renderer-i18n` | PASS |
| Focused error-level ESLint over all touched TS/Vue/MJS files | PASS |
| `git diff --check` | PASS |

No Electron, Playwright, full-app E2E, build, complete application, Keychain, branch, commit, or
push operation was run.

# Current Status

This second review wrote only
`docs/plan/reviews/onlypreview-layered-index-browse-009-2.md`. It did not modify source, tests,
configuration, task status, the first review, existing documentation, or Git state.

# Conclusion

**pass**
