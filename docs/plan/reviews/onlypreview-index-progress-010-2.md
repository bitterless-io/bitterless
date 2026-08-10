---
id: onlypreview-index-progress-010-2
status: pass
reviewed_task: onlypreview-index-progress-010
target: working-tree-at-722971ff7b13e567532d4955eb415a329e7cd5b4
base: 722971ff7b13e567532d4955eb415a329e7cd5b4
date: 2026-08-10
review_type: independent-second-source-and-node-no-electron
---

> **Historical review snapshot:** this review's findings, source locations, checks, and verdict are
> preserved against working tree `722971f`. Its Main-owned browse/build architecture was later
> superseded by tasks 012–016. Current behavior uses UtilityProcess-owned opaque-token directory
> browsing, persistent SQLite dual tiers, hard-pruned Project Search, watch reconciliation, and the
> retained 2px no-copy progress rail; see
> [the accepted feature contract](../../features/onlypreview.md).

# Verdict

**PASS — the prior P2 is closed, the task Path is complete, and no new blocking regression was
found.**

The active Index Rail is now bottom-anchored for populated trees and zero-row builds without
creating idle height. The new source regression guards the zero-row branch, and the revision
validator is now declared in the task Path. The counted BFS, exact progress event, renderer fencing,
cleanup, browse isolation, no-copy UI, status geometry, and security contracts remain intact.

# Findings

- P0 blocking: none.
- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: Shell event lifecycle evidence remains source-pattern based. The service tests
  execute real indexing behavior, but malformed/stale/reordered events and
  failure/completion/workspace/settings transitions are not driven through a bundled Shell store
  harness (`tests/onlypreview/onlyPreviewCore.test.mjs:1258-1371`). Static review finds the current
  implementation correct; this remains future hardening rather than a delivery blocker.

# Prior Blocking Closure

## The rail is now bottom-anchored in every Project content state

The Project pane remains a column flex container
(`src/renderer/onlypreview/shell/src/App.less:187-194`). The progress rail now has
`margin-top: auto` in addition to its fixed 2px basis (`App.less:404-411`). This produces the required
layout in all relevant states:

- **tree:** the scrollable tree consumes the flexible body height and the following rail remains at
  the bottom (`App.less:271-277`; `App.vue:156-222`);
- **empty workspace:** the empty body consumes the flexible height, while workspace cleanup leaves
  progress null (`App.less:358-369`;
  `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:548-572`);
- **settled empty/no-results:** the no-results body consumes the flexible height, and the matching
  request has already removed the rail (`App.vue:224-260`; `onlyPreviewShell.store.ts:670-678`);
- **active zero-row:** neither tree nor no-results body is rendered because `indexLoading` is true,
  so the auto top margin absorbs the remaining Project height and anchors the 2px rail to the bottom;
- **idle:** the `v-if="onlyPreviewShellStore.indexProgress"` removes the rail node entirely, so its
  basis and auto margin reserve no space (`App.vue:236-260`).

The regression assertion now requires the 2px fixed basis and `margin-top: auto`, explicitly names
the zero-row bottom-placement purpose, and verifies the active empty/search-no-result branch that
suppresses the no-results body (`tests/onlypreview/onlyPreviewCore.test.mjs:1342-1359`). That closes
the layout gap identified in review 1 without changing Preview or status-rail geometry.

## The task Path now declares the validator

`src/shared/onlypreview/onlyPreview.contract.ts` is present in the 010 Path
(`docs/plan/tasks/onlypreview-index-progress-010.md:37-52`), matching the new non-empty/128-character
revision parser and its real invalid-value test
(`src/shared/onlypreview/onlyPreview.contract.ts:51-56`;
`tests/onlypreview/onlyPreviewCore.test.mjs:72-80`).

# Full Contract Regression Audit

- Main still emits `counting`, performs a non-collecting pass, emits `indexing 0/total`, then performs
  the collecting pass with the counted bound. The common FIFO traversal applies the same hidden,
  fixed-exclusion, non-recursed-symlink, realpath-containment, depth-20, natural-sort, and 100,000
  rules to both passes. Progress is emitted only at 256-entry boundaries plus the final count and is
  bounded by `total` (`src/main/onlypreview/onlyPreviewIndex.service.ts:109-270`).
- Real fixtures still prove strict BFS, filesystem shrinkage between passes, monotonic `0/256/final`
  progress, `0/0`, exactly 100,000 generated entries with real truncation, silent depth-20 cutoff,
  hidden/exclusion/symlink behavior, and complete browsing beyond the search entry/depth bounds
  (`tests/onlypreview/onlyPreviewCore.test.mjs:446-710`). `listDirectory` remains a one-directory
  operation with no global search limit.
- The shared event remains the exact three-key/five-key union with no path, filename, content,
  settings, or absolute metadata. Main requires a content host, validates the opaque revision, and
  broadcasts the host ID and that revision with only the internal progress union
  (`src/shared/onlypreview/onlyPreview.types.ts:128-140`;
  `src/main/xpc/onlyPreview.handler.ts:112-129`).
- Shell runtime validation still rejects extra/malformed payloads, unsafe or out-of-bound numbers,
  foreign hosts/revisions, changed totals, decreasing completion, and counting after indexing. A
  new projection assigns a new revision and clears old progress before its first await; matching
  generation/revision guards clear success/failure while stale requests cannot clear or revive a
  newer rail (`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:75-99,501-527,623-679`).
- Counting remains an indeterminate Royal Blue sweep; generation remains a clamped determinate fill.
  Reduced-motion disables both animation and fill transition. The rail contains no visible text,
  number, phase, percentage, warning, explanation, or icon, and the renderer no longer contains the
  old partial/ready/truncated status copy (`src/renderer/onlypreview/shell/src/App.vue:236-260,341-345`;
  `src/renderer/onlypreview/shell/src/App.less:404-438,504-517`).
- The fixed 25px status rail still contains only the selected-character/type/size metadata and keeps
  its right-aligned geometry. Preview bounds code is unchanged, empty-query browsing still projects
  only demand-loaded listings, and non-empty search still projects only the bounded index
  (`src/renderer/onlypreview/shell/src/App.vue:288-303`;
  `src/renderer/onlypreview/shell/src/App.less:470-501`;
  `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:144-216`).

# Scope Audit

The closure changes are limited to the declared Shell Less file, core source test, and task Path
metadata. The working tree remains cumulative with task 009; no dependency, watcher, write path,
absolute renderer authority, browse limit, full-text indexing, or unrelated application behavior
was introduced.

# Verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/*.test.mjs` | PASS — 63/63; fresh second-round run |
| `yarn typecheck:node` | PASS — fresh second-round run |
| `yarn check:renderer-i18n` | PASS — `[check-renderer-i18n] ok`; fresh second-round run |
| Focused `yarn eslint --no-cache --quiet` over all touched TS/Vue/MJS files | PASS — fresh second-round run |
| `git diff --check` | PASS before and after review creation |

No Electron, Playwright, full-app E2E, build, complete application, branch, commit, or push operation
was run.

# Current Status

This second review wrote only `docs/plan/reviews/onlypreview-index-progress-010-2.md`. It did not
modify source, tests, configuration, task status, accepted feature/analysis documents, the first
review, or Git state.

# Conclusion

**pass**
