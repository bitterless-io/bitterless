---
id: motto-miniapp-001
scope: omni-motto
status: done
depends-on: [translator-miniapp-001]
---

# Objective

Add Motto as an Omni mini app with a vertical reminder-card list, card Edit/Delete menu, Add/Edit
modal with required Title and optional Subtitle, and validated whole-array localStorage
persistence.

# Context

- `docs/features/motto.md`
- `docs/features/omni-miniapp-cells.md`
- `docs/design/README.md`
- `docs/design/colors.md`
- `docs/plan/analysis/motto.md`

# Path

- `docs/INDEX.md`
- `docs/features/motto.md`
- `docs/features/omni-miniapp-cells.md`
- `docs/plan/README.md`
- `docs/plan/analysis/motto.md`
- `docs/plan/tasks/motto-miniapp-001.md`
- `electron.vite.config.ts`
- `src/main/windows/omniWindow.helper.ts`
- `src/preload/motto/`
- `src/renderer/motto/`
- `src/renderer/omni/omniControl/src/components/OmniPane.vue`
- `src/renderer/common/assets/icons/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/shared/omni/omni.types.ts`
- `scripts/renderer-i18n/check-renderer-i18n.mjs`
- `tests/motto/`
- `package.json`

# Verification

- Test missing, valid, malformed, duplicate-ID, invalid-field, optional-empty-subtitle, and
  write-failure storage behavior.
- Inspect Add/Edit/Delete mutations for whole-array persistence before reactive state commit.
- Inspect the fixed header, one-column scrolling card list, empty/error states, ellipsis dropdown,
  required Title and optional Subtitle form, focusable controls, shared i18n, BEM/Less, and
  constrained layout.
- Inspect that the Header Add action has no visible text, retains a localized accessible name, and
  centers its plus icon horizontally and vertically.
- Inspect that every card title and left rule use `#B42318`, every rendered subtitle uses
  `#A65F59`, and the red hierarchy does not spread to unrelated Motto controls or surfaces.
- Inspect Omni parser allowlisting, Control selector, dedicated preload/renderer runtime mapping,
  navigation fence reuse, development target, and packaged target.
- Run `yarn test:motto`, `yarn check:renderer-i18n`, scoped ESLint, Node/Web type checks, build, and
  `git diff --check`. Record unrelated baseline failures precisely.
