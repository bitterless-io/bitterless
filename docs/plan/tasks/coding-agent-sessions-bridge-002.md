---
id: coding-agent-sessions-bridge-002
scope: Codex and Claude lifecycle hook bridge and reversible settings installation
status: done
depends-on: [coding-agent-sessions-core-001]
---

# Coding-agent Sessions Lifecycle Bridge

## Objective

Implement a profile-isolated local event bridge, privacy-minimal helper mode, generated Codex shim,
Claude exec-form handler, reversible settings merge/remove, bridge status/drift reporting, app
startup/cleanup, and XPC integration. Do not read or forward transcript/prompt/tool content.

## Context

- `docs/integrations/coding-agent-sessions.md`
- `docs/features/todo-mcp.md`
- `docs/plan/analysis/coding-agent-sessions.md`

## Paths

- `src/shared/codingAgent/`
- `src/main/codingAgent/`
- `src/main/xpc/codingAgentSession.handler.ts`
- `src/main/app.main.ts`
- `scripts/coding-agent/`
- `package.json`
- `yarn.lock`
- this task file

## Verification

- Tests cover Unix socket/Windows pipe derivation, argument validation, redaction, frame limits,
  provider event mapping, unavailable GUI fast-success, idempotent install/remove, backup, drift,
  and preservation of unrelated JSON settings/hooks.
- Run focused tests, `yarn typecheck:node`, and `git diff --check`.
