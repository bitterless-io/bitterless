---
id: todo-mcp-multi-instance
scope: production and development Todo MCP instance routing
status: verified-source
depends-on: [todo-mcp-smoke-cli-and-skill, todo-mcp-domain-create]
---

# Todo MCP Multi-instance Routing

## Objective

Allow production Bitterless and local DEBUG Bitterless to run and serve MCP simultaneously, while
keeping the `bitterless-todo` skill permanently routed to production real Todo data and making all
development access explicit and test-only.

## Context

- `docs/features/todo-mcp.md`
- `docs/plan/analysis/todo-mcp-multi-instance.md`
- `docs/plan/tasks/todo-mcp-smoke-cli-and-skill.md`
- `docs/plan/tasks/todo-mcp-domain-create.md`
- Root `AGENTS.md` shared-skill mirroring rules

## Contract

- Preserve production MCP host key `bitterless`; generate distinct DEBUG/dev keys from the app
  identity without changing public Todo tool names or schemas.
- Generated POSIX and Windows shims pin the exact GUI bridge path. The stdio helper prioritizes that
  endpoint; legacy no-argument helper startup falls back to its own `userData` endpoint.
- Core SQLite exposes a typed readiness result. App main starts the bridge only after the Todo DB is
  initialized; failed readiness disables MCP with a clear log/error instead of exposing null data.
- GUI startup automatically ensures the helper shim. Opening the guide remains an idempotent refresh,
  not a prerequisite.
- A bridge never unlinks a responsive socket owned by another process and removes a Unix socket on
  shutdown only when it still owns that exact path.
- The smoke CLI supports `--profile production|debug`; default behavior remains production,
  `--helper` remains supported, and an explicit profile/helper conflict fails fast.
- The three mirrored `bitterless-todo` skills state that `bitterless` means production real Todo and
  DEBUG aliases are only for explicit development tests.

## Path

- `src/shared/mcp/`
- `src/main/mcp/`
- `src/main/xpc/mcp.handler.ts`
- `src/main/app.main.ts`
- `src/preload/sqlite/sqlite.preload.ts`
- `scripts/mcp/`
- `package.json`
- `docs/features/todo-mcp.md`
- `docs/plan/analysis/todo-mcp-multi-instance.md`
- `docs/plan/tasks/todo-mcp-multi-instance.md`
- `docs/plan/reviews/todo-mcp-multi-instance-1.md`
- overmind `.agents/skills/bitterless-todo/`
- overmind `.claude/skills/bitterless-todo/`
- `~/.codex/skills/bitterless-todo/`

## Verification

- Test distinct config keys/endpoints, exact shim argv quoting, pinned endpoint priority, legacy
  fallback, CLI profiles/conflicts, SQLite ready/error results, live socket rejection, stale socket
  recovery, and two concurrent helpers with non-crossing instance markers.
- Run `yarn test:mcp:todo-smoke`, `yarn test:mcp:domain-create`, the new instance-routing suite,
  targeted type checks, `yarn build`, and `git diff --check`.
- Run production and DEBUG GUI together. Execute both read-only smoke probes concurrently and prove
  each helper reaches its own bridge. Run the write lifecycle only against DEBUG.
- Validate and byte-compare all three skill mirrors. Confirm the Codex dependency remains
  `bitterless` and the production-first language is present.
- Complete independent source and runtime review before marking the task done.

## Verification result

Source verification passed with no remaining P1/P2/P3 findings. See
[`docs/plan/reviews/todo-mcp-multi-instance-1.md`](../reviews/todo-mcp-multi-instance-1.md).
Production activation remains pending because the installed `/Applications/Bitterless.app` is the
older build; upgrading and restarting it once will generate the production helper. No production
Todo write or production-process restart was performed during verification.
