# EyesOnAgents surface hierarchy is over-bordered

状态：已修复

## Symptom

EyesOnAgents uses borders and card shadows on the board canvas, every Domain column, every column
header, and every thread item. The result feels more segmented than Todo even though both Mini Apps
use the same horizontal Domain-board interaction.

## Required correction

- Reuse Todo's background-led hierarchy: neutral app canvas, soft default Domain surface, warm Focus
  surface, and white thread items.
- Remove decorative borders from Domain columns, column headers, thread items, source marks, and the
  add-Domain affordance. Keep borders or outlines only where they communicate input focus, keyboard
  focus, error state, or another necessary interaction boundary.
- Replace the thread item's elevated card treatment with Todo's quiet white row and subtle hover
  shadow. Runtime state remains encoded by the existing signal rail and text, not by a card border.
- Preserve the current EyesOnAgents layout, information density, drag behavior, status semantics,
  reduced-motion behavior, and keyboard focus visibility.

## Acceptance

- Default and Focus columns are distinguished primarily by background color and have no visible
  outer or header divider border.
- Thread items have no default border or elevation; hover uses only a restrained shadow and
  keyboard focus remains clearly visible.
- The add-Domain control follows Todo's filled neutral surface instead of a dashed outline.
- Focused UI source tests, strict UI typecheck, and the production build pass.

## Verification

- Todo and EyesOnAgents source styles were compared selector by selector.
- `yarn test:eyes-on-agents:ui`, `yarn typecheck:eyes-on-agents:ui`, the production build, and
  `git diff --check` pass.
- Independent review found no blocking or non-blocking style regression.
