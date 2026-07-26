---
id: omni-pane-menubar-003-5
target: working-tree-2026-07-26-size-feedback
compared_with: omni-pane-menubar-003
status: pass
---

# Verdict

**PASS. No P1, P2, or P3 blocking or non-blocking finding was identified.**

# Findings

None.

# Contract evidence

- The four directional split controls at `OmniPaneMenuBar.vue:71-126` retain their established
  action mappings and render the filled Tabler layout-expand icons with `:size="20"`, the business
  `omni-pane-menubar__split-icon` class, and no explicit `viewBox`. There is no residual size 14 or
  size 24 split-icon declaration and no custom SVG viewBox in the component.
- Vue SSR smoke renders each split icon as a 20x20 SVG with Tabler's single default
  `viewBox="0 0 24 24"`. `OmniPaneMenuBar.less:20-24` fixes the split SVG at
  `flex: 0 0 20px`, `width: 20px`, and `height: 20px`, preventing flex shrink.
- The shared split-button rule at `OmniPaneMenuBar.less:32-41` explicitly sets `width`,
  `min-width`, and `height` to 20px with zero padding. The four controls retain the 2px action gap
  at lines 15-18.
- The close control at `OmniPaneMenuBar.vue:152-162` renders only `IconSquareXFilled` with
  `:size="28"`, the business close-icon class, and no explicit `viewBox`. SSR renders it as a
  28x28 SVG with Tabler's single default `0 0 24 24` viewBox.
- `OmniPaneMenuBar.less:26-30` fixes the close SVG at 28px with `flex: 0 0 28px`.
  `.omni-pane-menubar__btn--close` at lines 83-89 explicitly overrides the 20px base button with
  28px `width`, `min-width`, and `height`; its danger color, border, and hover treatment remain
  intact.
- The menubar remains exactly 36px high with 4px vertical padding, which gives the 28px close
  control its full content box. The URL input and selector remain 24px high, their accepted opaque
  colors and readonly treatment are unchanged, and split hover/active styling remains scoped away
  from the close button.
- Selector-before-URL adjacency and all split, URL, content-mode, and close event bindings remain
  unchanged. The focused regression test guards these relationships together with the final
  20px/28px geometry and the absence of custom viewBoxes or obsolete split sizes.

# Verification

- `node --test tests/omni/omniLayoutLifecycle.test.mjs` — pass, 8/8 tests. Node emitted only the
  existing package-module-type performance warning.
- `yarn eslint src/renderer/omni/omniControl/src/components/OmniPaneMenuBar.vue` — pass.
- Scoped `git diff --check` for the component, Less, focused test, feature contract, and task — pass.
- Vue SSR smoke for all four split icons and `IconSquareXFilled` — pass; runtime dimensions are
  20x20 and 28x28 respectively, each with Tabler's default `0 0 24 24` viewBox.
- No full-repository typecheck was run; this final review was intentionally limited to the requested
  focused checks.
