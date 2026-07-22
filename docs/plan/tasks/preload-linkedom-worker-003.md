---
id: preload-linkedom-worker-003
scope: canvas-free LinkeDOM preload bundling and production development startup
status: done
depends-on: [desktop-helper-process-isolation-001]
---

# Restore Canvas-Free Preload Startup

## Objective

Keep HTML parsing available in the agent search helpers without pulling LinkeDOM's optional native
`canvas` peer into the Electron preload bundle. Restore a complete `yarn dev:prod` startup after the
LangChain dependency installation is reconciled.

## Context

- `electron.vite.config.ts`
- `src/preload/agent/defaultSkills/searchWeb.skill.ts`
- `src/preload/agent/search.adaptor.ts`
- `src/preload/base/langGraph/defaultSkills/searchWeb.skill.ts`
- `src/preload/base/searchHelper/search.helper.ts`

## Required behavior

- Use LinkeDOM's canvas-free worker entry for every preload `parseHTML` import.
- Preserve the existing HTML parsing and Readability behavior.
- Do not add the native `canvas` package to the desktop runtime.
- Keep LinkeDOM bundled by the existing Electron Vite dependency boundary.
- Start the production-backed development app without a LinkeDOM/canvas preload error.
- Report Core SQLite readiness through the existing startup diagnostics.

## Verification

- `yarn typecheck:node`
- `yarn build`
- Inspect generated preload artifacts for unresolved `canvas` imports.
- Run `yarn dev:prod` and observe Electron plus a successful Core SQLite startup.
- `git diff --check`

## Result

All four preload HTML parsers now import `parseHTML` from `linkedom/worker`. This keeps LinkeDOM
inside the existing bundled dependency boundary without pulling its optional native `canvas` peer
into the SQLite preload.

Verification passed:

- `yarn typecheck:node`
- `yarn build`
- generated preload scan for unresolved canvas imports and Vite optional-peer error stubs
- `yarn dev:prod`, including `Core SQLite ready` and MCP bridge startup
- `git diff --check`

Independent review: [preload-linkedom-worker-003-1](../reviews/preload-linkedom-worker-003-1.md) —
pass, with no P1, P2, or P3 findings.
