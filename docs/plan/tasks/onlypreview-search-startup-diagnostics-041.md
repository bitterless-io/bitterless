---
id: onlypreview-search-startup-diagnostics-041
scope: Privacy-safe Preview startup, index, and Global Search latency diagnostics
status: implemented; owner verification pending
depends-on: [onlypreview-global-search-concurrency-directory-ux-040]
verify: node --test tests/onlypreview/onlyPreviewSearchDiagnostics.test.mjs tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs && yarn typecheck:node && yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false && yarn build && git diff --check
---

# Trace Preview startup through first visible search result

## Objective

Add a low-overhead, privacy-safe timing timeline from OnlyPreview window startup through hidden
file-search initialization, reusable-index assessment, count/candidate/reconcile/promotion, search
gates, first section results, terminal result, and Shell acceptance. Diagnose the existing first
search delay without changing readiness, indexing, search, result, or UI behavior.

## Context

- `docs/features/onlypreview.md`
- `docs/features/application-diagnostics.md`
- `docs/design/onlypreview-global-search.md`
- `docs/issues/onlypreview-first-search-startup-delay.md`
- `docs/plan/analysis/onlypreview.md`

## Path

- `src/main/fileSearch/`
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs`
- `src/shared/onlypreview/onlyPreviewSearchDiagnostics.d.ts`
- `src/preload/fileSearch/fileSearchRuntime.ts`
- `src/preload/fileSearch/fileSearchCoordinator.ts`
- `src/preload/onlypreview/search/core/search-engine.mjs`
- `src/preload/onlypreview/search/core/global-search-executor.mjs`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store.ts`
- `tests/onlypreview/onlyPreviewSearchDiagnostics.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`
- `tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs`
- `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`
- `docs/features/onlypreview.md`
- `docs/features/application-diagnostics.md`
- `docs/design/onlypreview-global-search.md`
- `docs/issues/onlypreview-first-search-startup-delay.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/INDEX.md`
- `docs/plan/README.md`

## Contract

- Reuse the existing application log and exact `[onlypreview-search]` scope. Emit one string per
  event so the existing sanitizer and renderer-console spy preserve useful fields.
- Inject monotonic clocks and diagnostic writers into core/coordinator code where needed. Logging
  failures are swallowed and never affect lifecycle or search outcomes.
- Record fixed lifecycle enums, booleans, bounded aggregate counts, generation/build revision,
  short local correlation tags, and non-negative elapsed milliseconds only.
- Distinguish SQLite open/hydration, reuse decision, root listing, full count, candidate backup,
  traversal, rebuild/reconcile, promotion wait/commit, initialization total, search acceptance,
  priority/build gates, Files/Contents completion, first section visibility, terminal response, XPC
  duration, and Shell first-batch/terminal acceptance.
- Do not record query/snippet/body text, file/directory names, relative/absolute paths, workspace or
  config identity, database path, exclude rules, capabilities/tokens, or raw errors/objects/stacks.
- Do not log inside per-entry/per-file/per-chunk/per-result loops. Do not add I/O, SQLite statements,
  traversals, payload fields, timers, persistent state, or behavior-changing thresholds.
- Preserve one-active/one-latest cancellation, reusable-index/candidate semantics, grouped result
  ordering/caps, XPC schemas, Shell state, and Main's zero-search-I/O boundary.

## Verification

- Pure diagnostics tests use fake time/writers to prove formatting, duration bounds, event order,
  fixed-field allowlists, once-only first Files/Contents events, and terminal cancellation/failure.
- Existing reusable-startup regression proves a search logs its initial-tree-metadata wait before
  the first authoritative result and completes only after the existing gate releases.
- Coordinator/Main/Shell tests prove dispatch, first batch, terminal, and failure timing without
  starting Electron.
- Source/privacy tests prove forbidden values are absent from diagnostics and tight traversal/result
  loops contain no log emission.
- Run the listed focused tests, node and directed Renderer type checks, build, and diff check. Do not
  run Electron, Playwright, E2E, packaged smoke, or the real application; Ral owns the live sample.

## Owner Verification

- Fully quit Bitterless, reopen Preview on the same large project, immediately search a known term,
  wait for the results, then search a second known term.
- In Settings -> Log, reveal `main.log` and filter records whose `scope` is
  `onlypreview-search`.
- Compare the first query's initial-tree-metadata gate with SQLite open, count, backup,
  reconcile/traversal, promotion, XPC, and Shell commit durations. Confirm the second query has no
  startup gate and reaches first/terminal results quickly.
- Confirm no query, result text, filename, directory, or absolute/relative path appears in those
  records.

## Delivery

- Added one allowlisted `[onlypreview-search]` diagnostic helper shared by Main, the hidden
  file-search Renderer, and the visible Shell. Logging failures are swallowed and event volume is
  fixed per lifecycle/search rather than corpus-sized.
- Added real phase timings for visible Preview creation, hidden runtime readiness, Shell load and
  initialization, SQLite reuse/open, root listing, full count, candidate backup,
  traversal/reconcile, promotion, search gates, first Files/Contents visibility, XPC, and Shell
  terminal acceptance.
- Source diagnosis: a reusable SQLite index is opened quickly, but startup clears non-persisted
  tree metadata and performs a full count plus candidate reconcile/promotion. The first grouped
  search waits at the initial-tree gate; later searches skip it. Ral's live sample determines which
  update phase dominates on the current project.
- Production regressions cover success, failure, cancellation, supersession, early Main failures,
  initial-tree ordering, forbidden-field exclusion, and absence of emits in corpus-scaled loops.
- Verification passed: 48 focused Node tests, Node typecheck, directed Renderer typecheck, build,
  and `git diff --check`. Electron, Playwright, E2E, packaged smoke, and the real app were not run.
- [Independent review 3](../reviews/onlypreview-search-startup-diagnostics-041-3.md) passed with no
  P1, P2, or P3 finding. Live timing acceptance remains with Ral.
