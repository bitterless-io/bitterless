---
id: omni-miniapp-cells-001
scope: persistent browser or local mini-app content in Omni layout cells
status: pending
depends-on: [eyes-on-agents-focus-002]
verify:
  - legacy Omni layouts restore as browser cells without URL loss
  - layout panels persist browser/miniapp mode and Todo/EyesOnAgents selection
  - mini-app cells render directly in Omni operation views without standalone windows
  - Todo and EyesOnAgents use their own preload bundles
  - development uses ELECTRON_RENDERER_URL and packaged builds use app.getAppPath()/out files
  - unsupported mini apps fail explicitly
  - yarn test:omni-miniapps
  - yarn check:renderer-i18n
  - yarn typecheck:node
  - yarn build
---

# Omni Browser And Mini-App Cells

## Objective

Allow every Omni layout leaf to persist and render either a remote browser page or one of exactly
two local Bitterless mini apps: Todo and EyesOnAgents. The mini apps must run directly in the Omni
operation `WebContentsView`, select their own renderer/preload pair in development and packaged
builds, and never require their standalone windows.

## Context

- `docs/features/omni-miniapp-cells.md`
- `docs/plan/analysis/omni-miniapp-cells.md`
- `docs/features/renderer-i18n.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/plan/tasks/eyes-on-agents-focus-002.md`

## Path

- `src/shared/omni/**`
- `src/main/windows/omniWindow.helper.ts`
- focused Omni runtime helpers under `src/main/omni/**`
- `src/main/xpc/omniWindow.handler.ts`
- `src/preload/omni/**`
- `src/preload/eyesOnAgents/**`
- `src/renderer/omni/**`
- embedded-host context under `src/renderer/eyesOnAgents/**`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `electron.vite.config.ts` only if an existing renderer/preload entry is insufficient
- focused tests under `scripts/omni/**`
- `package.json`
- `docs/features/omni-miniapp-cells.md`
- `docs/plan/analysis/omni-miniapp-cells.md`
- `docs/plan/tasks/omni-miniapp-cells-001.md`
- `docs/plan/README.md`
- `docs/INDEX.md`

## Implementation Constraints

- Keep the remote browser runtime unchanged when `contentMode === 'browser'`.
- Use only `todo` and `eyesOnAgents` as mini-app IDs. Never accept arbitrary renderer paths,
  preload paths, URLs, or app identifiers from persisted configuration.
- Anchor generated assets at `app.getAppPath()/out`. Use the Electron Vite renderer URL only in
  development and `loadFile` only for packaged first-party renderers.
- Recreate only the affected operation view when mode/app changes. Do not recreate the BaseWindow
  or open Todo/EyesOnAgents standalone windows.
- Never attach a first-party mini-app preload to a remote browser cell. Prevent a privileged
  mini-app operation view from navigating away from its expected local renderer target.
- Preserve browser URL and mini-app selection across mode switches and application restarts.
- Explicitly migrate legacy leaves with no mode to browser. Reject unknown current variants.
- Give embedded Todo and EyesOnAgents static preload host context. Todo refreshes its own store;
  EyesOnAgents suppresses standalone-window actions. Remove embedded drag/traffic-light/fixed-size
  assumptions so mini apps remain usable in constrained split panes.
- Use Arco controls, Tabler icons, shared i18n, sibling Less, and shallow business BEM. Add no
  Tailwind/atomic classes and no hardcoded user-facing strings.
- Preserve all unrelated `eyes-on-agents-focus-002`, Electron pin, and existing working-tree
  changes.

## Verification

1. Add deterministic contract/runtime tests for legacy migration, allowed mini apps, content
   signature changes, persistence fields, and dev/packaged renderer/preload targets.
2. Add a renderer source guard for the Arco mode selector, exact two-item mini-app select,
   embedded EyesOnAgents behavior, i18n, and BEM/Less rules.
3. Run focused Omni tests, renderer i18n checks, affected EyesOnAgents UI tests, Node typecheck,
   full build, and `git diff --check`.
4. Inspect `out/preload/todo.js`, `out/preload/eyesOnAgents.js`,
   `out/renderer/todo/index.html`, and `out/renderer/eyesOnAgents/index.html` after the build.
5. Perform an independent review against the feature contract before marking this task done.
