# Review — todo-agent-onboarding-copy-014

## Findings

- **P1 · blocking:** None. The single-action onboarding contract in
  `docs/features/todo-mcp.md:207-232` is implemented by
  `src/renderer/todo/src/components/McpGuideModal/McpGuideModal.vue:17-51`: only Complete setup
  remains, while the summary, Detailed instructions, and individual helper/config/skill copy
  actions are absent.
- **P2 · blocking:** None. `src/main/mcp/mcpAgentOnboarding.service.ts:44-80` produces a fixed-English
  payload containing the current MCP JSON, bundled skill directory, revision, Codex and Claude Code
  destinations, additive-copy guidance, new-session/runtime guidance, and production or test-only
  safety. `McpGuideModal.vue:87-102` still acknowledges only after a successful Complete setup
  clipboard write; clipboard failure, acknowledgement failure, and restart-required behavior remain
  explicit.
- **P3 · non-blocking:** None. The direct localized titles and concise skill-plus-MCP explanation are
  present at `src/renderer/common/i18n/en.ts:1303-1308` and
  `src/renderer/common/i18n/zh.ts:1304-1309`. Task-scoped source/style/test changes contain no
  unrelated behavior or stale detail-only UI state.

Focused verification passed:

- `yarn test:mcp:agent-onboarding`
- `yarn test:todo:agent-skill-version`
- `yarn check:chat-composer`
- `yarn check:renderer-i18n`
- task-scoped `git diff --check`

No E2E test or Electron launch was performed, as requested.

## Conclusion

**pass** — the implementation is deliverable against the task and design contract.
