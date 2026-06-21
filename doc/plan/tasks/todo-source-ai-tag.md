---
id: todo-source-ai-tag
scope: todo
status: done
depends-on: []
---

# Todo Source And AI Tag

## Objective

Add a persistent todo `source` field so human-created todos default to `human`, MCP-created todos are stored as `ai`, and AI-created todos show an `AI` tag in the todo list item and detail header.

## Context

- `src/preload/sqlite/dao/todo.table.ts` defines the base `todos` table.
- `src/preload/sqlite/sqlite.preload.ts` registers migrations.
- `src/preload/sqlite/dao/todo.dao.ts` owns todo create/read contracts.
- `src/main/mcp/mcpBridge.server.ts` owns MCP todo write routing.
- `src/renderer/todo/src/components/TodoRow/` renders list items.
- `src/renderer/todo/src/components/TodoDetail/` renders detail header.

## Path

- Add `source TEXT NOT NULL DEFAULT 'human'` to new table schema and existing DB migration.
- Extend todo row/store types with `source: 'human' | 'ai'`.
- Keep normal renderer todo creation defaulting to human.
- Mark MCP-created todos as ai.
- Show a compact `AI` tag for ai todos in list rows and detail header only.

## Verification

- `yarn build`
- MCP helper/bridge smoke for `todo.create` should return a todo with `source: "ai"`.
- Existing human create path should still compile through the default source.
