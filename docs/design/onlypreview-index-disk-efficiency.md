# OnlyPreview search index — disk efficiency review

Status: analysis; no code changed yet. Measured 2026-09-18 against Ral's live index after he
reported search failing in a large directory
([issue](../issues/onlypreview-search-failure-payload-latches-protocol-error.md) covers only the
error *message*; this covers why the build was failing underneath).

## Why this exists

`/System/Volumes/Data` reached 100% (881 MiB free of 926 GiB). OnlyPreview's index caches held
~24.5 GB across three editions — `Bitterless_DEBUG_PROD` alone 16 GB. Index rebuilds were failing
with `SQLITE_FULL` (×7) and `SQLITE_CORRUPT` (×9). Search cannot work in a workspace whose index
cannot be built, so disk efficiency is not housekeeping here — it is the feature.

## What was measured

One workspace: 98,179 files, 16,560 tree rows, 508,995 chunks, **5.6 GB** database
(`dbstat`, page_size 4096, 1,473,698 pages).

| object | MB | share | what it is |
| --- | ---: | ---: | --- |
| `chunks` | 2442 | 43% | five text columns per chunk |
| `chunk_fts_data` | 2218 | 39% | FTS5 `tokenize='trigram'`, `content=''` |
| `cjk_postings_chunk_id` | 516 | 9% | index used **only** by delete-by-chunk |
| `cjk_postings` | 515 | 9% | 36,442,933 rows |
| everything else | 64 | 1% | `files`, `search_tree`, small indexes |

Inside `chunks`, by character count (40k-row sample):

| column | share of chunk text | ≈ MB |
| --- | ---: | ---: |
| `normalized_searchable` | 48.9% | ~1194 |
| `core_text` | 47.4% | ~1158 |
| `content_hash` | 1.9% | ~46 |
| `right_overlap_text` | 1.5% | ~37 |
| `left_context_text` | 0.4% | ~10 |

And the input side:

```text
content_indexed=1   81,321 files    905 MB of source text
content_indexed=0   16,858 files  15,131 MB skipped (binaries, over-size)
```

**905 MB of text produces a 5.6 GB index — 6.2× amplification.**

## Finding 1 — over half the index is scratch

Indexed files by top-level directory:

```text
45,681  tmp/         515 MB   ← 56% of indexed files, 57% of indexed bytes
34,359  projects/    356 MB
 1,041  areas/        25 MB
   128  resources/     9 MB
```

`tmp/` is this workspace's declared throwaway playground — overmind's own `CLAUDE.md` says
"Root `tmp/` gitignored — free scratch/playground … Nothing persists via git." Indexing it is pure
waste, and it is the majority of the index.

Exclusions otherwise work: only **4** files under any `node_modules` are indexed. So this is a
defaults gap, not a mechanism failure, and it is the cheapest large win available — roughly
**-3 GB on this workspace alone** for one entry in the default exclusion list.

## Finding 2 — the same text is stored three times

Every indexed chunk is materialized as:

1. `core_text` — the source text, needed for snippets.
2. `normalized_searchable` — an NFKC + locale-lowercase copy of the same text, ~1.2 GB / 21% of the
   whole database. Read at query time by `instr(c.normalized_searchable, ?) > 0`
   (`sqlite-index.mjs:170,198`) and for match projection (`:591`).
3. `chunk_fts_data` — the trigram index over that same text, 2.2 GB.
4. `cjk_postings` — unigram+bigram postings over that same text again, 1.0 GB, for CJK queries.

So ~4.4 GB of the 5.6 GB is derived from ~1.2 GB of retained content. Each layer is individually
defensible — trigram gives substring search, CJK postings give tokenless CJK, the normalized copy
gives an exact verified match — but nothing accounts for their **sum**.

## Finding 3 — the CJK posting index is pure delete-cost

`cjk_postings_chunk_id` (516 MB, 9% of the database) has exactly one reader:

```js
this.deletePostings = database.prepare('DELETE FROM cjk_postings WHERE chunk_id = ?');
```

Half a gigabyte to make one maintenance statement fast. The table's own primary key is
`(token, chunk_id)`, so the tokens of a chunk being re-indexed are already derivable from its text —
deleting by `(token, chunk_id)` pairs uses the PK and needs no second index.

## Finding 4 — nothing ever evicts

Each workspace ever opened keeps a permanent database under `search-index-v6/`, and
`reclaimInterruptedSqliteArtifacts` only cleans artifacts matching the basename of the database
being opened. There is no global budget, no LRU, no age-out. That is how three editions reached
24.5 GB. Two concrete leaks feed it:

- The reclaim regex matches `…candidate-<uuid>` with optional `-wal`/`-shm` but **not `-journal`** —
  110 orphan journals are on disk right now.
- Artifacts belonging to any other workspace are never considered.

`auto_vacuum=0` and freelist is only 479 pages (2 MB), so the file does not shrink after deletes —
though on this database there is currently almost nothing to reclaim that way.

## Recommendations, by measured saving

| # | change | saving here | risk |
| ---: | --- | ---: | --- |
| 1 | Exclude `tmp/` (and a default scratch set) from content indexing | **~3 GB** | none — declared throwaway |
| 2 | Drop `normalized_searchable`; normalize `core_text` on demand | **~1.2 GB** | CPU on the `instr` fallback path |
| 3 | Drop `cjk_postings_chunk_id`; delete by `(token, chunk_id)` | **~0.5 GB** | slower re-index of a chunk |
| 4 | Global cache budget + LRU eviction across workspaces | 24.5 GB → bounded | needs a policy decision |
| 5 | Fix the reclaim regex (`-journal`) and widen it past one basename | 110 files | none |
| 6 | Recover `SQLITE_FULL` (13) like 11/26, and say "disk full" in the UI | — | none |
| 7 | `content_hash` as BLOB rather than 64-char hex | ~23 MB | none |

1, 5, 6 and 7 are mechanical and safe. 2 and 3 trade disk for CPU on paths that are not the common
case and want a benchmark before committing. 4 is the only one that needs Ral to choose a number.

## What this does not claim

The trigram index (2.2 GB, 39%) is **not** proposed for removal: it is what makes substring search
work at all, and `content=''` already means it stores no copy of the text. Its size is the price of
the feature. The saving above comes from not indexing scratch, and from not keeping three derived
copies where one plus recomputation would do.
