# Review: todo-agent-skill-onboarding-002 (round 3)

## Findings

No P1, P2, or P3 findings.

## Stale-main / Loading review

The new shared resolver separates the runtime response into three explicit states. Only an exact
`null` response is `pending`; non-object responses and objects with a missing, non-string, empty,
or whitespace-only `skillPath` are `restart-required`; a valid path is trimmed before becoming
`ready` (`src/shared/mcp/mcpIntegrationInfo.shared.ts:1-20`). Focused assertions cover null,
missing, blank, and whitespace-padded valid paths
(`scripts/mcp/agent-onboarding.test.mjs:38-54`).

The normal MenuBar entry point validates the response before mutating the modal state. Any state
other than `ready` shows the restart-required error and returns before setting
`mcpGuideVisible = true`; the ready branch stores the resolver's trimmed path
(`src/renderer/todo/src/components/MenuBar/MenuBar.vue:132-144`). This prevents an older main
process response from opening a guide with a permanent `Loading...` placeholder.

`McpGuideModal` independently handles an already-open/HMR-preserved stale response. It renders an
Arco `type="error"` alert for `restart-required`, disables both the skill-path copy action and the
complete-instruction copy action, and passes only the trimmed ready path to display/copy
(`src/renderer/todo/src/components/McpGuideModal/McpGuideModal.vue:81-119,149-172`). Its generic
required-text display helper also uses `Loading...` only when `props.info === null`; once an object
exists, missing required text is shown as a restart-required contract problem rather than loading
(`src/renderer/todo/src/components/McpGuideModal/McpGuideModal.vue:151-167`). The error treatment
is implemented through the existing Arco alert and business BEM Less classes
(`src/renderer/todo/src/components/McpGuideModal/McpGuideModal.less:232-245`).

The changed modal remains free of Tailwind/atomic utility classes. Its static classes pass the
existing shallow `mcp-guide` business-BEM guard, and all copy actions still use the shared Arco
`IconBtn` with Tabler's copy icon (`scripts/maestro/check-chat-composer.mjs:65-102`).

## Verification

- `yarn test:mcp:agent-onboarding` passed.
- `yarn test:mcp:todo-skill-export` passed.
- `yarn check:chat-composer` passed.
- `yarn check:renderer-i18n` passed.
- `yarn typecheck:node` passed.
- `yarn build` passed, including Todo preload and renderer output.
- `git diff --check` passed.
- `yarn typecheck:web` still reports the repository's existing unrelated connector, coin, poker,
  home, Maestro, Omni, and Todo baseline errors. It reports no error in
  `McpGuideModal.vue`, `MenuBar.vue`, `mcpIntegrationInfo.shared.ts`, or the changed locale files.

## Conclusion

**pass** — stale main-process responses now produce explicit restart guidance instead of
permanent loading, the normal entry point refuses to open the modal on an incompatible contract,
the HMR/open-modal fallback is safe, and valid paths are trimmed consistently for display and
copying without introducing style, type, or build regressions.
