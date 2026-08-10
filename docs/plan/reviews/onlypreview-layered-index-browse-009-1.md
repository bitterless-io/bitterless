---
id: onlypreview-layered-index-browse-009-1
status: blocked
reviewed_task: onlypreview-layered-index-browse-009
target: working-tree-at-722971ff7b13e567532d4955eb415a329e7cd5b4
base: 722971ff7b13e567532d4955eb415a329e7cd5b4
date: 2026-08-10
review_type: independent-source-and-node-no-electron
---

# Verdict

**BLOCKED — two P2 findings conflict with the accepted depth and hidden-default contracts.**

The implementation otherwise establishes a capability-scoped complete directory-listing path,
loads the root before indexing, keeps empty-query browsing independent from the bounded search
projection, traverses search metadata breadth-first with an exact 100,000-entry cap, and fences
workspace/listing/index generations. The focused Node suite, node typecheck, renderer-i18n check,
ESLint, and diff check pass.

# Findings

## P2 blocking — depth-only search cutoff incorrectly produces a visible 100,000-item warning

The indexer records every depth-20 directory in `depthBoundaryDirectories`, reads those directories
after the BFS completes, and sets `truncated: true` if any visible child exists
(`src/main/onlypreview/onlyPreviewIndex.service.ts:109,131-137,146-162`). The Shell renders every
`truncated` index as `INDEX PARTIAL` plus “Search covers the first 100000 breadth-first items”
(`src/renderer/onlypreview/shell/src/App.vue:236-242,329-332,337-344`;
`src/renderer/onlypreview/common/onlyPreviewI18n.ts:31-40,135-143`).

That is wrong for a small depth-only fixture: the real test builds only a 21-level chain, omits the
depth-21 item correctly, but deliberately asserts `index.truncated === true`
(`tests/onlypreview/onlyPreviewCore.test.mjs:576-618`). The resulting user message claims the
100,000-entry bound was reached when it was not, and exposes exactly the search-depth warning the
task forbids. The contract says depth-20 and deeper directory browsing stays complete with **no
search-depth warning or rejection**, while `truncated: true` and the partial copy are specified only
when the search entry bound is reached (`docs/plan/tasks/onlypreview-layered-index-browse-009.md:41-61`;
`docs/features/onlypreview.md:237-258`).

Required closure: stop search recursion after entry depth 20 without scanning boundary directories
or setting `truncated`; reserve `truncated: true` for an actual omitted visible entry after the exact
100,000-entry prefix. Change the real depth test to assert that depth-21 content is absent,
depth-20+ browsing remains complete, and the depth-only index is not partial.

## P2 blocking — the accepted feature document still declares the old hidden-file default

The browse/search table correctly says hidden items are included by default, and code plus storage
tests correctly use `showHiddenFiles: true` while preserving a valid saved `false`
(`docs/features/onlypreview.md:228-235`;
`src/shared/onlypreview/onlyPreview.contract.ts:26-32`;
`tests/onlypreview/onlyPreviewSettings.test.mjs:63-77`). However, the Settings Contract still says
the ordered defaults are `light`, `13`, `false`, `false`, and `true`, which declares
`showHiddenFiles: false` (`docs/features/onlypreview.md:337-353`). This directly contradicts the
same accepted document and task constraint 5, so the source of truth is internally inconsistent.

Required closure: change the ordered defaults to `light`, `13`, `false`, `true`, and `true`; retain
the existing statement that valid saved settings remain authoritative.

## P3 non-blocking — Shell race/projection verification is source-pattern evidence only

The service-level BFS, limit, depth, containment, and permission tests execute real implementations.
In contrast, root-before-index ordering, stale listing/index suppression, browse/search separation,
refresh clearing, and selected-ancestor loading are asserted by slicing source text and matching
regular expressions (`tests/onlypreview/onlyPreviewCore.test.mjs:1045-1169,1226-1237`). The changed
Playwright spec exercises demand loading, but this task correctly forbids running it. The current
implementation's generation checks survive static audit, so this is not a delivery blocker by
itself; a future lightweight bundled-store harness would make these race guarantees behavioral
rather than syntactic.

- P1 blocking: none.
- P2 blocking: the two findings above.
- P3 non-blocking: the Shell behavioral-test hardening above.

# Contract Assessment

- `listDirectory` has the exact shared XPC parameter surface `{ hostToken, workspaceId,
  relativePath }`. Main derives hidden policy internally; `requireWorkspace` enforces a live content
  host and ownership before access. Empty path normalization, non-symlink directory checks,
  realpath containment, fixed exclusions, natural directories-first sorting, and permission mapping
  are present (`src/shared/onlypreview/onlyPreview.types.ts:75-79,150-163`;
  `src/main/xpc/onlyPreview.handler.ts:96-119`;
  `src/main/onlypreview/onlyPreviewIndex.service.ts:79-97,174-256`).
- Demand-loaded listings do not reference the 100,000-entry or depth constants. A real 100,000-file
  fixture proves a saturated search prefix does not remove root rows or a separately requested
  directory's children. A real depth-21 fixture proves listing continues past depth 20.
- Search traversal is FIFO over naturally ordered directory listings, so every level-one entry is
  emitted before level two and every level-two entry before level three. The real three-level test
  verifies the exact order; the real large fixture verifies exactly 100,000 returned entries and an
  actual bound-triggered partial result.
- Shell clears listing/load/expansion state per projection generation, loads root before selected
  ancestors and `buildIndex`, rejects workspace/generation/listing-identity mismatches, uses only
  listings for empty-query rows, and only the bounded index for search rows
  (`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:109-176,480-683`). Refresh,
  workspace replacement, hidden-setting change, and selected-file ancestor recovery follow that
  same projection path.
- The default hidden policy is `true`; the strict full-object settings parser continues accepting a
  valid persisted `false`. `.git`, dependency, cache, and build directories remain excluded, and
  symlinks remain non-recursed leaves.
- The OnlyPreview handler's exact renderer allowlist gains only `listDirectory`; settings hosts are
  rejected by content-workspace ownership. Preview bounds and standalone-only paths are unchanged.

# Scope Audit

The working-tree delivery is based on `722971ff7b13e567532d4955eb415a329e7cd5b4` and changes the
declared shared/Main/Shell/i18n/test/docs paths. It also changes
`tests/onlypreview/onlyPreviewSettings.test.mjs`, which is necessary proof for constraint 5 but is
missing from the task's Path list (`docs/plan/tasks/onlypreview-layered-index-browse-009.md:22-37`).
That task-metadata omission is non-blocking and should be corrected during the fix.

# Verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/*.test.mjs` | PASS — 60/60; includes real 100k/BFS/depth/listing/settings/containment/permission cases |
| `yarn typecheck:node` | PASS |
| `yarn check:renderer-i18n` | PASS |
| Focused error-level ESLint over all touched TS/Vue/MJS files | PASS |
| `git diff --check` | PASS |
| `yarn typecheck:web` | Existing unrelated baseline failures; no OnlyPreview diagnostic |

No Electron, Playwright, full-app E2E, build, complete application, or Keychain path was run.

# Current Status

This review wrote only
`docs/plan/reviews/onlypreview-layered-index-browse-009-1.md`. It did not modify source, tests,
configuration, task status, existing documentation, or Git state, and it did not commit, push, or
switch branches.

# Conclusion

**blocked**
