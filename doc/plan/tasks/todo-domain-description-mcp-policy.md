---
id: todo-domain-description-mcp-policy
scope: todo
status: done
depends-on: [todo-source-ai-tag]
---

# Todo Domain Description And MCP Policy

> Historical result only. The current public contract supersedes the read-only Domain policy:
> `domain.create` is explicit-only, `domain.description.update` updates active Domain descriptions,
> and `domain.archived.list` exposes archived metadata. See
> [`docs/features/todo-mcp.md`](../../../docs/features/todo-mcp.md).

## Objective

Add editable descriptions to todo domains, expose those descriptions through MCP `domain.list`, and make MCP domain management read-only so agents place todos into existing human-managed domains.

## Context

- `src/preload/sqlite/dao/domain.table.ts` defines the base `domain` table.
- `src/preload/sqlite/sqlite.preload.ts` registers migrations.
- `src/preload/sqlite/dao/domain.dao.ts` owns domain create/read/update contracts.
- `src/renderer/todo/src/components/DomainColumn/` renders each domain column.
- `src/main/mcp/mcpBridge.server.ts` owns bridge-side MCP dispatch.
- `src/main/mcp/mcpStdio.helper.ts` declares MCP tools.
- Root `CLAUDE.md` and `AGENTS.md` carry the persistent cross-agent todo intake rule.

## Path

- Add `description TEXT NOT NULL DEFAULT ''` to the domain schema and a migration for existing DBs.
- Extend domain types/store with `description`.
- Let humans edit the description from the domain column UI.
- Keep MCP `domain.list`, but remove MCP `domain.create` and `domain.update`.
- Return a virtual Focus description from `domain.list`; Focus is derived from important/starred active todos.
- Define star policy: starred means `important=true`; star only when the current agent session is blocked on an immediate human action, and do not star deferred follow-ups that can wait several days.
- Add the overmind agent rule: agents must inspect domain list before creating project todos, use an existing matching domain or `Others`, never create domains themselves, and mark live-session human blockers important.

## Verification

- `yarn build`
- MCP `tools/list` must include `domain.list` and must not include `domain.create` or `domain.update`.
- `git diff --check`

## Result

- Added domain descriptions to schema, migration, DAO, store, and domain column UI.
- MCP `domain.list` now returns domain descriptions and a virtual Focus description.
- MCP domain writes were removed from the tool list and bridge dispatch.
- Root `CLAUDE.md` and `AGENTS.md` now require agents to inspect domains before creating Bitterless todos.
- Root rules and MCP schemas now define when to set `important=true` so only current-session human blockers enter Focus.
