# OnlyPreview index disk budget — optimization plan

Status: proposed. Revised 2026-09-18 after two owner decisions and one further measurement:

- **`tmp/` stays indexed** (Ral, 2026-09-18: 「先保持对 tmp 的索引」). The largest single saving in
  the first draft is therefore withdrawn. It is recorded under *Rejected* below rather than deleted,
  so it is not re-proposed.
- **Migration of already-built indexes is in scope** (Ral: 「旧的版本的索引怎么迁移你是不是也得做」).
  It was missing from the first draft. It is now Phase 0, because it turns out to be the same
  problem as the crash.
- **A reconcile needs 2x the index size in free disk.** Measured, not assumed — see below. This, not
  index size, is what actually broke search, and it reorders everything.

Evidence and measurements: [disk efficiency review](../design/onlypreview-index-disk-efficiency.md).

Applies to **both** BL and micromeet-cowork (paired development). The search core under
`src/preload/onlypreview/search/core/` is vendored byte-identically between the repos, so every
change here is written once in BL and mirrored.

## The problem in one line

Every reconcile copies the whole index before rebuilding it, so a 5.6 GB index needs 11.2 GB of free
disk to stay current — and nothing checks first, nothing evicts, and the retry loop writes until the
volume is full.

## The finding that reorders this plan

`buildAndPromoteCandidate` (`search-engine.mjs:468-472`) does:

```js
const candidatePath = `${this.databasePath}.candidate-${randomUUID()}`;
if (reconcileCandidate) await backup(seedIndex.database, candidatePath);
```

`backup` is `node:sqlite`'s full byte copy. Reconciling an index therefore needs **2x its size** in
free space, transiently. On the reference machine that is 11.2 GB for one workspace.

The log shows the consequence directly — the same backup attempted over and over, each writing
gigabytes, none succeeding:

```text
event=candidate-backup mode=backup elapsedMs=31036
event=candidate-backup mode=backup elapsedMs=56643
event=candidate-backup mode=backup elapsedMs=52895
event=candidate-backup mode=backup elapsedMs=82479
   -> event=initialize-failure phase=rebuild sqliteCode=13   (SQLITE_FULL)
   -> event=initialize-failure phase=rebuild sqliteCode=11   (SQLITE_CORRUPT)
```

A `mode: 'fresh'` path already exists and skips the copy (`reconcileCandidate === false`). Nothing
chooses it on the basis of available disk.

So shrinking the index helps, but does not fix this: a 3.9 GB index still silently needs 7.8 GB free
and still fails the same way on a tight disk. **The precheck is the fix; the size work is the
margin.**

## Phases

Ordered so the largest, safest saving lands first and nothing depends on a decision Ral has not made.

```text
Phase 0  correctness  precheck disk, choose fresh over copy, migrate safely   task 183
Phase 1  leaks        reclaim orphans, truthful disk-full failure             task 183
Phase 2  ~1.7 GB      drop two derived copies                needs a benchmark  task 184
Phase 3  bounded      global budget + LRU eviction           needs Ral's number task 185
```

Phase 0 is new and is now the only part that is urgent: without it, every later saving is just a
larger margin before the same failure.

### Phase 0 — never write until there is room, and migrate the same way (task 183)

1. **Precheck free disk before the candidate backup.** Need `indexSize * 2 + headroom`; if it is not
   there, do not start. This is the one change that turns a disk-filling corruption loop into a
   refusal that names the number.
2. **Prefer `mode: 'fresh'` over `mode: 'backup'` when disk is tight.** The fresh path already
   exists and skips the copy entirely. It costs a full re-traversal instead of an incremental
   reconcile — slower, but it completes, and it needs ~1x rather than ~2x.
3. **Stop the retry loop from writing.** Eight consecutive failed backups wrote gigabytes each. A
   failure whose cause is `SQLITE_FULL` must not be retried on the same path without the precheck
   passing first.
4. **Bound the transient.** Remove a failed candidate before starting the next attempt, not only on
   the success path.

#### Migration of already-built indexes

This is the part the first draft missed, and it matters more than it looks, because **migration uses
the same doubling path as a reconcile**.

Current state, which is already inconsistent:

- The directory is hardcoded `search-index-v6` (`onlyPreviewSearchBootstrap.registry.ts:78`) while
  `SEARCH_SCHEMA_VERSION` is **8**. The directory name stopped tracking the schema two versions ago,
  so every schema generation shares one directory.
