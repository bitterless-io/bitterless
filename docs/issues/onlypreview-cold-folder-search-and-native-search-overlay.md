# OnlyPreview cold folder search and PDF overlay ordering

Status: implemented; owner verification pending

## Symptoms

1. On the first launch after upgrading an existing Search cache, Files can return ordinary file
   matches but omits matching directories until startup reconciliation finishes.
2. Opening Global Search over a PDF can leave the search workspace hidden behind the PDF surface.
3. Search can repeatedly rebuild a large workspace, consume sustained disk/CPU, and leave multi-GB
   candidate databases behind.

## Root Causes

The schema-7 to schema-8 additive upgrade preserves the reusable file/content index but deliberately
removes the old non-file tree tier. The warm search therefore has no directory rows until the first
schema-8 traversal commits a complete tree snapshot. This is why later launches are fast while the
first upgraded launch cannot find a folder such as `network` immediately.

The PDF problem is a native-view ordering error, not a CSS error. The Shell is attached to the
`BaseWindow` first and the active Vue/Chrome Preview `WebContentsView` is attached later above it.
Global Search currently lives in the Shell DOM and asynchronously hides Preview by reporting zero
bounds. A raw Chromium PDF view can therefore cover the Shell before that bounds update, or be
reattached above it while search remains open. DOM `z-index` cannot cross sibling native views.

The startup log also proves a separate watcher failure: one runtime advanced through repeated full
reconcile revisions over the same roughly 63,646 entries. A recursive-watch error permanently
enters a fixed 30-second fallback, while a reconcile itself can exceed 30 seconds; each interval
therefore latches the next full build. Directory events under physically excluded `.git`,
`node_modules`, build, and output trees also escalate to full reconcile before exclusion is checked.
Interrupted builds left 39 exact-prefix candidate/previous SQLite artifacts and companions using
about 29GB in the current debug cache.

## Accepted Repair

- When a reusable content index has no certified directory tier, derive a bounded provisional
  directory-name tier from the already persisted eligible file paths. This performs no filesystem
  walk or body read, exposes only ancestors proven by the committed snapshot, and is replaced by
  the complete directory/symlink tier after reconciliation. Empty directories still require one
  completed schema-8 traversal.
- Render Global Search in one trusted local `WebContentsView` child application. It uses exactly
  the Preview content bounds and is re-added as the topmost child whenever an active Preview view
  attaches. Hiding search detaches only the search view; it does not reload PDF/HTML/Vue Preview.
- Keep Shell as the Project-tree/current-directory authority. Main holds one host-scoped context
  snapshot for the Search renderer and mediates directory reveal completion. A failed reveal keeps
  search open; a successful reveal closes it only after Project expands/selects/centers the folder.
- Keep the raw Chrome Preview preload-free. The trusted Search renderer uses the existing
  OnlyPreview preload, context isolation, sandbox, navigation fence, and generation/host contracts.
- Drop physically excluded paths before Search reconciliation while still refreshing an already
  loaded Project listing. Replace fixed permanent fallback with completion-aware exponential
  watcher reattachment so a slow build cannot schedule an endless successor.
- On Search initialization, remove only stale candidate/previous SQLite artifacts belonging to the
  exact active database basename. Never glob other workspace databases or the active DB/WAL/SHM.
- Compile anchorless full-segment wildcard rules into a shared segment matcher so equivalent
  languages are evaluated once per path. Preserve `*/` versus `**/` ordering for filenames that
  contain line terminators. Anchorless embedded-wildcard fallbacks have a fixed aggregate 64-state
  limit and reject an unsafe workspace config before traversal instead of consuming unbounded CPU.
  Later-exclude union coverage uses one non-refundable 16,384-credit ledger; all scale-dependent
  scans and allocations reserve credits before work, and exhaustion safely allows traversal.

## Acceptance

- A schema-7 cache upgraded on startup can find a directory with at least one committed indexed
  descendant before startup reconcile completes. Ordinary file/content warm behavior remains
  unchanged, and a fresh complete tree replaces provisional rows.
- A PDF or HTML raw Preview cannot cover Global Search, including when the Preview is selected or
  reattached while search is already active.
- Search and Preview receive the same clamped content rectangle. Closing/reopening search reuses
  the warm Search renderer and preserves the loaded Preview.
- Shell directory selection updates Search Current directory live. File open and directory reveal
  retain their existing success/failure and focus semantics.
- A burst under physically excluded directories causes no Search rebuild, and a recursive-watcher
  failure cannot create a 30-second full-reconcile loop. Exact stale build artifacts are reclaimed
  without touching active or unrelated databases.
- Maximum supported anchorless full-segment rule sets stay bounded; unsafe residual wildcard
  complexity fails before indexing and cannot turn one tree pass into minutes of matcher work.
- Focused unit/source tests, type checks, build, and diff checks pass. Electron/Playwright/E2E and
  the real app remain Ral-owned verification.

## Resolution

Implemented by
[onlypreview-cold-folders-native-search-overlay-043](../plan/tasks/onlypreview-cold-folders-native-search-overlay-043.md).
Independent [Review 10](../plan/reviews/onlypreview-cold-folders-native-search-overlay-043-10.md)
passed with no P1/P2/P3 finding. Real-app PDF layering and immediate cold-folder behavior remain
owner verification.
