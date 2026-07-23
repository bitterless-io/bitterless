# Todo SQLCipher is owned by the Electron Main process

Status: fixed; owner verification pending

Implementation: [todo-sqlite-process-ownership-012](../plan/tasks/todo-sqlite-process-ownership-012.md)

## Report

The synchronized Todo database is opened inside Electron Main. `TodoistSyncSessionService` resolves
the customer database path, obtains its password, constructs `TodoistSyncDatabase` and
`TodoistSyncRepository`, and exposes renderer CRUD through Main-owned XPC handlers. The coordinator
also reads and writes repository state in Main.

This violates Bitterless's process boundary. The existing hidden Core SQLite renderer/preload is the
only process that may load the cipher driver or own Todo database state. Todo renderer, MCP, auth,
and application lifecycle code must reach it through `electron-xpc`.

## Confirmed cause

- The Todoist-style runtime was originally implemented under `src/main/todoistSync/`; its session
  directly imports Electron `app`, the SQLCipher database, password/key service, Snowflake service,
  repository, HTTP coordinator, and clock state.
- `src/main/xpc/todoistSync.handler.ts` registers every Domain, Todo, Step, event, session, clock,
  and status method in Main and calls the in-process repository.
- Main's MCP bridge calls the same in-process repository rather than an XPC client.
- The SQLCipher driver and Todo migrations therefore load into Main even though
  `electron-xpc` already supports renderer-to-preload and Main-to-preload calls.

## Required correction

- Move the complete Todo runtime that owns or derives Todo state into the Core SQLite preload
  process: encrypted database, migrations, protected-key file IO, Snowflake generator, repository,
  HTTP client/coordinator, clock state, and active session.
- Register Todo session, CRUD, event, clock, and status handlers from the SQLite preload. Todo and
  Home renderers call those handlers directly through `electron-xpc`; Main must not register a Todo
  CRUD or session handler.
- Main remains only the generic XPC routing center and the owner of OS-only capabilities. SQLite may
  request `safeStorage` encryption/decryption and opening Date & Time settings through narrow XPC
  services, but Main must not receive a database path, SQL statement, repository object, or Todo
  projection for those capabilities.
- The Main-owned MCP socket bridge may act as a Todo API client, but every operation must call the
  SQLite preload through a typed XPC emitter. It must not import the SQLite runtime implementation.
- Database commit broadcasts originate in the SQLite process and retain the initiating
  `originRendererId`. The source Todo renderer ignores only its own broadcast; other renderers
  refresh. MCP/remote operations use a null origin.
- Shutdown, logout, and auth invalidation deactivate the SQLite-owned session through XPC before
  the hidden SQLite window is destroyed.
- A new SQLite preload `targetId` invalidates Home's cached Todo activation and reactivates the
  current eligible account. Main may reload the hidden renderer after a crash, but it never reads
  or reconstructs Todo state. Shutdown deactivation is bounded so a lost XPC reply cannot block
  application exit.
- XPC results are interpreted per operation. Required reads reject absent/malformed data; optional
  entity results treat `null`/`undefined` as no result; no-result writes accept the transport's
  `null`/`undefined` without inventing a generic success ACK or result code.

## Acceptance

- No runtime file under `src/main/` imports `better-sqlite3-multiple-ciphers`,
  `TodoistSyncDatabase`, `TodoistSyncRepository`, Todo migrations, or the SQLite-owned session.
- `src/main/xpc/` contains no Domain/Todo/Step/event/session/status storage handler. Main owns only
  the narrow OS-capability handler needed by the SQLite process.
- The SQLite preload registers Todo handlers only after its target document is identified, and
  activation alone instantiates the session and opens the customer SQLCipher database there.
  Static module evaluation in the same hidden preload process does not create database ownership.
- Todo renderer CRUD routes directly to the SQLite handler name; MCP uses an XPC client adapter.
- Main never constructs, returns, stores, or closes a Todo database/repository instance.
- A static process-boundary check, focused type checks, and `git diff --check` pass. Ral performs the
  Electron login, Todo CRUD, MCP, sync, logout, and restart runtime verification.
