---
id: omni-pane-menubar-003-8
target: deb2e2bb83824e751f351838c804667a6804140e
compared_with: omni-pane-menubar-003
status: pass
---

# Verdict

**PASS. No P1, P2, or P3 blocking or non-blocking finding was identified.**

# Findings

None.

# Contract evidence

- `OmniPaneMenuBar.vue:3-9` imports the four directional Tabler filled layout-expand icons and the
  filled square-X icon. The template renders them in left, up, down, right order at lines 70-127,
  with every icon set to size 20 and no custom `viewBox`.
- The event mappings remain left=`h/before`, up=`v/before`, down=`v/after`, and right=`h/after` at
  `OmniPaneMenuBar.vue:35-38`; URL submission, content-mode selection, and stopped close emission
  remain intact.
- The Browser/Mini App selector is immediately before the URL wrapper at
  `OmniPaneMenuBar.vue:128-151`. The close action remains a danger button with a 20px filled
  square-X at lines 152-162.
- `OmniPaneMenuBar.less:20-36` fixes both split and close icon boxes and their buttons at 20x20px,
  with zero padding and no icon shrink. The split action group retains its 2px gap.
- Split hover/active styling is scoped to the split-actions descendant at
  `OmniPaneMenuBar.less:38-46`; the independent danger close color, border, and hover remain at
  lines 77-87, so the generic split hover cannot replace the close affordance.
- The menubar remains opaque `oklch(0.98 0.008 270)`. Selector and editable URL retain
  `oklch(0.87 0.02 270)`, while the readonly URL retains `oklch(0.85 0.035 270)`.
- Direct SSR rendering of all five installed Tabler components with `size=20` produced
  `width="20" height="20" viewBox="0 0 24 24"` and filled paths, confirming the default icon
  geometry rather than relying only on source-name guards.

# Verification

- `node --test tests/omni/omniLayoutLifecycle.test.mjs` — pass, 9/9 tests. Node emitted only the
  existing package-module-type performance warning.
- `yarn eslint src/renderer/omni/omniControl/src/components/OmniPaneMenuBar.vue` — pass.
- `git diff --check 10da844^..deb2e2b` — pass.

