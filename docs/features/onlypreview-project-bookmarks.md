# OnlyPreview Project bookmarks

Current loading visibility follows [Project loading gates](onlypreview-project-loading-gates.md):
show bookmarks only after the current root listing is ready, including a successful empty root.

Status: implemented; owner testing pending, 2026-09-08. Supersedes the top bookmark bar and
setting-store persistence in task 165; selection focus behavior is unchanged.

## Layout and interactions

```text
Project | Recents                 Collapse  Locate
------------------------------------------------
notes.md                                      ×   fixed bookmarks
design                                        ×   (Project only)
------------------------------------------------
project-root                                  ↑
  files and folders                           │   independent tree scroll
                                              ↓
```

- Put `onlypreview__bookmarks` inside Project, above its root/tree scroll container.
  Switching to Recents hides this region. Tree scrolling never moves the bookmarks.
- Vertical, full-width rows: left-aligned file/folder name, right-aligned Remove bookmark
  IconBtn. No leading bookmark, file or folder SVG. Name ellipsis and full-path tooltip.
  Remove is a sibling button and never activates the bookmark or deletes its disk target.
- Reuse the existing system font, 14px tree type, 22px rows, white/surface backgrounds,
  ink #25283a, divider #d9ddea and existing blue hover/focus tokens. No new theme or cards.
- A bounded bookmark region may scroll independently when many bookmarks exist; it must
  leave useful space for the tree. Empty state is compact; storage failure is visible with Retry.
- File click retains existing preview/Recents behavior; folder click locates, selects and
  expands it without switching Project. Native tree Add bookmark remains, root is forbidden.
  Preserve missing-target removal, duplicate-add order and the 1,000-entry bound.

## Storage and commit flow

Previous latency contributors visible in code: Main read/CAS calls went through the global
SettingDao; after a write the changed-event subscriber and the action's own completion each
triggered another snapshot read. Menu cancellation also reread storage. Cowork additionally
reread and rewrote its full `settings.json` through the Main adapter. These are source-confirmed
extra operations, not a measured breakdown of the owner's reported wall-clock delay.

- Each canonical Project root has a separate durable, plaintext state SQLite under the current
  edition's application userData, keyed by SHA-256 of the canonical root. Its path/schema are
  independent of derived search-index databases and of index generation/config hashes.
  A/B/A, application restart and tab/window moves restore only that Project's bookmarks.
- Bookmark SQLite reads, transaction writes and filesystem access belong to the existing trusted
  SQLite renderer preload so indexing cannot queue bookmark writes. Main only
  validates host/Project authority and routes a narrow operation; renderer input cannot choose
  an arbitrary database path or another Project. Ordinary application settings are not migrated.
- Reuse electron-xpc with a private random capability-bound handler name delivered only to the
  SQLite preload. Visible renderer APIs carry host/Project references, not root/DB paths or this
  capability. Requests have bounded failure; do not add a new IPC protocol or polling loop.
- On first access, migrate existing root-keyed `onlypreview_bookmarks` data once, transactionally.
  Preserve order and paths, retain the old source for recovery, and never resurrect deleted
  bookmarks on a later restart. A migration error is not an empty successful list.
- Add/remove returns the committed snapshot. UI changes only after success, applying that
  snapshot directly instead of issuing duplicate refresh reads. Publish the same committed
  snapshot to other relevant hosts if needed. Opening/cancelling a native menu does not reload.
- Serialize overlapping writes, reject stale Project/host authority, and prevent an old read,
  mutation response or event from replacing a newer snapshot or another Project's UI.
  Failed writes retain the last confirmed entries and expose an error. No index wait/rebuild,
  filesystem traversal, file-content read or optimistic false success in bookmark persistence.

## Verification and delivery boundary

Code-level tests cover real SQLite persistence/restart, A/B separation, index DB separation,
one-time migration including remove/restart, concurrent mutations and failure handling;
renderer commit ordering and stale Project fencing; fixed Project-only placement, icon removal,
right-side removal without activation, SFC/Less compilation and touched TypeScript contracts.
Ral owns live acceptance. No Electron/E2E, independent review, app launch, packaging or Git sync.

Cowork counterpart: `docs/features/onlypreview-project-bookmarks.md` and task mini-033.

## Code verification — 2026-09-08

`node --test tests/onlypreview/onlyPreviewBookmarks.test.mjs tests/onlypreview/onlyPreviewBookmarkStorage.test.mjs`:
20/20 passed. Includes real SQLite and
the private XPC/preload path, migration/restart, rollback, Project isolation, stale completions,
commit-driven UI and no duplicate reads. SFC/Less and relevant TS transforms, targeted semantic
TypeScript for six new core modules and scoped new-code/test lint pass.

A disposable local sample of 20 open/commit/close mutations took 58.1ms total on the final run
(approximately 2.9ms per operation). This is storage-only, not a live UI or indexing-load benchmark.
No Electron/E2E, packaging, install, independent review or Git sync was run.
