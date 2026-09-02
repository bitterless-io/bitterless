---
id: miniapp-card-layout-003
scope: fixed Home Mini Apps card geometry and description overflow
status: implemented; owner verification pending
depends-on: [maestro-local-home-navigation-007]
verify: source audit and independent review only; Ral owns Electron visual acceptance
---

# Keep Mini Apps Open actions on one bottom baseline

## Objective

Give every shared fixed-Home Mini Apps card one constant height, clamp its description to three
lines, and pin its Open action to the bottom so localized copy cannot shift the action baseline.

## Context

- `docs/features/README.md`
- `docs/issues/miniapp-card-action-alignment.md`
- `docs/plan/tasks/maestro-local-home-navigation-007.md`

## Path

- `src/renderer/home/src/views/miniApp/MiniApp.less`
- `docs/features/README.md`
- `docs/issues/miniapp-card-action-alignment.md`
- `docs/{INDEX.md,plan/README.md}`
- `docs/plan/{tasks,reviews}/miniapp-card-layout-003*.md`

## Contract

- Keep the existing card width at `320px` and set an exact `184px` height; do not use only
  `min-height` or allow content to grow the card.
- Make the card and its direct `.arco-card-body` child a nested vertical flex layout. The body owns
  its remaining height, the description region may shrink, and `.arco-card-actions` uses automatic
  top margin to stay against the bottom padding.
- Render at most three subtitle lines with `display: -webkit-box`, vertical box orientation, hidden
  overflow, and `-webkit-line-clamp: 3`. Allow long unbroken copy to wrap within the card.
- Use the existing Arco Card actions slot and Open button. Do not position the button absolutely or
  change its loading, disabled, click, error, i18n, or application-launch behavior.
- Apply the change only through the shared `MiniApp.less`. Maestro fixed Home receives it through
  the existing shared component import. Do not change the independent Workbench Apps compact list.
- Preserve the 12px wrapping grid gap, page scrolling, card border/background/radius, 24px icon,
  title, and current Royal Blue button theme.
- Preserve every unrelated current-worktree change, especially the concurrent Maestro and
  EyesOnAgents deliveries and the shared documentation indexes.

## Verification

- Independent source review verifies the exact `320 × 184px` card, direct Arco body flex ownership,
  bottom-pinned action region, three-line clamp, shared Maestro reuse path, and unchanged Open logic.
- Task-owned `git diff --check` and new-file trailing-whitespace inspection must pass.
- Do not run tests, type checks, lint, builds, Electron, Playwright/E2E, network, or packaged smoke
  in this delivery. Ral owns real-window Chinese/English visual acceptance.

## Delivery

- Implemented on 2026-08-31.
- The shared fixed-Home cards are exactly `320 × 184px`; their Arco bodies now own a vertical flex
  layout whose action region stays on one bottom baseline.
- Descriptions clamp after three lines and wrap long unbroken content without widening the card.
- Maestro inherits the shared component unchanged. Workbench Apps remains independent, and the
  existing Open loading, disabled, duplicate-open, failure, i18n, and launch behavior is untouched.
- [Review 1](../reviews/miniapp-card-layout-003-1.md) approved the implementation with no P0-P2
  findings.
- Task-scoped source, ownership, and whitespace checks passed. Tests, typecheck, lint, build,
  Electron, Playwright/E2E, network, and packaged smoke were intentionally not run; Ral owns the
  Chinese/English real-window visual acceptance.
