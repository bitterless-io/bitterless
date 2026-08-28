---
id: onlypreview-unsupported-default-app-078
scope: Add an in-page default-app recovery action to every file-backed OnlyPreview metadata failure state
status: implemented; owner verification pending
depends-on:
  - onlypreview-design-completion-025
verify: focused non-Electron rendering/store tests, directed typecheck, production build and git diff checks; no Electron/Playwright/E2E
---

# Unsupported preview default-app action

## Objective

When OnlyPreview cannot render the selected file and shows its metadata failure page, provide one
immediately visible **Open in default app** action inside that page. The action complements the
reason and metadata instead of forcing the user to discover the Shell toolbar recovery control.

## Contract

- Every file-backed compact metadata state—direct unsupported, size/signature rejection, decoder or
  parser failure, and other typed unavailable states—shows exactly one primary **Open in default
  app** button below the failure reason and before secondary metadata.
- The page does not duplicate Reveal, Delete, Copy, or the complete Shell `FileActions` group.
- The Preview renderer sends only its current capability-scoped `workspaceId` and `relativePath`
  with the existing host token. Main remains the sole owner of real-path resolution and
  `shell.openPath()`.
- While the request is pending, duplicate activation is disabled. A typed failure is shown beside
  the action; selection change clears that failure and fences any late completion from the old
  file.
- The existing Shell toolbar action remains available. Both surfaces use the same localized
  **Open in default app** label.

## Acceptance

- A direct unsupported file and each typed metadata failure fixture render one in-page default-app
  button without exposing an absolute path.
- Activating the button calls the existing `openExternally` API with exactly the current
  `hostToken`, `workspaceId`, and `relativePath`.
- Repeated clicks cannot create concurrent system-open requests, and a delayed failure from file A
  cannot appear after file B is selected.
- Ordinary loading, ready preview, and non-file generic error states do not render the button.
- Focused tests, directed typecheck, production build, formatting/diff checks pass. Electron,
  Playwright, packaged smoke, and E2E are not run; Ral performs the live OS-default-app check.

## Verification

- Update the mounted PreviewSurface fixtures and Preview Store harness for success, failure,
  duplicate-click, and stale-selection behavior.
- Run focused `tests/onlypreview/` Node/component tests plus the relevant web typecheck and build.
- Inspect the final diff for renderer-only capability use and absence of new Main/preload/shared API
  surface.

## Delivery

- The shared metadata failure page now shows one primary **Open in default app** action for direct
  unsupported files and typed size/signature/decoder/parser failures. Generic non-file errors and
  successfully rendered files do not show it.
- The Preview Store reuses the existing `openExternally` API with only `hostToken`, `workspaceId`,
  and `relativePath`. A request-generation plus exact-file fence suppresses duplicate activation and
  rejects late results after selection, surface, or lifecycle changes.
- English and Chinese Shell/content labels now consistently say **Open in default app** / **用默认应用打开**.
- Focused rendering/store tests passed 8/8; adapter/wiring tests passed 14/14; source-integration
  tests passed 5/5. Directed web syntax typecheck, Node typecheck, focused ESLint, production build,
  Prettier, and `git diff --check` passed.
- The repository-wide semantic web typecheck remains blocked by existing Poker, Connector, old
  Home, Maestro, Omni, and path-helper diagnostics; none report a Task 078 file. The renderer-i18n
  audit remains blocked by its existing `Tray must follow Home creation` source-order assertion.
  Electron, Playwright, packaged smoke, and E2E were not run by request.

## Owner verification

- Open an unsupported or rejected file and confirm the in-page button launches that file's current
  operating-system default application.
- Change selection while the default application is opening and confirm no stale error appears on
  the newly selected file.
