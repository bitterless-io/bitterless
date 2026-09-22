---
id: onlypreview-index-cache-budget-185
scope: Bound the total size of the OnlyPreview search-index cache with LRU eviction — mirrored to micromeet-cowork
status: cap chosen (10 GB) and enforced; eviction + auto_vacuum implemented; the user-visible setting is not built
depends-on: [onlypreview-index-scratch-and-leaks-183]
verify: node --test tests/onlypreview/onlyPreviewBackgroundIndex.test.mjs tests/onlypreview/onlyPreviewWorkspaceConfigDirectory.test.mjs; yarn typecheck:node; no Electron/Playwright/E2E
---

# Phase 3 — a cache budget, so this cannot recur

Plan: [index disk budget](../../features/onlypreview-index-disk-budget.md).

Every workspace ever opened keeps a permanent database under `search-index-v6/`. There is no budget,
no LRU, no age-out — which is how three editions reached 24.5 GB and filled a 926 GB disk. Phases 1
and 2 shrink each index; only this bounds the total.

## Required behavior

1. A global cap on the `search-index-v6/` directory, evicting least-recently-opened workspaces
   first. The active workspace is never evicted.
2. Eviction is of a **cache**, not data: it costs a background rebuild on next open, nothing else.
3. The cap is a visible setting with the chosen default.
4. `PRAGMA auto_vacuum = INCREMENTAL` on newly created databases, so deletes return pages instead of
   leaving the file at its high-water mark. (Freelist on the measured database is 2 MB today, so
   this is about the future, not a present saving.)

## Decision

**10 GB**, taken 2026-09-22 (Ral:「都修复掉」against a list that carried this recommendation).
`ONLY_PREVIEW_INDEX_CACHE_CAP_BYTES` in
`src/preload/onlypreview/search/core/index-cache-budget.mjs`.

## Shipped

1. LRU eviction on every workspace open, keyed on a `usage.json` ledger in the index directory
   rather than mtime — a database that is only ever read keeps the mtime of the day it was built,
   so mtime ordering would evict exactly the wrong one. Missing ledger entries fall back to mtime,
   which is what every pre-upgrade database has.
2. A database is evicted with its whole group (`-wal`, `-shm`, `.candidate-*`, `.previous-*`,
   `.recovery-*`, `.quarantine-*`), matched by "name starts with the database name". Nothing outside
   a group is touched — the ledger itself included.
3. The active database is never evicted, even alone over the cap: deleting it saves nothing and
   forces the open in progress to rebuild.
4. `PRAGMA auto_vacuum = INCREMENTAL` on brand-new databases only. It cannot be set on a database
   that already has tables without a full `VACUUM`, which is a whole-file rewrite and must not
   happen on the open path; existing databases pick it up at their next rebuild, because a rebuild
   builds a fresh candidate.

Guard: `tests/onlypreview/onlyPreviewIndexCacheBudget.test.mjs` (6 cases).

## Not built

**The user-visible setting.** The cap is a constant, not a preference. Adding one means the shared
`OnlyPreviewSettings` type, the main settings service and its validation, the renderer store, the
settings surface and both i18n catalogs — about the same size again as everything above, for an
affordance nobody has asked to change. Deliberately deferred, not forgotten.

## Original reasoning for the cap

**The cap.** After phases 1–2 the reference workspace's index is roughly 1.4 GB, so:

| cap | holds | rebuild pain |
| ---: | --- | --- |
| 5 GB | ~3 large workspaces | frequent if projects rotate |
| 10 GB | ~7 large workspaces | rare |
| 20 GB | ~14 large workspaces | almost never; most of a small SSD's slack |

Recommendation: **10 GB**. An order of magnitude below where this landed, holds a week of normal
rotation, and a rebuild is background minutes rather than lost work.
