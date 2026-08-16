# MCP and skill setup

The skill does not install or replace the local MCP helper. Install Bitterless, start the production
application once, and keep it running while an agent uses Trench.

## Install the complete skill directory

Install the whole `bitterless-trench/` directory, not only `SKILL.md`.

- Codex: `~/.codex/skills/bitterless-trench/`
- Claude Code: `~/.claude/skills/bitterless-trench/` for user-wide use, or
  `<project>/.claude/skills/bitterless-trench/` for one project

For an update, copy the directory contents additively into the same-named destination and overwrite
matching files. Do not delete the surrounding skills directory or unrelated skills. Start a new
agent session after installing or updating so the current version is loaded.

## Register production Bitterless

Use the production Bitterless Guide to copy the exact MCP configuration generated for the current
machine. Register it under the exact server name `bitterless`, keep production Bitterless running,
then start a new agent session. Confirm all 13 `trench.*` tools, including
`trench.person.import`, appear in `tools/list`.

Names such as `bitterless-debug`, `bitterless-dev`, and `bitterless-dev-debug` are test-only. Never
register a development helper under `bitterless`, and never write real Trench records through one.

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
