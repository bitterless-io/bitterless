---
id: omni-pane-menubar-003-3
target: working-tree-2026-07-26-final-contract
compared_with: omni-pane-menubar-003
status: pass
---

# Verdict

**PASS. No P1, P2, or P3 blocking or non-blocking finding was identified.**

# Findings

None.

# Contract evidence

- `OmniPaneMenuBar.vue:71-126` maps split left/up/down/right to the filled Tabler left-sidebar,
  top-navbar, bottom-bar, and right-sidebar expand icons. Each has `size=24` and the shared business
  icon class, with no component-level `viewBox` attribute.
- An SSR smoke render of all four installed Tabler v3.44.0 components produced SVGs with
  `width="24"`, `height="24"`, and exactly one `viewBox="0 0 24 24"`. Inspection of Tabler's
  `createVueComponent.mjs` and `defaultAttributes.mjs` confirms that viewBox comes from the filled
  icon default rather than from `OmniPaneMenuBar.vue`.
- `OmniPaneMenuBar.less:15-34` keeps the original 2px split gap and exact 24px zero-padding button,
  while `.omni-pane-menubar__split-icon` fixes `flex: 0 0 24px`, width, and height to prevent SVG
  shrink. Scoped search found no 28px value, cropped `3 3 18 18` viewBox, or 6px gap in the current
  task, feature contract, component, Less, or focused test.
- `OmniPaneMenuBar.less:1-12` keeps the 36px menu-bar geometry and uses the required opaque
  `oklch(0.98 0.008 270)` surface. The URL wrapper at lines 48-57 and selector at lines 65-75 share
  `oklch(0.94 0.012 270)`; the readonly URL state at lines 59-63 uses
  `oklch(0.93 0.025 270)`.
- Hover and active styles at `OmniPaneMenuBar.less:37-46` are descendants of
  `.omni-pane-menubar__split-actions`, so they cannot match the close button. Hover uses the deeper
  `oklch(0.84 0.025 270)` background and raises icon lightness from the default 0.45 to 0.56.
  Active deepens the background further to 0.78. The separate close danger hover at lines 77-84 is
  unchanged and retains its danger background.
- The Browser/Mini App selector remains the immediate sibling before the URL wrapper at
  `OmniPaneMenuBar.vue:128-151`. Split mappings and URL, content-mode, and close emits/bindings remain
  unchanged at lines 35-65 and 71-162.
- `tests/omni/omniLayoutLifecycle.test.mjs:263-359` guards icon family/size/default-viewBox use,
  fixed icon and button geometry, the 2px gap, all required surface colors, split-only interaction
  selectors, unchanged close hover, selector order, and event mappings.

# Verification

- `node --test tests/omni/omniLayoutLifecycle.test.mjs` — pass, 8/8 tests. Node emitted only the
  existing package-module-type performance warning.
- `yarn eslint src/renderer/omni/omniControl/src/components/OmniPaneMenuBar.vue` — pass.
- Scoped `git diff --check` for the component, Less, focused test, feature contract, and task — pass.
- Four-icon Vue SSR smoke — pass; each runtime SVG is 24x24 with Tabler's default `0 0 24 24`
  viewBox and no cropped override.
- No full-repository typecheck was repeated for this template/Less-only final revision.
