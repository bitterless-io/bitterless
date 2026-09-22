---
id: onlypreview-index-derived-copies-184
scope: Remove two derived copies of chunk text from the search index, behind a benchmark — mirrored to micromeet-cowork
status: **rejected by its own benchmark gate** (2026-09-22) — do not implement as specified
depends-on: [onlypreview-index-scratch-and-leaks-183]
verify: node tests/indexing/bench/queryHotspots.bench.mjs; node --test tests/onlypreview/onlyPreviewSearchEngineSqliteIndex.test.mjs tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs; yarn typecheck:node; no Electron/Playwright/E2E
---

# 结论:不做(2026-09-22 实测)

任务自己写的闸门是「若实测回归大于磁盘收益,就写进文档并停手 —— 那是一个有效结论」。
基准跑完了,三条都不通过。完整报告:
[`areas/agent-runtime/preview/index-benchmark.html`](../../../../../areas/agent-runtime/preview/index-benchmark.html),
脚本 `tmp/onlypreview-index-bench/`。

1. **短查询慢 2–8 倍。** 去掉 `normalized_searchable` 后现场归一化(已用 SQL 用户函数,是最省的实现,
   所以这是代价的下界)。231 MB 的语料上短查询本来就要 0.36–2.1 秒,乘 3–6 倍就是好几秒;
   真实索引还要大 12 倍。3 字符以上(FTS5)与中日韩(倒排)两条路确认不受影响。
2. **删除慢 1.8–3.4 倍。** 按 `(token, chunk_id)` 删比带索引删慢,只比无索引全扫快。
3. **磁盘收益拿不到手。** 这是文档原方案里的硬伤:所有已建索引 `auto_vacuum=0`,
   `PRAGMA incremental_vacuum` 实测 0–2 ms 且文件**一个字节没小**。SQLite 只允许在空库上设
   `auto_vacuum`,之后要改必须跑全量 `VACUUM` —— 整文件重写,正是任务 183 要避开的那类操作。

要重启这个任务,前提是找到一种**不需要全量 VACUUM 就能落地**、且短查询不回归的写法。
在那之前,新建索引已经带上 `auto_vacuum = INCREMENTAL`(任务 185),存量索引在下次完整重建时跟上。

**基准另外量出一件更值得做的事**(追查后已更正归因):**在索引还没见过的目录里新建文件,
会触发一次全量重建。** 最初把「新增 20 文件 = 0.9–15.3 秒」读成"新增很贵且随库变大"是错的 ——
那一列量到的是「一次全量重建 + 20 次真增量」,因为基准把文件写进了新建的 `__bench_added__/`。
逐批探测分开后,真正的增量新增是 **1.6–2.8 ms/文件**,和删除同一量级。

触发点在 `watch-reconciler.mjs` 的 `readParentDirectoryTreeEntry`:父目录不在索引树里就判
`valid: false`,调用方据此升级成全量。后面那整段校验(在根内、非符号链接、真是目录、realpath 一致)
才是真正的权威,这一行只是要求"这个目录必须早就见过"。新建功能目录、git checkout 带出新目录、
解压、脚手架生成 —— 每次都会在真实索引上触发 2.75 GB 克隆 + 41,855 条目遍历。

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
