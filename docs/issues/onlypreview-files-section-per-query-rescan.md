# OnlyPreview Files section rescans every tree entry on every query

Status: proposed; one product decision pending

## Symptom

Two user-visible effects, one mechanism.

- Every Global Search keystroke pays a cost proportional to the **whole workspace**, not to the
  query. On a 130,000-entry workspace that is about 200ms before any result can be shown.
- Restricting Global Search to one directory does not make it faster. At 6,000 files a
  directory-scoped name query is measured at **1.0x** the project-wide query - not slower, not
  faster, identical - so the Current-directory control appears to do nothing for the Files group.

## Source Diagnosis

The Files group is answered by a linear in-memory scan, and the scan is scope-blind by construction.

```text
executeOnlyPreviewGlobalSearch
  -> runSnapshotPhase
       filesPromise = searchOnlyPreviewGlobalFiles({
         entries: lease.treeEntries,
         scope: { kind: 'project' },      <- hardcoded in global-search-executor.mjs
         ...
       })
```

`searchOnlyPreviewGlobalFiles` (`global-search-files.mjs`) then walks every entry in the lease's tree
snapshot and, per entry per query, calls `normalizeSearchText(entry.name)` - NFKC normalisation plus
locale lowercasing - before testing `includes`. It yields to the event loop every 128 entries or
every 8ms, so a large workspace also produces roughly one turn per 128 entries per query.

Two things make this avoidable rather than intrinsic:

- The normalised name is **already persisted**. `files.normalized_title` exists in the schema
  (`sqlite-schema.mjs`) and is written on every upsert, and it is never consulted by this path. The
  scan recomputes at query time what the index already stores.
- The scope is already expressible as an index range. `SQLITE_SCOPE_SQL` in `sqlite-search-scope.mjs`
  already implements `relative_path >= 'dir/' AND relative_path < 'dir0'` for the Contents branch
  against the `files_project_path` index. The Files branch does not use it because it does not query
  SQLite at all.

The project-wide behaviour itself is a deliberate product decision recorded in
[directory selection and Global Search file scope](onlypreview-directory-selection-and-global-file-scope.md)
("Files -> always search project-wide file + directory metadata"). This issue is about the *cost* of
that decision, and separately asks whether the decision should now change.

## Evidence

Measured with `node tests/indexing/bench/queryHotspots.bench.mjs --scale medium --repeat 3` and
`yarn bench:indexing:matrix --scales medium`, engine fingerprint `c71864b3e684`.

The scan cost is linear in workspace size and independent of the query:

| tree entries | Files-branch p50 | per entry |
| --- | --- | --- |
| 1,000 | 1.75ms | 1.75us |
| 10,000 | 14.04ms | 1.40us |
| 50,000 | 65.93ms | 1.32us |
| 130,000 | **199.73ms** | 1.54us |

At 6,000 files it is already the dominant per-query cost, and it does not respond to scope:

| | project | 50% of text | 10% | 1% |
| --- | --- | --- | --- | --- |
| name query, p50 | 9.36ms | 10.0ms | 10.1ms | 10.0ms |
| speedup | 1.0x | 0.9x | 0.9x | 0.9x |
| unique-needle query, p50 | 9.88ms | 9.61ms | 9.54ms | 9.71ms |
| speedup | 1.0x | 1.0x | 1.0x | 1.0x |

The unique-needle row is the clearest reading: that query has exactly one content hit anywhere in the
workspace, so ~9.5ms of its ~9.9ms is the Files scan, at every scope.

A benchmark plan that answers the same section from SQL instead
(`tests/indexing/plans/planB.scopedSqlite.mjs`, graded against this engine for result parity) measures
**3.45ms** project-wide and **0.10ms** at the 1% directory on the same corpus - a 30.5x scope speedup
where the current path has none.

## Proposed Repair

Answer the Files section from the index instead of from an in-memory rescan. Two variants; the first
needs no product decision and is worth doing on its own.

### Variant 1 - keep project-wide semantics, change the implementation

- Query names from SQLite: `files.normalized_title LIKE ?` for files, and the equivalent over the
  persisted `search_tree` rows for directories and symlinks.
- Collect matches and order them with `compareOnlyPreviewTreeEntries` before applying the section cap.
  SQL cannot express that order - it is segment-wise natural collation with a directory ahead of its
  own descendants - so a `LIMIT` in SQL would silently return a different page than the current code.
  Collect, then sort, then cap, with a bounded ceiling on the collected set and an explicit signal
  when the ceiling is hit.
- Result set, ordering, cap and `truncated` must be identical to today's for every query. This variant
  is a pure speedup with no observable behaviour change.

### Variant 2 - additionally honour the directory scope

Stop hardcoding `scope: { kind: 'project' }` in `runSnapshotPhase` and pass the validated scope
through, adding the existing `relative_path` range predicate. This changes what the Files group
returns and therefore needs the decision below.

## Pending decision

**Does the Files group stay project-wide?**

Keeping it project-wide is defensible - it is how a person finds a file whose location they have
forgotten, which is the opposite of a scoped search. But it means the first requirement placed on this
work ("asking for one directory must be faster than asking for the whole project") cannot be met for
the Files group at any workspace size, because the answer is by definition the whole workspace.

If the decision is to keep it, Variant 1 still removes 200ms per query at 130,000 entries and should
proceed alone. If the decision is to scope it, Variant 2 is a one-predicate addition on top of
Variant 1 and the measured payoff is 30.5x at a 1%-of-text directory.

A third possibility worth considering rather than assuming: keep Files project-wide but **rank**
in-scope matches first, so the Current directory is visibly useful without hiding anything.

## Acceptance

- For every query in the benchmark set, at project scope, the Files section returns byte-identical
  relative paths, order, and `truncated` to the current implementation - checked at several caps,
  including caps below the match count where ordering decides the page.
- The Files-branch cost stops scaling with workspace size: the per-query figure at 130,000 synthetic
  entries drops from ~200ms to single-digit milliseconds.
- `normalizeSearchText` is no longer called per entry per query on this path.
- Cooperative yielding is preserved or shown to be unnecessary: the current code releases the event
  loop every 128 entries, and a SQL lookup must not reintroduce a long uninterruptible turn.
- The existing `tests/onlypreview/*` suites pass unchanged, and
  `node tests/indexing/bench/planMatrix.bench.mjs --plans A --scales medium` shows the Files-branch
  improvement with parity still PASS.

## Sequencing

Touches `sqlite-index.mjs`, which task
[043](../plan/tasks/onlypreview-cold-folders-native-search-overlay-043.md) currently has open (four
lines changed there). `global-search-files.mjs` and `global-search-executor.mjs` are not touched by
043. Land after 043, or coordinate the four-line overlap.

## Related

- [OnlyPreview indexing plan comparison and evaluation](../design/onlypreview-indexing-plan-evaluation.md) -
  where the measurements above come from, and how the alternative plans handle this section
- [OnlyPreview indexing throughput](../design/onlypreview-indexing-throughput.md) - the build-side
  measurement this per-query one complements
- [OnlyPreview first search waits for startup reconciliation](onlypreview-first-search-startup-delay.md) -
  the startup-side gate, already repaired
