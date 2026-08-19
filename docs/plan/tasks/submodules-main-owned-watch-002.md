---
id: submodules-main-owned-watch-002
scope: submodules
status: implemented; owner runtime verification pending
depends-on: [submodules-omni-embedding-001]
verify: yarn typecheck && node --test tests/omni/submodulesOmniEmbedding.test.mjs tests/submodules/submodulesMainRuntime.test.mjs
---

# One Main-owned Submodules watcher broadcasting to every view

## Objective

Move scanning, watching, and root persistence out of the per-view preload runtime into a single
Main-owned runtime, and push each changed snapshot to every renderer through `xpcMain.broadcast`.

1. `src/main/submodules/` owns the scanner, the watcher, and the runtime. The scanner and watcher move
   unchanged (pure `node:fs` / `node:path`); the runtime reaches Core SQLite through
   `createXpcMainEmitter<SettingDao>('SettingDao')`.
2. `SubmodulesHandler` becomes an `XpcMainHandler` registered from `src/main/xpc/xpc.helper.ts`. Its
   four methods and the `SUBMODULES_HANDLER_NAME` channel name are unchanged, so the renderer emitter
   needs no edit.
3. Changed snapshots leave Main as `xpcMain.broadcast(SUBMODULES_SNAPSHOT_EVENT, snapshot)`. Renderers
   subscribe with `xpcRenderer.subscribe(...)` and apply `payload.params`.
4. `SubmodulesStoreApi` / `SUBMODULES_STORE_HANDLER_NAME` and the renderer `SubmodulesStoreHandler`
   are deleted: a preload no longer calls into its own renderer.
5. `initialize()` is idempotent across views. The first call restores the persisted root and arms the
   watcher; a later call from another view returns the current snapshot without a second restore.
6. Watching follows the views. A debounced change or safety tick that finds no live Submodules surface
   (no standalone window, no `submodules` mini-app cell) disarms the watcher and the interval while
   keeping the persisted root. This repairs the regression a Main-owned watcher would otherwise
   introduce: a per-view watcher used to die with its view.
7. The preload keeps only `electron-xpc`, the Omni active-frame SDK, and the static host context.

Out of scope: changing the snapshot shape, the scan algorithm, the `.gitmodules` contract, the debounce
and interval constants, and any renderer UI behavior.

## Context

- `docs/features/submodules.md` — "One Main-owned runtime, broadcast to every view", Boundaries,
  Surfaces.
- `docs/features/omni-miniapp-cells.md` — Embedded Mini-App Behavior (Submodules bullet).
- `docs/plan/tasks/submodules-omni-embedding-001.md` — the delivery this refactor supersedes in part.
- Broadcast precedent: `src/main/trench/trench.runtime.ts` +
  `src/renderer/coin/src/views/vault/trenchVault.client.ts`.

## Path

- `src/main/submodules/submoduleScanner.service.ts` (moved)
- `src/main/submodules/submoduleWatcher.service.ts` (moved)
- `src/main/submodules/submodulesRuntime.service.ts` (moved, rewired)
- `src/main/xpc/submodules.handler.ts` (new)
- `src/main/xpc/xpc.helper.ts`
- `src/main/xpc/submodulesWindow.handler.ts` (live-window query)
- `src/main/windows/omniWindow.helper.ts` (live mini-app query)
- `src/preload/submodules/submodules.preload.ts`
- `src/preload/submodules/` (scanner, watcher, runtime, handler deleted)
- `src/shared/submodules/submodules.type.ts`
- `src/renderer/submodules/src/store/submodules.store.ts`
- `tests/submodules/submodulesMainRuntime.test.mjs` (new)
- `tests/omni/submodulesOmniEmbedding.test.mjs`

## Verification

1. No file under `src/preload/submodules/` reads, watches, or persists anything; only the preload
   entry remains and it imports no scanner, watcher, or runtime.
2. `src/main/submodules/submodulesRuntime.service.ts` holds exactly one watcher and one interval, and
   publishes only through `xpcMain.broadcast(SUBMODULES_SNAPSHOT_EVENT, …)` behind the changed-
   fingerprint check.
3. The renderer store subscribes to `SUBMODULES_SNAPSHOT_EVENT` and no longer defines an
   `XpcRendererHandler`; `SubmodulesStoreApi` is gone from the shared contract.
4. A second `initialize()` does not restore or re-persist a second time.
5. Disarming happens when no live surface remains, and the persisted root is untouched.
6. `yarn typecheck` adds no new error. `yarn build` produces the six mini-app renderers and preloads.
7. `node --test tests/submodules/ tests/omni/ tests/motto/` passes.
8. Electron runtime acceptance (two Submodules cells plus the standalone window updating together
   from one branch change; choosing a root in one view updating the others immediately) is
   owner-verified; this task does not run Electron E2E.
