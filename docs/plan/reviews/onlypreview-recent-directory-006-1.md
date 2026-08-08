---
id: onlypreview-recent-directory-006-1
status: blocked
reviewed_task: onlypreview-recent-directory-006
target: 4df92d1e7584dbb062cd63b08f264b87c03e3dee
base: 5d841569df4513f0de972b331e717976db5f11bd
date: 2026-08-08
review_type: independent-source-and-node-no-electron
---

# Verdict

**BLOCKED — two P2 findings violate the optional-storage and host-cleanup contracts.**

The schema, value-free DAO surface, exact compare-and-set cleanup, fresh directory-only restore,
per-host restore single flight, explicit-before-`ensureStandalone()` ordering, generation checks,
and path-free logging are otherwise implemented as specified. The focused Node suite and build
pass, but the success-path storage await can indefinitely block an explicit folder or OS-file open,
and pre-ready remembered state survives every documented host/auth/quit cleanup hook.

# Findings

## P2 blocking — explicit opens await unbounded optional SettingDao persistence

After `createForTarget` succeeds and the generation is revalidated,
`openExplicitTarget()` awaits `rememberDirectory()` before returning the workspace
(`src/main/onlypreview/onlyPreviewRecentDirectory.service.ts:115-130`). In the ready state,
`rememberDirectory()` awaits the serialized flush, which in turn awaits `SettingDao.getStored()`
and then `compareAndSet()` or `insertIfAbsent()` without a timeout
(`src/main/onlypreview/onlyPreviewRecentDirectory.service.ts:237-294`). Catching a rejected promise
does not handle a request that never settles.

Both user-visible callers await that result before broadcasting the workspace; the Main-owned OS
route additionally waits before showing the standalone window
(`src/main/xpc/onlyPreview.handler.ts:61-85,293-306`). Therefore an XPC request that remains pending
after the initial Core SQLite ready signal can permanently block an otherwise successful explicit
open. It also holds the per-host mutation chain; for OS associations it holds the serialized open
queue as well. This contradicts task constraint 3 and the feature fallback requiring SQLite
unavailability never to block explicit folder/file opening or the standalone window
(`docs/plan/tasks/onlypreview-recent-directory-006.md:47-50`;
`docs/features/onlypreview.md:200-204,460-461`).

A bounded pure-Node probe configured a storage adapter whose `getStored()` never settles, marked
storage ready, and raced `openExplicitTarget()` against 200 ms. The result was:

```json
{"outcome":"timed-out","getCount":1,"workspaceCreated":true}
```

The workspace capability had already been created, but the explicit-open promise did not resolve,
so its handler could not publish it. The existing failure test only throws from `getStored()` and
therefore misses the non-settling case.

Required closure: record/fence the canonical pending directory synchronously and enqueue optional
persistence without making the explicit-open result, broadcast, window show, or host mutation queue
wait for that storage promise. Add a never-settling storage test that proves the explicit open
resolves first. Invalid-history cleanup should follow the same non-blocking rule when it is reached
from a host mutation.

## P2 blocking — host/auth/quit cleanup retains and later persists pre-ready directory state

`pendingDirectory` is global remembered state containing the canonical absolute path
(`src/main/onlypreview/onlyPreviewRecentDirectory.service.ts:49-55,237-240`). The host revoke hook
removes only `hostGeneration`, `hostMutationChain`, and `restoreFlights`; `clearTransientState()`
also leaves `pendingDirectory` intact and does not fence it
(`src/main/onlypreview/onlyPreviewRecentDirectory.service.ts:155-160,349-353`). Auth invalidation and
host quit call `hosts.clear()` followed by that incomplete cleanup
(`src/main/xpc/onlyPreview.handler.ts:309-318`). A later ready signal consequently flushes a path
owned by a revoked host.

A second pure-Node lifecycle probe opened a directory before readiness, revoked the content host,
called `clearTransientState()`, and then signalled ready. It observed:

```json
{"persistedAfterRevokeAndClear":true}
```

This violates task constraint 4 and the feature contract that host revoke, standalone teardown,
auth invalidation, and quit remove that host's transient remembered state
(`docs/plan/tasks/onlypreview-recent-directory-006.md:51-55`;
`docs/features/onlypreview.md:205-209`). The current lifecycle test opens only after storage is
already ready, so its write has completed and `pendingDirectory` has been cleared before teardown;
it does not exercise this required pre-ready cleanup case.

