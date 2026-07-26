---
id: omni-pane-menubar-003
scope: Omni per-pane layout menu bar hierarchy and split-action legibility
status: done
depends-on: []
verify:
  - split-left, split-up, split-down, and split-right use Tabler filled layout-expand icons at size 20 with the default viewBox
  - all four split buttons and no-shrink icon boxes are 20x20px
  - the 20x20 glyphs do not flex-shrink or overlap each other
  - the Browser/Mini App selector renders immediately left of the URL input
  - the menu bar is opaque; selector and URL use oklch(0.87 0.02 270), readonly URL uses oklch(0.85 0.035 270)
  - split hover uses a deeper background and lighter icon without changing close-button danger hover
  - close uses the Tabler filled square-X at size 20 inside a 20x20 danger button
  - existing split, URL, content-mode, and close events remain unchanged
  - node --test tests/omni/omniLayoutLifecycle.test.mjs
  - yarn eslint src/renderer/omni/omniControl/src/components/OmniPaneMenuBar.vue
  - yarn typecheck:web reports no task-related diagnostics
  - git diff --check
---

# Omni Pane Menu Bar Hierarchy

## Objective

Make all four directional split actions compact with a 20×20px SVG and button using Tabler's
unaltered default viewBox, place the Website/Mini App
selector immediately to the left of the URL input it controls, and give
the menu surface and split hover states a clearer opaque visual hierarchy. Make the close action
equally compact with a filled 20px Tabler square-X and danger button.

## Context

- `docs/features/omni-miniapp-cells.md`
- `docs/design/colors.md`

## Layout

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ [left][up][down][right]  [Website | Mini App]  [URL / target]  [close] │
└─────────────────────────────────────────────────────────────────────────┘
```

## Path

- `src/renderer/omni/omniControl/src/components/OmniPaneMenuBar.vue`
- `src/renderer/omni/omniControl/src/components/OmniPaneMenuBar.less`
- `tests/omni/omniLayoutLifecycle.test.mjs`
- `docs/features/omni-miniapp-cells.md`
- `docs/plan/tasks/omni-pane-menubar-003.md`

## Verification

1. Guard the component source for the filled Tabler icon family, 20×20px SVG rendering, no custom
   viewBox, and selector-before-input order.
2. Guard the Less source for consistent 20px split-button and close-button geometry.
3. Run the focused Omni lifecycle test, targeted ESLint, Web typecheck audit, and diff check.

## 2026-07-26 First-Pass Verification

- Independent review: pass with no findings.
- Focused Omni lifecycle test: pass, 8/8.
- Targeted component ESLint and diff check: pass.
- Web typecheck: no task-related or Omni Control diagnostic; unrelated existing repository
  diagnostics keep the full command at exit 2.

## 2026-07-26 22px Feedback Verification

- Independent review: pass with no findings.
- Focused Omni lifecycle test: pass, 8/8.
- Targeted component ESLint and scoped diff check: pass.
- The scoped contract, component, and test contain no residual 18px split-icon size.
- Split buttons remain 24×24px with zero padding; layout, events, and TypeScript structure are unchanged.

## 2026-07-26 Final Visual Verification

- Independent menu-surface review and close-button review: pass with no findings.
- Focused Omni lifecycle test: pass, 8/8.
- Targeted component ESLint and scoped diff check: pass.
- SSR smoke confirms the four split icons and filled square-X close icon render at 24×24px with
  Tabler's default viewBox.
- Menu opacity, deeper target controls, split-only hover hierarchy, close danger styling, button
  geometry, selector order, and event bindings match the accepted contract.

## 2026-07-26 Screenshot Size Verification (Superseded Close Size)

- Independent review: pass with no findings.
- Focused Omni lifecycle test: pass, 8/8; targeted ESLint and scoped diff check: pass.
- SSR smoke confirms the four split controls render at 20×20px and close renders at 28×28px,
  all with Tabler's default viewBox.
- The 28px close modifier overrides the 20px shared button geometry without changing the 36px
  menu bar, 24px target controls, colors, selector order, or event behavior.
- Subsequent owner feedback standardized close and split controls at 20×20px.

## 2026-07-26 Final Color Verification

- Independent review: pass with no findings.
- Focused Omni lifecycle test: pass, 8/8; targeted ESLint and scoped diff check: pass.
- URL input and content selector use `oklch(0.87 0.02 270)`; readonly URL uses
  `oklch(0.85 0.035 270)` with no old control-color value remaining in the active Less rules.
- Text, borders, 20px button/icon geometry, hover states, selector order, and event behavior are unchanged.
