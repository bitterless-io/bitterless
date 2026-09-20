---
id: local-workflow-directory-188
scope: Replace the remote institution workflow library with a per-environment local directory (`~/.<appName>/workflows`) ensured at boot, keep list / flow graph / details / source in Workbench, and add an Open-workflows-folder entry — paired with micromeet-cowork
status: implemented; owner verification pending
depends-on: []
verify: yarn test:workflow-library (15/15); node --test tests/workflowHost/hostIntegration.test.cjs tests/skillScopes/execution.test.mjs; yarn typecheck:workflow-library; yarn build; no Electron/Playwright/E2E
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

## What changed

1. **Root + boot ensure.** `workflowsRoot.ts` derives `~/.<appName lowercased>/workflows` from the
   runtime profile — the same expression `defaultWorkspaceRoot()` uses, so a new edition cannot get
   a directory that disagrees with its `userData`. `ensureWorkflowsRoot()` runs next to
   `ensureDefaultWorkspace()` in `app.main.ts` and seeds the offline demo package **once**, guarded
   by a `.demo-seeded` marker: deleting the demo is a decision, and restoring it every launch would
   override it.
2. **Directory scanner replaces the remote sync.** `WorkflowLibraryService` now reads the folder:
   one package per directory, identity = directory name, `ref = local:<dir>`. No `catalog.json`, no
   revision, no hash, no immutable copy. A recursive `fs.watch` with a 300ms debounce publishes; the
   60s poll is gone.
3. **Broken packages are listed with their reason.** Missing/oversized/unparseable manifest, missing
   entry, unusable folder name — each becomes a row carrying `error`, with the folder name as the
   fallback title. `statSync(..., { throwIfNoEntry: false })` is deliberate: the raw ENOENT it
   replaces was an absolute path, not an explanation.
4. **Run gate re-based.** `assertPath` resolves symlinks first, then admits an in-root path only if
   it is the entry a manifest declares — so `reference/cleanup.ts` inside a package is not runnable
   just for living in the root. Institution authorization is gone from this path.
5. **Institution scope extracted, not deleted.** The remote library was also what resolved
   `/auth/me` + `/institution/mine` and set `assetScope`, and institution **skills** read only that.
   Deleting it with the sync would have left skills permanently "no institution selected" with no
   error. The resolution moved to `main/institution/institutionScope.service.ts` +
   `xpc/institutionScope.handler.ts`, and the institution picker moved from the Workflows view to
   the Skills view — its only remaining consumer.
6. **Workbench.** List / flow / details / source kept; institution selector, scope tabs, sign-in and
   sync states, revision comparison and download actions removed. Added **Open workflows folder**
   (header, empty state and welcome pane), the root path as a borderless button, and per-package
   *Show in folder*. Details now shows the package folder, entry, entry size, modified time and step
   count instead of cloud/local revisions and SHA-256.
7. **ZIP import retargeted.** Same archive hardening (CRC, local-header agreement, path guard, link
   rejection, expansion cap), expanding into `<root>/<slug>`; a name collision becomes a second
   package rather than a silent overwrite.

## Verification

- `yarn test:workflow-library` — 15/15 (9 service/import/gate, 6 UI/store/layout).
- `node --test tests/workflowHost/hostIntegration.test.cjs` — the `local:` reference test passes;
  one unrelated pre-existing failure (`coach.deleteNativeSession is not a function`, a chat-deletion
  fixture stub outside this change).
- `node --test tests/skillScopes/execution.test.mjs` — 26/26 after repointing the `assetScope` path.
- `yarn typecheck:workflow-library` — clean (node + web surfaces).
- `yarn build` — succeeds.
- `yarn typecheck` / `yarn typecheck:web` — no diagnostics in any file this task touched
  (both surfaces carry pre-existing diagnostics; the node count went 111 → 109).
- `yarn check:renderer-i18n` — **fails, pre-existing**: `maestroControl must start language
  initialization before evaluating product UI`, in `renderer/maestro/control/src/control.ts`, last
  modified 2026-09-17 and untouched here.
- No Electron/Playwright/E2E, per the workspace rule. `tests/workflowLibrary/visual.mjs` (Chromium)
  was updated for the new fixture but not run.

## Not done

Cowork's half. It is blocked on whether the CRMS server-side workflow distribution is retired
too — recorded as PQ-1 in `areas/agent-runtime/workflow/workflow.html`.

## Follow-up, same day — the manifest was never actually shown

Ral asked whether list + detail + folder path + **JSON description** + visual flow were all covered.
Four were; the JSON one was not: the details pane showed *fields extracted from* the manifest and
never the manifest itself.

- **JSON tab** added between Details and Source. It reads `workflow.json` **raw from disk** via a new
  `manifestSource`, deliberately *not* through `parseWorkflowManifest`: the package whose manifest
  fails to parse is exactly the one whose raw file has to stay readable, and the raw text also shows
  keys the parser drops, so "what the library understood" and "what the author wrote" can be
  compared instead of assumed equal.
- The pane is rendered **outside** the `store.detail` branch for that reason — `detail` is null for a
  broken package, and nesting it there would have hidden the file behind the error it caused.
  `ui.test.mjs` pins that placement so a later tidy-up cannot quietly re-nest it.
- The two file tabs share one source slot; switching between them refetches, so a stale read can
  never appear under the other tab's filename. Covered by a test that asserts the exact call order.
- `source()` and `manifestSource()` now share one bounded `readText`, so "missing / empty / not
  UTF-8" read the same for both files.
