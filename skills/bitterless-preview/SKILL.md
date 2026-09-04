---
name: bitterless-preview
metadata:
  version_code: "260904151653"
description: >-
  Open one explicit local file or folder in the running Bitterless OnlyPreview window for
  read-only human inspection through the `bitterless` (Production) or `bitterless-preview`
  (Preview) MCP server. Use when the user asks to preview a known local target or an artifact the
  agent has just produced. Never guess, search for, enumerate, edit, or infer a target path. DEV
  and DEBUG MCP aliases are test-only.
---

# Bitterless Preview

Use OnlyPreview only as a read-only handoff for a local file or folder whose exact path is already
known from the user's request or from an artifact you just created in this session. Two server
names are real editions of Bitterless: `bitterless` (Production) and `bitterless-preview` (Preview).
Use whichever one is configured; a machine may have only one of them installed.

## Open an explicit target

1. Resolve exactly one absolute path from the request or the artifact you just produced.
2. Call `preview.open` once with `{ "path": "<absolute path>" }`.
3. Treat `{ "opened": true }` only as confirmation that Bitterless accepted the open request.
4. Tell the user briefly that Bitterless accepted the target for OnlyPreview. Do not claim that
   rendering is ready.

Do not search the filesystem, enumerate a directory, guess a path, or broaden the target. Do not
use Preview as evidence of file contents; read a file through the normal authorized workspace tools
when the task requires content analysis. Never use this skill to edit or write the target.

For the exact tool contract, read [references/tools.md](references/tools.md). If no real MCP
dependency is configured, read [references/mcp-setup.md](references/mcp-setup.md).

## Keep real and test instances separate

Use `bitterless` or `bitterless-preview` for real work — they are shipped editions holding the
user's own data in separate storage. Names such as `bitterless-debug`, `bitterless-debug-prod`,
`bitterless-debug-dev`, and `bitterless-dev` are test-only. If both real editions are configured,
prefer `bitterless`. If the configured bridge is unavailable, ask the user to start or keep that
edition of Bitterless running; never silently substitute a DEV or DEBUG instance.
