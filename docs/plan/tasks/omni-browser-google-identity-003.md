---
id: omni-browser-google-identity-003
scope: provider-scoped remote-browser identity in Omni cells
status: implemented; owner verification pending
depends-on: []
verify:
  - default-profile browser cells keep untouched Electron identity in persist:omni
  - Google/YouTube URLs use persist:omni-google with the verified honest Bitterless UA
  - crossing the profile boundary recreates the remote content view before navigation
  - native UA-CH, request headers, and CDP identity remain untouched
  - owner completes interactive YouTube login in an Omni browser cell
---

# Omni Browser Google Identity

## Objective

Remove the unconditional plain-Chrome UA from Omni remote browser cells. Keep default sites on
stock Electron identity, while Google and YouTube use a dedicated persistent session whose UA
retains the real `Bitterless/<app version>` token and removes only `Electron/<version>`.

## Context

- `docs/features/omni-miniapp-cells.md`
- `docs/issues/browser-identity-inconsistent-across-embedded-views.md`
- `docs/plan/analysis/omni-miniapp-cells.md`

## Path

- `src/main/windows/omniWindow.helper.ts`
- focused Omni browser-identity helpers under `src/main/windows/`
- `docs/features/omni-miniapp-cells.md`
- `docs/issues/browser-identity-inconsistent-across-embedded-views.md`
- `doc/modules/omni.md`
- `docs/INDEX.md`
- `docs/plan/README.md`
- `docs/plan/tasks/omni-browser-google-identity-003.md`

## Implementation Constraints

- Preserve the owner's uncommitted `package.json` version changes.
- Remove Omni's dependency on Maestro `chromeIdentity()` and its unconditional `setUserAgent()`.
- Classify only exact `google.com`, `youtube.com`, `youtu.be`, and their subdomains as Google
  profile; hostname lookalikes remain default.
- Keep `persist:omni` untouched. Configure `persist:omni-google` before creating/loading any
  Google-profile content view.
- Build the Google UA dynamically from the session's real UA and `app.getVersion()`; do not
  hardcode Electron, Chromium, OS, or Bitterless versions.
- Remove duplicate `Electron/...` and `Bitterless/...` tokens idempotently, insert one
  `Bitterless/<app version>` token before the existing `Chrome/<actual version>` token, and retain
  every other product token.
- Set the identical Google UA on the session and content view before `loadURL()`.
- Do not patch UA-CH, request headers, JavaScript globals, WebGL, plugins, or webdriver. Do not add
  a CDP identity override.
- Recreate only the affected remote content view when a control/cell URL crosses profile scope.
  Never call `setUserAgent()` from `will-navigate` or during a pending navigation.
- Preserve browser URL persistence, split geometry, notification interception, browser chrome,
  mini-app runtimes, and all unrelated working-tree changes.

## Verification

Ral explicitly requested no automated or repeated login test in this delivery. Perform independent
source review and `git diff --check` only. Ral will verify the complete interactive YouTube login in
the Omni browser cell.
