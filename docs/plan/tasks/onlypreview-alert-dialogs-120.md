---
id: onlypreview-alert-dialogs-120
scope: Alert-layer WebContentsView with a reusable dialog stack, a New Folder dialog replacing the inline create row, and a generic error dialog
status: implemented; owner verification pending
depends-on: [onlypreview-view-layers, onlypreview-folder-authoring-112]
verify: node --test tests/onlypreview/*.test.mjs && yarn build
---

# OnlyPreview alert dialogs

## Objective

Give OnlyPreview the alert layer reserved by
[onlypreview-view-layers](../../features/onlypreview-view-layers.md): one `WebContentsView` in the
`alert` layer holding a dialog stack, a New Folder dialog that collects the name **before** anything
is written, and a reusable error dialog stacked above whatever raised it.

Contract: [onlypreview-alert-dialogs](../../features/onlypreview-alert-dialogs.md).

## Path

- `src/shared/onlypreview/onlyPreviewAlert.types.ts`
- `src/shared/onlypreview/onlyPreviewAlert.contract.ts`
- `src/shared/onlypreview/onlyPreview.types.ts` — `ONLY_PREVIEW_ALERT_STATE_EVENT`, and
  `OnlyPreviewProjectNewFolderEvent` now carries the created folder
- `src/main/onlypreview/views/onlyPreviewAlertView.service.ts`
- `src/main/onlypreview/views/onlyPreviewAlertWindow.service.ts`
- `src/main/onlypreview/views/onlyPreviewAlertXpc.service.ts`
- `src/main/onlypreview/views/onlyPreviewViewLayer.service.ts` — `'alert'` owner
- `src/main/onlypreview/views/onlyPreviewRendererTarget.service.ts` — `'alert'` mode
- `src/main/onlypreview/onlyPreviewNewFolderDialog.service.ts`
- `src/main/onlypreview/onlyPreviewProjectNativeAction.service.ts` — New Folder opens the dialog
- `src/main/xpc/onlyPreviewAlert.handler.ts`, `src/main/xpc/xpc.helper.ts`
- `src/main/windows/onlyPreviewWindow.helper.ts` — create/preload/bounds/teardown, and a modal
  swallows the find chords
- `src/main/fileSearch/fileSearchProjectAuthorityResponse.service.ts` — see the issue below
- `src/preload/onlypreview/onlyPreviewEnv.preload.ts`, `onlypreview.preload.type.ts`
- `src/renderer/onlypreview/alert/**`
- `src/renderer/onlypreview/shell/src/onlyPreviewProjectAuthoring.{service,store}.ts`
- `src/renderer/common/i18n/{en,zh}.ts`
- `electron.vite.config.ts`
- `tests/onlypreview/onlyPreviewAlertView.test.mjs`,
  `tests/onlypreview/onlyPreviewAlertDialogs.test.mjs`,
  `tests/onlypreview/onlyPreviewProjectAuthorityCodes.test.mjs`,
  `tests/onlypreview/fixtures/{alertWindow,newFolderI18n,xpcMain}.stub.mjs`,
  `tests/onlypreview/alertNewFolder.entry.ts`

## Contract

1. One view occupies the `alert` layer, created and loaded when the shell reports a successful
   bootstrap and destroyed with the window. A dialog shows it, the last dialog hidden hides it, and
   the renderer process survives between dialogs.
2. The view is never attached before its page has loaded. A transparent full-window scrim attached
   early is an invisible click and keystroke sink over the shell and the preview.
3. The view never calls `addChildView`. Stacking belongs to the layer service, reached through
   `show('alert', 'alert', view)` / `hide('alert', 'alert')`.
4. The error dialog is not a second view. It is a second dialog inside the same renderer at a higher
   `z-index`, so it needs no view, window, or layer of its own and any caller can raise it.
5. Every string the alert renderer displays arrives inside the dialog payload, already localized by
   Main. The renderer owns no wording, and it renders text — never markup, never a path.
6. Payloads cross both ways through the shared contract parsers, and every XPC entry point asserts
   the `content` host role before reaching the view service.
7. The renderer **pulls** the dialog stack with `getAlertSnapshot`; the broadcast carries only
   `{hostId, revision}`. A broadcast has no replay and this renderer exists before any dialog does.
8. New Folder writes nothing until the dialog is confirmed. Confirming Main's untouched suggestion
   runs the existing untitled sequence; a name the owner typed is created verbatim.
9. A rejected name keeps the dialog open with the typed name in it and stacks the error above, so the
   next keystroke edits the name. While the error is up, the dialog underneath cannot be answered.
10. A destructive confirmation holds focus on Cancel; Enter cancels and `⌘⏎` / `Ctrl+⏎` confirms.
    A one-button error closes on Enter, Escape, or its button.
11. A commit that throws, a dead renderer, and a destroyed window all resolve an open dialog as a
    cancel. Nothing is written and no caller is left waiting.
12. A dialog is modal: `Cmd+F` and `Shift+Cmd+F` are swallowed while one is open rather than opening
    Find or Global Search underneath it, and the alert view carries no native shortcut bindings.
13. Rename keeps its in-place edit row. Renaming edits a row that already exists, and the row is the
    right place for it.

## Issue found and fixed on the way

[onlypreview-duplicate-name-destroys-the-window](../../issues/onlypreview-duplicate-name-destroys-the-window.md):
`NAME_EXISTS` and `NAME_INVALID` were missing from the hidden authority's permitted response codes,
so a duplicate folder name was read as a protocol violation and tore down the file-search runtime
along with the OnlyPreview window. The conflict dialog could not work until this was fixed, and the
existing rename-conflict dialog was unreachable for the same reason.

## Verification Evidence

- `tests/onlypreview/onlyPreviewAlertView.test.mjs` — **PASS 16/16**: readiness gating, layer
  show/hide, renderer reuse across dialogs, the conflict keeping the dialog open, stale and
  cross-host resolutions refused, commit throw / dead renderer / window destroy all cancelling,
  bounds re-attachment, the ten-entry cap, and the revision-only event.
- `tests/onlypreview/onlyPreviewAlertDialogs.test.mjs` — **PASS 15/15**: keyboard ownership and every
  key rule including IME composition, the untitled-vs-typed commit split, the conflict message,
  cancel performing no filesystem work, the renderer carrying no wording, build/preload/mode
  registration, CSP shape, layer ownership, and the modal shortcut swallow.
- `tests/onlypreview/onlyPreviewProjectAuthorityCodes.test.mjs` — **PASS 5/5**.
- `node --test tests/onlypreview/*.test.mjs`: **716 tests, 709 pass, 7 fail** — six failures are
  pre-existing from concurrent work in this worktree (drawio 800-line budget, Shell live bounds,
  Shell Project filter, find UI source, renderers empty state, root projection) and one
  (`result preview is token-only`) is a timing flake that passes in isolation. Each was confirmed
  against `git show HEAD:`.
- `tsc --noEmit -p tsconfig.node.json`: **zero errors**. `vue-tsc -p tsconfig.web.json`: zero errors
  in any `onlypreview` file; its 79 remaining errors are pre-existing in `home`, `connector` and
  `poker`.
- `yarn build`: **PASS**, including the OnlyPreview HTML security audit for the new `alert` renderer.
- `git diff --check`: clean.
- `yarn check:renderer-i18n`: **fails on HEAD as well** — the script looks for
  `trayHelper.init(mainWindowHelper)` in `app.main.ts`, which now reads `trayHelper.init({`. Not
  caused by this change, and not repaired here.
- Electron E2E: not run.

## Owner Verification

- Right-click a folder row and the Project root: the dialog opens centered above the preview,
  including over a PDF, with the input focused and `untitled folder` selected.
- Press Enter immediately, twice in the same folder: `untitled folder` then `untitled folder 2`, with
  no error either time.
- Type an existing folder's name: the conflict dialog appears above the New Folder dialog, and after
  Enter / Escape / clicking 确定 the typed name is still there and selected.
- Escape on the New Folder dialog leaves nothing on disk.
- With a dialog open, `Cmd+F` and `Shift+Cmd+F` do nothing.
