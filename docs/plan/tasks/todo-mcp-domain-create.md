---
id: todo-mcp-domain-create
scope: Todo MCP domain bootstrap
status: done
depends-on: [todo-mcp-smoke-cli-and-skill]
---

# Todo MCP Domain Create

## Objective

Expose an explicit-only `domain.create` MCP tool, use it to create the active `Others` domain in
the running `Bitterless_DEBUG` instance, then prove the existing Todo write lifecycle works through
that domain without direct SQLite access.

## Context

- `src/main/mcp/mcpStdio.helper.ts` owns the public MCP tool catalog and JSON schemas.
- `src/main/mcp/mcpBridge.server.ts` validates bridge requests and calls the existing `DomainDao`.
- `src/preload/sqlite/dao/domain.dao.ts` already provides the UI-backed domain create operation.
- `scripts/mcp/todo-smoke.mjs` verifies the Todo lifecycle through public MCP stdio.
- The overmind `bitterless-todo` skill defines when an agent may create a domain.

## Contract

- Add `domain.create` with required `title` and optional `description`.
- Trim both values. Reject a blank title, a title longer than 200 characters, a non-string
  description, or a description longer than 500 characters.
- Preserve the UI business rule by rejecting creation when 17 active domains already exist.
- Create an active, human-managed domain through `DomainDao.create`, return `{ domain }`, and
  broadcast `todo/data_updated` so the Todo UI reloads immediately.
- Do not implicitly create domains during ordinary Todo creation. Agents must call `domain.list`
  first and may call `domain.create` only when Ral explicitly requests or authorizes a new domain.
- Do not add MCP rename, archive, restore, or delete operations in this task.
- Update all three mirrored `bitterless-todo` skill copies and their tool reference to describe the
  explicit-create policy and exact response shape.

## Path

- `src/main/mcp/mcpStdio.helper.ts`
- `src/main/mcp/mcpBridge.server.ts`
- `scripts/mcp/`
- `docs/plan/tasks/todo-mcp-domain-create.md`
- overmind `.agents/skills/bitterless-todo/`
- overmind `.claude/skills/bitterless-todo/`
- `~/.codex/skills/bitterless-todo/`

## Verification

- Confirm `tools/list` exposes the `domain.create` schema.
- Cover successful creation plus blank/oversized/invalid inputs at the public MCP boundary.
- Through the real DEBUG helper, create `Others`, verify it with `domain.list`, and run the complete
  Todo smoke lifecycle with default cleanup.
- Run targeted type checks/tests and `git diff --check` without disturbing unrelated worktree
  changes.
- Run skill quick validation, strict YAML parsing, and byte-identical three-way directory diffs.

## Result

- Added the explicit-only `domain.create` public tool and serialized its active-count/create
  critical section so concurrent requests cannot exceed the 17-domain UI limit.
- Added a source-backed public stdio contract test for schema, validation, trimming, UI broadcast,
  deterministic concurrent limit enforcement, and queue recovery. `yarn test:mcp:domain-create`,
  `yarn test:mcp:todo-smoke`, script syntax checks, and `git diff --check` pass.
- Independent review passed after closing the concurrency finding; see
  [todo-mcp-domain-create-1.md](../reviews/todo-mcp-domain-create-1.md).
- Updated and forward-tested the three byte-identical `bitterless-todo` skill mirrors. Strict
  `js-yaml` parsing passes for their frontmatter and Codex sidecars. The bundled
  `quick_validate.py` was attempted but its runtime lacks PyYAML, so it could not start.
- Restarted `yarn dev:prod`, confirmed the live DEBUG helper advertises `domain.create`, then
  created active domain `1:Others` with description `General tasks and uncategorized follow-ups.`
  through MCP. A follow-up `domain.list` returned exactly that domain.
- The real DEBUG helper completed create/get/update/complete/uncomplete/delete for smoke todo `1`
  and reported `PASS (todo cleaned up)`. No SQLite access was used.
