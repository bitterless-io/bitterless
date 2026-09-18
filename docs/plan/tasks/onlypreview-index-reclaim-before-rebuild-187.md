---
id: onlypreview-index-reclaim-before-rebuild-187
scope: Break the disk-full rebuild deadlock by reclaiming a dead index before planning against it, bound quarantine/recovery residue, and stop a refused build from re-walking the workspace — mirrored to micromeet-cowork
status: implemented; owner verification pending
depends-on: [onlypreview-index-scratch-and-leaks-183]
verify: node --test tests/onlypreview/onlyPreviewIndexDiskBudget.test.mjs tests/onlypreview/onlyPreviewSqliteRecovery.test.mjs tests/onlypreview/onlyPreviewSearchEngine.recovery.test.mjs tests/onlypreview/onlyPreviewSearchEngine.sqlite.test.mjs tests/onlypreview/onlyPreviewSearchEngine.scope.test.mjs tests/onlypreview/onlyPreviewIndexRecovery.test.mjs; yarn typecheck:node; no Electron/Playwright/E2E
---

# Phase 1b — check and repair the index *before* rebuilding it

Plan: [index disk budget](../../features/onlypreview-index-disk-budget.md).
Follows [task 183](onlypreview-index-scratch-and-leaks-183.md), which added the fit-on-disk precheck
this task found a hole in.

Ral, 2026-09-18: 「新版本安装后索引前先需要检查索引是否需要被修复（删除无效索引文件）然后再重建」.

## The deadlock task 183 created

183 was right to refuse a rebuild that cannot fit. But the refusal is computed against the index that
is *already on disk*:

```js
const freshNeeds = indexBytes + HEADROOM_BYTES;   // disk-space.mjs:49
```

When the traversal config changes, `configHash` changes, so `isReusable()` and `canReconcile()` are
both false — the database on disk can never be read from and can never be reconciled against. It is
dead weight. Yet its 6.04 GB are charged to `freshNeeds`, **and** they occupy the space the rebuild
needs. With 5.5 GB free the plan returns `none`, the build refuses, and the only thing that would
free the space — promotion, which renames the dead database aside and deletes it — is downstream of
the refusal. The index can then never be rebuilt, on any subsequent launch, without a manual delete.

That is exactly the state the reference machine was in.

## Required behavior

1. **Reclaim a dead index before planning against it.** In `buildAndPromoteCandidate`, when the plan
   says `none` *and* nothing is serving reads from the database (`this.index === undefined`), close
   the seed handle, delete the database, and plan again. The second plan sees `indexBytes === 0`, so
   it needs only the headroom, and it has the reclaimed gigabytes to spend. Force `reconcile: false`
   on the second plan: there is no longer anything to reconcile against, and a plan that still said
   `reconcile` would hand `backup()` a closed handle to a deleted file.
   The narrow condition matters. `applyConfig` passes a live `this.index`, so this branch cannot fire
   there — a database that is currently answering searches is never deleted to make room.
2. **One quarantine per database, and only when the volume can spare it.** Quarantine is forensic,
   not functional. Keeping a corrupt multi-GB copy on the volume whose fullness *caused* the
   corruption is the opposite of a repair. Before `mkdtemp`, delete any earlier quarantine of the
   same database — a superseded forensic copy carries nothing the newest one does not — and if the
   copy would not leave `HEADROOM_BYTES` free, do not retain it at all: delete the corrupt artifacts
   and report `retained: 0`.
3. **Reclaim quarantine and recovery residue.** `reclaimInterruptedSqliteArtifacts` matches
   `candidate|previous` files only, and skips every directory. A quarantine is a `mkdtemp`
   **directory**, so it was missed twice over, and `recovery` was deliberately excluded to keep
   forensics across a crash — which made it immortal rather than durable. Reclaim
   `<db>.recovery-<uuid>`, `<db>.quarantine-<tmp>` and `<db>.recovery-<uuid>.quarantine-<tmp>` once
   they are older than the retention window, or as soon as their owning database is gone, since
   forensics on an index that no longer exists answers nothing.
4. **`-journal` in `removeSqliteArtifacts`.** The engine's own remover lists `'', '-shm', '-wal'`;
   `sqlite-recovery.mjs` and `sqlite-artifacts.mjs` both list four suffixes. A candidate's journal was
   therefore never removed by the engine, only later by the reclaim sweep. Three lists describing one
   fact about SQLite must not disagree.
5. **Report a close failure instead of swallowing it.** `closeIndex` swallows everything. A close
   that fails leaves a handle open on a file the next line unlinks, so a multi-GB index keeps its
   blocks for the life of the process and nothing says why. Keep the swallow — the caller cannot act
   on it — but emit a diagnostic. That only means something if a *double* close is not reported as a
   failure, so `OnlyPreviewSqliteIndex.close()` becomes idempotent: `node:sqlite` throws
   `ERR_INVALID_STATE` on a second close, the engine already closes defensively along overlapping
   paths, and item 1 adds one more (the reclaim closes the seed handle its caller's `finally` then
   closes again). The old `closeIndex` comment already claimed this idempotence at the engine
   boundary; now it is true one layer down instead of being simulated by swallowing.
