# MCP setup for Codex and Claude Code

The skill folder teaches an agent how to use Bitterless, but it does not install the local MCP
server. Install Bitterless — Production or Preview — start that app once, and keep it running while an agent uses
Todo. Current Bitterless versions generate the helper automatically after the personal Todo store
is ready.

## Install the same skill package

The exported ZIP contains one top-level `bitterless-todo/` folder.

For Codex, extract it under `~/.codex/skills/`. For Claude Code, extract it under
`~/.claude/skills/` for user-wide use or `<project>/.claude/skills/` for one project. Claude Code
ignores `agents/openai.yaml`; Codex uses it to discover the production `bitterless` dependency.

For an update, copy the contents of the packaged `bitterless-todo/` folder additively into the same
named destination folder. Replace matching files, but do not replace or delete the surrounding
skills directory or any unrelated skill.

Restart with a new agent session after installing or updating the skill. Existing sessions keep
the previously loaded instructions and do not see the new domain catalog rules.

## Editions and their helper paths

Each edition installs its own MCP helper under its own application-data directory, so the two never
share a socket. Register the helper of the edition that is installed; a machine may have only one.

| Edition | Server name | macOS helper | Windows helper |
|---|---|---|---|
| Production | `bitterless` | `$HOME/Library/Application Support/Bitterless/bin/bitterless-mcp` | `$env:APPDATA\Bitterless\bin\bitterless-mcp.cmd` |
| Preview | `bitterless-preview` | `$HOME/Library/Application Support/Bitterless_PREVIEW/bin/bitterless-mcp` | `$env:APPDATA\Bitterless_PREVIEW\bin\bitterless-mcp.cmd` |

The running Bitterless Guide already generates the correct pair for its own edition; copy it from
there when in doubt.

## Register the MCP server on macOS

Production:

```bash
codex mcp add bitterless -- "$HOME/Library/Application Support/Bitterless/bin/bitterless-mcp"
claude mcp add --scope user bitterless -- "$HOME/Library/Application Support/Bitterless/bin/bitterless-mcp"
```

Preview:

```bash
codex mcp add bitterless-preview -- "$HOME/Library/Application Support/Bitterless_PREVIEW/bin/bitterless-mcp"
claude mcp add --scope user bitterless-preview -- "$HOME/Library/Application Support/Bitterless_PREVIEW/bin/bitterless-mcp"
```

## Register the MCP server on Windows

Run from PowerShell.

Production:

```powershell
codex mcp add bitterless -- "$env:APPDATA\Bitterless\bin\bitterless-mcp.cmd"
claude mcp add --scope user bitterless -- "$env:APPDATA\Bitterless\bin\bitterless-mcp.cmd"
```

Preview:

```powershell
codex mcp add bitterless-preview -- "$env:APPDATA\Bitterless_PREVIEW\bin\bitterless-mcp.cmd"
claude mcp add --scope user bitterless-preview -- "$env:APPDATA\Bitterless_PREVIEW\bin\bitterless-mcp.cmd"
```

Confirm registration with `codex mcp get <server name>` or `claude mcp get <server name>`, then
start a new agent session. Keep the server name the Guide generated: `bitterless` for Production or
`bitterless-preview` for Preview. The portable skill accepts either, and a machine may have only
one edition installed.

## Real and development separation

Production and Preview Bitterless both contain the user's real personal, synchronized Todo data, in
separate storage. Development names such as `bitterless-dev`, `bitterless-debug-prod`, and
`bitterless-debug-dev` are test-only. Never point `bitterless` or `bitterless-preview` at a
development helper, and never store real personal work in a DEV or DEBUG instance.

When working inside the Bitterless repository, diagnose production without writes using:

```bash
yarn mcp:todo:smoke --read-only
```

Run a full lifecycle smoke only against an explicitly selected DEBUG profile unless the user
separately authorizes a production write test.