- `configureSearchDatabase` migrates **in place**: version 7 with a valid content schema takes an
  additive path (recreate `search_tree` only); anything else does `DROP TABLE` on all six objects and
  recreates them in the same file.

That in-place drop is actually the *good* case for a full disk: `DROP TABLE` moves pages to the
freelist and the rebuild writes back into them, so the file does not grow much. What must not happen
is a schema bump that routes through `buildAndPromoteCandidate`, because that needs 2x.

So the rule for Phase 2's schema change:

| situation | path | disk needed |
| --- | --- | --- |
| schema version differs | in-place `DROP` + rebuild into the same file | ~1x, reuses freelist |
| content reconcile | candidate backup + promote | ~2x — must precheck |
| index missing/unreadable | fresh build | ~1x |

Phase 2 bumps `SEARCH_SCHEMA_VERSION` to 9. Every existing v8 index must take the in-place row, and a
test must prove it does not allocate a candidate. Dropping `normalized_searchable` and the CJK index
is `ALTER TABLE DROP COLUMN` + `DROP INDEX` — SQLite supports both, and both are metadata-cheap —
so an **additive downgrade path is available** and is preferable to a full rebuild: the surviving
columns keep their data and no re-traversal is needed at all.

That is the migration answer: **v8 -> v9 should be an in-place column/index drop, not a rebuild.**
Users keep a working index across the update, and it costs no disk instead of 2x. Add
`PRAGMA incremental_vacuum` after the drop so the freed pages actually return to the filesystem
rather than sitting in the freelist.

### Phase 1 — stop leaking, stop lying (task 183)

Three independent, mechanical changes. No algorithm changes, no schema change.

1. **Fix the artifact reclaim regex.** It matches `…candidate-<uuid>` with optional `-wal`/`-shm`
   but not `-journal`; 110 orphan journals are on disk. One alternation.
2. **Widen reclaim past a single basename.** It only ever considers the database being opened, so
   every other workspace's leftovers are immortal. Reclaim any `*.candidate-*` / `*.previous-*`
   whose owning database is absent, not just the current one's.
3. **Recover `SQLITE_FULL` (13)** the way `SQLITE_CORRUPT` (11) and `SQLITE_NOTADB` (26) already are,
   and surface a failure that names the disk. Today a disk-full build fails with a generic error and
   no recovery; recovery fired once across 16 failures in the log, and the user is told the index
   "returned an invalid response", which is not what happened.

Verification: focused Node tests per change (a directory seeded with orphan journals, an injected
`SQLITE_FULL`, a precheck that refuses when free space is short), plus the existing search suites
unchanged.

### Phase 2 — stop storing the same text three times (task 184)

Two changes, each trading disk for CPU on a path that is not the common case. **Benchmark before
committing** — `tests/indexing/bench/` already exists for this.

1. **Drop `chunks.normalized_searchable`** (~1.2 GB, 21% of the database). It is an NFKC +
   locale-lowercase copy of `core_text`. Two readers:
   `WHERE instr(c.normalized_searchable, ?) > 0` (the `sqlite-instr-prefilter` fallback engine) and
   the match projection at `sqlite-index.mjs:591`. Both can normalize `core_text` on demand. The
   offset mapping is already solved — `projectNormalizedMatchToSource` exists precisely because
   normalization is not length-preserving. Keep `normalized_core_length`.
   **Risk to measure:** the `instr` path becomes a normalize-per-row scan. It is the fallback for
   queries trigram cannot answer (under 3 characters), so the benchmark must cover short queries.
2. **Drop the `cjk_postings_chunk_id` index** (~516 MB, 9%). Its only reader is
   `DELETE FROM cjk_postings WHERE chunk_id = ?`. The table's PK is `(token, chunk_id)` and a
   chunk's tokens are derivable from its text, so delete by pairs and use the PK.
   **Risk to measure:** re-indexing one changed chunk does more work; the watch path re-indexes in
   ten-file chunks, so measure that, not a cold build.

Not in scope: the trigram index. 2.2 GB and 39% of the file, but it is what makes substring search
work and `content=''` means it stores no copy of the text. That size is the feature's price.

### Phase 3 — a budget, so this cannot recur (task 185)

Every workspace ever opened keeps a permanent database. There is no budget, no LRU, no age-out.
Phases 1 and 2 shrink each index; only this bounds the total.

Proposed: a global cap on `search-index-v6/`, evicting least-recently-opened workspaces first, with
the active workspace never evicted. An index is a rebuildable cache, so eviction costs a rebuild,
not data.

