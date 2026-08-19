---
id: submodules-omni-embedding-001
scope: submodules
status: implemented; owner runtime verification pending
depends-on: [omni-miniapp-cells-001]
verify: yarn typecheck && node --test tests/omni/submodulesOmniEmbedding.test.mjs
---

# Submodules as the sixth Omni mini-app cell

## Objective

Make the Submodules mini app selectable and fully operational inside an Omni Browser cell, without
creating or depending on the standalone Submodules window.

1. `submodules` becomes the sixth bounded `OmniMiniAppId`, with display URL `bl://miniapp/submodules`
   and a non-sandboxed runtime (`preloadFile: 'submodules.js'`, `rendererName: 'submodules'`).
2. The Omni Layout panel offers Submodules as a sixth mini-app choice with its existing icon and
   `miniApp.submodules.name` label.
3. The `submodules` preload exposes static host context (`standalone` | `omni`) and loads the shared
   Omni active-frame SDK so an embedded cell shows the accent-orange active frame.
4. The renderer keeps its full capability in the cell (choose root, live watch state, refresh, Open
   in WebStorm) and hides every standalone-window affordance: Windows minimize/maximize/close,
   menu-bar double-click maximize, the drag region, and the macOS traffic-light padding. It never
   calls `SubmodulesWindowApi` from the Omni host.
5. The native directory dialog attaches to the focused top-level window resolved as a `BaseWindow`,
   so it parents to the Omni `BaseWindow` instead of falling back to a parentless dialog.

Out of scope: live cross-instance root synchronization, deduplicating watchers across hosts, and any
change to the standalone window graph or to `.gitmodules` scanning itself.

## Context

- `docs/features/submodules.md` — Contract, Hosts, Instance boundary, Boundaries, Surfaces, Layout.
- `docs/features/omni-miniapp-cells.md` — Persisted Content Contract, Runtime Mapping, Embedded
  Mini-App Behavior, Interaction Contract, Verification Contract.
- `docs/plan/tasks/trench-omni-embedding-012.md` — the fifth mini app's precedent.
- `docs/INDEX.md` — documentation index.

## Path

- `src/shared/omni/omni.types.ts`
- `src/shared/submodules/submodules.type.ts`
- `src/main/windows/omniMiniAppRuntime.service.ts`
- `src/main/xpc/submodulesSystem.handler.ts`
- `src/preload/submodules/submodules.preload.ts`
- `src/renderer/submodules/src/contextBridge/submodulesEnv.bridge.ts`
- `src/renderer/submodules/src/App.vue`
- `src/renderer/submodules/src/App.less`
- `src/renderer/submodules/src/components/SubmodulesMenuBar/SubmodulesMenuBar.vue`
- `src/renderer/submodules/src/components/SubmodulesMenuBar/SubmodulesMenuBar.less`
- `src/renderer/omni/omniControl/src/components/OmniPane.vue`
- `tests/omni/submodulesOmniEmbedding.test.mjs`

## Verification

1. `OMNI_MINI_APP_IDS` is exactly the six documented ids; `parseOmniMiniAppId('submodules')` resolves
   and `parseOmniMiniAppId('onlypreview')` still throws.
2. A persisted `contentMode: 'miniapp'` / `miniAppId: 'submodules'` leaf survives a
   `parseOmniLayoutConfig` round trip with its browser URL preserved.
3. `OMNI_MINI_APP_RUNTIME.submodules` is `{ preloadFile: 'submodules.js', rendererName: 'submodules',
   sandbox: false }`, and Trench remains the only sandboxed mini-app runtime.
4. The preload exposes `submodulesEnv.host` and imports the Omni active-frame SDK.
5. The renderer gates every `submodulesWindowEmitter` call and the drag/traffic-light styling on the
   non-Omni host, and keeps Open…/Refresh unconditional.
6. `OmniPane.vue` lists exactly the six mini apps with i18n names and no Tailwind classes.
7. `yarn typecheck` passes. `node --test tests/omni/submodulesOmniEmbedding.test.mjs` passes.
8. Electron runtime acceptance (select Submodules in a cell, choose a root, watch a branch change,
   Open in WebStorm) is owner-verified; this task does not run Electron E2E.
