---
id: onlypreview-settings-category-navigation-015
scope: Reorganize the OnlyPreview Settings window into category navigation and one focused settings list
status: done
depends-on: [onlypreview-search-performance-acceptance-014]
---

# Objective

Replace the vertically stacked OnlyPreview Settings sections with a stable two-column information
architecture: a category list on the left and the selected category's settings list on the right.
Preserve every existing setting, save/cancel behavior, host capability, window bound, and light-only
theme constraint.

# Context

- [OnlyPreview feature contract](../../features/onlypreview.md#settings-contract)
- [OnlyPreview delivery analysis](../analysis/onlypreview.md)
- [Bitterless color system](../../design/colors.md)
- [PRODUCT-P01 and three-view acceptance](onlypreview-search-performance-acceptance-014.md)

# Path

- `src/renderer/onlypreview/settings/src/App.vue`
- `src/renderer/onlypreview/settings/src/App.less`
- `src/renderer/onlypreview/settings/src/onlyPreviewSettings.store.ts`
- `src/renderer/onlypreview/settings/src/onlyPreviewSettings.type.ts`
- `tests/onlypreview/onlyPreviewSettingsLayout.test.mjs`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `areas/only-preview/feature-design.md` (historical-status clarification only)

# Flow

```text
Settings Header
      ↓
left category button ── local activeCategory ──► one right-hand settings list
      ↓                                             ↓
fixed Cancel / Save ───────── shared draft ────────┘
```

The category is renderer-local view state. It never enters the shared settings contract, XPC,
Main, or SQLite.

# Delivery

1. Keep the existing Settings title/header and bottom Cancel/Save actions.
2. Add a left category rail for Preview, Project, and Appearance. Preview is selected initially.
3. Render only the selected category's settings rows in the right pane; category changes never mutate
   the settings draft or save implicitly.
4. Use semantic buttons, visible keyboard focus, `aria-current`, and stable `name` attributes for
   automation. Keep the 800×600 minimum-window layout usable without horizontal page scrolling.
5. Preserve the existing royal-blue/light-surface visual language; use one narrow active-category
   marker as the layout's only new visual signature.

# Acceptance

- The category rail is left of the settings detail pane at the 800×600 minimum window size.
- Exactly one category is current, and changing categories swaps the right-hand list without losing
  draft changes made in another category.
- Preview exposes editor font size and word wrap; Project exposes single-click preview; Appearance
  exposes the disabled Light theme row.
- Save, Cancel, Escape, loading, error, sandbox, persistence, and parented-window behavior remain
  unchanged.
- Focused source/UI tests, Node typecheck, renderer i18n, lint, formatting, and diff checks pass.

# Verification

- `node --test tests/onlypreview/onlyPreviewSettingsLayout.test.mjs tests/onlypreview/onlyPreviewSettings.test.mjs`: 11/11 PASS.
- `yarn typecheck:node`, renderer i18n, focused source/test ESLint and Prettier, and
  `git diff --check`: PASS.
- `yarn typecheck:web` still reports only the repository's existing Connector/Poker/Home/shared
  baseline diagnostics; it reports no OnlyPreview Settings diagnostic.
- `yarn build`: PASS.
- Focused real Electron acceptance:
  `yarn _test:e2e:onlypreview --grep "opens one secure Settings BrowserWindow"`: 1/1 PASS. It
  verifies left/right geometry, category order/default/current state, one visible panel, cross-category
  draft retention, save persistence, cancel/Escape, sandbox, and parented-window bounds.
- Full post-change `yarn test:e2e:onlypreview`: 7/7 PASS.
