---
id: onlypreview-cowork-tab-mount-135
scope: implement the Cowork mount as a Maestro tab kind that carries the OnlyPreview container, and open it from the Mini Apps grid inside Maestro
status: pending
depends-on: [onlypreview-mount-chrome-134]
verify: node --test tests/onlypreview/onlyPreviewCoworkMount.test.mjs && node --test tests/maestro/maestroTabSurface.test.mjs && yarn typecheck:node && yarn typecheck:web && yarn check:maestro && yarn check:renderer-i18n && git diff --check
---

# OnlyPreview as a Cowork tab

## Objective

Open OnlyPreview inside the Maestro browser window as a Mini App tab, using the tab rect Maestro
already measures and the tab visibility it already toggles.

## Context

- `docs/features/onlypreview-embeddable-mount.md` (the design, and what the host already offers)
- `src/main/maestro/windows/main/maestroBrowserView.service.ts` (`OperationTab`, `buildViewSlot`,
  `buildPinnedHomeView`, `activateTab`, `closeTab`, `addChildView(view, 0)`)
- `src/main/maestro/windows/main/maestroWindow.controller.ts:1593-1614` (`layout`, `setViewBounds`,
  `opBounds`, `TOOLBAR_H`, `SIDEBAR_W`)
- `src/renderer/maestro/workbench/src/views/WorkbenchAppsView.vue:35` and the local Home Mini Apps
  grid, which call `openOnlyPreviewWindow()` today

## Contract

- `OperationTab` gains a `kind: 'onlypreview'` whose content is a container `View`, not a
  `WebContentsView`. Tab code that reaches for `tab.view.webContents` — navigation, address, favicon,
  loading watchdog, capture, replay, debugger — must be inert for this kind rather than throwing.
  Title comes from `mount.reportTitle`, and the tab's icon is the OnlyPreview icon.
- The container is attached with `addChildView(container, 0)` so it sits below Maestro's chrome and
  control sidebar, and is positioned from `opBounds` — with `layout()`'s first-frame rect as the
  fallback, exactly as tab views are today.
- Tab switching uses `container.setVisible(false|true)`. Per-layer visibility inside the composite
  is not touched: hiding a container already hides its children, and the composite's own layer state
  must survive a switch.
- Closing the tab calls the surface's dispose path; disposing the surface closes the tab. Neither may
  leave the other behind.
- Inside Maestro, the Mini Apps OnlyPreview entry opens this tab. The Bitterless Home grid keeps
  opening the standalone window. Both go through the same open router.
- Maestro's own chords keep working while an OnlyPreview tab is active, per task 133.

## Verification

- A stub Maestro host drives the mount: attach at index 0, `opBounds` positioning, first-frame
  fallback, activate/deactivate visibility, close in both directions.
- Non-web tab kinds do not reach `webContents` on any tab path.
- Existing Maestro checks and tab tests pass.
