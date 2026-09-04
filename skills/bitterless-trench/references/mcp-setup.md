# MCP and skill setup

The skill does not install or replace the local MCP helper. Install Bitterless — Production or Preview — start that
application once, and keep it running while an agent uses Trench.

## Install the complete skill directory

Install the whole `bitterless-trench/` directory, not only `SKILL.md`.

- Codex: `~/.codex/skills/bitterless-trench/`
- Claude Code: `~/.claude/skills/bitterless-trench/` for user-wide use, or
  `<project>/.claude/skills/bitterless-trench/` for one project

For an update, copy the directory contents additively into the same-named destination and overwrite
matching files. Do not delete the surrounding skills directory or unrelated skills. Start a new
agent session after installing or updating so the current version is loaded.

## Register a real Bitterless

Use the running Bitterless Guide to copy the exact MCP configuration generated for the current
machine. Register it under the exact server name the Guide produced — `bitterless` for Production or
`bitterless-preview` for Preview — keep that Bitterless running, then start a new agent session. Confirm all 13 `trench.*` tools, including
`trench.person.import`, appear in `tools/list`.

| Edition | Server name | macOS helper | Windows helper |
|---|---|---|---|
| Production | `bitterless` | `$HOME/Library/Application Support/Bitterless/bin/bitterless-mcp` | `$env:APPDATA\Bitterless\bin\bitterless-mcp.cmd` |
| Preview | `bitterless-preview` | `$HOME/Library/Application Support/Bitterless_PREVIEW/bin/bitterless-mcp` | `$env:APPDATA\Bitterless_PREVIEW\bin\bitterless-mcp.cmd` |

Each edition installs its own helper under its own application-data directory, so the two never
share a socket. Register the one that is installed; a machine may have only one.

A machine may have only one edition installed; use the one that is there. Names such as
`bitterless-dev`, `bitterless-debug-prod`, and `bitterless-debug-dev` are test-only. Never register
a development helper under `bitterless` or `bitterless-preview`, and never write real Trench records
through one.

## Optional provider readiness

`gmgn-token` and `gmgn-portfolio` are optional read-only research skills. Use them only when their
CLI is already configured and its own readiness check succeeds. This skill never asks for or accepts
a credential and never opens the provider's config, environment, Keychain, or secret store. If the
provider asks for credential setup, stop that provider step and record it as unavailable.

Inside the overmind workspace, provider setup is authorized only by an exact GMGN resource in
`ops/bitterless/ops.yml` whose project, resource, and credential owners are all `ral`. Inspect the
inventory without printing secret values. If that exact resource is absent, stale, or contradictory,
report the provider as unavailable and ask Ral to repair Ops; never fall back to `areas/keychain/`, a
different project's Ops file, or another owner's resource.
