---
id: onlypreview-index-progress-010
scope: Count OnlyPreview search-index work and show one temporary Project-bottom progress rail
status: done
depends-on: [onlypreview-layered-index-browse-009]
---

> **Historical delivery record (2026-08-10, `0728afb`)**: the objective, implementation evidence,
> and reviews below are retained for the delivered Main-owned counted BFS snapshot. Tasks 012–016
> later superseded its Main `buildIndex` event path. The current product still uses the same 2px,
> Project-bottom, no-visible-copy rail, now driven by fenced UtilityProcess
> `onlypreview/search-progress` events; see
> [`docs/features/onlypreview.md`](../../features/onlypreview.md).

# Objective

Count the bounded breadth-first search-index workload before generation, then show only a minimal
progress rail at the bottom of the Project directory pane while indexing. The rail is indeterminate
during counting, determinate during generation, and completely absent after the current build
settles. Remove every visible index status, count, percentage, partial warning, and explanatory
sentence.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-layered-index-browse-009.md`

# Layout

```text
┌──────────── Project directory pane ────────────┐
│ PROJECT                                     ⊕  │
│ Search files…                                  │
│ ▾ src                                          │
│   ▾ components                                 │
│       FileTree.vue                             │
│                                                │
│ ━━━━━━━ counting sweep / generated ratio       │  visible only while current build runs
└────────────────────────────────────────────────┘
```

# Path

- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/main/onlypreview/onlyPreviewIndex.service.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-index-progress-010.md`

# Implementation Constraints

1. Make `buildIndex` accept one Shell-generated opaque `indexRevision` in addition to the existing
   host/workspace capability. Validate it as a non-empty string no longer than 128 characters. Add
   one `onlypreview/indexProgress` event with an exact host/revision-scoped discriminated payload:
   `{ hostId, indexRevision, phase: 'counting' }` or `{ hostId, indexRevision, phase: 'indexing',
   completed, total }`. Carry no paths, filenames, content, settings, or absolute metadata.
2. Before generating search entries, perform a real breadth-first counting pass under the same
   hidden/exclusion/symlink/depth-20/100,000 rules. Stop after proving the 100,000 cap and use the
   exact bounded count as generation `total`. Then run the real generation pass. Preserve complete
   demand-loaded directory browsing and all host/workspace/realpath security checks.
3. Emit `counting` before the count pass. Emit `indexing` at `0 / total`, at bounded intervals no
   more often than every 256 generated entries, and once with the final completed count. Progress
   must be monotonic and bounded (`0 <= completed <= total <= 100000`). Filesystem changes between
   passes may make generation settle before the counted snapshot; the Shell clamps the visual ratio
   and hides the rail when the matching request settles rather than inventing rows or leaving a
   stuck progress state.
4. Shell accepts only exact progress events for its current host and current `indexRevision`.
   Workspace replacement, refresh, settings rebuild, failure, or a newer generation supersedes and
   clears the old state. A stale counting/indexing event cannot restore a completed or replaced rail.
5. Place a 2px BEM-named progress rail at the bottom of the Project pane, outside the scrolling tree.
   Counting uses one indeterminate Royal Blue sweep; indexing uses a determinate Royal Blue fill.
   It reserves no height when idle, has a non-visible localized accessible label, shows no visible
   word, phase, percentage, item total, warning, icon, or explanation, and respects
   `prefers-reduced-motion`.
6. Remove the visible truncated paragraph and every index-state element from the 25px status rail.
   Keep the status rail itself and its selected-character/type/size metadata unchanged because Main
   Preview bounds depend on its geometry. Keep errors actionable in the existing inline error
   surface; an error clears the progress rail.
7. Preserve the exact 100,000 search bound, depth-20 search cutoff, unlimited demand-loaded browse,
   hidden default/persisted preference, natural order, selected-file reveal, refresh fencing,
   read-only behavior, and standalone Preview geometry. Add no dependency and do not run Electron,
   Playwright, E2E, or the complete application.

# Verification

- Real service tests prove two breadth-first passes, exact bounded totals, monotonic throttled build
  events, empty/small/100,000/truncated cases, depth-20 cutoff, and unchanged listing independence.
- Contract/source tests prove the exact event union and build revision, host/current-revision event
  filtering, stale replacement/failure/completion clearing, count-before-build order, and no path or
  content fields.
- UI/source tests prove the Project-bottom 2px rail, indeterminate/determinate states,
  reduced-motion handling, zero visible index copy/statistics, removed truncated paragraph, removed
  status-rail index state, and unchanged file metadata/status height/Preview bounds.
- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn check:renderer-i18n`
- focused error-level ESLint over touched TS/Vue/MJS files
- `git diff --check`
- Do not run Electron, Playwright, full-app E2E, or the complete application.

# Delivery Evidence

- Implemented on 2026-08-10. Main now performs one bounded breadth-first counting pass before the
  matching generation pass and emits only host/revision-scoped `counting` or bounded `indexing`
  progress payloads. Both passes share hidden, exclusion, symlink, containment, depth-20, natural
  order, and 100,000-entry rules; demand-loaded directory browsing remains independent.
- Shell assigns each build an opaque revision, rejects malformed, foreign, stale, reordered, or
  changed-total events, and clears the current rail on replacement, workspace removal, success, or
  failure. Events expose no path, filename, content, setting, or absolute metadata.
- The Project pane renders only a temporary 2px Royal Blue rail: indeterminate while counting,
  determinate while generating, bottom-anchored even with zero visible rows, absent when idle, and
  motion-reduced when requested. Visible index status, phase, count, percentage, partial warning,
  icon, and explanation were removed; the fixed 25px selected-file metadata rail remains.
- Independent review passed after closing the initial empty-active-projection bottom-placement
  finding. `node --test tests/onlypreview/*.test.mjs` passed 63/63, including real empty, changing
  filesystem, 100,000-entry, depth-20, deep-browse, progress-order, containment, and permission
  cases.
- `yarn typecheck:node`, `yarn check:renderer-i18n`, focused error-level ESLint, and
  `git diff --check` passed. `yarn typecheck:web` remains blocked only by unrelated repository
  baseline diagnostics and reported no OnlyPreview diagnostic.
- Electron, Playwright, full-app E2E, build, and the complete application were not run by task
  contract. Main must be restarted before runtime verification of the new event and index service.

# Review

- [Round 1 — blocked by empty active projection rail placement](../reviews/onlypreview-index-progress-010-1.md)
- [Round 2 — pass](../reviews/onlypreview-index-progress-010-2.md)
