---
id: todo-agent-skill-onboarding-002
scope: in-app MCP and portable agent-skill onboarding for Bitterless Todo
status: done
depends-on: [todo-mcp-portable-skill, renderer-arco-bem-controls]
verify:
  - integration info exposes a readable bundled bitterless-todo skill directory
  - copied setup instructions contain both MCP configuration and skill installation
  - production and DEBUG instance roles remain explicit and separate
  - modal presents MCP and skill as two steps with accessible Arco copy controls
  - packaged resources preserve every skill file including SKILL.md
  - yarn test:mcp:agent-onboarding
  - yarn test:mcp:todo-skill-export
  - yarn check:chat-composer
  - yarn typecheck:node
  - yarn build
---

# Complete Agent Todo Onboarding

## Objective

Replace the insufficient one-sentence MCP-only handoff with a complete two-step onboarding flow:
connect the current Bitterless MCP server, then install the bundled portable `bitterless-todo`
skill. The copied instruction must let Codex or Claude Code understand both setup actions and the
skill must supply the judgment policy for durable personal, multi-device-synchronized Todo work.

## Context

- `docs/INDEX.md`
- `docs/features/todo-mcp.md`
- `docs/plan/tasks/todo-mcp-portable-skill.md`
- `docs/plan/tasks/renderer-arco-bem-controls.md`
- `skills/bitterless-todo/`

## Path

- `src/shared/mcp/**`
- `src/main/xpc/mcp.handler.ts`
- `src/renderer/todo/src/components/McpGuideModal/**`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `skills/bitterless-todo/**` only if its agent-facing contract needs correction
- `electron-builder.tmp.yml`
- `electron-builder.yml`
- focused MCP onboarding checks under `scripts/mcp/`
- affected package scripts and existing MCP guide source guards
- `docs/features/todo-mcp.md`
- `docs/plan/tasks/todo-agent-skill-onboarding-002.md`
- `docs/plan/README.md`

## Implementation constraints

- Treat MCP and skill as complementary: MCP exposes tools; the skill provides triggering,
  personal-Todo semantics, domain selection, duplicate avoidance, and safety policy.
- Resolve the development skill from the canonical repository tree and the packaged skill from an
  explicit `extraResources` directory. Fail explicitly if `SKILL.md` is absent.
- Package real skill files, including Markdown references and `agents/openai.yaml`; do not rely on
  the app's `files: '!**/*.md'` payload.
- The copied instruction must include the exact current MCP JSON, the readable skill directory,
  Codex and Claude Code install destinations, restart/keep-running guidance, and current instance
  safety. Never describe `bitterless-debug` as the production personal Todo route.
- Keep the portable skill's Codex dependency fixed to production `bitterless`.
- Use the existing Arco Modal, shared `IconBtn`, Tabler copy icon, business BEM classes, and sibling
  Less file. Add no Tailwind or atomic utility classes.
- Preserve the constrained modal body scrolling and existing helper/config copy actions.
- Treat `Loading...` as a pending-request state only. If an older/stale main process returns an
  integration object without a non-empty `skillPath`, surface an explicit restart-required
  contract error and never display the missing path as perpetual loading.

## Verification

1. Add deterministic tests for production and DEBUG setup instructions, skill-path resolution,
   packaged resource inclusion, and required skill files.
2. Extend the MCP guide source guard for the new skill copy action and two-step labels.
3. Run the focused MCP/skill checks, affected renderer guard, node typecheck, build, and
   `git diff --check`.
4. Inspect the built modal contract and verify the packaged skill source is not lost to Markdown
   exclusion.

## Result

The Todo integration guide now presents MCP connection and `bitterless-todo` skill installation as
two required steps. Integration info exposes the exact current MCP JSON, a verified readable skill
directory, and complete Codex/Claude setup instructions. Development uses the canonical repository
skill; release packaging copies the complete Markdown-bearing tree into
`Resources/agent-skills/bitterless-todo` for runtime installation.

Non-production server names now produce a visible Arco warning in addition to copied safety text.
The warning identifies the actual test server, prohibits real personal Todo data there, and directs
real multi-device Todo work to production `bitterless`. The canonical skill dependency remains
production-only.

The renderer now treats `Loading...` strictly as the `info === null` request state. An older running
main process that returns an integration object without a non-empty `skillPath` is rejected at the
MenuBar entry point with explicit restart guidance. An already-open modal preserved by HMR has the
same Arco error fallback and disables skill/setup copying until a current integration response is
available. Valid skill paths are trimmed consistently for display and copying.

Verification passed:

- `yarn test:mcp:agent-onboarding`
- `yarn test:mcp:todo-skill-export`
- `yarn check:chat-composer`
- `yarn check:renderer-i18n`
- `yarn typecheck:node`
- `yarn build`
- `git diff --check`

Repository-wide `yarn typecheck:web` still reports existing errors across unrelated renderer
modules; neither review found an error in the onboarding component or changed locale files.

Round-one review found and blocked the hidden DEBUG safety state. The fix passed independent
[round-two review](../reviews/todo-agent-skill-onboarding-002-2.md) with no P1, P2, or P3 findings.
The stale-main compatibility fix passed independent
[round-three review](../reviews/todo-agent-skill-onboarding-002-3.md) with no P1, P2, or P3
findings.
