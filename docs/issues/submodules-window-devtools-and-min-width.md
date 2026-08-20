# Submodules standalone window: DevTools never visible, 800px floor too wide

Status: fixed; owner verification pending

Feature: [Submodules mini app](../features/submodules.md)

## Report

1. Running in dev debug mode, the standalone Submodules window shows no DevTools.
2. The window cannot be narrowed enough to sit beside an editor. Owner decision: `minWidth: 480`,
   matching the EyesOnAgents standalone window.

## Evidence and likely cause

The call was present and it does run. `src/main/xpc/submodulesWindow.handler.ts` opened DevTools at
the end of `createWindow()`, and the built debug bundle proves the gate evaluates true:

```js
// out/main/app.main.js (debug_dev build)
if (utils$2.is.dev && true) {
  created.webContents.openDevTools({ mode: "detach" });
}
```

So this is not a dead gate — `import.meta.env.VITE_MODE` is inlined as `'debug'` by
`generateEnvDefines()` for the Main bundle, and `is.dev` is `!app.isPackaged`. What is wrong is the
ordering. `createWindow()` opened detached DevTools while the window was still `show: false`, and only
after it resolved did `openSubmodulesWindow()` run `show()` and then `focus()`. Focusing the
Submodules window raises it above the DevTools window created moments earlier, so a same-size DevTools
window sits behind the app window and reads as "DevTools never opened".

Two secondary defects in the same code path:

- The gate was `is.dev && VITE_MODE !== 'release'`. The project's debug authority is
  `VITE_MODE === 'debug'` (see `docs/plan/tasks/desktop-command-line-debug-mode-010.md`), and every
  other debug DevTools path additionally excludes `BITTERLESS_E2E=1` so a test never fights DevTools
  for focus. This one did neither.
- `windowStateService.resolve` / `register` were called without the window's minimum, so
  `constrainSize` applies `DEFAULT_MIN_WIDTH = 800`. Lowering `minWidth` alone would let the user
  narrow the window, but the next launch would restore it at 800.

Not reproduced under instrumentation — the app was not launched to confirm the stacking order, so the
focus-ordering diagnosis is inference from the source and the compiled bundle. If DevTools still fails
to appear after this change, the next suspect is placement on a secondary display.

## Fix contract

- `minWidth: 480`, `minHeight: 600` on the window, and the same pair passed to both
  `windowStateService.resolve` and `windowStateService.register`, so a narrow width survives a restart.
- DevTools opens from `openSubmodulesWindow()` after `show()` and `focus()`, never from
  `createWindow()`, so the DevTools window is the last one raised.
- Debug gate: `import.meta.env.VITE_MODE === 'debug' && process.env.BITTERLESS_E2E !== '1'`. `is.dev`
  is not consulted. A release profile and every E2E run stay DevTools-free.
- Re-opening an already-open window does not stack a second DevTools: guarded by
  `webContents.isDevToolsOpened()`.

## Acceptance

- `yarn dev` → open Submodules from Mini Apps: a detached DevTools window is visible and on top.
- The window can be dragged down to 480px wide, and reopening the app restores that width.
- `node --test tests/submodules/*.test.mjs` passes.
- `yarn typecheck` reports nothing new for submodules files.

## Resolution

`submodulesWindow.handler.ts` now declares `SUBMODULES_MIN_WIDTH = 480` /
`SUBMODULES_MIN_HEIGHT = 600` and one `WINDOW_STATE_OPTIONS` constant reused by the window options,
`resolve`, and `register`. The DevTools call moved into a private `openDebugDevTools()` invoked at the
end of both `openSubmodulesWindow()` branches, gated on `VITE_MODE === 'debug'`, `BITTERLESS_E2E`, and
`isDevToolsOpened()`. Covered by `tests/submodules/submodulesWindow.test.mjs`. The 480px exception is
recorded in the workspace rule files (`CLAUDE.md` / `AGENTS.md`) next to the EyesOnAgents one.
Remaining step is Ral's run of the debug app.
