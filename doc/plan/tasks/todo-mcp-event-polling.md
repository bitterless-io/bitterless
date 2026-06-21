---
id: todo-mcp-event-polling
scope: todo
status: done
depends-on: [todo-domain-description-mcp-policy]
---

# Todo MCP Event Polling

## Objective

Support polling-based coordination between agents and Bitterless todos. Agents should detect that a human completed or changed a todo by polling MCP tools, without push notifications and without one socket per session.

## Context

- `src/preload/sqlite/sqlite.preload.ts` registers todo-related tables and DAOs.
- `src/preload/sqlite/dao/todo.dao.ts` owns todo writes.
- `src/main/mcp/mcpBridge.server.ts` dispatches local bridge RPC.
- `src/main/mcp/mcpStdio.helper.ts` exposes MCP tool schemas.
- Root `CLAUDE.md` and `AGENTS.md` carry cross-agent behavior rules.

## Path

- Add an append-only `todo_events` table.
- Record todo mutation events from the DAO, defaulting to actor `human`; MCP writes pass actor `ai`.
- Add MCP `event.list` for cursor-based polling.
- Add MCP `event.wait` for bounded long-polling while an agent is actively waiting for human action.
- Keep a single app-wide `bridge.sock`; distinguish agent progress by explicit event cursors such as `lastEventId`, not by per-session socket files.
- Update workspace rules so agents poll events when resuming or waiting for a human-blocking todo.

## Verification

- `yarn build`
- `git diff --check`
- MCP `tools/list` includes `event.list` and `event.wait`.

## Result

- Added `todo_events` as an append-only event log.
- Todo DAO writes events for create, update, complete, uncomplete, delete, move, star, and unstar actions.
- MCP exposes `event.list` for cursor polling and `event.wait` for bounded long-polling.
- Overmind root rules now say to use one app-wide sock and explicit event cursors, not one sock per session.
