# Review: todo-agent-skill-onboarding-002 (round 2)

## Findings

No P1, P2, or P3 findings.

## Blocking-fix review

The round-one P2 is resolved. `McpGuideModal` now renders an Arco warning alert whenever integration
info is present and `serverName !== 'bitterless'`, so DEBUG and every other non-production instance
are visibly marked while the production guide renders no warning
(`src/renderer/todo/src/components/McpGuideModal/McpGuideModal.vue:20-28`). The alert title replaces
`{serverName}` with the actual current server name, and Vue text interpolation keeps that value
escaped. Its English and Chinese bodies both forbid real personal Todo data in the current test
instance and explicitly direct real, multi-device-synchronized Todo work to the production
`bitterless` server (`src/renderer/common/i18n/en.ts:992-993`;
`src/renderer/common/i18n/zh.ts:994-995`).

The alert uses Arco's warning type and icon and receives a prominent warning treatment without
changing the modal's existing constrained scrolling, two-step layout, copy controls, or business
BEM structure (`src/renderer/todo/src/components/McpGuideModal/McpGuideModal.less:72-86`). The source
guard now checks the Arco warning, exact non-production predicate, current-name interpolation,
production routing in both locales, and the existing onboarding controls
(`scripts/maestro/check-chat-composer.mjs:83-94`). No regression was found in the task-owned fix.

## Verification

- `yarn check:chat-composer` passed.
- `yarn check:renderer-i18n` passed.
- `yarn test:mcp:agent-onboarding` passed.
- `git diff --check` passed.
- `yarn typecheck:web` remains blocked by existing errors across unrelated connector, coin, poker,
  home, Maestro, Omni, and Todo files; it reported no error in `McpGuideModal.vue` or the changed
  locale files.

## Conclusion

**pass** — the visible non-production safety contract is now implemented and guarded, production
remains warning-free, and no new blocking or non-blocking issue was found in the fix.
