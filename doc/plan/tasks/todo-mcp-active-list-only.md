---
id: todo-mcp-active-list-only
scope: todo
status: done
depends-on: [todo-domain-description-mcp-policy]
---

# Todo MCP Active List Only

## Objective

Keep MCP todo list reads small and useful by returning only unarchived domains and incomplete todos.

## Context

- `src/main/mcp/mcpBridge.server.ts` implements MCP bridge dispatch.
- `src/main/mcp/mcpStdio.helper.ts` exposes MCP tool schemas.
- `doc/bitterless-mcp-communication.html` documents the local MCP contract.

## Path

- Filter MCP domain exposure to domains with `archived = 0`.
- Make `todo.list` return only incomplete todos (`status = 0`).
- Remove the `status` selector from the MCP `todo.list` schema so agents do not request completed/all history.
- Keep `todo.get` unchanged for explicit single-todo lookup by ID.

## Verification

- `yarn build`
- `git diff --check`
- MCP `tools/list` smoke confirms `todo.list` no longer exposes a `status` input.

## Result

- MCP `domain.list` now returns only unarchived, non-deleted domains.
- MCP `todo.list` now returns only incomplete todos from unarchived domains.
- `todo.list` rejects completed/all status requests if an old direct caller still sends them.
- The MCP schema and HTML communication doc now describe the active-only list contract.
