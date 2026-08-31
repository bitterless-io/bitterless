---
id: maestro-tab-iconbtn-controls-078
scope: Maestro tab close and New-tab shared IconBtn rendering and optical alignment
status: implemented; owner verification pending
depends-on: [maestro-menubar-tab-inset-077]
verify: focused source contract test, targeted lint/typecheck/build; no Electron/Playwright/E2E
---

# Use shared IconBtn for Maestro tab icon actions

## Objective

Replace the Maestro tab's raw text close button and custom New-tab button with the shared
`IconBtn`, using centered Tabler SVG glyphs without changing tab geometry or behavior.

## Context

- `docs/design/README.md`
- `docs/features/maestro.md`
- `docs/issues/maestro-tab-icon-actions-not-iconbtn.md`
- `docs/issues/maestro-menubar-tabs-not-inset.md`
- `docs/plan/tasks/maestro-menubar-tab-inset-077.md`

## Path

- `src/renderer/maestro/home/src/components/MenuBar/MenuBar.vue`
- `src/renderer/maestro/home/src/components/MenuBar/MenuBar.less`
- `src/renderer/common/components/IconBtn/{IconBtn.vue,IconBtn.less}` (consume only)
- `tests/maestro/maestroTabIconButtons.test.mjs`
- `docs/{INDEX.md,features/maestro.md,issues,plan}/**`

## Contract

- Import and use the existing shared `IconBtn`; do not clone its Arco wrapper or global styles.
- Replace text `×` with Tabler `IconX` and use Tabler `IconPlus` for New tab. Keep explicit SVG
  sizes appropriate to the existing `20px` close and `28px` New-tab controls.
- Use component-scoped BEM selectors qualified with `.icon-btn.arco-btn` to retain the exact
  `20 × 20px` close and `28 × 28px` New-tab geometry, `right: 4px`, current colors, active-tab/idle
  hover contrast, and drag exclusion. Let the shared primitive own SVG centering, pressed scale,
  transition, and keyboard focus behavior.
- Preserve `@click.stop`, locked-width consecutive closing, drag suppression, visibility rules,
  `tabStore.newTab()`, the New-tab wrapper, and every existing tab/favicon/loading/label behavior.
- Preserve the exact 36px strip, 28px tab row, 48px address row, 84px total chrome, four-corner tab
  shape, 78px macOS gutter, and native traffic-light position.
- Preserve all unrelated current-worktree changes.

## Verification

- Add one focused source contract test proving both actions use `IconBtn`, both real Tabler glyphs
  are present, the raw text `×` is absent, event behavior remains wired, and scoped CSS retains the
  exact two control sizes and centering.
- Run the focused test, targeted ESLint/Prettier, renderer typecheck, production build, and
  `git diff --check`. Record any unrelated baseline failure exactly.
- Do not run Electron, Playwright, packaged smoke, or E2E. Ral performs the final visual check.

## Delivery

- Replaced the raw tab-close `×` and custom New-tab `+` buttons with the shared `IconBtn` and
  Tabler `IconX` / `IconPlus` glyphs, while preserving the existing click, drag, visibility, and
  locked-width behavior.
- Kept the reviewed Task 077 geometry intact at this delivery boundary; the follow-on
  [maestro-address-row-compact-082](maestro-address-row-compact-082.md) intentionally supersedes
  only the address-row and total-chrome dimensions.
- [Review 1](../reviews/maestro-tab-iconbtn-controls-078-1.md) passed with no findings. The focused
  source-contract test passed 3/3, targeted ESLint passed, the production build passed, and
  task-scoped `git diff --check` passed. Renderer typecheck and Prettier still report unrelated
  existing baseline failures documented by the review.
- Electron, Playwright/E2E, packaged smoke, and application launch were not run. Ral owns final
  visual verification.
