---
id: todo-preload-runtime-001
scope: chunk-safe Todo preload and renderer runtime asset resolution
status: done
depends-on: [renderer-i18n-sync]
verify:
  - embedded Todo loads the generated out/preload/todo.js bridge
  - standalone Todo loads the generated out/preload/todo.js bridge
  - packaged Todo resolves out/renderer/todo/index.html independently of Rollup chunk placement
  - missing preload is not hidden by a renderer-language fallback
  - yarn check:todo-window-runtime
  - yarn check:renderer-i18n
  - yarn typecheck:node
  - yarn build
---

# Restore Todo Preload Runtime Resolution

## Objective

Resolve Todo preload and renderer assets from the Electron application root rather than from the
compiled module's `__dirname`. The Todo XPC handler may be emitted under `out/main/chunks/`; both its
embedded `WebContentsView` and standalone `BrowserWindow` must still load the generated
`out/preload/todo.js` bridge so renderer-language initialization can subscribe successfully.

## Context

- `docs/INDEX.md`
- `docs/features/renderer-i18n.md`
- `docs/plan/tasks/renderer-i18n-sync.md`
- `electron.vite.config.ts`

## Path

- `src/main/xpc/todoWindow.handler.ts`
- focused Todo window runtime check under `scripts/`
- `package.json`
- `docs/plan/tasks/todo-preload-runtime-001.md`
- `docs/plan/README.md`

## Implementation constraints

- Use one explicit resolver for generated Todo assets under `<appPath>/out/`.
- Do not infer paths from the handler bundle's `__dirname`; Rollup may move it into `out/main/chunks/`.
- Cover both embedded and standalone Todo creation paths and the packaged renderer HTML path.
- Preserve the renderer-language contract: a missing required preload remains a startup failure;
  do not add an optional `subscribe` fallback or silently mount in a default language.
- Do not change unrelated Coin, Maestro, MCP, or renderer styling behavior.
- Follow the workspace arrow-function rule for new standalone functions.

## Verification

1. Add a deterministic focused check proving all Todo runtime paths use the app-root resolver and
   reject chunk-relative `__dirname` resolution.
2. Run `yarn check:todo-window-runtime`, `yarn check:renderer-i18n`, and `yarn typecheck:node`.
3. Run `yarn build` and confirm the generated `out/preload/todo.js` and
   `out/renderer/todo/index.html` files exist.
4. Run `git diff --check`.

## Result

Todo runtime assets now resolve from `app.getAppPath()/out` rather than the compiled handler's
directory. This keeps both embedded and standalone preload paths correct when Rollup emits the
handler under `out/main/chunks/`, and applies the same stable root to packaged renderer HTML.

Verification passed:

- `yarn check:todo-window-runtime`
- `yarn check:renderer-i18n`
- `yarn typecheck:node`
- `yarn build`
- generated `out/preload/todo.js` and `out/renderer/todo/index.html` inspection
- `git diff --check`

Independent review: [todo-preload-runtime-001-1](../reviews/todo-preload-runtime-001-1.md) — pass,
with no P1, P2, or P3 findings.
