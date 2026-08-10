---
id: todo-agent-onboarding-copy-014
scope: simplified in-app Agent Todo onboarding copy
status: done
depends-on: [todo-mcp-domain-catalog-skill-version-007]
verify:
  - the modal title directly tells the user to copy the skill to an agent
  - only the Complete setup instructions copy action remains
  - the removed summary and Detailed instructions do not render
  - copied setup instructions are English and include both MCP and skill setup
  - production and DEBUG safety guidance remains correct
  - only a successful Complete setup copy acknowledges the current skill revision
  - yarn test:mcp:agent-onboarding
  - yarn test:todo:agent-skill-version
  - yarn check:chat-composer
  - yarn check:renderer-i18n
  - yarn typecheck:todo-web
---

# Simplify Agent Todo Onboarding Copy

## Objective

Reduce the Agent Todo access modal to one direct action: copy complete English instructions to the
user's agent. The visible title must communicate that action, while the copied payload must retain
both the portable `bitterless-todo` skill and current-instance MCP setup.

## Context

- `docs/INDEX.md`
- `docs/features/todo-mcp.md`
- `docs/plan/tasks/todo-agent-skill-onboarding-002.md`
- `docs/plan/tasks/todo-mcp-domain-catalog-skill-version-007.md`

## Path

- `src/main/mcp/mcpAgentOnboarding.service.ts`
- `src/renderer/todo/src/components/McpGuideModal/**`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- focused onboarding, skill-version, renderer, and i18n checks under `scripts/`
- `docs/features/todo-mcp.md`
- `docs/plan/tasks/todo-agent-onboarding-copy-014.md`
- `docs/plan/README.md`

## UI contract

```text
┌────────────── Bitterless Todo ──────────────┐
│ Copy the skill to your agent                │
├──────────────────────────────────────────────┤
│ [test-instance warning when applicable]     │
│ Complete setup instructions            copy │
│ Copy these instructions to your agent.      │
│ They include the skill and MCP setup.        │
└──────────────────────────────────────────────┘
```

- Remove the existing summary paragraph and the entire Detailed instructions section.
- Remove the individual helper-path, MCP-config, and skill-path copy actions and their unused UI
  state/styles.
- Retain the existing primary card, copy icon, accessible action label, DEBUG/test warning,
  revision acknowledgement, and restart-required error state.
- Use `Copy the skill to your agent` for the English title and a natural localized equivalent for
  Chinese.

## Copied instruction contract

- Generate the complete copied instruction in English regardless of renderer language.
- Include the exact MCP JSON, bundled skill directory, skill revision, Codex and Claude Code
  destinations, additive-copy guidance, new-session/runtime guidance, and production or test-only
  instance safety.
- Keep the current `bitterless` production dependency and all runtime values unchanged.

## Verification

1. Update focused source guards to require exactly one copy action and reject the removed summary,
   detail sections, and individual copy handlers.
2. Assert the production and DEBUG setup payloads use English safety and setup text while retaining
   their dynamic configuration, paths, and revision.
3. Run every command in frontmatter plus `git diff --check` without starting Electron, packaging,
   signing, publishing, or deploying.

## Result

The Agent Todo onboarding modal now presents one direct action under `Copy the skill to your
agent`: Complete setup instructions. The old summary, Detailed instructions section, and separate
helper, MCP-config, and skill-path copy controls and their unused state/styles are gone. The
existing test-instance warning and restart-required contract error remain visible when applicable.

The copied payload is now always English and still includes the exact current MCP JSON, bundled
skill path and revision, Codex and Claude Code destinations, additive installation guidance, new
session/runtime guidance, and production or test-only safety. Only a successful Complete setup
clipboard write acknowledges the current skill revision.

Verification passed:

- `yarn test:mcp:agent-onboarding`
- `yarn test:todo:agent-skill-version`
- `yarn check:chat-composer`
- `yarn check:renderer-i18n`
- `yarn typecheck:todo-web`
- task-scoped `git diff --check`

Independent [round-one review](../reviews/todo-agent-onboarding-copy-014-1.md) passed with no P1,
P2, or P3 findings. Per owner direction, no E2E test ran and Electron was not started; visual
acceptance remains with the owner.
