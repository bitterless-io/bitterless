---
id: desktop-helper-process-isolation-001
scope: Node-only helper processes, GUI singleton, and strict SQLite-first startup
status: in-progress
depends-on: [todo-mcp-multi-instance, eyes-on-agents-global-onboarding-008]
---

# Desktop Helper Process Isolation

## Objective

Keep every background Codex helper out of the Electron GUI lifecycle while making successful Core
SQLite boot the mandatory first application dependency before Home or any other runtime work.

## Context

- [Desktop helper startup issue](../../issues/desktop-helper-dock-and-home-startup.md)
- [Todo MCP integration](../../features/todo-mcp.md)
- [EyesOnAgents Codex observation](../../features/eyes-on-agents-codex-observation.md)

## Required behavior

- Emit a dedicated Todo MCP build entry without Electron application/window imports.
- Generate POSIX and Windows shims that execute the helper with `ELECTRON_RUN_AS_NODE=1`, retain the
  pinned bridge endpoint, preserve quoting, and exit naturally when stdio closes.
- Keep stale app-main helper invocations windowless while the GUI replaces their shims.
- Refresh exact owned EyesOnAgents helper artifacts before listener startup while leaving hook
  settings byte-identical and failing closed for drifted definitions.
- Request the single-instance lock only in GUI mode and focus current Home on a second launch.
- Initialize only the minimum handlers required by SQLite, then create its hidden window and await
  the target preload's explicit successful Core boot result. The initial `about:blank` preload
  response is ignored, and HTML `did-finish-load` is not a database-readiness prerequisite.
- Prove connection readability after applying the SQLCipher key with
  `SELECT COUNT(*) AS object_count FROM sqlite_master`; accept `0` for a new empty database and any
  non-negative count for an existing database, while query failure aborts startup.
- SQLite failure aborts GUI startup; no language hydration, Home, Tray, Todo shim, MCP, or
  EyesOnAgents initialization may occur on the failure path.
- After SQLite success, hydrate the durable language strictly, create Home with persisted layout,
  refresh the Todo shim, and then start optional MCP/EyesOnAgents work.

## Expected paths

- `electron.vite.config.ts`
- `src/main/app.main.ts`
- `src/main/startup/`
- `src/main/windows/mainWindow.helper.ts`
- `src/main/i18n/applicationLanguage.service.ts`
- `src/preload/sqlite/sqlite.preload.ts`
- `src/preload/sqlite/sqliteHelper/sqlite.manager.ts`
- `src/preload/sqlite/sqliteHelper/coreSqliteReadProbe.ts`
- `src/preload/sqlite/messageServer/messageServer.ts`
- `src/shared/i18n/applicationLanguage.ts`
- `src/shared/mcp/mcpBridge.type.ts`
- `src/main/mcp/`
- `src/main/xpc/mcp.handler.ts`
- `src/shared/mcp/mcpBridge.shared.ts`
- `src/main/eyesOnAgents/codexDesktopBridge.service.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `scripts/mcp/`
- `scripts/eyes-on-agents/`

## Verification

- MCP tests prove Node mode, the dedicated artifact, pinned routing, quoting, and legacy no-Dock
  behavior.
- EyesOnAgents tests prove exact legacy artifacts refresh before listener startup without config
  mutation or generic repair.
- Startup tests prove target-preload/Core success precedes language, Home, Tray, Todo shim, MCP, and
  EyesOnAgents; missing registration, timeout, or failure produces none of those side effects.
- The read-probe contract accepts `0` for a new empty schema, accepts a non-negative populated
  schema count, and fails closed for invalid/unreadable results before Core can report readiness.
- Startup coordinator tests and source-contract checks cover the required ordering and fail-closed
  paths; owner verification exercises the real preload-to-main handshake and early quit path.
- Relevant typechecks, build, compiled-helper smoke checks, and `git diff --check` are release
  verification gates; the latest real-startup check is intentionally handed to the owner.

## Reviews

- [Round 1](../reviews/desktop-helper-process-isolation-001-1.md) — changes requested for optional
  startup/cleanup overlap.
- [Round 2](../reviews/desktop-helper-process-isolation-001-2.md) — accepted after lifecycle fencing.
- [Round 3](../reviews/desktop-helper-process-isolation-001-3.md) — accepted for bounded Core,
  layout, and language fallback behavior.
- [Round 4](../reviews/desktop-helper-process-isolation-001-4.md) — accepted after live verification
  added bounded hidden-document loading and immediate degraded Home visibility.
- [Round 5](../reviews/desktop-helper-process-isolation-001-5.md) — changes requested for an
  unbounded post-Core layout read and insufficient fatal-timeout/single-flight behavior coverage.
- [Round 6](../reviews/desktop-helper-process-isolation-001-6.md) — no confirmed code defect,
  pending one controlled real startup.

Round 4's degraded-startup contract was superseded by the owner's SQLite-first correction and is
not the acceptance basis for the reopened task.

The Round 6 live handoff then failed at the still-present `did-finish-load` prerequisite. The
current implementation replaces document completion with a generation-bound target-preload signal
and the schema read probe above. Per owner direction, no further agent-run Electron launch is
performed; owner verification remains pending.
