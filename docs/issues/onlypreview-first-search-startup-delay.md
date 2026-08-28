# OnlyPreview first search waits for startup reconciliation

Status: implemented; owner verification pending

## Symptom

Immediately after starting Preview, Global Search accepts a query but shows no result for a
noticeable interval. Results then appear together, and later searches are fast.

## Source Diagnosis

The blocking mechanism is already identifiable from source:

```text
Preview startup
  -> open reusable SQLite + hydrate filename tier
  -> clear generation-local tree metadata
  -> count the full workspace
  -> back up SQLite to a candidate
  -> traverse/reconcile the full workspace
  -> promote candidate + restore tree metadata

first Global Search during that interval
  -> request accepted
  -> waits for initial tree metadata / active build
  -> Files + Contents authoritative branches start
  -> first batch and terminal result appear
```

Even when the persisted SQLite index is reusable, initialization starts a complete freshness
reconcile and sets `treeMetadataReady=false`. Grouped Global Search needs non-persisted directory
metadata for Files, so its initial-tree-metadata gate waits for the whole candidate build and
promotion. Later searches bypass that gate and use ready in-memory metadata plus the open SQLite
index.

This establishes that the user-visible wait is a startup reconciliation/readiness gate rather than
an intrinsically slow warm query. Ral's captured startup sample confirms it: Shell dispatch reached
the hidden runtime in about 5ms, reusable SQLite open/hydration took 1.203s, full counting took
9.07s, candidate backup took 12.09s, traversal/reconcile took 16.94s, promotion took 0.714s, and the
query spent 33.024s behind the initial-tree gate. Once released, Contents completed in 0.665s and
Files in 0.817s. The root cause is therefore the freshness gate, not XPC, Renderer commit, or search
execution.

## Accepted Optimization

- Treat the last committed index as an immutable readable snapshot while startup builds and checks
  a separate candidate: stale-while-revalidate, not search-after-revalidate.
- With a reusable snapshot, run Files and Contents together immediately and publish early batches.
  Keep the same request pending; after candidate promotion, rerun against the fresh authoritative
  snapshot and terminal-replace rows and result tokens.
- Persist committed directory/symlink metadata and maximum traversal depth beside the SQLite
  content build so subsequent launches can return complete folder results before reconciliation.
  A legacy schema-7 index upgrades additively: it preserves files, chunks, and FTS. Task 043 also
  derives provisional non-empty folder ancestors from those committed file paths immediately;
  certified empty-directory/symlink coverage still arrives after one successful reconcile.
- Acquire each query through a reader lease that captures one consistent index/tree pair. Promotion
  closes the writer gate, waits for active readers, atomically swaps snapshots, then permits the
  fresh terminal rerun; candidate rows are never searchable.
- Invalidate the persisted-tree ready marker before any watch mutation and restore it only after a
  successful bounded commit. Missing/mismatched markers fail closed to file-only seed behavior.
- Preflight bounded watch metadata before reading bodies, then retain and commit at most ten files
  per chunk under the writer gate. The maximum 512-path batch therefore cannot accumulate hundreds
  of 1MiB text bodies or one SQLite transaction per file.
- A true first build still waits for complete project Files metadata and preserves the existing
  bounded Current-directory/selected-file early paths.

## Accepted Diagnostic Contract

All events reuse the existing application `main.log` with fixed scope `[onlypreview-search]`.
Main, `renderer:fileSearch`, and `renderer:onlypreviewShell` already converge into that UTC NDJSON
file, so no new log writer, IPC channel, protocol field, or database is introduced.

### Startup and index timeline

- Preview/hidden-runtime lifecycle: window start, renderer loaded, preload ready, relay attached,
  Shell initialized.
- Index lifecycle: initialize start, SQLite open/reuse assessment, root listing, count complete,
  candidate backup, traversal, rebuild/reconcile, promotion, and ready/failure/cancellation.
- Each event contains only fixed enums, booleans, bounded aggregate counts, generation/build
  revision, and monotonic elapsed milliseconds.

### Search timeline

- Shell dispatch, hidden-runtime acceptance, optional priority/promotion/initial-tree-metadata gate
  wait, first Files result, first Contents result, section completion, terminal result, and Shell
  first-batch/terminal acceptance.
- Short process-local tags distinguish overlapping lifecycle/search operations; the shared UTC log
  chronology correlates Main and Renderer events without subtracting their independent monotonic
  clocks. Query text, result text, and any path are forbidden.
- First-result events are emitted at most once per section. Empty searches emit only the terminal
  count. Cancellation/failure is terminal and cannot produce a late diagnostic result event.

## Privacy and performance boundary

The diagnostic path must never record query text, snippets, file bodies, file or directory names,
relative or absolute paths, workspace identity/name/hash, configuration rules, database path,
host/bootstrap/runtime capability, request/result/directory tokens, or raw errors/objects/stacks.
Only sanitized fixed error codes/names are allowed.

Logging is O(1), non-awaited, and aggregate-only. It cannot add filesystem calls, SQLite queries,
body reads, traversals, array copies, timers, or persisted state. There is no per-file, per-directory,
per-chunk, per-result, per-batch, or progress-tick logging. Each index lifecycle and actual search
dispatch has a fixed small event ceiling.

## Acceptance

- One log filter reconstructs Preview start -> hidden runtime ready -> index phases -> first search
  gate -> first Files/Contents visibility -> terminal commit.
- Separate durations make SQLite open, count, backup, traversal/reconcile, promotion, XPC, and
  Renderer commit distinguishable without comparing clocks across processes.
- Fake monotonic-clock tests prove ordered non-negative timings, once-only first-section events,
  cancellation/failure termination, fixed event bounds, and forbidden-field exclusion.
- Existing index, search, XPC, cancellation, and privacy behavior remains unchanged.
- Ral performs the real-app sample: fully quit, start Preview on the same large project, search an
  existing term immediately, wait for results, then run a second search and export only
  `scope=onlypreview-search` rows.

## Resolution

Task
[onlypreview-search-startup-diagnostics-041](../plan/tasks/onlypreview-search-startup-diagnostics-041.md)
added the diagnostic timeline and [independent review 3](../plan/reviews/onlypreview-search-startup-diagnostics-041-3.md)
passed. The captured timings select
[onlypreview-warm-search-before-reconcile-042](../plan/tasks/onlypreview-warm-search-before-reconcile-042.md)
as the repair. It now serves a committed warm snapshot immediately, terminal-replaces it after the
fresh candidate is promoted, and passed
[independent review 2](../plan/reviews/onlypreview-warm-search-before-reconcile-042-2.md) with no
P1/P2/P3 finding. Focused verification passed 86/86; only Ral's live large-project startup check
remains.
