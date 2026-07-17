---
id: desktop-helper-process-isolation-001
scope: Node-only helper processes, GUI singleton, and non-blocking Home startup
status: done
depends-on: [todo-mcp-multi-instance, eyes-on-agents-global-onboarding-008]
---

# Desktop Helper Process Isolation

## Objective

Keep every background Codex helper out of the Electron GUI lifecycle and make the Bitterless Home
window the first visible, single-instance application surface during development and production.

## Context

- [Desktop helper startup issue](../../issues/archived/desktop-helper-dock-and-home-startup.md)
- [Todo MCP integration](../../features/todo-mcp.md)
- [EyesOnAgents Codex observation](../../features/eyes-on-agents-codex-observation.md)

## Required behavior

- Emit a dedicated Todo MCP build entry without Electron application/window imports.
- Generate POSIX and Windows shims that execute the helper with `ELECTRON_RUN_AS_NODE=1`, retain the
  pinned bridge endpoint, preserve quoting, and exit naturally when stdio closes.
- Refresh the owned Todo MCP shim before Core SQLite readiness so degraded startup still replaces
  the legacy GUI-entry launcher; bridge availability remains a separate concern.
- Keep stale app-main helper invocations windowless while the GUI replaces their shims.
- Refresh exact owned EyesOnAgents helper artifacts before listener startup while leaving hook
  settings byte-identical and failing closed for drifted definitions.
- Request the single-instance lock only in GUI mode and focus current Home on a second launch.
- Initialize a system-language fallback before the first GUI await, then create Home after bounded
  hidden-SQLite-document and persisted-layout attempts. Degraded startup shows the Home shell
  immediately instead of depending on `ready-to-show`.
- Run Core SQLite readiness and persisted-language hydration in the fenced optional lifecycle after
  Home. On timeout, retain the visible fallback shell and keep SQLite-dependent integrations
  disabled.

## Expected paths

- `electron.vite.config.ts`
- `src/main/app.main.ts`
- `src/main/windows/mainWindow.helper.ts`
- `src/main/i18n/applicationLanguage.service.ts`
- `src/shared/i18n/applicationLanguage.ts`
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
- Startup tests prove unresolved EyesOnAgents work cannot precede or block Home, and only GUI mode
  owns the single-instance lock.
- Deterministic never-resolving SQLite-document, Core-readiness, and layout fixtures prove Home
  still creates and becomes visible within the bounds, independent of `ready-to-show`, and an early
  quit path has initialized main-process i18n.
- Relevant typechecks, build, compiled-helper smoke checks, and `git diff --check` pass.

## Reviews

- [Round 1](../reviews/desktop-helper-process-isolation-001-1.md) — changes requested for optional
  startup/cleanup overlap.
- [Round 2](../reviews/desktop-helper-process-isolation-001-2.md) — accepted after lifecycle fencing.
- [Round 3](../reviews/desktop-helper-process-isolation-001-3.md) — accepted for bounded Core,
  layout, and language fallback behavior.
- [Round 4](../reviews/desktop-helper-process-isolation-001-4.md) — accepted after live verification
  added bounded hidden-document loading and immediate degraded Home visibility.
