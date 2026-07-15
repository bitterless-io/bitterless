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

## Guides

- [Coin data source preparation](guides/coin-data-sources.md) - owner resources, Alchemy/GMGN
  setup, wallet cohorts, credential boundary, and production readiness gates.
- [GMGN CLI setup](guides/gmgn-cli.md) - Yarn installation, personal API key, read-only probes,
  allowlist, and second-machine setup.

## Integrations

- [Coding-agent sessions](integrations/coding-agent-sessions.md) - safe links to Codex and Claude
  sessions, normalized live status, provider capability boundaries, and phased delivery.

## Design system

- [Design system](design/README.md)
- [Color system](design/colors.md) - Royal Blue theme, accent-orange provenance, menu states, and
  the Maestro icon contract.
- [Customer authentication](design/customer-authentication.md) - account lifecycle, password
  recovery, first-password modal, and login/home visual contract.

## Delivery

- [Delivery plan](plan/README.md)
- [Delivery backlog](plan/backlog.md)
- [Coin delivery analysis](plan/analysis/coin-subapp.md)

## Legacy references

- `doc/colors.md` - historical palette exploration; the current contract is
  [`docs/design/colors.md`](design/colors.md).
- `doc/plan/tasks/` - historical Todo and release tasks.
- `docs/plan/tasks/` - current task files, including tasks created before this index.
