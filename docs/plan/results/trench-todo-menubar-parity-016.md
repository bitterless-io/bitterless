# Result: Trench / Todo Menu Bar Parity

## Outcome

Trench now uses the same top-shell visual contract as Todo in standalone and Omni: a fixed 32px
Royal Blue menu bar, one left title, and a compact right action group. Trench keeps its live vault
status as the only domain-specific element.

## Delivered

- `TrenchHeader.vue`: removed the `BL` badge and subtitle, grouped status/Agent/Refresh on the right,
  and converted Agent and Refresh to icon-only Arco buttons with preserved automation names,
  localized tooltips, accessible labels, loading fencing, and behavior.
- `TrenchHeader.less`: matched Todo's exact `#4e5882` background, `#3d4666` divider, 32px height,
  padding, title treatment, 8px action gap, 28px buttons, 16px icons, hover color, and host padding.
- `App.less`: removed the obsolete short-height header override so every host keeps the same height.
- `trenchOmniEmbedding.test.mjs`: added focused source-contract coverage for the visual tokens,
  simplified hierarchy, host modifiers, required controls, and narrow-width status behavior.

## Verification

- PASS — `node --test tests/omni/trenchOmniEmbedding.test.mjs`: `6/6` after fresh build.
- PASS — narrow Trench renderer `vue-tsc` project.
- PASS — fresh DEBUG build while preserving the running `Bitterless_DEBUG_PROD` instance.
- PASS — isolated canonical DEBUG_DEV build and focused Electron Playwright standalone + Omni: `2/2`.
- PASS — standalone 1360×860 / 800×600 and Omni 800×568 / 398×568 / 800×282 screenshots inspected
  at original resolution; no height drift, clipping, overlap, or root overflow.
- PASS — `git diff --check`.
- Independent review: no P1, P2, or P3 finding.

The broader `yarn typecheck:web` was also attempted during development and remained blocked by
pre-existing unrelated connector, Poker test, and renderer bridge errors; the task-scoped Trench
renderer typecheck passed with no Header error. Windows behavior remains source-contract verified,
not runtime tested in this macOS session.

## Review

- [`../reviews/trench-todo-menubar-parity-016-1.md`](../reviews/trench-todo-menubar-parity-016-1.md)
