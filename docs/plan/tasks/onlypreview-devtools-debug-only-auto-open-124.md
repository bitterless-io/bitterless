---
id: onlypreview-devtools-debug-only-auto-open-124
scope: gate every OnlyPreview DevTools auto-open on the debug-only predicate so packaged builds never open it
status: implemented; owner verification pending
depends-on: []
verify: node --test tests/onlypreview/onlyPreviewSourceIntegration.test.mjs && yarn typecheck:node && git diff --check
---

# Auto-open OnlyPreview DevTools only in debug

## Objective

Stop the packaged Preview build from opening a DevTools window on startup, while keeping the manual
DevTools shortcut available on that channel.

## Context

- `docs/issues/onlypreview-devtools-auto-open-in-packaged-preview.md`
- `docs/plan/tasks/onlypreview-preview-debug-identity-011.md`

## Path

- `src/main/windows/onlyPreviewWindow.helper.ts`
- `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`
- issue and index documents

## Contract

- Every auto-open — shell view and Vue preview view — is gated on
  `shouldAutoOpenOnlyPreviewDevTools()`, which is debug-only and excludes isolated E2E.
- `isOnlyPreviewDevToolsEnabled()` decides only whether the keyboard shortcut is bound, and keeps
  its Preview-channel branch.
- No change to detached/inactive DevTools mode, the shortcut key matching, or Stable behavior.
- Record the reversal of the earlier Preview-channel auto-open decision where the old one was
  documented, rather than deleting it silently.

## Verification

- Source assertions prove both auto-opens use the debug-only predicate and that
  `isOnlyPreviewDevToolsEnabled()` no longer appears anywhere in the standalone startup path.
- Do not run Electron, Playwright, packaging, or publication.

## Delivery

- Switched the shell-view auto-open from `isOnlyPreviewDevToolsEnabled()` to
  `shouldAutoOpenOnlyPreviewDevTools()`, matching the Vue preview view directly below it and the
  intent the predicate's own comment already stated.
- Rewrote that comment to separate the two predicates explicitly and to name the reversal.
- Replaced the test comment recording the old decision with the new one, and added two assertions.

## Verification result

- `node --test tests/onlypreview/onlyPreviewSourceIntegration.test.mjs` — the window-sources test
  carrying these assertions passes. One unrelated test in the same file, "renderers keep empty state
  distinct from index failure…", fails on a missing `<GlobalSearchWorkspace />` in
  `shell/src/App.vue`; that file is clean at HEAD and already lacks the string, so the failure
  predates this change.
- `yarn typecheck:node` — 0 errors. `git diff --check` passed.
- No Electron, Playwright, packaging, or publication ran.

## Owner Verification

- Launch the packaged Preview build and confirm no DevTools window appears.
- Press the DevTools shortcut on that build and confirm it still opens and closes.
