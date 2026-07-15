# MCP setup for Codex and Claude Code

The skill folder teaches an agent how to use Bitterless, but it does not install the local MCP
server. Install Bitterless, start the production app once, and keep it running while an agent uses
Todo. Current Bitterless versions generate the helper automatically after the personal Todo store
is ready.

## Install the same skill package

The exported ZIP contains one top-level `bitterless-todo/` folder.

For Codex, extract it under `~/.codex/skills/`. For Claude Code, extract it under
`~/.claude/skills/` for user-wide use or `<project>/.claude/skills/` for one project. Claude Code
ignores `agents/openai.yaml`; Codex uses it to discover the production `bitterless` dependency.

Restart the agent session after installing or replacing the skill.

## Register production MCP on macOS

Codex:

```bash
codex mcp add bitterless -- "$HOME/Library/Application Support/Bitterless/bin/bitterless-mcp"
```

Claude Code:

```bash
claude mcp add --scope user bitterless -- "$HOME/Library/Application Support/Bitterless/bin/bitterless-mcp"
```

## Register production MCP on Windows

Run from PowerShell.

Codex:

```powershell
codex mcp add bitterless -- "$env:APPDATA\Bitterless\bin\bitterless-mcp.cmd"
```

Claude Code:

```powershell
claude mcp add --scope user bitterless -- "$env:APPDATA\Bitterless\bin\bitterless-mcp.cmd"
```

Confirm registration with `codex mcp get bitterless` or `claude mcp get bitterless`, then start a
new agent session. The production server name must remain `bitterless` because the portable skill
depends on that exact name.

## Production and development separation

Production Bitterless contains the user's real personal, synchronized Todo data. Development names
such as `bitterless-debug`, `bitterless-dev`, and `bitterless-dev-debug` are test-only. Never point
the production `bitterless` name at a development helper, and never store real personal work in a
DEBUG instance.

When working inside the Bitterless repository, diagnose production without writes using:

```bash
yarn mcp:todo:smoke --read-only
```

Run a full lifecycle smoke only against an explicitly selected DEBUG profile unless the user
separately authorizes a production write test.
