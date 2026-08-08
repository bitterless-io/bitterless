---
id: onlypreview-recent-directory-006
scope: Persist and restore OnlyPreview's last canonical directory across application restarts
status: implemented; owner verification pending
depends-on: [onlypreview-shell-ux-005]
---

# Objective

Remember the last successfully opened canonical OnlyPreview directory in the existing Core SQLite
`setting` table, restore it into one fresh workspace when OnlyPreview is next opened, and preserve
explicit OS-file ordering, host isolation, and fail-closed behavior when storage or the directory is
unavailable.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-shell-ux-005.md`

# Path

- `src/main/onlypreview/onlyPreviewRecentDirectory.service.ts`
- `src/main/app.main.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/runtime.entry.ts`
- `tests/onlypreview/fixtures/onlyPreviewApp.fixture.ts`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-recent-directory-006.md`

# Implementation Constraints

1. Store `{ version: 1, directoryPath }` under `key: 'onlypreview_workspace'` and
   `sub_key: 'last_directory'`. Persist only the canonical workspace root returned after a
   successful `createForTarget`: the selected directory for a folder target or the parent for an
   OS-opened file. Never persist a file selection, `workspaceId`, `hostId`, `hostToken`, asset
   token, raw picker input, or unvalidated path.
2. Access this record only through the value-free-log `SettingDao.getStored`, `insertIfAbsent`, and
   `compareAndSet` methods. Do not call `get` or `upsert`, add path/value logging, change the schema,
   or add a migration. Insert/CAS writes must be generation-fenced so an older folder/restore result
   cannot overwrite the latest explicit target.
3. Add one Core SQLite ready/failure latch. `app.main.ts` resolves it from the existing
   `handleCoreSqliteReady` and `handleCoreSqliteFailure` callbacks. History restore waits for the
   latch; failure returns `null` without blocking folder or OS-file opens. Successful opens before
   readiness update Main memory and retain only the latest canonical directory to flush after ready.
4. Coalesce concurrent Shell and Preview `restoreWorkspace` calls into one promise per content
   host. Recheck the current host workspace before and after waiting for SQLite, mint one new
   workspace capability with no selected file, and return that same workspace to both callers.
   Remove per-host restore promises, mutation generations, and transient state on host revoke,
   standalone teardown, auth invalidation, and quit.
5. Treat the stored path as an untrusted candidate. Parse only version 1 and revalidate it with the
   normal `createForTarget` path. Missing, malformed, non-directory, or permission-denied candidates
   return the empty state and CAS-clear the record to `null` only against its exact observed
   `serializedValue`; cleanup must not erase a concurrently stored newer directory.
6. Suppress history restoration and advance the explicit-target generation before
   `ensureStandalone()` for a Main-owned OS file target. A late restore cannot replace an explicit
   target; serialized explicit requests remain latest-wins, and the winning target's canonical
   directory becomes the remembered value.
7. Keep the renderer API unchanged and preserve standalone-only Shell/Preview siblings, existing
   workspace/path containment, fresh opaque capabilities, folder-only visible picker, settings,
   native file actions, DevTools, media/PDF support, and all read-only/security/logging rules. Add
   no dependency and do not modify or stage the unrelated existing `package.json` DEBUG-name change.

# Verification

- `node --test tests/onlypreview/*.test.mjs`, covering value parsing, ready/failure latch,
  pre-ready latest-write flush, insert/CAS conflict and stale generation, invalid candidate CAS
  clear, per-host Shell/Preview single flight, host cleanup, and explicit-target-over-history order
- `yarn typecheck:node`
- `yarn typecheck:web`
- `yarn check:renderer-i18n`
- targeted error-level ESLint for touched TS/test sources
- `yarn build`
- Electron/Node unit tests must simulate a complete storage lifecycle and fresh host creation to
  prove directory-only restoration plus explicit-target-over-history ordering without launching
  the full Bitterless application.
- Owner manual verification: restart Bitterless, open OnlyPreview without an explicit target, and
  confirm the last directory (but no selected file) returns; then launch an explicit file target
  and confirm it overrides stored history. Automated E2E must not launch the full application for
  this task because its startup integrations may access the macOS Keychain.
- `git diff --check`

# Delivery Evidence

- Implemented on 2026-08-08. OnlyPreview now stores the latest successfully opened canonical
  directory through the existing setting-table CAS API, restores it into one fresh workspace with
  no file selection, and lets a later explicit folder or OS-file target override stored history.
- Round 1 closure decouples successful explicit opens from optional persistence: canonical state is
  retained synchronously, the handled write chain runs in the background, and auth/quit teardown
  clears and generation-fences pending state while an ordinary window revoke preserves it.
- `node --test tests/onlypreview/*.test.mjs` passed 45/45 tests. The focused harness covers SQLite
  ready/failure behavior, pre-ready latest-write flushing, insert/CAS conflicts, stale-generation
  fencing, per-host Shell/Preview single flight, a fresh service/storage/host restart lifecycle,
  directory-only restoration, explicit-file override, a deferred storage read that cannot block a
  successful open, revoke/teardown pending-state behavior, host revocation, and log privacy.
- `yarn typecheck:node`, `yarn check:renderer-i18n`, targeted error-level ESLint, `yarn build`, and
  `git diff --check` passed. `yarn typecheck:web` remains the documented repository baseline and was
  not used as acceptance evidence for this Main-process-only change.
- Automated E2E was not run by explicit owner instruction: this task must not launch the full
  Bitterless application or risk startup integration access to the macOS Keychain. Ral should
  manually open a folder, restart Bitterless, enter OnlyPreview from Home, and confirm that the
  folder returns without a selected file; then open an explicit OS file, confirm it overrides the
  restored directory, and confirm its containing folder is restored without a selection after the
  next restart.

# Review

- [Round 1 — blocked by optional persistence coupling and teardown state](../reviews/onlypreview-recent-directory-006-1.md)
- [Round 2 — static source review pass; owner verification pending](../reviews/onlypreview-recent-directory-006-2.md)
