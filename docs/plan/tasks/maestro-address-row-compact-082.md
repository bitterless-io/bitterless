---
id: maestro-address-row-compact-082
scope: Maestro compact address row and aligned navigation/address control height
status: implemented; owner verification pending
depends-on: [maestro-tab-iconbtn-controls-078]
verify: focused source contract test, targeted lint/build, independent review; no Electron/Playwright/E2E
---

# Compact the Maestro address row

## Objective

Reduce Maestro's address row by 6px and make the navigation group and address input share an exact
28px height, while keeping Main's first-frame native-view layout aligned with the renderer.

## Context

- `docs/design/README.md`
- `docs/features/maestro.md`
- `docs/issues/maestro-address-row-too-tall.md`
- `docs/plan/tasks/maestro-tab-iconbtn-controls-078.md`

## Path

- `src/renderer/maestro/home/src/components/MenuBar/MenuBar.{vue,less}`
- `src/renderer/maestro/home/src/components/MenuBar/menuBar.store.ts`
- `src/main/maestro/windows/main/maestroWindow.controller.ts`
- `src/main/maestro/windows/window.helper.ts`
- `tests/maestro/maestroAddressRowGeometry.test.mjs`
- `docs/{INDEX.md,features/maestro.md,issues,plan}/**`

## Contract

- Preserve the 36px tab strip and change only the address row from 48px to 42px, making the total
  MenuBar height 78px.
- Give `.maestro-menu-bar__navigation` and `.maestro-menu-bar__address` explicit 28px heights. The
  navigation group keeps 2px padding, so its contained navigation buttons become 24px square and
  cannot stretch the wrapper beyond 28px.
- Keep the snapshot and other address-row actions unchanged. Keep all navigation state, URL entry,
  keyboard submit, tab behavior, styling language, and native traffic-light geometry unchanged.
- Change Main's first-frame `TOOLBAR_H` from 84 to 78 and update only directly related geometry
  comments. Renderer-measured placeholders remain authoritative after mount.
- Preserve all unrelated current-worktree changes.

## Verification

- Add a focused source-contract test proving the `36 + 42 = 78` hierarchy, equal 28px navigation
  and address heights, 24px navigation controls, and Main's 78px first-frame fallback.
- Run the focused Maestro tests, targeted ESLint, production build, and task-scoped
  `git diff --check`; record unrelated baseline failures exactly.
- Obtain an independent source review against this task.
- Do not run Electron, Playwright/E2E, packaged smoke, or application launch. Ral performs the
  final visual check.

## Delivery

- Reduced the MenuBar to 78px total while preserving the 36px tab strip and changing the address
  row to 42px.
- Aligned the navigation group and address input at 28px. Only navigation-contained buttons shrink
  to 24px; snapshot, Control, Workbench, update, and other trailing actions retain their established
  geometry and behavior.
- Updated Main's first-frame native-view fallback to 78px and the directly related source comments;
  renderer-measured placeholder bounds remain authoritative after mount.
- Added a focused source-contract test. The combined Task 078/082 tests passed 6/6, targeted ESLint
  passed, the production build passed, and task-scoped `git diff --check` passed.
- [Review 1](../reviews/maestro-address-row-compact-082-1.md) approved the implementation with no
  remaining P1/P2/P3 findings.
- Electron, Playwright/E2E, packaged smoke, and application launch were not run. Ral owns final
  visual verification.
