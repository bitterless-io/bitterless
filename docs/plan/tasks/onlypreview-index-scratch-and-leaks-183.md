---
id: onlypreview-index-scratch-and-leaks-183
scope: Refuse an index rebuild that cannot fit on disk instead of filling the volume, stop leaking index artifacts, and report a disk-full build truthfully — mirrored to micromeet-cowork
status: implemented; owner verification pending
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs tests/onlypreview/onlyPreviewBackgroundIndex.test.mjs tests/onlypreview/onlyPreviewWorkspaceConfigDirectory.test.mjs tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs; yarn typecheck:node; no Electron/Playwright/E2E
---

# Phase 0+1 — fit-on-disk precheck, artifact reclaim, disk-full recovery

Plan: [index disk budget](../../features/onlypreview-index-disk-budget.md).
Evidence: [disk efficiency review](../../design/onlypreview-index-disk-efficiency.md).

**`tmp/` stays indexed** (Ral, 2026-09-18). The scratch exclusion that was item 1 of the first draft
is withdrawn — see *Rejected* in the plan. That makes the precheck below load-bearing rather than
belt-and-braces, because the reference index stays at 5.6 GB.

## Required behavior

**Corrections found during implementation** (kept here rather than silently dropped):

- Two items of the original draft were **already satisfied**. `removeSqliteArtifacts(candidatePath)`
  is already in the `finally` of `buildAndPromoteCandidate`, so a failed candidate is already
  cleaned; and `SQLITE_FULL` already falls through `if (!reconcileExisting || !isSqliteCorruption(error)) throw error`
  without retrying inside that function. The repeated backups in the owner's log come from the
  scheduler *above* re-entering initialize, which is what the precheck stops.
- "Recover `SQLITE_FULL` the way 11/26 are" was **wrong** and is not implemented. That path
  quarantines the database and rebuilds it; doing that for a full disk throws away an undamaged
  index and then retries in space that was already insufficient. 13 gets its own predicate,
  `isSqliteDiskFull`, and is reported, never recovered from.
- One item was **added**: `PRAGMA journal_size_limit`. It was unset, i.e. `-1`, so the WAL was
  checkpointed but never truncated and kept its high-water mark for the connection's life — a third
  claim on the volume during a reconcile, alongside the database and the candidate copy.

1. **Refuse a rebuild that cannot fit.** `buildAndPromoteCandidate` (`search-engine.mjs:468-472`)
   calls `backup(seedIndex.database, candidatePath)` — a full byte copy — so a reconcile needs
   **2x the index size** free. Precheck `indexSize * 2 + headroom` before the backup; if short,
   do not start. Prefer the existing `mode: 'fresh'` path (`reconcileCandidate === false`), which
   skips the copy and needs ~1x, when disk is tight. Do not retry the same path after a
   `SQLITE_FULL` without the precheck passing. Remove a failed candidate before the next attempt,
   not only on success. On the reference machine eight consecutive failed backups (25-82s each)
   wrote gigabytes apiece until the volume hit zero and the index corrupted.
2. **Reclaim `-journal` artifacts.** `reclaimInterruptedSqliteArtifacts`
   (`sqlite-artifacts.mjs:6-11`) matches `<db>.(candidate|previous)-<uuid>(-(wal|shm))?$`. Add
   `journal` to that alternation. 110 orphan journals exist on the reference machine.
3. **Reclaim beyond the active basename.** The same function keys off `basename(databasePath)`, so
   artifacts of every other workspace are immortal. Reclaim any `*.candidate-*`/`*.previous-*` in
   the directory whose owning `<db>.sqlite` no longer exists. Never touch an artifact whose owner is
   present — a live build is using it.
4. **Recover and report `SQLITE_FULL`.** `sqlite-recovery.mjs:22` treats only 11 and 26 as
   recoverable. Add 13, and make the surfaced failure name the disk rather than a generic index
   error. A user whose disk is full must be told that, not "the index returned an invalid response".

## Path

- `src/preload/onlypreview/search/core/search-engine.mjs` — item 1
- `src/preload/onlypreview/search/core/sqlite-artifacts.mjs` — items 2, 3
- `src/preload/onlypreview/search/core/disk-space.mjs` — new, the plan/precheck
- `src/preload/onlypreview/search/core/sqlite-recovery.mjs` — item 3
- `src/preload/onlypreview/search/core/sqlite-schema.mjs` — item 4
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts` — the disk-full message, both catalogs
- mirrored into `micromeet-cowork/apps/cowork` at the same relative paths
- `docs/INDEX.md`

## Verification

- With free space below `2x + headroom`, the reconcile refuses before writing anything, names the
  shortfall, and leaves the existing index usable; with room, it proceeds unchanged.
- A `SQLITE_FULL` failure does not re-enter the backup path, and leaves no candidate behind.
- A directory seeded with `<db>.candidate-<uuid>-journal` plus an orphan of an absent database is
  fully reclaimed; an artifact whose owning database exists is left alone.
- An injected `SQLITE_FULL` takes the recovery path and produces a failure whose message names the
  disk; the existing 11/26 behavior is unchanged.
- Existing search suites pass unchanged. Baseline note: `onlyPreviewShell.store.ts`'s 800-line guard
  is red before this task and stays red.
