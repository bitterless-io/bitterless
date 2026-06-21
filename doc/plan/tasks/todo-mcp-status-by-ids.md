---
id: todo-mcp-status-by-ids
scope: todo
status: done
depends-on: [todo-mcp-active-list-only, todo-mcp-event-polling]
---

# Todo MCP Status By IDs

## Objective

Let agents check the current state of known todo IDs without listing all completed todos.

## Decision

Do not add a domain-level completed todo list for MCP. Completed history can grow large, while agents usually need to follow only the todo IDs they created or were given. Add a batch status lookup instead.

## Path

- Add a DAO method that accepts todo IDs and returns each item's state: `active`, `completed`, `deleted`, or `missing`.
- Use the current `todos` table for active/completed rows.
- Use `todo_events` deletion records to identify newly deleted todos after the event log existed.
- Expose the method through MCP as `todo.status`.
- Document that agents should prefer `todo.status({ ids })` for known todos instead of scanning completed lists.

## Verification

- `yarn build`
- `git diff --check`
- MCP `tools/list` shows `todo.status`.

## Result

- Added `todo.status({ ids })` for batch lookup of known todo IDs.
- Returned states are `active`, `completed`, `deleted`, and `missing`.
- Kept completed history out of list reads; agents should use ID-based status checks for tracked work.
- Verified with `yarn build`, `git diff --check`, filtered `yarn typecheck:web`, and MCP `tools/list`.
