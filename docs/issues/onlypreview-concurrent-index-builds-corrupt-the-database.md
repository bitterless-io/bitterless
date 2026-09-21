# OnlyPreview: concurrent index builds on one database corrupt it and burn the disk

- Status: root cause established, fix in progress
- Reported: 2026-09-21 (Ral — "为什么有消耗了 十几个 G 的 磁盘刚才")
- Evidence: `COWORK_TEST_DEBUG` packaged build, `logs/main-2026-09-21.log`, and four quarantined
  index copies under `onlypreview/search-index-v6/`
- Applies to: `bitterless` and `micromeet-cowork` — the whole `preload/onlypreview/search/core/`
  tree is byte-identical between them except `workspace-config.mjs`, and
  `preload/fileSearch/fileSearchRuntime.ts` is byte-identical

## Symptom

The cowork index directory grew from 2.6 GB to 17 GB in about two hours. In the same window the
machine became unresponsive (Ral: "72244 特别卡", "72128 也特别卡"), free space on a 926 GB volume
fell to 17 GiB, and the log recorded four `sqlite-recovery … sqliteCode=11` events — SQLITE_CORRUPT.

## Measured, not inferred

**Two of the four quarantined 2.6 GB databases are healthy.** Both `PRAGMA quick_check` and FTS5's
own `INSERT INTO chunk_fts(chunk_fts) VALUES('integrity-check')` pass, and their `-wal` files are
0 bytes, so the main file is the complete image and there is nowhere for corruption to hide.

| quarantine | `-wal` | page structure | FTS5 integrity | verdict |
| --- | --- | --- | --- | --- |
| `e6XQ3z` | 127 KB | `2nd reference to page 663714…` | malformed (11) | genuinely corrupt |
| `ZmwrlB` | 3.7 MB | `2nd reference to page 42981`, many `never used` | malformed (11) | genuinely corrupt |
| `wYoihm` | 0 B | ok | ok | **healthy, discarded** |
| `v3EbIS` | 0 B | ok | ok | **healthy, discarded** |

The corruption signature matters. `2nd reference to page N` over a contiguous run of pages, plus
`Rowid … out of order` in the same tree, is two database images superimposed — one file's page
allocations carrying another file's page contents. A full volume produces a different signature
(truncated pages, `page never used`, a short header), and none of the disk-full shape appears in
the two corrupt copies beyond what the superimposition already explains.

## Root cause

Engines are never actually shut down, so several of them build on one database at once.

`fileSearchRuntime.ts:472` clears `this.active` **before** awaiting the old coordinator at `:476`.
An `initialize` arriving inside that window reads `active === null`, waits for nothing, and stands
up a second engine on the same `databasePath`. The await it skipped is long: the old engine's
`shutdown()` is queued behind its in-flight build (`search-engine.mjs:1111-1114` → `enqueue`), and
that build is parked in an uncancellable `await backup(seedIndex.database, candidatePath)`
(`:502`; `cancelBuild()` only bumps `buildEpoch`). Observed park time: 80–120 s.

Worse, the queue need never drain. The watcher keeps feeding the old engine whole-tree rebuilds
every 5–8 s (see *Escalated rebuilds are never throttled* below), so `shutdown()` is never reached
and the old engine lives indefinitely. **The runaway trigger is what makes the engines accumulate** —
the two halves are one failure, not two.

Every exclusion primitive is an instance field — `operationTail` (`:166`), `buildEpoch` (`:171`),
`promotionPromise` (`:228`) — so none of them exclude anything across engines. There is no lock,
lease, or per-path registry anywhere under `preload/onlypreview/search/` or `preload/fileSearch/`.

### Confirmed by a falsifiable prediction

Concurrent builds should never exceed the number of engines a runtime has created, and a runtime
emits exactly one `sqlite-open` per engine.

- Runtime A (06:47:28 → 08:25:06): `sqlite-open` at `tag=i2` 06:47:33, `tag=ip` 07:30:57,
  `tag=iu` 07:41:28 — three engines. Peak concurrency **3** (`i11`, `i12` at 08:14:30.354 and
  `i13` at .355).
- Runtime B (09:00:12 →): four `sqlite-open` (`i2`, `i5`, `ib`, `if`). Peak concurrency 2 (≤ 4).

Across the whole day: 14 `sqlite-open` against 141 `candidate-plan`. `tag=i2` recurs eight times
because the tag counter is per runtime and the runtime was rebuilt eight times.

### What the concurrency then does

1. **Disk.** Each engine copies the whole 2.6 GB database into its own candidate. Three at once,
   repeatedly. Free space fell 23235 → 14858 MiB in two minutes. Note this is *not* a failure of
   the disk precheck: `requiredMiB=5823` × 3 = 17469 < 23235, so a reservation-aware precheck would
   have admitted all three too. `planIndexBuild` is per-engine off a bare `statfs`
   (`disk-space.mjs:11-26, 42-57`) and `onlyPreviewIndexBytes` never counts `.candidate-*`, but
   fixing that would not have stopped this.

