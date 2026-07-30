---
id: eyes-on-agents-search-result-domain-033
scope: two-line global-search result rows with custom Domain context
status: implemented; owner verification pending
depends-on: [eyes-on-agents-token-title-search-032]
---

# EyesOnAgents Search Result Domain

## Objective

Turn each global-search result into a compact two-line observation row so its title remains primary
while the second line identifies the task's custom Domain and retains the runtime state.

## Context

- [EyesOnAgents global title search issue](../../issues/eyes-on-agents-global-title-search.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [Token title search](eyes-on-agents-token-title-search-032.md)

## Required behavior

```text
┌ Search tasks ────────────────────────────────────────────┐
│ [ dsh________________________________________________ ] │
├─────────────────────────────────────────────────────────┤
│ > dsh-service&viv-admin                                 │
│   Operations                                      Idle  │
│                                                       │
│   DSH-maintain                                         │
│   -                                            Unknown  │
└─────────────────────────────────────────────────────────┘
```

- Render every result as exactly two visual rows:
  - row 1: thread title only;
  - row 2: Domain title aligned left and existing runtime state aligned right.
- Resolve Domain metadata from the current renderer snapshot by `thread.domainId`. Only active
  custom Domains produce a visible title.
- Treat the system `uncategorized` storage fallback as “no classification” and display `-`.
  Missing Domain rows, stale IDs, and blank resolved titles also display `-`.
- Do not display the All or Focus projection names as a Domain. They are views, not stored custom
  classification.
- Keep long Domain titles on one ellipsized line with their full value available through the native
  title tooltip.
- Preserve the result's whole-row click target, selected/hover background, keyboard selection,
  Open behavior, title search matching, and modal scrolling.
- Include the resolved Domain context in the result's accessible name. Use localized “No Domain”
  wording for accessibility when the visual value is `-`.
- Domain resolution remains renderer-memory only. Add no XPC, persistence, App Server request, or
  polling behavior.

## State contract

| stored Domain state | second-line left value |
|---|---|
| active custom Domain with non-blank title | Domain title |
| system `uncategorized` Domain | `-` |
| missing/stale `domainId` lookup | `-` |
| blank resolved title | `-` |

## Expected paths

- `docs/issues/eyes-on-agents-global-title-search.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `docs/INDEX.md`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.vue`
- `src/renderer/eyesOnAgents/src/components/ThreadSearch/ThreadSearch.less`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/global-title-search.test.mjs`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- The real store harness covers custom, uncategorized, missing/stale, and blank Domain resolution.
- Source guards protect the two-line structure, left/right metadata alignment, ellipsis/tooltip,
  accessible Domain context, and preservation of whole-row Open behavior.
- Run the normal EyesOnAgents UI suite, renderer i18n check, focused renderer typecheck, and
  `git diff --check`. Do not launch Electron; Ral owns runtime UI verification.

## Review

- [eyes-on-agents-search-result-domain-033-1](../reviews/eyes-on-agents-search-result-domain-033-1.md)
  accepted the implementation with no P1, P2, or P3 finding.

## Delivery evidence

- Completed on 2026-07-30 with a reactive custom-Domain resolver and compact two-line result grid.
- Custom Domain rename/refresh is read from the current snapshot; uncategorized, missing/stale, and
  blank Domain values render `-` without changing search matching.
- The normal EyesOnAgents UI suite passes 47/47; renderer i18n and diff checks pass.
- Focused renderer typecheck remains blocked only by the pre-existing unresolved `@preload/*`
  alias in `eyesOnAgentsEnv.bridge.ts`; no changed file produces a diagnostic.
- No Electron process was launched. Ral owns the final visual, tooltip, and keyboard runtime check.
