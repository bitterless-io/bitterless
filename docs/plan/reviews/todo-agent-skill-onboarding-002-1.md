# Review: todo-agent-skill-onboarding-002 (round 1)

## Findings

No P1 or P3 findings were identified.

- **P2 · blocking — the DEBUG guide does not visibly identify the current instance as test-only.**
  The safety distinction is generated only inside the copied `instruction`
  (`src/main/mcp/mcpAgentOnboarding.service.ts:43-52,55-76`). The modal does not render
  `info.serverName`, `info.instruction`, or a conditional DEBUG warning; it renders the server key
  only inside the MCP JSON and shows a generic hint that the hidden copied text contains instance
  safety (`src/renderer/todo/src/components/McpGuideModal/McpGuideModal.vue:17-103`;
  `src/renderer/common/i18n/en.ts:988-1005`; `src/renderer/common/i18n/zh.ts:990-1007`). A user can
  therefore open a `bitterless-debug` guide and see no direct statement that it is a test target or
  that real personal Todo data must remain on production. This violates the feature contract that
  “a `bitterless-debug` guide must identify that server as test-only”
  (`docs/features/todo-mcp.md:145-151`) and leaves the main data-safety distinction behind a copy
  action. Render a prominent, conditional test-only warning in the Arco modal whenever
  `info.serverName !== 'bitterless'`, and guard that visible contract in the focused source test.

## Contract review

| Contract | Result | Evidence |
|---|---|---|
| MCP versus skill responsibility | pass | The generated handoff explicitly says MCP exposes tools while the skill owns personal-Todo meaning, trigger judgment, domain selection, duplicate avoidance, and safety (`src/main/mcp/mcpAgentOnboarding.service.ts:55-76`). The portable skill applies that policy to personal, multi-device-synchronized Todo and rejects project issues, agent scratch work, and implicit DEBUG use (`skills/bitterless-todo/SKILL.md:1-69`). |
| Development and packaged skill paths | pass | Development resolves from `app.getAppPath()/skills/bitterless-todo`; packaged builds resolve from `process.resourcesPath/agent-skills/bitterless-todo` (`src/main/mcp/mcpAgentOnboarding.service.ts:19-26`; `src/main/xpc/mcp.handler.ts:26-35`). The tracked builder template copies the complete skill tree through `extraResources`, outside the app payload's Markdown exclusion (`electron-builder.tmp.yml:5-36`). |
| Explicit missing-skill failure | pass | `requireTodoAgentSkillPath` requires a readable, regular `SKILL.md` and throws a path-specific error rather than returning an unusable directory (`src/main/mcp/mcpAgentOnboarding.service.ts:28-41`). The handler requires it before returning integration info (`src/main/xpc/mcp.handler.ts:26-39`). |
| Production/DEBUG instruction safety | partial / blocked | The copied production and DEBUG instructions are correctly distinct, and DEBUG explicitly says not to register it as `bitterless` or save real Todo data there (`src/main/mcp/mcpAgentOnboarding.service.ts:43-52`). `agents/openai.yaml` still depends only on production `bitterless` (`skills/bitterless-todo/agents/openai.yaml:1-12`). The blocking finding above applies to the visible guide. |
| Codex and Claude Code installation handoff | pass | The copied instruction includes the exact current MCP JSON, readable source directory, whole-folder requirement, both install destinations, agent-session restart, keep-running guidance, and instance safety (`src/main/mcp/mcpAgentOnboarding.service.ts:55-76`). This is sufficient for a filesystem-capable Codex or Claude Code session to install the package rather than merely load MCP schemas. |
| Modal implementation | pass except visible safety | The flow uses Arco Modal and its native close, four shared `IconBtn` controls with Tabler `IconCopy`, accessible labels, two labeled steps, shallow `mcp-guide` BEM classes, sibling Less, and a viewport-constrained scrolling body (`src/renderer/todo/src/components/McpGuideModal/McpGuideModal.vue:1-137`; `src/renderer/todo/src/components/McpGuideModal/McpGuideModal.less:1-228`). No Tailwind or atomic utility classes were introduced. |
| Deterministic clean-checkout checks | pass | `scripts/mcp/agent-onboarding.test.mjs:18-147` reads the tracked `electron-builder.tmp.yml`, not ignored/generated `electron-builder.yml`, and checks both path modes, missing/invalid `SKILL.md`, production/DEBUG copy text, exact skill files, `extraResources`, handler wiring, and the production-only OpenAI dependency. It passed again with `electron-builder.yml` temporarily absent, demonstrating that the check does not depend on generated workspace state. Its missing assertion for a visible DEBUG warning is part of the blocking finding. |

## Verification

- An independent focused rerun of `yarn test:mcp:agent-onboarding`,
  `yarn test:mcp:todo-skill-export`, `yarn check:chat-composer`, and `git diff --check` passed.
- `yarn test:mcp:agent-onboarding` passed, including a second run with ignored
  `electron-builder.yml` temporarily absent.
- `yarn test:mcp:todo-skill-export` passed.
- `yarn check:chat-composer` passed.
- `yarn typecheck:node` passed.
- `yarn build` passed and emitted the main, Todo preload, and Todo renderer bundles.
- `git diff --check` passed before this review file was added.
- The independent `todo-preload-runtime-001` changes were excluded from this task's findings.

## Conclusion

**blocked** — the MCP/skill packaging and copyable handoff are sound, but a DEBUG integration guide
must show its test-only status directly in the modal before this safety-sensitive onboarding task
can pass.
