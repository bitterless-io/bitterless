---
id: coding-agent-sessions-core-001
scope: provider-neutral storage, discovery, status normalization, and safe opening
status: in-progress
depends-on: []
---

# Coding-agent Sessions Core

## Objective

Implement the provider-neutral contract, dedicated soft-delete SQLite repository, read-only Codex
and Claude Code CLI discovery, safe Codex opening, safe Claude attach/resume templates, and one main
XPC service. Do not install hooks or add renderer UI in this task.

## Context

- `docs/integrations/coding-agent-sessions.md`
- `docs/plan/analysis/coding-agent-sessions.md`
- `docs/INDEX.md`

## Paths

- `src/shared/codingAgent/`
- `src/preload/sqlite/dao/codingAgentSession.*`
- `src/preload/sqlite/sqlite.preload.ts`
- `src/main/codingAgent/`
- `src/main/xpc/codingAgentSession.handler.ts`
- `src/main/xpc/xpc.helper.ts`
- `scripts/coding-agent/`
- `package.json`
- this task file

## Verification

- Contract tests cover ID/path validation, every normalized provider state, unknown variants,
  freshness and service-restart invalidation, Codex `notLoaded`, Claude
  interactive/legacy-foreground versus background distinction, command timeout/output caps, and
  fixed open/attach/resume targets.
- Repository tests cover create/upsert/list/rename/status/soft-delete/re-register, including custom
  title and explicit title-clear survival across provider refresh, plus exact legacy-schema
  migration of both non-null rename and null-clear rows.
- A real adapter -> service -> SQLite -> open-target test covers Claude live -> absent -> resume,
  failed poll -> unknown, lease expiry -> unknown, and same-millisecond startup observations.
- Deferred overlapping `refresh()` and provider-only refresh tests prove one probe/merge/reconcile
  operation per provider and prevent reverse completion from replacing live evidence.
- Run the focused test script, `yarn typecheck:node`, and `git diff --check`.
