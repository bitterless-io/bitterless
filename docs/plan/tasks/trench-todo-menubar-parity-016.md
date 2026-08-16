---
id: trench-todo-menubar-parity-016
scope: renderer/coin
status: done
depends-on: [trench-omni-embedding-012, trench-agent-skill-guide-015]
---

# Trench / Todo Menu Bar Parity

## Objective

Align Trench's top menu bar with Todo's established desktop shell while preserving Trench's live
vault status, Agent guide action, Refresh behavior, and standalone/Omni host semantics.

## Context

- `docs/features/coin-layout.md`
- `docs/features/todo-layout.md`
- `src/renderer/todo/src/components/MenuBar/`

## Design contract

```text
Todo:   │ Todo                                  action · action · refresh │ 32px Royal Blue
Trench: │ Trench                       ● local · agent · refresh          │ 32px Royal Blue
```

- Reuse Todo's exact menu-bar height, background, bottom border, horizontal padding, title type,
  action spacing, 28px icon sizing, and hover color.
- Use one left title and one right action group. Remove the Trench-only `BL` badge and subtitle.
- Keep the Trench status dot and localized status label as the only domain-specific visual; hide the
  label before required buttons when width is constrained.
- Keep macOS traffic-light clearance and native drag only in standalone; Omni remains no-drag.

## Path

- `docs/features/coin-layout.md`
- `src/renderer/coin/src/components/TrenchHeader/TrenchHeader.vue`
- `src/renderer/coin/src/components/TrenchHeader/TrenchHeader.less`
- `src/renderer/coin/src/App.less`
- focused Trench renderer layout tests when needed

## Acceptance

- Standalone and Omni Trench top bars are exactly 32px high with Todo's `#4e5882` background and
  `#3d4666` divider, and no height-specific override changes that contract.
- The left side contains only the localized/product title `Trench`; the right side contains the live
  status, Agent icon action, and Refresh icon action in Todo's spacing and button treatment.
- Loading, refreshing, unavailable, and local status semantics remain truthful and accessible.
- Agent and Refresh retain their current stable automation names, tooltips/accessible labels, and
  behavior; required actions do not clip at narrow width.
- Standalone drag/traffic-light spacing and Omni no-drag behavior remain correct.

## Verification

- Focused static renderer contract test for height, colors, layout, host modifiers, action controls,
  and narrow-width status behavior.
- `yarn typecheck:web` (or the narrowest equivalent renderer typecheck available).
- Fresh standalone and Omni screenshots at representative wide and narrow sizes, inspected against
  Todo's menu bar for height, background, alignment, clipping, and interaction reachability.
- `git diff --check` and an independent Verify review.

## Implementation result

- Replaced the Trench-only badge/subtitle header with Todo's 32px Royal Blue one-title/one-action-
  group menu bar, while retaining the live status plus Agent and Refresh behavior.
- Preserved standalone macOS traffic-light clearance and drag behavior, and Omni's 12px no-drag
  layout. Narrow layouts hide only the status label; the status dot and both actions remain visible.
- Added focused static guards for the shared shell tokens, host modifiers, icon actions, responsive
  behavior, and absence of the obsolete compact-height override.
- Task-scoped static tests passed `6/6`, narrow Trench renderer typecheck passed, fresh build passed,
  focused standalone/Omni Electron tests passed `2/2`, and representative screenshots passed visual
  inspection without clipping or overflow. See
  [`../results/trench-todo-menubar-parity-016.md`](../results/trench-todo-menubar-parity-016.md).
- Independent Verify found no P1, P2, or P3 finding. See
  [`../reviews/trench-todo-menubar-parity-016-1.md`](../reviews/trench-todo-menubar-parity-016-1.md).
