---
id: desktop-helper-process-isolation-001
scope: Node-only helper processes, GUI singleton, and observable SQLite-first startup
status: in-progress
depends-on: [todo-mcp-multi-instance, eyes-on-agents-global-onboarding-008]
---

# Desktop Helper Process Isolation

## Objective

Keep every background Codex helper out of the Electron GUI lifecycle while starting Core SQLite
first without allowing its readiness or failure to block the visible application startup.

## Context

- [Desktop helper startup issue](../../issues/desktop-helper-dock-and-home-startup.md)
- [Startup diagnostics](../../features/startup-diagnostics.md)
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
- Initialize only the minimum handlers required by SQLite, then create its hidden window first and
  observe its explicit result in the background. No registration, document, Core, or elapsed-time
  wait may block Home and independent startup work.
- Prove connection readability after applying the SQLCipher key with
  `SELECT COUNT(*) AS object_count FROM sqlite_master`; accept `0` for a new empty database and any
  non-negative count for an existing database, while query failure fails Core readiness and records
  a startup issue.
- Initialize a system-language fallback, create Home with default bounds, refresh the Todo shim,
  and initialize Tray while SQLite remains pending.
- Keep the internal SQLite BrowserWindow hidden in every mode so concurrent Core startup cannot
  cover or focus ahead of Home.
- Start Home's language subscription and snapshot request before mount, but do not await the request
  as a mount gate. Mount with the documented bootstrap locale and hydrate it in place.
- After SQLite success, hydrate the durable language and start SQLite-dependent MCP/EyesOnAgents
  work. On explicit failure, keep the GUI alive and publish a revisioned startup issue.
- Show startup issues in a background-led Home menubar button; hover or keyboard focus lists the
  localized stage and concise error for each issue.

## Expected paths

- `electron.vite.config.ts`
- `src/main/app.main.ts`
- `src/main/startup/`
- `src/shared/startup/`
- `src/main/xpc/mainWindow.handler.ts`
- `src/main/windows/mainWindow.helper.ts`
- `src/main/windows/sqliteWindow.helper.ts`
- `src/main/i18n/applicationLanguage.service.ts`
- `src/preload/sqlite/sqlite.preload.ts`
- `src/preload/sqlite/sqliteHelper/sqlite.manager.ts`
- `src/preload/sqlite/sqliteHelper/coreSqliteReadProbe.ts`
- `src/preload/sqlite/messageServer/messageServer.ts`
- `src/renderer/home/src/components/MenuBar/`
- `src/renderer/home/src/main.ts`
- `src/renderer/common/i18n/`
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
- Startup coordinator checks prove the SQLite renderer starts before foreground work, while its
  pending state or explicit failure cannot block Home, Todo shim, or Tray.
- The read-probe contract accepts `0` for a new empty schema, accepts a non-negative populated
  schema count, and fails closed for invalid/unreadable results before Core can report readiness.
- Diagnostics checks cover subscribe-before-fetch, revision ordering, stage replacement/clearing,
  and menubar visibility. Owner verification exercises the real preload-to-main lifecycle.
- Owner verification confirms that only Home becomes visible, its shell renders while language IPC
  is pending, and a later language snapshot updates the mounted UI.
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
- [Round 7](../reviews/desktop-helper-process-isolation-001-7.md) — changes requested for scripted
  checks that still encoded the superseded fatal Core gate.
- [Round 8](../reviews/desktop-helper-process-isolation-001-8.md) — changes requested for missing
  diagnostics revision, replacement, clearing, and stale-snapshot coverage.
- [Round 9](../reviews/desktop-helper-process-isolation-001-9.md) — static review passed after the
  runtime and verification contracts converged; owner runtime verification remains pending.

Round 4's degraded-startup contract was superseded by the owner's SQLite-first correction and is
not the acceptance basis for the reopened task.

The Round 6 live handoff then failed at the still-present `did-finish-load` prerequisite. That gate
was replaced by a generation-bound target-preload signal and the schema read probe above.

The next owner run exposed a 30-second target-registration timeout. The owner clarified that
SQLite-first is launch priority rather than a readiness barrier. The current correction removes
elapsed-time failure semantics, continues foreground startup, and surfaces explicit failures in
the Home menubar.

The following owner run exposed the remaining foreground races: the development SQLite renderer
could surface above Home, while Home itself still treated language IPC as a pre-mount barrier. The
current correction keeps the internal renderer hidden and makes Home language hydration fail-open.
