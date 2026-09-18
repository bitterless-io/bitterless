# Cowork Project authority rejection: canonical HTML transform parity

2026-09-17 paired assessment for Ral's Cowork `selectStandaloneFile`
`WORKSPACE_ACCESS_DENIED` report. Bitterless works in the reported comparison.

## Assessment

Cowork's hidden `fileSearch` HTML retained Vite's injected client. Its runtime log shows a
successful initial preview, Vite reconnections at 23:27:45, preview-text authority loss at
23:27:46, and file-search initialization restarting at generation 1 without a new Main runtime
startup. The Main workspace registry survived while the reloaded preload lost its authority.

Bitterless already removes page scripts for `fileSearch` through
`src/shared/security/blankPrivilegedRendererHtml.service.ts`, registered as a post HTML transform
in `electron.vite.config.ts`. Its preload owns the file runtime; the blank page does not need
Vite's HMR client or Monaco bootstrap. The same-directory reopen guard is already present in
both projects and is not the missing change.

No Bitterless source change is required. Cowork will adapt the canonical script removal to
its existing CSP policy, scoped to `fileSearch`; Trench remains Bitterless-only. Repair tracking:
`micromeet-cowork/docs/issues/onlypreview-project-authority-workspace-mismatch.md`.

## Verification

Canonical blank-HTML, Project authority, authority error-code, and workspace-core checks passed:
39/39 via `node --test` on their four test files (2026-09-17).

The separately inspected `onlyPreviewExternalFilePreview.test.mjs` has two existing failures:
its snapshot assertion still forbids an external display path, and its source assertion still
requires direct `shell.openPath` instead of the current default-app helper. Those unchanged tests
and their implementation are outside this repair. No Electron E2E or app launch.
