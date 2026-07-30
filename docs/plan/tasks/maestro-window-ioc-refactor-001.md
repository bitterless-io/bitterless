---
id: maestro-window-ioc-refactor-001
scope: Maestro main-process window/view split
status: implemented; owner verification pending
depends-on: [maestro-source-layout-migration]
verify: node typecheck + Maestro source guards + build + owner runtime smoke
---

# maestro-window-ioc-refactor-001 - Split the Maestro window by native-view ownership

## Objective

Refactor the 8,952-line Maestro window helper into an IoC-bound controller plus three native-view
services, following Micromeet Cowork's `apps/cowork/src/main/windows/main` structure while preserving
the current Bitterless XPC and runtime contracts.

## Context

- `docs/features/maestro-window-ioc.md`
- `docs/features/maestro.md`
- Reference:
  `projects/micromeet-cowork/apps/cowork/src/main/windows/main`

## Requirements

1. Move the controller implementation to
   `src/main/maestro/windows/main/maestroWindow.controller.ts`, rename the class to
   `MaestroWindowController`, and keep exporting the singleton name `maestroWindowHelper`.
2. Extract browsing-tab/page-view ownership to `MaestroBrowserViewService`.
3. Extract control-panel view ownership to `MaestroControlViewService`.
4. Extract workbench overlay ownership to `MaestroWorkbenchViewService`.
5. Give every service a local state interface, explicit Inversify injection, one `setState(this)`
   call in the controller, and one registration in `iocHelper.bind`.
6. Keep capture, integration, skill, workspace, and agent domains on the controller for this pass;
   narrow delegators are allowed only where those domains still depend on moved view state.
7. Update XPC imports and every affected `scripts/maestro/check-*.mjs` guard so moved assertions read
   the new source family.
8. Do not change XPC names, return shapes, broadcast names, renderer code, or user-visible behavior.

## Path

- `src/main/maestro/windows/main/`
- `src/main/xpc/maestroWindow.handler.ts`
- `src/main/maestro/xpc/coach.handler.ts`
- `scripts/maestro/check-*.mjs`
- `docs/features/maestro-window-ioc.md`

## Verification

- `yarn typecheck:node`
- `yarn check:maestro`
- `yarn build`
- Independent code review against this task and the Cowork reference
- Owner manual runtime smoke after handoff
