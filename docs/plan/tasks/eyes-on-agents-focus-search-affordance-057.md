---
id: eyes-on-agents-focus-search-affordance-057
scope: place the Focus search toggle after Read all and disclose its platform shortcut on hover
status: implemented; owner verification pending
depends-on: [eyes-on-agents-focus-search-consolidation-055]
---

# EyesOnAgents Focus Search Affordance

## Objective

Move the Focus search toggle to the right of `Read all` so both header actions form one right-aligned
cluster, and give the toggle a hover tooltip that names the platform's own shortcut — `⌘F` on macOS,
`Ctrl+F` on Windows.

## Context

- [EyesOnAgents Focus-only board](../../features/eyes-on-agents-focus-board.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [Focus search consolidation](eyes-on-agents-focus-search-consolidation-055.md)

Task 055 made `Cmd+F` / `Ctrl+F` drive the column's own filter, but nothing in the UI says so. The
toggle also sat between the title and `Read all`, which `space-between` pushed into the middle.

## Required behavior

- Header order left to right: target glyph and `Focus` title, then a right-aligned cluster of
  `Read all` followed by the `⌕` search toggle. The title keeps the remaining space so the cluster
  stays flush right at every width.
- The toggle carries an Arco `mini` tooltip on hover and focus, matching the menu bar's existing
  tooltip treatment.
- Tooltip and accessible label are the same platform-resolved string: macOS shows the `⌘F` symbol
  form, Windows shows `Ctrl+F`; any other platform falls back to the `Ctrl+F` wording.
- Platform detection reuses the shared `uaHelper`, not a new user-agent check.
- Both locales get the two strings; no hardcoded user-facing text.
- Everything else in the header stays as delivered: `Read all` state rules, the expand/collapse
  toggle behavior, and the filter row's own contract.
- Do not launch Electron E2E; Ral performs the visual check.

## Expected paths

- `docs/features/eyes-on-agents-focus-board.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/README.md`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.vue`
- `src/renderer/eyesOnAgents/src/components/DomainColumn/DomainColumn.less`
- `src/renderer/common/i18n/en.ts`, `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/ui-source.test.mjs`

## Verification

- `yarn typecheck:eyes-on-agents:ui`
- `yarn test:eyes-on-agents:ui`
- `yarn check:renderer-i18n`
- `yarn build`
- Static source coverage asserts the header order, the tooltip wrapper, the `uaHelper`-driven
  platform label, and both locale strings.

## Result

Implemented. Header order is now title → `Read all` → `⌕`, with
`.agent-domain__title-row { margin-right: auto }` keeping the pair flush right. The toggle is wrapped
in `<a-tooltip position="br" mini>`, matching the menu bar, and both the tooltip and the button's
`aria-label` use one platform-resolved string.

New i18n keys `actions.searchTitlesMac` (`Search titles (⌘F)` / `搜索标题（⌘F）`) and
`actions.searchTitlesWindows` (`Search titles (Ctrl+F)` / `搜索标题（Ctrl+F）`) resolve through
`uaHelper.isMac`, so anything that is not macOS gets the `Ctrl+F` wording.

Verified: `yarn typecheck:eyes-on-agents:ui`, `yarn test:eyes-on-agents:ui`,
`yarn check:renderer-i18n`, `yarn build`. E2E not run.
