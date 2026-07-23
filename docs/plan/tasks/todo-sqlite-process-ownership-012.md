---
id: todo-sqlite-process-ownership-012
scope: move synchronized Todo SQLCipher ownership from Main to the Core SQLite preload process
status: in-progress
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
- Move renderer emitters to the SQLite handler contracts. Preserve mutation origin envelopes and
  fail closed on unavailable/malformed XPC results.
- Replace Main repository access in MCP with a typed XPC repository adapter. Replace auth and app
  cleanup imports with a session emitter.
- Split Date & Time settings into a narrow Main OS handler. Password key-file IO stays in SQLite;
  only raw encrypt/decrypt capability calls cross to Main.
- Remove Main's Todo XPC handler registration and all Main runtime imports of SQLite-owned modules.
- Add a greppable boundary script that rejects forbidden Main imports/constructors and proves the
  SQLite preload composition root registers the runtime.

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
- `src/shared/todoistSync/`
- Todo renderer/Home emitters
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
