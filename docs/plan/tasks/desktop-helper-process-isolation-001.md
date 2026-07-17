---
id: desktop-helper-process-isolation-001
scope: Node-only helper processes, GUI singleton, and non-blocking Home startup
status: in-progress
depends-on: [todo-mcp-multi-instance, eyes-on-agents-global-onboarding-008]
---

# Desktop Helper Process Isolation

## Objective

Keep every background Codex helper out of the Electron GUI lifecycle and make the Bitterless Home
window the first visible, single-instance application surface during development and production.

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
- Create Home after SQLite and language readiness, before optional MCP/EyesOnAgents runtime work.
- Give Core SQLite readiness and persisted main-window layout reads explicit startup bounds. On
  timeout, initialize the Home shell with a system-language fallback and keep SQLite-dependent
  integrations disabled.

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
- A deterministic never-resolving SQLite/layout fixture proves Home still creates within the bound
  and an early quit path has initialized main-process i18n.
- Relevant typechecks, build, compiled-helper smoke checks, and `git diff --check` pass.