2. **Healthy databases discarded.** `backup()` copies a source another engine is concurrently
   writing — or renaming out from under it during its own promote. The torn candidate throws
   SQLITE_CORRUPT, which `search-engine.mjs:604` records as `corruptionCode`, and
   `:753` / `:794` then quarantine **`previousPath` — the live database** — not the candidate that
   actually failed. In reconcile mode the candidate is a copy of the live database, so blaming the
   live one is right when the source really is corrupt and wrong when the copy was torn in transit.
   That is how two healthy 2.6 GB databases ended up in quarantine. The retry that follows
   (`:606` `await buildCandidate(false)`) is the second `candidate-backup … mode=fresh elapsedMs=0`
   the log shows under the same tag.

3. **Genuine corruption.** The normal promote branch renames the main file only —
   `:782` `rename(this.databasePath, previousPath)` and `:784` `rename(candidatePath, this.databasePath)`
   — while the corruption branch one line up (`:781`) correctly moves all four suffixes via
   `renameSqliteIndexArtifacts`. The bare rename is safe *only* because the promoter closed the last
   connection first (`:775-777`), which is what makes SQLite unlink `<live>-wal` and `<live>-shm`.
   With another engine still holding that path open, the sidecars survive, and the next open replays
   database A's WAL frames onto database B. A WAL carries no back-reference to its database — only a
   salt and a checksum chain — and both files share page size and schema, so the frames apply
   cleanly and produce exactly the observed signature.

   **This attribution is not exclusive.** `sqlite-recovery.mjs:29-42` records that on this same
   machine an 11 once arrived as the consequence of a 13 (writes torn off mid-page on a full
   volume), and a 13 can never appear in a `sqlite-recovery` line by construction (rethrow at
   `sqlite-recovery.mjs:218`, short-circuit at `search-engine.mjs:583`) — so the log's silence on 13
   is information-free. Stale-WAL fits the promote-adjacent timing better; disk-pressure-induced
   torn writes are not ruled out. The fixes below do not depend on choosing between them.

### Escalated rebuilds are never throttled

`watch-reconciler.apply()` escalates a batch the controller dispatched as `{full:false}` into a
whole-tree `refreshFromWatchInternal()` (`watch-reconciler.mjs:189, 193-197, 206-215, 307-309,
422-425`), reached from `:242-243` (any `mkdir`/`rmdir`) and `:287-289` (any delete or atomic
save). The cooldown added 2026-09-16 is gated on the *controller's* `full` flag
(`watch-controller.mjs:195, :199`) and — decisively — is *recorded* only under that same flag
(`:238-241`). So an escalated rebuild is neither gated nor measured: `lastFullReconcileEndedAt`
stays 0 and `fullReconcileCooldownRemainingMs()` (`:87-94`) returns 0 forever. In the 06:47–07:25
single-engine stretch this produced 21 builds with `count=40820` unchanged throughout, at
promotion-to-next-plan gaps of 5–8 s.

## Fix

Ordered by what stops the damage soonest. The first one alone stops corruption and the disk burn.

1. **DONE (2026-09-21, both repos).** **Per-`databasePath` build mutex** around `buildAndPromoteCandidate`
   (`search-engine.mjs:489`). Module-level, keyed by path, so it holds across engine instances.
   Chosen over repairing `_shutdownActive` alone because the invariant — one build per database —
   belongs to the resource, not to one caller: any future second engine inherits it for free.
   Repairing `_shutdownActive` alone is also actively unsafe, because awaiting a shutdown that can
   never drain would make `initialize` block forever.
2. **DONE (2026-09-21, both repos).** **Sidecar-atomic promotion** — use `renameSqliteIndexArtifacts` unconditionally at `:781-782`
   and at the rollback twin `:826-827`, not only when `corruptionCode` is set. Defense in depth:
   a promoted inode must never land on a path whose `-wal`/`-shm` it did not bring.
3. **NOT DONE — needs a design decision, do not patch mechanically.** **Charge escalated rebuilds
   to the cooldown.** Recording an `escalatedToFull` flag at `watch-controller.mjs:238-241` is the
   easy half and is *not sufficient*: the runaway is made of batches the controller dispatched as
   `{full:false}`, so recording the cooldown never gates them — the next escalated batch bypasses
   it exactly as before. Gating them properly means the reconciler must stop escalating inline and
   instead *request* a full reconcile from the controller (`fullReconcile = true` + `schedule()`),
   letting it pass through the existing gate at `:199`. That defers tree freshness across the
   cooldown, which is the intended trade but is a real behaviour change at five call sites
   (`watch-reconciler.mjs:189, 193-197, 206-215, 307-309, 422-425`) — a careless version leaves
   the tree stale after a `mkdir`/`rmdir`, which is a worse, user-visible regression than the
   churn it fixes. This is what bounds engine lifetime: it lets the operation queue drain so
   `shutdown()` can finally run.
4. **Close the `_shutdownActive` window** (`fileSearchRuntime.ts:470-477`) — only meaningful once
   (3) makes shutdown able to complete.
5. **Quarantine the failing artifact, not the live database** — when `corruptionCode` came from a
   torn candidate rather than from the seed, the live database must not be discarded. Needs a
   distinction the code does not currently draw; scope separately.

## Not fixed by work already in this batch

The uncommitted fixes in these repos — the quarantine retention cap in `sqlite-artifacts.mjs`,
runtime recovery in `onlyPreviewWindow.helper.ts`, and the progress terminal state — would **not**
have prevented any of this. The retention cap would have bounded the leftover copies after the
fact; it does nothing about concurrent builds, and the 2.6 GB candidates it does not match are
where most of the growth came from.
