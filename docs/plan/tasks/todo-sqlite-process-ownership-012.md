---
id: todo-sqlite-process-ownership-012
scope: move synchronized Todo SQLCipher ownership from Main to the Core SQLite preload process
status: implemented; owner verification pending
depends-on: [todoist-sync-desktop-001, todo-renderer-refresh-stability-011]
---

# Todo SQLite process ownership

## Objective

Make the hidden Core SQLite preload the sole owner of the synchronized Todo database and runtime.
Todo renderer, Home auth, MCP, and host lifecycle code communicate with it through `electron-xpc`;
Electron Main must never open or directly operate the Todo SQLCipher database.

## Context

- `docs/issues/todo-sqlite-owned-by-main-process.md`
- `docs/features/todoist-sync.md`
- `docs/plan/analysis/todoist-sync.md`
- `docs/plan/reviews/todo-sqlite-process-ownership-012-1.md`
- `docs/plan/tasks/todo-renderer-refresh-stability-011.md`

## Process contract

```text
Todo/Home renderer ── typed XPC request ───────────────┐
                                                       ▼
MCP bridge in Main ── typed XPC client ────────> Core SQLite preload
                                                  owns session + HTTP sync
Main lifecycle ────── activate/deactivate XPC ──> owns Repository + SQLCipher
                                                  emits Todo broadcasts

Main XPC center routes opaque messages only.
Main OS services: safeStorage encrypt/decrypt, open Date & Time settings.
```

## Implementation contract

- Relocate the Todo sync database, migration, repository, password/key-file, Snowflake, HTTP client,
  coordinator, clock, and session modules under the Core SQLite preload boundary.
- Keep these modules Electron-layer neutral where native tests import them; inject broadcast and
  OS-capability adapters. Only the SQLite preload composition root may instantiate the production
  runtime.
- Add preload handlers for session, Domain, Todo, Step, event, clock, and sync status. Register them
  only for the actual SQLite target document and wait for Core SQLite boot before activation.
- Move renderer emitters to the SQLite handler contracts and preserve mutation origin envelopes.
  Interpret results by method contract: required reads fail closed on absent/malformed data,
  optional entity results stop on `null`/`undefined`, and void writes require no generic ACK.
- Replace Main repository access in MCP with a typed XPC repository adapter. Replace auth and app
  cleanup imports with a session emitter.
- Split Date & Time settings into a narrow Main OS handler. Password key-file IO stays in SQLite;
  only raw encrypt/decrypt capability calls cross to Main.
- Remove Main's Todo XPC handler registration and all Main runtime imports of SQLite-owned modules.
- Add a greppable boundary script that rejects forbidden Main imports/constructors and proves the
  SQLite preload composition root registers the runtime.
- Clear a failed lazy session-construction promise so a transient preload capability failure can be
  retried. Treat each SQLite preload `targetId` as a runtime generation: reload a crashed hidden
  renderer, invalidate Home's old activation, and reactivate only Todo sync for the current account.
- Bound every Todo/Core XPC client call so a lost preload reply cannot hang a renderer, MCP request,
  auth activation, or shutdown. Preserve returned data and `null` exactly; normalize transport
  `null` to `undefined` only at MCP methods whose public contract is an optional entity.

## Path

- `docs/INDEX.md`
- `docs/features/todoist-sync.md`
- `docs/issues/todo-sqlite-owned-by-main-process.md`
- `docs/plan/README.md`
- `docs/plan/analysis/todoist-sync.md`
- `docs/plan/tasks/todo-sqlite-process-ownership-012.md`
- `electron.vite.config.ts`
- `src/preload/sqlite/sqlite.preload.ts`
- `src/preload/sqlite/todoistSync/`
- `src/shared/sqlite/coreSqliteRuntime.shared.ts`
- `src/shared/todoistSync/`
- Todo renderer/Home emitters
- `src/renderer/home/src/xpc/todoistSyncRuntime.subscriber.ts`
- `src/main/startup/coreSqliteRuntimeRecovery.service.ts`
- Main app/auth/MCP XPC clients and OS-capability handler
- focused static/typecheck scripts

## Verification

- Static process-boundary check: no forbidden Todo storage/runtime import or constructor under
  `src/main/`; no Main Todo CRUD/session handler registration; SQLite preload runtime registration
  is present.
- `yarn typecheck:node`
- `yarn typecheck:todo-web`
- `yarn typecheck:todoist-sync`
- `yarn typecheck:mcp`
- `git diff --check`
- Electron runtime verification is explicitly handed to Ral.

## Completion — 2026-07-23

- Todo SQLCipher, migrations, repository, key-file IO, Snowflake allocation, HTTP client,
  coordinator, polling timer, outbox/reconciliation, sync status, clock persistence, and active
  session now live under `src/preload/sqlite/todoistSync/` and are composed by the Core SQLite
  preload.
- Todo/Home renderer requests and the Main-owned MCP socket reach the preload-owned handlers through
  typed `electron-xpc` emitters. Main retains only opaque routing, the local MCP socket, safeStorage
  encryption/decryption, the fixed Date & Time action, and hidden-window lifecycle recovery.
- Commit broadcasts originate in SQLite and retain the renderer origin; remote/MCP commits use a
  null origin. Result handling is method-specific and does not assign a global success/failure
  meaning to `null`. The installed XPC library's `undefined`-to-`null` normalization is covered by
  the process-boundary regression test.
- Lazy session creation retries after transient failure. A reloaded SQLite preload broadcasts a new
  runtime generation; Home fences the old activation and restores polling for the current eligible
  account without restarting unrelated authenticated runtimes.
- Every Todo/Core XPC client has a bounded wait. The wrapper preserves valid values, including
  `null`; optional MCP entity methods alone translate the installed XPC transport's `null` back to
  their public `undefined` absence contract. UI move and Step-create flows stop before dependent
  writes or refreshes when the optional entity is absent. Core target registration/ready and the
  preload's path, safeStorage, legacy Core-password, and Date & Time capability calls are bounded at
  their innermost client, so a cached session/bootstrap promise can reject instead of staying
  permanently pending. A password-capability timeout is never treated as corrupt ciphertext.
- Static boundary, strict Todo/MCP/Todo-web type checks, native synchronization tests, startup and
  customer-auth recovery tests pass. Ral still owns Electron login, CRUD, MCP, sync, crash/reload,
  logout, and restart verification.
