---
id: onlypreview-mount-chrome-134
scope: publish the mount's window-chrome capability to the Shell so an embedded surface renders no minimize or maximize control
status: pending
depends-on: [onlypreview-shortcut-arbitration-133]
verify: node --test tests/onlypreview/onlyPreviewMountChrome.test.mjs && yarn typecheck:web && yarn check:renderer-i18n && yarn lint && git diff --check
---

# The Shell renders what its host can honour

## Objective

An OnlyPreview inside a Cowork tab must not show traffic lights it cannot operate, and must not
drag a window that is not its own.

## Context

- `docs/features/onlypreview-embeddable-mount.md` (chrome and window commands)
- `src/preload/onlypreview/onlyPreviewEnv.preload.ts` (`--onlypreview-*` additional arguments)
- `src/preload/onlypreview/onlypreview.preload.type.ts` (`OnlyPreviewEnvApi`)
- `src/renderer/onlypreview/shell/src/App.vue:60-100` (the three window controls)
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:205-219`

## Contract

- A new `--onlypreview-chrome=window|cowork` additional argument reaches the renderer on
  `onlyPreviewEnv`, exactly as `hostToken`, `hostId`, `mode` and `platform` already do. No new XPC
  method and no new IPC channel.
- The Shell store exposes the capability; `App.vue` renders minimize and maximize only for
  `window`, and the double-click-to-maximize drag region only for `window`.
- Close stays available in both modes and routes to `mount.requestClose()`.
- Any new user-facing string exists in both `en.ts` and `zh.ts` under the OnlyPreview module and is
  read through `i18nHelper`.

## Verification

- The env resolver maps a missing, valid and invalid argument to a defined capability, defaulting to
  `window`.
- Renderer source assertion: the two controls are conditional on the capability, and no control
  calls a command the mount declares unavailable.
