# Bitterless Documentation

This directory is the entry point for current Bitterless design and delivery documents.
Older implementation notes remain under `doc/` and are reference-only unless linked from a current
design document.

## Feature contracts

- [Renderer language coordination](features/renderer-i18n.md) - one main-process language authority,
  live updates for every first-party renderer, and correct locale before recreated windows mount.
- [Maestro sub-application](features/maestro.md) - the Bitterless Mini App migrated from the
  Micromeet Cowork runtime.
- [Coin sub-application](features/coin.md) - full-width crypto analysis tabs with background Codex
  analysis and local resource configuration.
- [Coin layout](features/coin-layout.md) - full-width analysis console, Resources page, tab layouts,
  states, and responsive constraints.
- [Todo MCP integration](features/todo-mcp.md) - production-first local Todo access with isolated
  development instances.
- [Todoist-style Todo synchronization](features/todoist-sync.md) - independent encrypted
  per-customer SQLite, HTTP command/outbox sync, working-set-first bootstrap, and shared UI/MCP
  refresh without PowerSync or logical WAL.
- [EyesOnAgents Project filter](features/eyes-on-agents-project-filter.md) - Git-worktree-derived
  Project metadata and an All-column source filter.
- [EyesOnAgents Codex observation](features/eyes-on-agents-codex-observation.md) - global Hook
  lifecycle, lightweight reliable delivery, Codex trust review, and App Server independence.
- [EyesOnAgents last user prompt](features/eyes-on-agents-last-user-prompt.md) - narrow capture of one
  bounded latest user question per thread with content-free offline delivery and tiered All-thread
  App Server recovery.
- [Omni browser and mini-app cells](features/omni-miniapp-cells.md) - persistent per-cell browser
  or local Todo/EyesOnAgents operation views with development and packaged runtime mapping.
- [SQLite migration release gate](features/sqlite-migration-release-gate.md) - strict multi-version
  upgrade audit required before signed production packaging.
- [Startup diagnostics](features/startup-diagnostics.md) - SQLite-first but non-blocking GUI
  startup with main-owned failures surfaced from the Home menubar.
- [Top-level window state persistence](features/window-state-persistence.md) - normal bounds,
  window mode, physical-display affinity, off-screen recovery, and legacy geometry import for every
  user-visible Main-owned window.

## Guides

- [Coin data source preparation](guides/coin-data-sources.md) - owner resources, GMGN setup,
  wallet cohorts, credential boundary, and production readiness gates.
- [GMGN CLI setup](guides/gmgn-cli.md) - Yarn installation, personal API key, read-only probes,
  allowlist, and second-machine setup.

## Integrations

- [EyesOnAgents](integrations/eyes-on-agents.md) - Codex-only App Server connection, raw inventory snapshots, Domain
  classification, Focus/unread semantics, Desktop status bridge, and persistence boundary.
- [EyesOnAgents layout](integrations/eyes-on-agents-layout.md) - standalone Mini App window,
  wrapping observation board, compact title/action cards, and responsive interaction states.

## Design system

- [Design system](design/README.md)
- [Color system](design/colors.md) - Royal Blue theme, accent-orange provenance, menu states, and
  the Maestro icon contract.
- [Customer authentication](design/customer-authentication.md) - account lifecycle, deterministic
  login transition, password recovery, General account/logout controls, and login/home visual
  contract.

## Delivery

- [Delivery plan](plan/README.md)
- [Delivery backlog](plan/backlog.md)
- [Coin delivery analysis](plan/analysis/coin-subapp.md)
- [EyesOnAgents delivery analysis](plan/analysis/eyes-on-agents.md)
- [Omni mini-app cells delivery analysis](plan/analysis/omni-miniapp-cells.md)
- [SQLite migration release-gate analysis](plan/analysis/sqlite-migration-release-gate.md)
- [Todoist-style Todo sync delivery analysis](plan/analysis/todoist-sync.md)

## Issues

- [Desktop package includes build-only dependencies](issues/desktop-package-includes-build-only-dependencies.md) - fixed:
  renderer/build-only production dependencies and a duplicated CLI workspace inflated the macOS
  app to about 1.1 GiB; the committed package is now guarded at 220 MiB ASAR / 650 MiB app.
- [Todo sync device identity changes across login methods](issues/todo-sync-device-identity-node-mismatch.md) - fixed:
  one persisted installation identity must be shared by password and email-code login.
- [Todo batch SubTodo counts omit zero rows](issues/todo-subtodo-count-map-omits-zero.md) - fixed:
  dense repository counts keep a newly created zero-SubTodo Todo refreshable.
- [Customer login session transition](issues/customer-auth-login-session-transition.md) - client
  fix implemented; Shanghai backend gate and owner verification pending: valid Core login is no
  longer blocked or misreported by optional local runtime activation, and General now exposes the
  current account and Logout.
- [EyesOnAgents existing-thread normalized ingestion](issues/eyes-on-agents-thread-normalization-drops-existing-sessions.md) - implemented; owner verification pending:
  valid Codex threads can be omitted from All and remain Untitled when an optional preview is
  multiline or longer than the display bound.
- [Desktop helper Dock and Home startup](issues/desktop-helper-dock-and-home-startup.md) - active:
  retain Node-only helper isolation while restoring strict SQLite-first GUI startup.
- [EyesOnAgents surface hierarchy](issues/archived/eyes-on-agents-surface-hierarchy.md) - fixed:
  decorative borders replaced by Todo-style background-led Domain and thread-item hierarchy.
- [EyesOnAgents Desktop Focus](issues/archived/eyes-on-agents-desktop-focus.md) - fixed: active Codex Desktop tasks
  missing from Focus when lifecycle observation is absent or expires too early.

## Legacy references

- `doc/colors.md` - historical palette exploration; the current contract is
  [`docs/design/colors.md`](design/colors.md).
- `doc/plan/tasks/` - historical Todo and release tasks.
- `docs/plan/tasks/` - current task files, including tasks created before this index.
- `docs/integrations/coding-agent-sessions*.md` - historical Codex/Claude implementation superseded
  by EyesOnAgents.
