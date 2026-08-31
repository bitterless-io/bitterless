---
id: maestro-control-entry-royalblue-076
scope: Maestro Control entry pruning and themed Arco Button interaction states
status: implemented; owner verification pending
depends-on: [maestro-cowork-menubar-parity-006, maestro-local-home-navigation-007]
verify: source audit and independent review only; Ral owns Electron/runtime visual acceptance
---

# Remove obsolete Control entries and restore Royal Blue Arco buttons

## Objective

Remove the empty Connector selector and development Demo menu from Maestro Control while retaining
the real fixed-Home/Workbench Connector path, then make Maestro Arco Buttons use Bitterless's
canonical Royal Blue Less theme rather than the precompiled Arcoblue CSS.

## Context

- `docs/features/maestro.md`
- `docs/issues/maestro-control-connector-demo-and-arco-blue.md`
- `docs/design/colors.md`
- `docs/plan/tasks/maestro-cowork-menubar-parity-006.md`
- `docs/plan/tasks/maestro-local-home-navigation-007.md`

## Path

- `src/renderer/maestro/{home,control,workbench}/src/{main.ts,control.ts,workbench.ts}`
- `src/renderer/maestro/control/src/{ControlApp.vue,ControlApp.less}`
- `docs/{INDEX.md,features/maestro.md,issues,plan}/**`

## Contract

- Delete only the Control header's Connector button, Connector placeholder, and Demo trigger/menu.
  Remove their UI-only imports, refs, constants, functions, and styles.
- The Control chat remains the only Control content and keeps the existing Maestro channel identity,
  close action, model selectors, chat history, attachments, voice flow, context meter, and send/stop
  behavior.
- Preserve Connector capability: the fixed Home rail action, Workbench `connectors` pane/route/view,
  connector preload/handler/runtime, connector message compatibility, and related XPC contracts stay.
- Preserve the Main Demo service and XPC contract; the visible Control entry alone is retired.
- Replace Maestro Home, Control, and Workbench `arco.css` imports with `arco.less` plus Arco global
  theme styles, matching Local Home and the other Bitterless renderers. The existing Electron Vite
  `modifyVars: theme` mapping remains the single Arco palette authority.
- Standard Arco primary buttons inherit Royal Blue `#4E5882`; hover inherits `#606B9D`; pressed
  inherits `#323955`. Outline/secondary focus and interaction states use the same mapped palette.
- Remove page-local Control Arcoblue button colors. Preserve component geometry and all semantic
  warning/danger/success/loading/disabled colors.
- Do not change 36px/28px/48px/84px chrome geometry, traffic lights, tab loading, fixed Home, browser
  navigation, Workbench pane inventory, capture, i18n, or updater behavior.

## Verification

- Independent source review verifies entry removal, retained fixed-Home/Workbench Connector path,
  retained Main Demo API, themed Less imports in every affected renderer, no Control-local Arcoblue
  Arco Button overrides, and preserved semantic statuses.
- Task-owned `git diff --check` and new-file trailing-whitespace inspection must pass.
- Do not run tests, type checks, lint, builds, Electron, Playwright/E2E, network, or packaged-app
  smoke in this delivery. Ral owns real-app acceptance.

## Delivery

- Implemented on 2026-08-31.
- Removed the Control-only Connector selector, Demo menu, Connector placeholder, compact-demo UI
  state/handlers, and their now-unused styles while retaining fixed Home/Workbench Connector and
  Main Demo contracts.
- Changed Maestro Home, Control, and Workbench from precompiled `arco.css` to the canonical
  `arco.less` plus global theme pipeline already used by Local Home.
- Removed Control-local Arco primary/secondary/outline color overrides so `theme.ts` owns Royal Blue
  default/hover/pressed/focus states and Arco retains danger/warning/success/loading/disabled
  semantics.
- Independent source review: [Review 1](../reviews/maestro-control-entry-royalblue-076-1.md) —
  Approved, no P0-P2 findings.
- Task-owned static and whitespace checks passed. Tests, type checks, lint, builds, Electron,
  Playwright/E2E, network, and packaged smoke were intentionally not run; Ral owns runtime visual
  acceptance.
