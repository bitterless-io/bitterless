---
id: onlypreview-selected-file-index-priority-034
scope: Project Search indexing priority for the manually opened file
status: implemented; owner verification pending
depends-on: [onlypreview-search-during-index-017]
verify: node --test tests/onlypreview/onlyPreviewSelectedFileIndexPriority.test.mjs tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs && yarn typecheck:node && yarn build && git diff --check
---

# Prioritize the manually opened file during indexing

## Objective

When a user opens file A while the current workspace index is still building or reconciling,
validate and index A through a single-file priority lane so a matching Project Search can publish A
without waiting for the whole candidate build. Keep the complete candidate isolated and let the
normal active index take over after atomic promotion.

## Context

- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `areas/agent-runtime/preview-roadmap/baseline.md`

## Path

- `src/shared/onlypreview/onlyPreviewSearch.type.ts`
- `src/shared/onlypreview/onlyPreviewSearch.contract.ts`
- `src/shared/onlypreview/fileSearchRuntime.types.ts`
- `src/main/xpc/onlyPreviewSearchRuntime.handler.ts`
- `src/main/fileSearch/fileSearchRuntimeRelay.service.ts`
- `src/preload/fileSearch/fileSearch.preload.ts`
- `src/preload/fileSearch/fileSearchRuntime.ts`
- `src/preload/fileSearch/fileSearchCoordinator.ts`
- `src/preload/onlypreview/search/core/search-engine.mjs`
- `src/preload/onlypreview/search/core/search-scope.mjs`
- `src/preload/onlypreview/search/core/selected-file-priority-lane.mjs`
- `src/preload/onlypreview/search/core/traversal.mjs`
- `src/preload/onlypreview/search/core/watch-reconciler.mjs`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewSelectedFilePriority.service.ts`
- `tests/onlypreview/onlyPreviewSelectedFileIndexPriority.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs`
- `tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs`
- `tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `areas/agent-runtime/preview-roadmap/baseline.md`

## Contract

- A successful manual file activation sends an exact host/workspace/generation/relative-path
  priority request to the hidden `fileSearch` preload. Main only validates and relays; it performs
  no file or index I/O.
- The priority lane exists only while the current generation is `building` or `reconciling`. It
  retains at most the latest requested file, so rapid file switching cannot accumulate file bodies
  or create unbounded parallel work.
- The hidden preload applies the same relative-path, containment, symlink, exclusion, extension,
  size, tolerant-decode, opened-identity, and post-read validation used by ordinary Project Search.
  Excluded, missing, changed, non-regular, stale-generation, or already-ready inputs produce no
  priority row and cannot weaken the main index policy.
- A newer manual selection supersedes an older priority read. Late A results cannot replace B.
  Workspace replacement, refresh/build generation replacement, promotion, failure, and shutdown
  revoke the priority lane and release its bounded in-memory SQLite state.
- Search may publish a verified match from the single-file priority lane while the request remains
  pending. `In Directory` still returns only after its complete same-policy scope scan; first-build
  `In Project` still returns only after candidate promotion. The terminal response always contains
  the complete authoritative result set, and the Shell replaces any early batch projection with
  that response.
- The candidate database remains private. Search never reads partially written candidate rows;
  the priority lane is a separate, complete one-file index and is deduplicated by exact relative
  path when the authoritative result arrives.
- Selection/preview must not wait for priority indexing. Priority failure is non-fatal to opening A
  and is not surfaced as a Preview error.

## Verification

- Focused tests prove strict request parsing/relay, stale generation rejection, exclusion parity,
  latest-selection wins, bounded one-file retention, early batch visibility, complete terminal
  results, promotion cleanup, and no candidate-row visibility.
- Run `yarn typecheck:node`, debug `yarn build`, and `git diff --check`.
- Do not launch Electron, Playwright/E2E, the real application, or packaged smoke. Ral owns final
  runtime acceptance on a fresh large directory.

## Owner Verification

- Open a fresh large project and, while the bottom index rail is active, open a late-sorting text
  file whose body contains a unique token.
- Immediately search that token in `In Project`; confirm the opened file appears while the request
  remains pending and the final complete result remains correct after the rail settles.
- Rapidly open A then B during indexing; confirm only B receives priority and the application stays
  responsive with bounded memory.

## Delivery

- Added an exact relative-path `prioritizeFile` route from a successful current Shell selection
  through Main's capability relay to the hidden `fileSearch` preload; selection and Preview never
  await the work.
- Added a latest-only, complete one-file in-memory SQLite lane that reuses normal exclusion, depth,
  size, classification, containment, identity, generation, and cancellation guards. Candidate rows
  remain private; early batches deduplicate against the complete authoritative terminal response.
- Isolated priority failures from subsequent search barriers and covered A→B late completion,
  over-depth no-I/O admission, promotion/failure/shutdown cleanup, active-index authority, and
  request-shape boundaries.
- Split priority, search-scope, Shell dispatch, and watch reconciliation responsibilities so
  `search-engine.mjs` is 706 lines and `onlyPreviewShell.store.ts` is 799 lines.
- [Independent review 3](../reviews/onlypreview-selected-file-index-priority-034-3.md): PASS after
  review rounds 1–2 found and closed two P1 correctness failures plus the TS-1 blocker.
- Verification: focused task tests 26/26, broader priority/watch/boundary/recovery/traversal tests
  53/53 during remediation, `yarn typecheck:node`, debug `yarn build`, and `git diff --check`
  passed. Electron/Playwright/E2E/real-app verification was not run; Ral owns the checklist above.
