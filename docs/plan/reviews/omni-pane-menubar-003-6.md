---
id: omni-pane-menubar-003-6
target: working-tree-2026-07-26-close-size-feedback
compared_with: omni-pane-menubar-003
status: pass
---

# Verdict

**PASS. No P1, P2, or P3 blocking or non-blocking finding was identified.**

# Findings

None.

# Contract evidence

- The four directional controls at `OmniPaneMenuBar.vue:71-126` render the filled Tabler
  layout-expand icons at size 20. The close control at lines 152-162 renders
  `IconSquareXFilled` at the same size. All five SVGs carry their business icon class and contain
  no explicit `viewBox` override.
- Vue SSR smoke renders every split icon and the close icon as a 20x20 SVG with Tabler's single
  default `viewBox="0 0 24 24"`; no runtime width or height is 28px.
- `OmniPaneMenuBar.less:20-30` gives both split and close icons `flex: 0 0 20px`, `width: 20px`,
  and `height: 20px`, so neither family can shrink. The base button at lines 32-41 and the explicit
  close modifier at lines 83-89 both set `width`, `min-width`, and `height` to 20px with the base
  padding fixed at zero.
- No active component or Less geometry remains at 28px. The focused test's `28px` expressions are
  negative regression assertions, and the task's earlier 28px verification paragraph is retained
  only as immutable feedback history; neither defines the current contract or runtime styling.
- The close button retains `status="danger"`, its localized title and aria label, and
  `@click.stop="closePane"` at `OmniPaneMenuBar.vue:152-161`; `closePane` still emits `close` at
  lines 63-65. Its danger color, border, and hover background remain intact at
  `OmniPaneMenuBar.less:83-93`.
- The menubar remains 36px high, split actions retain their 2px gap, and the selector and URL input
  remain 24px high. Accepted opaque colors, selector-before-URL order, split-only hover/active
  hierarchy, and all split, URL, content-mode, and close events are unchanged.
- `tests/omni/omniLayoutLifecycle.test.mjs` guards the unified 20px SVG/button/no-shrink contract,
  removal of active 28px close geometry, default-viewBox use, close danger behavior, and the
  unchanged layout and event contracts.

# Verification

- `node --test tests/omni/omniLayoutLifecycle.test.mjs` — pass, 8/8 tests. Node emitted only the
  existing package-module-type performance warning.
- `yarn eslint src/renderer/omni/omniControl/src/components/OmniPaneMenuBar.vue` — pass.
- Scoped `git diff --check` for the component, Less, focused test, feature contract, and task — pass.
- Vue SSR smoke for all four split icons and `IconSquareXFilled` — pass; all five runtime SVGs are
  20x20 with Tabler's default `0 0 24 24` viewBox and no 28px dimensions.
- No full-repository typecheck was run; this final review was intentionally limited to the requested
  focused checks.
