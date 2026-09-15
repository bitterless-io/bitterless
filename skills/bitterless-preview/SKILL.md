---
name: bitterless-preview
metadata:
  version_code: "260915135852"
description: >-
  Preview an explicit local file or folder for read-only human inspection in Bitterless
  OnlyPreview. Use for requests such as “通过 onlypreview 预览”, “用 only preview 打开这个文件”,
  “bitterless-preview 预览”, or “preview this file in OnlyPreview”, including an artifact the
  agent just produced. OnlyPreview, onlypreview, only preview, and bitterless-preview mean the
  same preview intent; no explicit skill invocation is needed. Use the configured real
  `bitterless` (Production) or `bitterless-preview` (Preview) MCP server. Never guess, search for,
  enumerate, edit, or infer a target path. DEV and DEBUG MCP aliases are test-only.
---

# Bitterless Preview

Treat “通过 onlypreview 预览”, “用 only preview 预览”, and “通过 bitterless-preview 打开” as
requests to use this skill when the local target is known. OnlyPreview / onlypreview / only preview
are equivalent names for the preview feature, regardless of spacing or case. They are not MCP
server names; keep the exact server name from the current installation Guide.

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
`bitterless-debug-dev`, and `bitterless-dev` are test-only. Honor an edition explicitly selected by
the user or the current installation Guide. Otherwise, if both real editions are configured,
prefer `bitterless`. If the configured bridge is unavailable, ask the user to start or keep that
edition of Bitterless running; never silently substitute a DEV or DEBUG instance.
