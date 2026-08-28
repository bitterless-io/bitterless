---
id: onlypreview-warm-search-before-reconcile-042
scope: Immediate reusable-snapshot Global Search during startup reconciliation
status: implemented; owner verification pending
depends-on: [onlypreview-search-startup-diagnostics-041]
verify: node --test tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewWarmSearchLifecycle.test.mjs tests/onlypreview/onlyPreviewWarmSearchScale.test.mjs tests/onlypreview/onlyPreviewSearchEngine.sqlite.test.mjs tests/onlypreview/onlyPreviewSearchEngine.recovery.test.mjs tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs tests/onlypreview/onlyPreviewSearchEngineWatchBoundary.test.mjs tests/onlypreview/onlyPreviewSelectedFileIndexPriority.test.mjs tests/onlypreview/onlyPreviewSearchEngineSqliteIndex.test.mjs tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs && yarn typecheck:node && yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false && yarn build && git diff --check
---

# Search the warm snapshot before startup reconcile completes

## Objective

Remove the 33-second first-search readiness stall on a reusable workspace index. Return the last
complete committed Files/Contents snapshot as soon as the query arrives, continue startup
reconciliation in the background, and terminal-replace the warm projection with a fresh consistent
snapshot after successful promotion. Preserve fail-closed first-build, cancellation, capability,
memory, and candidate-isolation guarantees.

## Evidence

The `[onlypreview-search]` live sample records about 5ms from Shell dispatch to hidden-runtime
acceptance, 1.203s for SQLite reuse/hydration, 9.07s for full count, 12.09s for candidate backup,
16.94s for traversal/reconcile, 0.714s for promotion, and 33.024s behind the initial-tree gate.
After that gate, Contents completes in 0.665s and Files in 0.817s. The query engine and UI are not
the bottleneck; the reusable active index is unnecessarily hidden until freshness work completes.

## Context

- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/issues/onlypreview-first-search-startup-delay.md`
- `docs/plan/analysis/onlypreview.md`

## Path

- `src/preload/onlypreview/search/core/constants.mjs`
- `src/preload/onlypreview/search/core/sqlite-schema.mjs`
- `src/preload/onlypreview/search/core/sqlite-index.mjs`
- `src/preload/onlypreview/search/core/filename-tier.mjs`
- `src/preload/onlypreview/search/core/search-engine.mjs`
- `src/preload/onlypreview/search/core/global-search-executor.mjs`
- `src/preload/onlypreview/search/core/watch-reconciler.mjs`
- `src/preload/onlypreview/search/core/search-memory.mjs`
- `src/preload/onlypreview/search/core/sqlite-search-scope.mjs`
- `src/preload/onlypreview/search/core/sqlite-snapshot-store.mjs`
- `src/preload/fileSearch/fileSearchCoordinator.ts`
- `tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs`
- `tests/onlypreview/onlyPreviewWarmSearchLifecycle.test.mjs`
- `tests/onlypreview/onlyPreviewWarmSearchScale.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.sqlite.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.recovery.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngineWatchBoundary.test.mjs`
- `tests/onlypreview/onlyPreviewSelectedFileIndexPriority.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngineSqliteIndex.test.mjs`
- `tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs`
- `tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs`
- `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`
- `docs/features/onlypreview.md`
- `docs/design/onlypreview-global-search.md`
- `docs/issues/onlypreview-first-search-startup-delay.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/INDEX.md`
- `docs/plan/README.md`

## Contract

- If initialization opened a reusable committed index, do not wait for startup count, candidate
  backup, traversal, reconcile, or promotion before searching it. Start Files and Contents together
  and stream their ordinary existing batches while the request remains pending.
- Keep the candidate private. After successful promotion, begin a new bounded result-token session,
  reacquire the fresh committed snapshot, rerun both sections, and return one authoritative terminal
  result that replaces every warm row/token. Offline add/delete/rename must therefore converge in
  the terminal projection. If startup candidate reconciliation fails while the reusable snapshot
  remains valid, terminalize from that warm snapshot successfully; the unrelated freshness failure
  must not clear or fail an otherwise valid search.
- Add a reader acquisition API that captures one consistent `{ index, treeEntries,
  maxDepthReached, searchPolicy, identity }` snapshot. It must recheck a writer/promotion gate before
  granting the lease. Promotion raises that gate first, waits for active readers, atomically
  swaps/closes the snapshot, and only then admits new readers. There is no
  priority-to-authoritative ownership gap and no query may combine old SQLite/tree metadata with a
  candidate policy or identity.
- Persist eligible non-file Global Search tree entries, maximum traversal depth, and a tree-ready
  build marker bound to the same committed SQLite build. Ordinary files continue to hydrate from
  the existing filename tier. Task 043 later permits provisional ancestors proven by committed file
  paths only while this certified tier is missing; empty directories and symlinks remain truthful.
- Upgrade a valid schema-7 database additively to schema 8. Preserve `files`, chunks, postings, FTS,
  and build identity. This task originally withheld folders/symlinks until the first successful
  reconcile; task 043 supersedes only that cold-upgrade behavior by permitting provisional non-empty
  directory ancestors derived from committed eligible file paths. Symlinks and empty directories
  still require the certified tree tier. The migration must discard any pre-existing `search_tree`
  rows and `tree_*` metadata even when a malformed or downgraded cache happens to contain them.
- A missing, mismatched, or invalid tree-ready marker fails closed to file/Contents-only warm
  results. It never invalidates an otherwise reusable content index and never publishes false empty
  folder authority. `tree_max_depth_reached` is part of that compound marker and accepts only the
  exact persisted values `0` or `1`.
- Every bounded watch mutation clears the tree-ready marker before changing active file/tree state
  and restores it only after the whole update commits. An interrupted mutation must force the next
  launch or watch event into the safe file/Contents-only warm path; a later bounded delta cannot
  recertify an incomplete tree. Full reconcile promotion publishes one matching file/tree build
  atomically. Bounded watch paths obey the same traversal-depth boundary as a full build, use one
  bounded lookup pass rather than one full-tree scan per path, and never use argument-spread merges
  whose safety depends on project size.
- If no reusable active index exists, retain the existing true-first-build behavior: selected-file
  priority and same-policy Current-directory early Contents may stream, while project-wide Files and
  terminal authority wait for the first complete candidate.
- Preserve one-active/one-latest cancellation, generation/workspace/host fences, 250-row section
  caps, folder-first Files ordering, exact-path deduplication, preview authority bounds, current
  directory scope, and Main's zero-search-filesystem-I/O boundary. Selected-file priority
  supersession must not revoke or fail an independently accepted Global Search request.
- Do not add another renderer, worker, traversal, SQLite connection, XPC request, Main-process I/O,
  per-entry diagnostics, query/path logging, or unbounded retained collection.
- A malformed schema-8 tree table must either be rebuilt safely or reject without retaining an open
  SQLite handle. Task-owned JavaScript/TypeScript modules stay within the repository's 800-line
  limit through cohesive helpers rather than mixed-responsibility growth.

## Verification

- Hold startup promotion and prove a reusable snapshot emits Files and Contents batches before the
  hold is released while the search promise remains pending.
- Release promotion and prove the terminal result replaces warm rows/tokens and reflects offline
  file add, delete, and rename changes. Old preview tokens must fail closed and fresh ones work.
- Persist and restore an empty directory, symlink, and maximum depth; prove a folder-only query can
  return before promotion on the launch after a complete schema-8 reconcile.
- Prove a missing/mismatched tree marker returns only ordinary-file/Contents warm results and never
  invents directories.
- Prove schema 7 upgrades in place without losing searchable file/FTS data; its first upgraded run
  takes the safe partial-warm path even when stale tree rows/markers exist, and a later launch
  restores complete warm folder results.
- Race reader acquisition against promotion and prove no closed-index access, mixed snapshot,
  candidate visibility, ownership gap, or deadlock. Cover cancellation, candidate failure,
  shutdown, supersession, and true first build.
- Interrupt a watch mutation after marker invalidation and prove the next open fails closed; prove a
  second bounded event in the same runtime forces full reconcile rather than recertifying stale
  rows; prove a successful mutation restores a matching ready marker. Cover the traversal depth
  boundary, a maximum bounded batch over a large tree, and at least 130,000 retained merge records.
- Delete or corrupt the maximum-depth marker and corrupt the schema-8 tree shape; prove both fail
  closed and repeated constructor failures release every SQLite handle. Supersede selected-file
  priority while an ordinary search is streaming and prove the ordinary search still terminals.
- In a non-Electron production-chain harness, hold initialize/search terminal pending and prove the
  early root Browse listing enables Shell dispatch and a warm batch is projected before reconcile.
- Run the listed focused tests, Node and directed Renderer type checks, build, and diff check. Do not
  run Electron, Playwright, E2E, packaged smoke, or the real application; Ral owns live verification.

## Owner Verification

- Fully quit Bitterless, reopen Preview on the same indexed large project, immediately search a
  known filename/body term, and confirm Files/Contents appear before the Index Rail completes.
- Leave the query open until reconciliation finishes and confirm results settle without clearing,
  duplicate rows, broken preview, or stale deleted/renamed entries.
- Restart once more after the schema-8 reconcile and search a folder-only term immediately; confirm
  folders also appear before reconciliation completes.
- Filter `main.log` by `scope=onlypreview-search` and confirm the first batch precedes
  `initial-tree`/promotion completion without any query, filename, directory, or path in the log.

## Delivery

- Reusable schema-8 startup now exposes the last complete committed file/content/tree snapshot as
  soon as the root Browse projection is ready. Files and Contents stream through the existing
  request while count, candidate backup, traversal, reconcile, and promotion continue in the
  background.
- Successful promotion starts a fresh result-token session, reacquires one matching
  SQLite/tree/policy/identity reader lease, reruns both sections, and terminal-replaces the warm
  projection. Candidate failure leaves the committed snapshot searchable; true first build remains
  fail closed.
- Schema 8 persists build-bound directory/symlink metadata and the exact maximum-depth marker.
  Schema-7 residue, missing/corrupt markers, interrupted bounded mutations, and malformed tree
  tables fail closed without losing a reusable content index or leaking SQLite handles.
- Reader/writer gates protect promotion, watch mutation, and shutdown. A maximum 512-path watch
  update over 130,000 retained tree rows preflights metadata once, retains at most ten 1MiB file
  bodies, and commits exactly 52 bounded file transactions before restoring tree readiness.
- The non-Electron production-chain regression proves root Browse listing -> Shell readiness ->
  Shell scheduler -> Main relay -> hidden runtime/coordinator -> warm batch -> Shell projection
  while both initialize and search terminals remain pending.
- Verification passed: 86 focused Node tests, Node typecheck, directed Renderer typecheck,
  production build, 23-file `<=800` line audit, package-name restoration, and `git diff --check`.
  [Independent review 2](../reviews/onlypreview-warm-search-before-reconcile-042-2.md) passed with no
  P1, P2, or P3 finding. Electron, Playwright, E2E, packaged smoke, and the real app were not run;
  Ral owns the remaining live large-project startup acceptance.
