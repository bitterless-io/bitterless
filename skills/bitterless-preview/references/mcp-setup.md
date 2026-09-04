# MCP setup for Codex and Claude Code

The skill teaches the agent when to use OnlyPreview, but the running Bitterless application owns
the local MCP bridge. Install Bitterless — Production or Preview — start that app, and keep it
running while an agent uses Preview.

## Install the complete skill directory

Install the whole `bitterless-preview/` directory, not only `SKILL.md`.

- Codex destination: `~/.codex/skills/bitterless-preview/`
- Claude Code destination: `~/.claude/skills/bitterless-preview/` for user-wide use, or
  `<project>/.claude/skills/bitterless-preview/` for one project

For an update, copy the directory contents additively into the same-named destination and overwrite
matching files. Do not delete other skills. Start a new agent session after installing or updating
the skill.

## Register a real server

Use the running Bitterless Guide to copy the exact MCP configuration for this machine. It already
carries the correct server name for that edition: `bitterless` for Production and
`bitterless-preview` for Preview. Register it under exactly that name, then start a new agent
session. Keep that Bitterless application running while the agent uses MCP.

| Edition | Server name | macOS helper | Windows helper |
|---|---|---|---|
| Production | `bitterless` | `$HOME/Library/Application Support/Bitterless/bin/bitterless-mcp` | `$env:APPDATA\Bitterless\bin\bitterless-mcp.cmd` |
| Preview | `bitterless-preview` | `$HOME/Library/Application Support/Bitterless_PREVIEW/bin/bitterless-mcp` | `$env:APPDATA\Bitterless_PREVIEW\bin\bitterless-mcp.cmd` |

Each edition installs its own helper under its own application-data directory, so the two never
share a socket. Register the one that is installed; a machine may have only one.

A machine may have only one edition installed; use the one that is there. Development names such as
`bitterless-dev`, `bitterless-debug-prod`, and `bitterless-debug-dev` are test-only. Never register
a development helper under `bitterless` or `bitterless-preview`.
