---
id: todo-mcp-portable-skill
scope: portable Codex and Claude Code skill package for personal Bitterless Todo
status: done
depends-on: [todo-mcp-multi-instance]
---

# Portable Bitterless Todo Skill

## Objective

Ship one exportable `bitterless-todo` skill folder and ZIP archive for Codex and Claude Code. The
skill must explain that Bitterless is the user's personal multi-device-synchronized Todo manager,
teach agents when a durable personal Todo is appropriate, and use only the production `bitterless`
MCP server for real work.

## Context

- `docs/features/todo-mcp.md`
- `docs/plan/tasks/todo-mcp-multi-instance.md`
- Root `AGENTS.md` shared-skill mirroring rules

## Path

- `skills/bitterless-todo/`
- `scripts/mcp/export-todo-skill.mjs`
- `scripts/mcp/todo-skill-export.test.mjs`
- `src/main/mcp/mcpBridge.server.ts`
- `package.json`
- `docs/features/todo-mcp.md`
- `docs/plan/tasks/todo-mcp-portable-skill.md`
- overmind `.agents/skills/bitterless-todo/`
- overmind `.claude/skills/bitterless-todo/`
- `~/.codex/skills/bitterless-todo/`

## Verification

- Validate strict SKILL frontmatter and `agents/openai.yaml`.
- Assert the sidecar depends only on production `bitterless`.
- Assert the portable source and all three installed copies are byte-identical.
- Export a ZIP and assert it contains exactly one `bitterless-todo/` tree with identical bytes.
- Confirm the setup reference covers both Codex and Claude Code and contains no machine-specific
  absolute path or credentials.
- Run the focused export test, existing MCP tests, and `git diff --check`.
