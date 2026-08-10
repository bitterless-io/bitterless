---
id: onlypreview-layered-index-browse-009
scope: Keep OnlyPreview directory browsing complete while indexing search metadata breadth-first
status: done
depends-on: [onlypreview-safe-markdown-selection-008]
---

> **Historical delivery record (2026-08-10, `0728afb`)**: the objective, implementation evidence,
> and reviews below are retained for the delivered Main-owned `listDirectory`/`buildIndex`,
> 100,000-entry, depth-20 snapshot. Tasks 012–016 later superseded that implementation with the
> UtilityProcess, persistent SQLite dual tiers, physical hidden/fixed/config pruning, and watch
> reconciliation. The current contract retains complete browsing independent of Project Search, but
> serves it from the UtilityProcess through opaque directory tokens; see
> [`docs/features/onlypreview.md`](../../features/onlypreview.md).

# Objective

Decouple OnlyPreview's visible directory tree from its bounded search metadata index. Load the root
and each expanded directory completely on demand, while building a larger search index in strict
breadth-first level order so a partial index may omit search hits but never hides browsable files or
directories.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-safe-markdown-selection-008.md`

# Path

- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/main/onlypreview/onlyPreviewIndex.service.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.type.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/shell/src/App.vue`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/onlyPreviewSettings.test.mjs`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-layered-index-browse-009.md`

# Implementation Constraints

1. Add a capability-scoped `listDirectory` API that accepts only `{ hostToken, workspaceId,
   relativePath }`. An empty relative path means the workspace root. Main must revalidate host,
   workspace, directory type, realpath containment, symlink policy, and permissions on every call.
   Return every visible immediate child in directories-first natural order; do not apply the global
   search-index entry or depth bound to a directory listing. Browsing is demand-driven, so a user
   may keep expanding depth-20 and deeper directories; each requested immediate-child listing stays
   complete and no search-depth warning or rejection is shown.
2. Load the complete root listing before the background search index. With an empty search query,
   render only demand-loaded directory listings. Expanding a directory loads that directory once,
   then reveals all its files and subdirectories. Search-index truncation must never remove loaded
   browse rows. Refresh and workspace/settings changes clear listing state, reload the root, and
   fence stale directory/index results by workspace plus generation.
3. Increase the search-index bound from 20,000 to exactly 100,000 entries. Traverse visible metadata
   in strict breadth-first order across the workspace: all level-one entries before any level-two
   entry, then level two before level three. Enforce the exact depth-20 cap, fixed excluded directories,
   symlink-leaf rule, natural sibling order, async yielding, explicit hidden-selection behavior,
   typed errors, and host/workspace containment.
4. When search is non-empty, filter only the bounded search-index projection by filename/relative
   path. It is acceptable for a truncated search index to miss deeper matches. Change the partial
   copy so it states that search covers the first 100,000 breadth-first items while folder browsing
   remains complete; do not tell users to narrow the folder to recover browse rows.
5. Change the missing/invalid-setting default for `showHiddenFiles` from `false` to `true`, while
   preserving any existing valid saved preference. Ordinary hidden files/directories then appear
   in new/default profiles. Keep `.git`, dependency directories, and build outputs in the fixed
   exclusion set.
6. Preserve standalone-only architecture, selected-file reveal (including an explicitly opened
   hidden file), current preview behavior, read-only security, MenuBar/status geometry, settings,
   recent-directory restore, selection-count revision fencing, and native refresh behavior. Add no
   dependency and do not run Electron/Playwright/full-app E2E in this delivery.

# Verification

- Pure Node tests prove a complete root listing contains both root files and root directories even
  when another branch exhausts the search-index limit; expanding/listing a directory remains
  complete independently of the search prefix.
- Pure Node tests prove exact breadth-first search ordering across at least three levels, the exact
   100,000 bound and partial flag, directories-first natural sibling order, hidden-default behavior,
   fixed exclusions, symlink non-recursion, exact depth-20 search bound with deeper demand-loaded
   browsing, containment, and permission errors.
- Source/integration guards prove the exact new API, host/workspace-only parameters, root-before-
  index startup, demand-loaded expansion, stale result fencing, browse/search projection separation,
  refreshed root/listing state, selected-file reveal, updated i18n, and unchanged Preview bounds.
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn check:renderer-i18n`
- focused error-level ESLint over touched TS/Vue/MJS files
- `git diff --check`
- Do not run Electron, Playwright, full-app E2E, or the complete application.

# Delivery Evidence

- Implemented on 2026-08-10. `listDirectory` now returns a complete authorized immediate-child
  listing independently of the search projection; Shell loads the root first and demand-loads each
  expanded directory with workspace/generation stale-result fencing.
- Search metadata now traverses strict breadth-first order, returns at most 100,000 entries, and
  silently stops after depth 20. Deeper directories remain fully browsable. `INDEX PARTIAL` is
  reserved for the actual 100,000-entry bound, and its localized copy states that browsing remains
  complete.
- Ordinary hidden items are enabled for missing/invalid settings while a valid saved preference
  remains authoritative. Fixed `.git`, dependency, cache, and build-output exclusions remain.
- Final independent review passed after closing the initial depth-warning and stale-default
  documentation findings. `node --test tests/onlypreview/*.test.mjs` passed 60/60, including real
  100,000-entry, breadth-first, depth-20, deep-browse, containment, and permission cases.
- `yarn typecheck:node`, `yarn check:renderer-i18n`, focused error-level ESLint, and
  `git diff --check` passed. `yarn typecheck:web` remains blocked only by unrelated repository
  baseline diagnostics and reported no OnlyPreview diagnostic.
- Electron, Playwright, full-app E2E, build, and the complete application were not run by task
  contract. Ral should refresh/reopen OnlyPreview and verify overmind root files, ordinary hidden
  directories, deep expansion, and a partial search-index workspace at runtime.

# Review

- [Round 1 — blocked by depth-only partial copy and stale hidden default](../reviews/onlypreview-layered-index-browse-009-1.md)
- [Round 2 — pass](../reviews/onlypreview-layered-index-browse-009-2.md)