Required closure: associate pending state with its originating live host (or otherwise fence it)
and clear only the revoked host's still-pending value during host/auth/quit cleanup, without erasing
a newer live host's pending directory. Add the exact open-before-ready → revoke/clear → ready test
and assert that no insert/CAS occurs.

- P1 blocking: none.
- P2 blocking: the two findings above.
- P3 non-blocking: none.

# Contract Assessment

- Storage ownership and privacy pass: the service uses only `SettingDao.getStored`,
  `insertIfAbsent`, and `compareAndSet`; it adds no renderer contract, migration, dependency, or
  path/value log. The record contains only exact version 1 plus the canonical directory.
- Ready/failure latching passes for initial startup resolution and pre-ready latest-memory behavior;
  rejected storage calls are swallowed without logging. The first P2 covers the missing
  never-settling-storage boundary after ready.
- Concurrent Shell/Preview restores share one promise per content host, recheck workspace and host
  state, and mint one fresh directory workspace without a selected file.
- Stored candidates are parsed strictly, revalidated through `createForTarget`, and invalid values
  are cleared with `compareAndSet` against the exact observed serialized value. A concurrent
  replacement is preserved.
- OS explicit-target suppression advances before `ensureStandalone()`. Current/host generations
  prevent a late restore or stale completed workspace from replacing the latest explicit target.
- Existing standalone-only, Settings, native Menu, DevTools, media/PDF, capability containment,
  and renderer-API boundaries are outside the delta and remain covered by the passing Node source
  suite and build.

# Scope Audit

- Target `4df92d1e7584dbb062cd63b08f264b87c03e3dee` is the direct child of
  `5d841569df4513f0de972b331e717976db5f11bd`. It changes exactly seven files: the task record, three
  Main sources, two Node test files, and the Node runtime bundle entry.
- No shared renderer API, preload, renderer source, schema, migration, lockfile, dependency, or
  package file is changed by the target commit.
- The unrelated user-owned `package.json` diff was preserved. Its current diff SHA-256 is
  `3d1803a21e22dd01c928cd459520d6c0dc0a6b8c769571b505960d0bc032b5cd`.
- Concurrent coin/trench/i18n work visible in the working tree was not inspected as target scope,
  modified, staged, reverted, or included in this verdict.

# Verification

- `node --test tests/onlypreview/*.test.mjs` — pass, 43/43.
- `yarn typecheck:node` — pass.
- `yarn check:renderer-i18n` — pass.
- `yarn eslint --quiet` over the task-added recent-directory service plus the modified handler and
  OnlyPreview test/runtime files — pass.
- Whole touched-file ESLint including `src/main/app.main.ts` — existing baseline only: 15
  `no-empty` errors in unchanged cleanup blocks. The target adds only an import and the two storage
  latch calls in that file; none intersects those diagnostics. Task-added sources introduce no
  error-level ESLint diagnostic. Formatting warnings remain non-acceptance output because the task
  explicitly requires targeted error-level ESLint.
- `yarn build` — pass; Electron Vite emits Main, `out/preload/onlypreview.js`, and all three
  OnlyPreview renderer entries. This build command did not start the application.
- Bounded pure-Node hung-storage probe — reproduced the first P2: timeout after 200 ms while the
  workspace already existed.
- Bounded pure-Node pre-ready revoke/clear probe — reproduced the second P2: the directory was
  persisted after host revoke and transient cleanup.
- `git diff --check 5d841569df4513f0de972b331e717976db5f11bd..4df92d1e7584dbb062cd63b08f264b87c03e3dee`
  — pass.
- `yarn typecheck:web` — not run under the review instruction's allowed Main/Node gate set; the task
  records it as an existing repository baseline rather than acceptance evidence for this change.

No Playwright or Electron E2E command was run. Electron.app / the complete Bitterless application
was never launched, and no Keychain was accessed.

# Current Status

The working tree already contained concurrent user/agent-owned coin, trench, i18n, README, and
`package.json` changes. This review created only
`docs/plan/reviews/onlypreview-recent-directory-006-1.md`; it changed no source, task, package,
existing review, or other documentation file. No commit or push was performed.

# Conclusion

**blocked**
