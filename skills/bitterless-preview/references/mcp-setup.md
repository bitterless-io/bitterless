# MCP setup for Codex and Claude Code

The skill teaches the agent when to use OnlyPreview, but the running Bitterless application owns
the local MCP bridge. Install Bitterless, start the production app, and keep it running while an
agent uses Preview.

## Install the complete skill directory

Install the whole `bitterless-preview/` directory, not only `SKILL.md`.

- Codex destination: `~/.codex/skills/bitterless-preview/`
- Claude Code destination: `~/.claude/skills/bitterless-preview/` for user-wide use, or
  `<project>/.claude/skills/bitterless-preview/` for one project

For an update, copy the directory contents additively into the same-named destination and overwrite
matching files. Do not delete other skills. Start a new agent session after installing or updating
the skill.

## Register the production server

Use the current production Bitterless Guide to copy the exact MCP configuration for this machine.
Register it under the exact server name `bitterless`, then start a new agent session. Keep the
current Bitterless application running while the agent uses MCP.

Development names such as `bitterless-debug`, `bitterless-dev`, and `bitterless-dev-debug` are
test-only. Never register a development helper under the production `bitterless` name.
