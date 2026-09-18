---
id: onlypreview-index-cache-budget-185
scope: Bound the total size of the OnlyPreview search-index cache with LRU eviction — mirrored to micromeet-cowork
status: blocked on one product decision (the cap)
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

## Blocked on

**The cap.** After phases 1–2 the reference workspace's index is roughly 1.4 GB, so:

| cap | holds | rebuild pain |
| ---: | --- | --- |
| 5 GB | ~3 large workspaces | frequent if projects rotate |
| 10 GB | ~7 large workspaces | rare |
| 20 GB | ~14 large workspaces | almost never; most of a small SSD's slack |

Recommendation: **10 GB**. An order of magnitude below where this landed, holds a week of normal
rotation, and a rebuild is background minutes rather than lost work.
