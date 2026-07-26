---
id: omni-layout-axis-collapse-002
scope: Omni topology lifecycle, native bounds, and browser/mini-app header mapping
status: implemented; owner verification pending
depends-on: []
verify:
  - collapsing one row inside a two-column/two-row tree preserves the untouched column geometry
  - splitting and re-closing the collapsed column cannot move untouched native views
  - first-level vertical-to-horizontal promotion preserves the promoted split sizes
  - closing and splitting cannot accept Splitpanes lifecycle resize events
  - post-collapse split-above and split-below geometry matches native cell bounds
  - browser content is inset by the URL header and mini-app content is not
  - layout-mode toolbar height is stable and does not alter outer leaf geometry
  - yarn test:omni-layout
  - yarn check:renderer-i18n
  - yarn typecheck:node
  - yarn typecheck:web reports no task-related diagnostics
  - yarn build
  - git diff --check
---

# Omni Root-Axis Collapse And Header Bounds

## Objective

Keep the layout editor, persisted tree, and native Omni cell views on one geometry model when close
operations collapse the root across axes, new panes are inserted above or below, and browser versus
mini-app runtime headers change the inner content rectangle.

## Context

- `docs/issues/omni-root-axis-collapse-size-mismatch.md`
- `docs/features/omni-miniapp-cells.md`
- `docs/plan/analysis/omni-miniapp-cells.md`

## Path

- `src/shared/omni/omniLayout.service.ts`
- `src/main/windows/omniWindow.helper.ts`
- `src/main/xpc/omniWindow.handler.ts`
- `src/shared/omni/omni.types.ts`
- `src/renderer/omni/omniControl/src/App.vue`
- `src/renderer/omni/omniControl/src/store/layout.store.ts`
- `src/renderer/omni/omniControl/src/components/OmniPane.vue`
- `src/renderer/omni/omniControl/src/components/OmniPaneMenuBar.less`
- `tests/omni/omniLayoutLifecycle.test.mjs`
- `package.json`

## Verification

1. Exercise both exact two-level topologies from the issue through pure split/remove helpers. Assert
   root promotion keeps the promoted split ratios and an inner-column collapse keeps the root and
   untouched sibling ratios.
2. Flatten the promoted and newly split trees into pixels and assert complete, non-overlapping x/y
   coverage including 4px dividers.
3. Assert browser and mini-app inner bounds derive from the same outer leaf bounds with 36px and 0px
   header insets respectively.
4. Guard the production Vue and XPC source contract for structural revision remounting,
   lifecycle-event rejection, awaited split/close synchronization, and one serialized Main commit.
   These checks are a release gate: the task cannot be marked done while only helper/test files
   contain the intended implementation.
5. Run the focused test, renderer i18n check, Node type check, full build, and diff check. Audit Web
   type-check output for touched files while preserving the repository's unrelated existing
   diagnostics as an explicit boundary.

## Previous Review

- [omni-layout-axis-collapse-002-1](../reviews/omni-layout-axis-collapse-002-1.md) - superseded by
  the 2026-07-26 recurrence because the reviewed implementation is not present in the current branch

## 2026-07-26 Verification

- Exact inner-column collapse/re-split/close geometry: pass.
- Root-axis promotion and split-above/split-below geometry: pass.
- Serialized commit ordering and production source gates: pass.
- `yarn test:omni-layout`: pass, 7/7.
- Node type check, targeted ESLint, renderer i18n, full build, and diff check: pass.
- Web type check: no touched Omni diagnostic; unrelated existing repository diagnostics remain.
- Manual visual reproduction: pending Ral; no recording or screenshot was taken.
