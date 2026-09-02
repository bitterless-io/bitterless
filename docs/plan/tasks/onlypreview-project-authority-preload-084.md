---
id: onlypreview-project-authority-preload-084
scope: Move Project item/root authority and two-phase Delete from Main to hidden preload
status: implemented
depends-on: [onlypreview-retire-main-index-083]
verify: focused authority/security/integration tests, typecheck/lint/build; no Electron/Playwright/E2E
---

# Move Project file authority into the hidden preload

## Objective

Add an independent capability-bound Project authority to the hidden `fileSearch` preload and use it
for Project root/item metadata, copy/open/reveal authorization and identity-fenced permanent Delete,
leaving only native confirmation and OS actions in Main.

## Context

- [`onlypreview-main-filesystem-io.md`](../../issues/onlypreview-main-filesystem-io.md)
- [`onlypreview-main-filesystem-preload-migration.md`](../analysis/onlypreview-main-filesystem-preload-migration.md)
- [`onlypreview.md`](../../features/onlypreview.md)

## Path

- `src/shared/onlypreview/onlyPreviewFileAuthorityRuntime.types.ts`
- `src/preload/fileSearch/fileSearchProjectAuthority.service.ts`
- `src/preload/fileSearch/fileSearch.preload.ts`
- `src/main/fileSearch/fileSearchWindow.service.ts`
- `src/main/fileSearch/fileSearchProjectAuthorityResponse.service.ts`
- `src/main/onlypreview/onlyPreviewRecentDirectory.service.ts`
- `src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts`
- `src/main/onlypreview/onlyPreviewWorkspace.registry.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `tests/onlypreview/**`

## Contract

- Use a capability distinct from search and Office, exact hidden-runtime instance and bound
  workspace generation. Visible renderers continue to supply only `{ workspaceId, relativePath }`.
- The preload owns root/item `lstat`/`realpath`/`stat`, containment, symlink/device checks and the
  canonical native-action target. Main validates host/workspace/ref and invokes native shell or
  clipboard actions only after current preload authorization.
- Delete is two phase: preload prepares an opaque identity-bound grant; Main shows the existing
  parented confirmation; preload commits only the exact still-current regular file and rejects any
  replacement/race. Main never calls `unlink` or opens the file.
- Commit pins the prepared identity, atomically isolates the directory entry inside a high-entropy
  same-parent private recovery directory, revalidates the isolated entry plus active generation and
  unlinks only that match. A mismatch is restored only by a no-overwrite hard link or retained as a
  recovery entry; there is no whole-file copy fallback.
- Errors crossing XPC are bounded, typed and path-free. Runtime timeout/replacement revokes all
  authority and grants.
- Preserve selection clearing, watcher convergence, Project shortcuts/menu wording and all native
  OS behavior.

## Verification

- Cover containment, symlink/root identity, node type, permission/missing errors, path secrecy,
  two-phase replacement races, host/workspace/runtime revocation and native-action wiring.
- Extend the Main filesystem boundary guard only for paths completed by this task.
- Run targeted tests/typechecks/lint/build, then independent review. No Electron/E2E.

## Delivery

- Added the third pairwise-distinct hidden-runtime capability and moved Project target/root/item
  inspection, containment and metadata into its preload service.
- Main Project menus and shortcuts now reauthorize through the preload and revalidate the exact
  host/workspace/generation before clipboard, open or reveal effects.
- Permanent Delete now uses active-expiry pinned grants plus same-parent atomic quarantine and
  post-isolation identity/generation checks. Cancel, timeout, rebind, rollback and dispose close
  every pinned handle; races never overwrite a concurrent candidate or copy a large file.
- Project plus Office binding commits atomically from Main's perspective and rolls hidden Project
  authority back on failure. Private response envelopes are exact, bounded and path-free.
- Extracted Project native actions from the XPC handler and strengthened the Task 084 source guard.
- [Review 1](../reviews/onlypreview-project-authority-preload-084-1.md) passed after the first
  review's one P1, three P2 and two P3 findings were repaired. Developer focused tests passed 64/64;
  independent re-review tests passed 39/39; Node typecheck, targeted lint, build and diff-check pass.
- Electron, Playwright/E2E, packaged smoke and application launch were not run.
