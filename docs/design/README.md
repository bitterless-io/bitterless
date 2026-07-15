# Bitterless Design System

## Purpose and boundary

This scope defines the visual contracts shared by Bitterless desktop renderers. It owns brand
colors, component-state colors, spacing, and reusable asset rules. Feature documents own page
structure and behavior; implementation files consume the tokens defined here.

## Ownership

| Concern | Source of truth |
|---|---|
| Product palette and semantic color usage | [Color system](colors.md) |
| Arco Less runtime mapping | [`theme.ts`](../../theme.ts) |
| Renderer-wide Arco density and radius rules | `src/renderer/common/assets/style/` |
| Menu icon state selection | `HomeMenuItem.vue` and the paired PNG assets |
| Maestro glyph naming and color | [Color system](colors.md#maestro-icon) |
| Historical palette exploration | `doc/colors.md` (reference only) |

## Modules

- [Color system](colors.md)
- [Customer authentication](customer-authentication.md)

## Scope-wide constraints

- Design values are documented here before they are introduced into renderer code or image assets.
- Arco primary actions use the Royal Blue product palette.
- Navigation active icons and documented identity accents use `#C2410C`, not the Arco primary
  color.
- Image assets preserve transparent backgrounds and use exact solid source colors before
  antialiasing.
- Vue renderers use Arco components for standard buttons, dialogs, inputs, and other controls.
  Icon-only actions use the shared `IconBtn` wrapper, with Tabler icons preferred when available.
- Renderer component styling uses business-rooted BEM class names in a sibling `.less` file; Vue
  templates and dynamic class producers contain no Tailwind/atomic utility classes.
- BEM depth is capped at two `__` separators (`block__element__subelement`). Deeper markup uses
  descendant selectors or a new business block, while state uses `--modifier`.
