---
id: local-workflow-directory-188
scope: Replace the remote institution workflow library with a per-environment local directory (`~/.<appName>/workflows`) ensured at boot, keep list / flow graph / details / source in Workbench, and add an Open-workflows-folder entry — paired with micromeet-cowork
status: in progress
depends-on: []
verify: node --test tests/workflowLibrary/*.test.mjs; yarn typecheck; yarn typecheck:web; i18n check; yarn build; no Electron/Playwright/E2E
---

# Local workflow directory

Contract: [local workflow directory](../../features/local-workflow-directory.md).
Scheme of record: `/Users/ral/Documents/projects/overmind/areas/agent-runtime/workflow/workflow.html`.

## Plan

1. `src/main/workflowLibrary/workflowsRoot.ts` — `workflowsRoot()` / `ensureWorkflowsRoot()`, same
   expression shape as `maestro/files/defaultWorkspace.ts`. Ensure at boot in `app.main.ts`.
2. `src/shared/workflowLibrary.type.ts` — local snapshot/item types; drop cloud/institution shapes.
3. `src/main/workflowLibrary/workflowLibrary.service.ts` — directory scanner + debounced recursive
   watcher + on-demand source read + ZIP import; delete the HTTP/session/catalog implementation.
4. `src/main/workflowLibrary/workflowLibraryRuntimeProvider.ts` — list/resolve/assertPath against the
   scan; run gate = "entry of a currently valid package", realpath-checked.
5. `src/main/xpc/workflowLibrary.handler.ts` — new API surface incl. `openRoot` / `reveal`.
6. Renderer: `workflowLibrary.store.ts` + `WorkbenchWorkflowsView.vue` (+ `.less`) — remove
   institution/scope/sync UI, add open-folder, keep flow/details/source tabs.
7. i18n `en.ts` / `zh.ts` keys.
8. Tests per the contract's verification list.
