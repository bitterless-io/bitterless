---
status: completed
verify:
  - yarn build
  - Arco buttons, inputs, selects, menu items, pagination items, dropdown options, and textareas use a consistent 6px radius
  - cards, forms, and modals retain the compact 12px density from ai-crms
  - Bitterless pages use a 12px content inset and 12px module gap
  - login and authenticated desktop layouts have no clipped or overlapping controls at the 800x600 minimum window size
---

# Arco Style System

## Goal

Bring Bitterless's global Arco overrides in line with the compact `ai-crms/src/assets` conventions
without copying Micromeet-specific colors, table borders, or domain selectors.

## Layout

```text
+--------------------------------------------------+
| desktop chrome                                   |
+------+-------------------------------------------+
| nav  | 12px content inset                        |
|      | +---------------------------------------+ |
|      | | compact Arco controls, 6px radius     | |
|      | +---------------------------------------+ |
|      |             12px module gap              |
|      | +---------------------------------------+ |
|      | | next module                           | |
|      | +---------------------------------------+ |
+------+-------------------------------------------+
```

## Contract

- Import each reusable Arco override once through the shared renderer theme.
- Use `6px` for standard controls and menu/dropdown/pagination items; preserve circle and round
  button shapes.
- Use `12px` card, form, modal, content inset, and module spacing where applicable.
- Keep the existing Bitterless brand palette and login composition.
- Do not copy the `ai-crms` doctor-select selector, Micromeet palette, or blue bordered-table rules.
- Keep project-specific component styles only when they express layout or brand behavior that the
  shared Arco layer should not own.

## Verification

- `yarn build`, `yarn typecheck`, and `yarn lint` pass.
- Login inputs and all three login buttons compute to a `6px` radius; form spacing remains `12px`.
- The settings page computes to `12px` content padding/gap, `6px` input/button/select radii, and an
  auto-scrolling content shell.
- Connector cards retain an `8px` card frame, `12px` body padding, and `10px 12px` header padding.
- At the `800x600` minimum window size, the OTP login panel and controls fit without document
  overflow, clipping, or overlap.
