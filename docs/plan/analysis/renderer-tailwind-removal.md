# Renderer Tailwind Removal Analysis

## Objective

Remove Tailwind usage from the Bitterless renderer without changing the existing UI or interaction
contracts. Replace every utility class and dynamic utility string with business-named BEM classes
owned by sibling Less files. Keep the Tailwind packages installed as dormant development
dependencies, but do not import or activate them in the renderer build.

## Inventory

| Module | Current Tailwind surface | Migration boundary |
|---|---:|---|
| Host Home | 2 CSS files using `@reference`/`@apply` | Rewrite as ordinary CSS/Less declarations |
| Maestro shared runtime | Tailwind Vite plugin, packages, shared `@import` | Remove plugin activation/import; retain the packages and an explicit minimal renderer reset |
| Maestro Control | 11 Vue components plus `record.format.ts` dynamic utility strings | Business blocks such as `control-app`, `message-item`, `record-item`, and sibling Less files |
| Maestro Home | 2 Vue components | `maestro-menu-bar` and `maestro-layout` blocks with sibling Less files |
| Maestro Workbench | 10 Vue components | `workbench-*` blocks with sibling Less files |

The source inventory found Tailwind utilities in 23 Vue SFCs, utility-returning helpers in
`record.format.ts`, two Home CSS `@apply` sites, and the Tailwind renderer plugin/import/dependencies.
No other Bitterless renderer currently owns Tailwind utilities.

## Integration chain

```text
electron.vite.config.ts
        │
        ├── Host Home CSS ───────► ordinary declarations
        │
        └── Maestro entry points ─► common/style.css (theme + reset only)
                                      │
                                      ├── control components + *.less
                                      ├── home components + *.less
                                      └── workbench components + *.less
```

Removing Tailwind usage is complete only when Vite plugin activation, CSS import/reference, static
utility classes, and utility strings returned by TypeScript helpers are all absent. The
`tailwindcss` and `@tailwindcss/vite` packages intentionally remain in `devDependencies` and
`yarn.lock` for compatibility, without being imported by `electron.vite.config.ts`.

## UI preservation contract

```text
┌──────────────────────── Maestro window ────────────────────────┐
│ Home toolbar / tabs                                            │
├──────────────────────────────────────┬──────────────────────────┤
│ Operation or Workbench view          │ Control / ChatPanel      │
│                                      │                          │
│ Existing density, scroll ownership,  │ Existing composer,       │
│ states, colors, and overlays remain  │ actions, and wrapping    │
└──────────────────────────────────────┴──────────────────────────┘
```

This is a styling-source refactor, not a redesign. Preserve the existing Royal Blue palette,
system UI typography, monospace data/code treatment, responsive sizing, focus/hover/disabled
states, renderer selectors, and every user interaction.

## BEM contract

- Each migrated component uses a business block derived from its role, never a layout utility name.
- CSS classes allow at most two `__` separators: `block__element__subelement`.
- State is represented with `--modifier`; dynamic class functions return semantic BEM modifiers.
- Deeper DOM nesting uses descendant selectors or a new business block rather than deeper class
  chains.
- Stable `name` attributes are preserved independently from CSS classes.

## Verification strategy

1. Add a source guard that rejects Tailwind imports/plugin activation, Tailwind utility syntax,
   `@apply`, and BEM class names with more than two `__` separators in renderer-owned
   templates/helpers, while confirming the dormant packages remain declared.
2. Compile every migrated SFC and Less file.
3. Run the complete Maestro contract suite and production build.
4. Launch isolated Electron E2E and visually compare the Home, Control, and Workbench renderers at
   their real constrained sizes, including popup, active, error, empty, and overflow states that the
   fixture can reach.
