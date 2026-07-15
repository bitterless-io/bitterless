---
id: renderer-tailwind-removal
scope: Bitterless renderer styling and agent Vue rules
status: done
depends-on: [renderer-arco-bem-controls, maestro-source-layout-migration]
---

# Renderer Tailwind Removal

## Objective

Remove every Tailwind utility class and Tailwind build activation from Bitterless renderers.
Migrate affected Vue components to business BEM classes in sibling Less files, with at most two
`__` separators, while preserving the current UI and all behavior. Keep `tailwindcss` and
`@tailwindcss/vite` installed as dormant development dependencies.

## Context

- `docs/plan/analysis/renderer-tailwind-removal.md`
- `docs/design/README.md`
- `docs/design/colors.md`
- `docs/features/maestro.md`
- Root `AGENTS.md` and `CLAUDE.md` styling rules

## Contract

- No renderer-owned Vue/TypeScript/CSS source contains Tailwind utility classes, dynamic utility
  strings, `@apply`, `@reference "tailwindcss"`, or `@import "tailwindcss"`.
- Keep `@tailwindcss/vite` and `tailwindcss` in `devDependencies` and `yarn.lock`, but do not import
  or activate the renderer Vite plugin. Preserve a minimal explicit CSS reset for behavior
  previously supplied by preflight.
- Every migrated Vue component imports a sibling `.less` file and uses a business-rooted BEM block.
- CSS class names contain at most two `__` separators. State uses `--modifier`; deeper structure uses
  descendant selectors or a new business block.
- Preserve current layout, visual palette, typography, responsive behavior, overlays, scroll
  ownership, Arco controls, Tabler icons, `name` attributes, events, and runtime behavior.
- Add a deterministic source check and register it in the existing Maestro check suite without
  weakening the current fixed-count/check-discovery guard.
- Update `AGENTS.md` and `CLAUDE.md` with byte-equivalent shared styling rules.

## Path

- `/Users/ral/Documents/projects/overmind/AGENTS.md`
- `/Users/ral/Documents/projects/overmind/CLAUDE.md`
- `docs/design/README.md`
- `docs/plan/analysis/renderer-tailwind-removal.md`
- `docs/plan/tasks/renderer-tailwind-removal.md`
- `electron.vite.config.ts`
- `package.json`
- `yarn.lock`
- `src/renderer/home/src/App.css`
- `src/renderer/home/src/views/layout/components/homeMenu/HomeMenu.css`
- `src/renderer/maestro/common/style.css`
- `src/renderer/maestro/control/src/`
- `src/renderer/maestro/home/src/`
- `src/renderer/maestro/workbench/src/`
- `scripts/maestro/`
- `tests/maestro/`
- `docs/plan/reviews/renderer-tailwind-removal-1.md`
- `docs/plan/reviews/renderer-tailwind-removal-2.md`

## Verification

- Run the no-Tailwind/BEM-depth source guard and the complete `yarn check:maestro` suite.
- Compile every affected Vue SFC and sibling Less file.
- Run `yarn build` and inspect build output for Tailwind packages or emitted utility selectors.
- Confirm both dormant Tailwind packages remain declared and locked while the Vite config does not
  import or activate them.
- Run isolated Electron Playwright coverage for Maestro Home, Control, and Workbench, checking
  renderer errors, horizontal overflow, control accessibility, and key visible states.
- Run `yarn typecheck:web`; if repository baseline errors remain, prove that no new error belongs to
  the migrated files.
- Run `git diff --check` and complete an independent review before marking this task done.

## Result (round 1)

- Migrated all 23 inventoried Maestro Tailwind SFCs to business BEM classes and sibling Less, plus
  the SQLite manager's remaining generic `container` class.
- Removed renderer-owned Tailwind directives, the Vite plugin, direct packages, and lockfile
  entries; added an explicit shared reset and the fixed-suite source regression guard.
- Verified 37/37 Maestro checks, targeted Vue/Less compilation, production build, Electron baseline,
  every Workbench view, artifact selectors, and patch hygiene.
- Independent verdict: [pass](../reviews/renderer-tailwind-removal-1.md).

## Owner follow-up

- Restore the two Tailwind development dependencies without restoring renderer imports, plugin
  activation, directives, utility classes, or generated project-owned utility CSS.
- Adjust the regression guard so dependency presence is expected rather than treated as Tailwind
  usage, then complete a round 2 independent review.

## Owner follow-up result

- Restored `tailwindcss` and `@tailwindcss/vite` as dormant `devDependencies` at `^4.3.0`; the
  existing Yarn lock resolves both to `4.3.2`.
- Kept the renderer Vite plugin inactive and all renderer-owned source free of Tailwind imports,
  directives, utility classes, and generated project-owned utility CSS.
- Updated the guard to require the dormant dependencies and lock entries while continuing to reject
  source/build activation, dynamic utility producers, and BEM depth beyond two `__` separators.
- Independent follow-up verdict: [pass](../reviews/renderer-tailwind-removal-2.md).
