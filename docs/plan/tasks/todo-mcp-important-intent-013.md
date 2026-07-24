---
id: todo-mcp-important-intent-013
scope: expose star/important intent consistently through Todo create, edit, Focus, and the portable agent skill
status: done
depends-on: [todo-mcp-step-crud-009]
---

# Todo MCP important intent

## Objective

Make agents reliably recognize when Ral wants a Todo starred as important, set or clear that state
through existing create/update tools, and understand that active starred Todos appear in Focus.

## Context

- `docs/features/todo-mcp.md`
- `skills/bitterless-todo/`
- `docs/plan/tasks/todo-mcp-step-crud-009.md`

## Implementation contract

- Keep the existing optional boolean `important` field on `todo.create` and `todo.update`; do not
  add a redundant star tool or change persistence/synchronization.
- Describe `important: true` as star/add to Focus and `important: false` as unstar/remove from Focus.
- Recognize clear semantic intent such as star, important, priority, key/重点, or Focus placement;
  the user need not say one exact field name.
- Continue starring an immediate human action that blocks the active agent session.
- Do not infer a star from a due date, reminder, ordinary backlog item, or unrelated edit alone.
  `todo.update` must omit `important` when the star state should be preserved.
- Update MCP tool metadata, the Domain Focus guidance, portable `SKILL.md`, tool reference, and
  Codex UI metadata to share this contract.
- Bump the quoted 12-digit Todo skill revision and the matching hard-coded application constant,
  then additively synchronize the complete skill folder to workspace Codex/Claude and installed
  Codex copies.

## Path

- `docs/features/todo-mcp.md`
- `docs/plan/README.md`
- `docs/plan/tasks/todo-mcp-important-intent-013.md`
- `src/main/mcp/mcpStdio.helper.ts`
- `src/main/mcp/mcpBridge.server.ts`
- `src/shared/mcp/todoAgentSkillVersion.shared.ts`
- `skills/bitterless-todo/`
- `scripts/mcp/todo-step-crud.test.mjs`
- `scripts/mcp/domain-catalog.test.mjs`
- `scripts/mcp/agent-onboarding.test.mjs`
- `scripts/mcp/todo-skill-export.test.mjs`
- `scripts/todo/todo-agent-skill-version.test.mjs`
- `.agents/skills/bitterless-todo/`
- `.claude/skills/bitterless-todo/`
- `~/.codex/skills/bitterless-todo/`

## Verification

- MCP metadata asserts create/update star, unstar, Focus, explicit-intent, blocker, and preserve-on-
  omission guidance.
- Existing create/update contract tests confirm `important: true` and `important: false` persist.
- `yarn typecheck:mcp`
- `yarn test:mcp:todo-step-crud`
- `yarn test:mcp:domain-catalog`
- `yarn test:mcp:agent-onboarding`
- `yarn test:mcp:todo-skill-export`
- `yarn test:todo:agent-skill-version`
- Skill YAML validation and four-destination byte-equivalence checks.
- `git diff --check`
- Electron runtime acceptance remains with Ral.

## Result

- `todo.create` and `todo.update` now teach agents to map explicit star, important, priority,
  重点, and Focus-placement intent to the existing `important` field.
- Update guidance distinguishes `important: true`, `important: false`, and omission, so an
  unrelated edit preserves the existing star state.
- Focus metadata explains the same policy without introducing a redundant star tool.
- The portable skill and Codex picker metadata carry the same semantics at revision
  `260724175151`; the complete folder is synchronized to workspace Codex/Claude plus installed
  Codex/Claude destinations.
- Persistence tests cover create-star, edit-without-changing-star, and explicit unstar behavior.

## Completion evidence

- `yarn typecheck:mcp`
- `yarn test:mcp:todo-step-crud`
- `yarn test:mcp:domain-catalog`
- `yarn test:mcp:agent-onboarding`
- `yarn test:mcp:todo-skill-export`
- `yarn test:todo:agent-skill-version`
- Skill YAML validation and canonical-to-four-destination `diff -qr` checks
- `git diff --check`
- [Review round 1](../reviews/todo-mcp-important-intent-013-1.md)
