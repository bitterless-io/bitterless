---
id: maestro-main-shell-004
scope: Maestro post-login main window and Workbench consolidation
status: implemented; owner verification pending
depends-on: [claude-subscription-ui-003]
---

# Objective

Make Maestro the primary window after a Bitterless session is authenticated. Keep the existing Home
renderer as the authentication bootstrap and recovery shell, hide it after Maestro is ready, and
restore it when the session is deactivated or invalidated. Consolidate the existing Home Settings,
Mini Apps, and Connector surfaces into Maestro Workbench as first-pass embedded views so Ral can
optimize their information architecture in a later iteration.

# Contract

- Bitterless still creates Home during startup because login and Core SQLite bootstrap live there.
- `AuthHandler.activateSession()` prepares and opens the existing singleton Maestro graph. Only
  after Maestro is ready does it hide Home, guarded by the existing activation generation fence.
- `AuthHandler.deactivateSession()` destroys Maestro and all authenticated secondary windows, then
  creates/shows Home for login or session recovery.
- Dock activation and a second-instance launch open/focus Maestro when the authenticated session is
  active; otherwise they show Home.
- Closing Maestro does not expose authenticated Home navigation as an alternate main shell. A later
  application activation recreates Maestro while the session remains active.
- Workbench adds localized `Apps`, `Connectors`, `Settings`, and `Configuration` panes. The first
  three reuse the current Home implementations through renderer aliases/adapters. Their old Home
  routes are removed from the authenticated route map so only Workbench registers connector
  callbacks and exposes these surfaces.
- `Configuration` owns Claude subscription account status/actions plus the fixed loopback `Local`
  provider and supported local model selection. No credential or remote-provider URL is accepted.
- Existing Maestro recording, skills, integrations, tools, models, about, and log panes continue to
  work and keep their current routes.

# Path

- `src/main/app.main.ts`
- `src/main/xpc/auth.handler.ts`
- `src/main/xpc/maestroWindow.handler.ts`
- `src/renderer/maestro/workbench/src/`
- `src/renderer/home/src/views/miniApp/`
- `src/renderer/home/src/views/connector/`
- `src/renderer/home/src/views/setting/`
- `src/shared/home/`
- `src/shared/connector/`
- `src/shared/maestro/coach.api.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `docs/features/maestro.md`
- `docs/plan/tasks/maestro-main-shell-004.md`

# Verification

For this delivery Ral will run all runtime and automated verification. The implementation handoff
must therefore contain a source-only audit and must not run tests, type checks, lint, builds,
Electron, Claude CLI, or network probes.

Ral's manual acceptance should confirm:

- Login transitions from Home into Maestro and leaves no visible duplicate Home window.
- Logout or authentication invalidation closes Maestro and returns to the Home login surface.
- Dock activation and a second launch focus the correct window for the current authentication state.
- Workbench can open Apps, Connectors, Settings, and Configuration without breaking existing panes.
- Mini App actions still open their singleton windows, connector drawers still initialize, and Home
  settings still read/write through their existing XPC and SQLite boundaries.
- Configuration can manage multiple Claude subscription profiles and configure the Local model
  provider without displaying or persisting Claude credentials.
