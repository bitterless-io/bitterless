---
id: onlypreview-index-derived-copies-184
scope: Remove two derived copies of chunk text from the search index, behind a benchmark — mirrored to micromeet-cowork
status: proposed (benchmark first)
depends-on: [onlypreview-index-scratch-and-leaks-183]
verify: node tests/indexing/bench/queryHotspots.bench.mjs; node --test tests/onlypreview/onlyPreviewSearchEngineSqliteIndex.test.mjs tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs; yarn typecheck:node; no Electron/Playwright/E2E
---

# Phase 2 — stop storing the same text three times

Plan: [index disk budget](../../features/onlypreview-index-disk-budget.md).

**Benchmark before committing.** Both changes trade disk for CPU. If the measured query regression
is worse than the disk win is worth, say so in this doc and stop — that is a valid outcome.

## Required behavior

1. **Drop `chunks.normalized_searchable`** (~1.2 GB, 21% of the reference database). Readers:
   `WHERE instr(c.normalized_searchable, ?) > 0` (`sqlite-index.mjs:170,198`, the
   `sqlite-instr-prefilter` engine) and the match projection at `:591`. Both normalize `core_text`
   on demand instead. Keep `normalized_core_length`. The normalized→source offset mapping already
   exists as `projectNormalizedMatchToSource`, because normalization is not length-preserving.
2. **Drop the `cjk_postings_chunk_id` index** (~516 MB, 9%). Only reader is
   `DELETE FROM cjk_postings WHERE chunk_id = ?` (`sqlite-index.mjs:143`). Delete by
   `(token, chunk_id)` pairs re-derived from the chunk's text, which uses the existing
   `(token, chunk_id)` primary key.

## Migration — the part that must not regress (Ral, 2026-09-18)

Both are schema changes, so **how already-built indexes cross the update is part of this task, not an
afterthought**. The naive route — bump `SEARCH_SCHEMA_VERSION` and let `configureSearchDatabase`
drop and rebuild — is wrong here for a specific reason: a rebuild that routes through
`buildAndPromoteCandidate` needs **2x the index size** in free disk (see task 183), which is exactly
the condition that broke the reference machine.

Required instead: **an in-place, additive downgrade.**

- `ALTER TABLE chunks DROP COLUMN normalized_searchable` and `DROP INDEX cjk_postings_chunk_id`.
  SQLite supports both and both are metadata-cheap; the surviving columns keep their data, so **no
  re-traversal and no candidate copy is needed at all**.
- Follow with `PRAGMA incremental_vacuum` so the freed pages return to the filesystem instead of
  sitting in the freelist — otherwise the file stays at its high-water mark and the saving is
  invisible on disk.
- Bump `SEARCH_SCHEMA_VERSION` to 9 and give `configureSearchDatabase` a v8 -> v9 additive branch
  beside the existing v7 one. A v8 index must take that branch; a test must prove no candidate file
  is allocated during the upgrade.

Note the existing inconsistency this touches: the index directory is hardcoded `search-index-v6`
(`onlyPreviewSearchBootstrap.registry.ts:78`) while the schema is already at 8, so the directory name
stopped tracking the schema two versions ago. Do **not** rename it to v9 — that would orphan every
existing index with no cleanup path (task 185 owns eviction). Migrate in place.

## Benchmark gates

- Short queries (1–2 characters, the `instr` fallback path) — the case most exposed by item 1.
- CJK queries — unaffected in principle by item 1, must be confirmed.
- Incremental re-index of a changed file through the watch path — the case exposed by item 2.
  Measure that, not a cold build.
- Record before/after database size on a fixture corpus alongside the timings.
- **Migration gate:** a v8 index built by the previous release upgrades to v9 in place, keeps serving
  queries, allocates no `.candidate-*` file, and shrinks on disk after the incremental vacuum.