**This is the decision Ral must make: the cap.** For reference, after Phase 1+2 his largest
workspace's index would be roughly 1.4 GB (5.6 GB less ~3 GB scratch less ~1.7 GB derived copies).

| cap | holds | rebuild pain |
| ---: | --- | --- |
| 5 GB | ~3 large workspaces | frequent for someone who rotates projects |
| 10 GB | ~7 large workspaces | rare |
| 20 GB | ~14 large workspaces | almost never, but that is most of a small SSD's slack |

Recommendation: **10 GB**, with a visible setting. It is an order of magnitude below where he landed,
it holds every workspace he plausibly cycles through in a week, and a rebuild is minutes of
background work rather than lost data.

Also in this phase: `PRAGMA auto_vacuum=INCREMENTAL` for new databases so deletes return pages
instead of leaving the file at its high-water mark. Freelist on the measured database is only 2 MB
today, so this is about the future, not a saving now.

## PRAGMA layer (Ral, 2026-09-18: 「sqlite pragma 层面还能优化也好」)

Read off the live 5.6 GB index. Persistent settings live in the file header; per-connection ones are
whatever `configureSearchDatabase` sets, so an unset one is running at SQLite's default.

| pragma | now | scope | verdict |
| --- | --- | --- | --- |
| `journal_size_limit` | **-1 (unlimited)** | connection | **fixed in 183** — see below |
| `auto_vacuum` | 0 (none) | file, creation-time | take in 184 |
| `page_size` | 4096 | file, creation-time | candidate for 184, must be measured |
| `wal_autocheckpoint` | 1000 pages | connection | fine as is |
| `journal_mode` | wal | file | correct |
| `synchronous` | NORMAL | connection | correct for WAL |
| `temp_store` | FILE | connection | see caveat |

**`journal_size_limit = -1` is the one that mattered and is already fixed.** SQLite checkpoints the
WAL but never *truncates* it at this setting: the file keeps whatever high-water mark a large
transaction drove it to, for the life of the connection. A bulk index build is such a transaction,
so the WAL is a third claim on the volume during a reconcile — alongside the database and the
candidate copy. Now capped at 64 MB.

**`auto_vacuum = INCREMENTAL` and a larger `page_size` both have to be set before any table is
created**, or they need a full `VACUUM` (which itself needs ~1x free disk — the thing this plan is
trying to stop needing). Phase 2 already recreates nothing but drops two columns in place, so the
honest options are: set them only on *newly created* databases, or accept that existing indexes keep
4096/none until they are rebuilt for some other reason. Take the first; do not force a VACUUM.

**`page_size` is a candidate, not a claim.** A larger page reduces overflow-chain pages for wide
text columns and shallows the B-tree, and this schema is mostly wide text. But this SQLite build's
`dbstat` has no `pagetype` column, so the overflow share could not be measured here, and the usual
5-15% is a literature number, not this database's number. Measure it on a fixture corpus in 184
before adopting it; report the measurement either way.

**`temp_store = FILE` caveat.** FTS5 merges spill to temp files on the same volume, so on a tight
disk they add pressure at exactly the wrong moment. `MEMORY` would avoid that but trades it for RAM
on a 500k-chunk merge. Left alone deliberately — the fix for disk pressure is the precheck, not
moving the spill into memory.

**`PRAGMA optimize` before close** is worth adding for query plans. It is not a disk saving, so it is
not counted above.

## What is deliberately not here

- Reducing the CJK posting set (unigrams + bigrams, 36.4M rows). It is 515 MB and a real candidate,
  but cutting unigrams breaks single-character CJK queries, which is a search-quality decision, not
  a disk decision. Raise separately if Phase 1–3 is not enough.
- Compressing chunk text. SQLite-level compression would cut `core_text`, but it costs CPU on every
  snippet and complicates the offset mapping the snippet projector depends on.

## Rejected

**Excluding `tmp/` from indexing** — first draft's largest saving (~3 GB; 45,681 of 81,321 indexed
files). Withdrawn by Ral on 2026-09-18: 「先保持对 tmp 的索引」. He searches his scratch tree, and an
index that silently omits half the workspace is a worse product than a large index. Recorded here so
it is not re-proposed as an obvious win; it is a deliberate trade, not an oversight.

Consequence: the reference index stays ~5.6 GB, so Phase 0's precheck is load-bearing rather than
belt-and-braces, and Phase 2 becomes the only real size lever (~1.7 GB, 5.6 -> ~3.9 GB).