6. **A `SQLITE_FULL` during traversal is reported as a full disk.** `isSqliteDiskFull` was added by
   183 with no call site. Wire it into the candidate build so a 13 surfaces the same truthful message
   as the precheck rather than a generic index error.
7. **A refused build does not re-walk the workspace.** `initialize` counts every entry in the
   workspace (1.7M files on the reference machine, tens of seconds) *before* reaching the precheck
   that refuses. Latch the refusal: record what the plan required, and on the next build re-measure
   free space with a single `statfs` before counting. Still short — fail immediately. Recovered —
   clear the latch and proceed. The latch is cleared on a successful promotion and on shutdown.

## Deliberately not done

- **No `search-index-v7` directory, no `SEARCH_SCHEMA_VERSION` bump.** Ral asked for a versioned
  index filename so a new build can detect and repair an old one. The repo already has that, better:
  `SEARCH_ENGINE_IDENTITY` is part of the identity triple checked on open, so a schema change
  invalidates every index in place and rebuilds it. A new directory would strand the old one — 6 GB
  per edition that nothing would ever open or delete again, which is the disk problem, not its fix.
  Item 1 is the part of his instruction that was actually missing: check and repair *before*
  rebuilding.
- **No main-process reclaim hook at app start.** The sweep already runs at exactly the moment he
  asked for — `initialize` calls `reclaimInterruptedSqliteArtifacts` before opening the database
  (`search-engine.mjs:311`) — and with item 3 it sweeps the whole index directory, not just the
  active database's artifacts. Reaching it from Main would mean Main importing preload search
  internals, which no other code here does. Cost of the narrowing: nothing is reclaimed for a user
  who never opens OnlyPreview, which is also a user whose index is not growing.
- **`tmp/` stays indexed** (Ral, 2026-09-18), unchanged from 183.

## Path

- `src/preload/onlypreview/search/core/search-engine.mjs` — items 1, 4, 5, 6, 7
- `src/preload/onlypreview/search/core/sqlite-recovery.mjs` — item 2
- `src/preload/onlypreview/search/core/sqlite-artifacts.mjs` — item 3
- `src/preload/onlypreview/search/core/sqlite-index.mjs` — item 5, idempotent `close()`
- `src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs` — `candidate-plan` had **no schema**, so
  183's plan diagnostic was emitted and silently dropped at every call; registered along with
  `candidate-reclaim` and `sqlite-close-failure`, in MiB because `count` saturates at 1e9 and a 6 GB
  index would have printed as 1000000000 bytes
- `tests/onlypreview/onlyPreviewIndexDiskBudget.test.mjs` — item 3
- `tests/onlypreview/onlyPreviewIndexReclaimBeforeRebuild.test.mjs` — new; items 1 and 7
- `tests/onlypreview/onlyPreviewSqliteRecovery.test.mjs` — item 2
- mirrored into `micromeet-cowork/apps/cowork` at the same relative paths
- `docs/INDEX.md`

## Contract change

`onlyPreviewSqliteRecovery.test.mjs:64` asserted that a second quarantine of the same database keeps
the first. Item 2 replaces that with supersede-and-delete, and the assertion is rewritten to state
the new contract rather than removed. The reference machine held ~10 GB in stacked quarantines of one
5.6 GB index; that is the cost the old contract was paying for a forensic copy nobody read.

## Verification

- A workspace whose config changed, with free space below `indexBytes + headroom` but above
  `headroom`, rebuilds: the dead database is deleted, the second plan reports `fresh`, and the build
  runs. With a *live* index the same shortfall still refuses and leaves the index serving.
- A second quarantine of one database leaves exactly one quarantine directory behind.
- With free space below the copy plus headroom, quarantine retains nothing and the corrupt artifacts
  are gone.
- A directory seeded with an aged `<db>.quarantine-<tmp>`, an aged `<db>.recovery-<uuid>`, and a
  fresh one of each is left with only the fresh pair; a quarantine whose owning database is absent is
  reclaimed on the orphan clock instead.
- After a refused build, the next build fails without counting the workspace; once space is freed it
  counts and proceeds.
- Existing search suites pass unchanged.

## Verified

- `tests/onlypreview/` search and index suites: **105 pass / 0 fail** in bitterless
  (`onlyPreviewIndexDiskBudget`, `onlyPreviewSqliteRecovery`, `onlyPreviewIndexReclaimBeforeRebuild`,
  `onlyPreviewSearchEngine.{recovery,sqlite,scope}`, `onlyPreviewSearchEngineSqliteIndex`,
  `onlyPreviewIndexRecovery`, `onlyPreviewCorruptIndex`, `onlyPreviewBackgroundIndex`,
  `onlyPreviewGlobalSearchEngine`). **69 pass / 0 fail** for the mirrored set in micromeet-cowork.
- Reverse-verified: neutralising the item-1 reclaim branch and the item-7 latch turns exactly the two
  tests that cover them red, and leaves the live-index test green.
- `yarn typecheck:node` (bitterless) and `yarn typecheck` (cowork) report only their pre-existing
  errors — 3 shared diagnostics on the `preload/onlypreview` surface, 19 in cowork — none in any file
  this task touched.
- No Electron, Playwright or E2E run.
