---
id: onlypreview-shell-ux-005
scope: Simplify folder-first chrome and add current-file navigation and window-correct native actions
status: implemented; independent verification pending
depends-on: [onlypreview-devtools-004]
---

# Objective

Make standalone OnlyPreview folder-first and remove redundant visual state: keep only Open Folder
and Settings in the MenuBar, remove indexed-item totals and visible read-only labels, add a Tabler
crosshair that locates the currently previewed file, expose a native file-row context menu that can
cross the Shell view boundary, and open Settings relative to the active OnlyPreview window.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-devtools-004.md`

# Path

- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/main/onlypreview/onlyPreviewWindowBounds.service.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`
- `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue`
- `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.less`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/runtime.entry.ts`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-shell-ux-005.md`

# Implementation Constraints

1. Replace the renderer-facing `chooseTarget(kind)` capability with `chooseFolder(hostToken)` and
   make `Cmd/Ctrl+O` open a directory. Keep Main-owned OS file associations/argv routing able to
   open one absolute file; do not expose an arbitrary absolute path to a renderer.
2. Remove the visible Open File and Refresh controls, both indexed item/file totals, and visible
   `READ ONLY` badge/status text. Keep F5 and `Cmd/Ctrl+R` refresh behavior, read-only Monaco
   options, content security, and accessibility/rejection copy that describes actual behavior.
3. Add an `IconCrosshair` text button to the Project header. When a selected file exists, clear
   search, expand all ancestors, focus that row, and use `scrollIntoView({ block: 'center' })`; do
   not create a new Main API or reload the preview.
4. Add `showFileContextMenu(HostRequest & OnlyPreviewFileRef)` to the exact renderer API. Resolve
   and authorize the file before opening a native `Menu` owned by the active `BaseWindow`; include
   Preview, Open in system app, and Reveal in folder. Re-resolve the file when a callback runs.
   Do not use a renderer popup, transfer an absolute path, or add clipboard capability.
5. Authorize Settings against the active standalone host. Parent the `BrowserWindow` to that
   `BaseWindow`, restore only its size, center it in the current parent bounds, and clamp it to the
   matching display work area whenever opened. Do not let `windowStateService.show()` reapply old
   x/y coordinates.
6. Keep OnlyPreview standalone-only, preserve Shell/Preview sibling views, settings persistence,
   media/PDF support, native refresh shortcuts, detached DevTools, OS associations, and all
   sandbox/capability/containment rules.
7. Use existing Arco controls, `@tabler/icons-vue`, shared native-menu localization, stable
   `name` attributes, and OnlyPreview-rooted BEM. Add no dependency and do not modify or stage the
   unrelated existing `package.json` DEBUG-name change.

# Verification

- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- `yarn typecheck:web`
- `yarn check:renderer-i18n`
- targeted error-level ESLint for touched TS/Vue/test sources
- `yarn build`
- `yarn test:e2e:onlypreview`, including folder-only chrome, crosshair reveal/focus, native menu
  ownership/actions, Settings parent/centering/work-area bounds, and absence of counts/read-only UI
- visual inspection at normal and 800×600 sizes
- `git diff --check`

# Review

Pending independent verification.

# Delivery Evidence — 2026-08-08

- The exact renderer API is folder-first, while the Main-owned OS association route continues to
  accept one absolute file and derive its containing workspace. Visible Open File, Refresh,
  indexed-item totals, and read-only labels are removed without weakening refresh shortcuts or
  Monaco's read-only enforcement.
- The Project header's quiet 27px Tabler crosshair clears search, expands the current file's
  ancestors, centers its row, and focuses it without a second scroll. File-row right click requests
  a localized Main-owned native menu whose Preview, system-open, and reveal callbacks each
  re-resolve the host-bound relative file reference.
- Settings is parented to the active standalone `BaseWindow`, restores only persisted size, and is
  re-centered with width, height, x, and y constrained to the current parent's display work area
  whenever opened. If a display work area is smaller than the app's 800×600 minimum, Settings keeps
  that minimum at the work-area origin because full containment is impossible.
- All 32 OnlyPreview Node tests, Node typecheck, renderer-i18n check, targeted error-level ESLint,
  Electron Vite build, the 5-test Electron E2E suite, and `git diff --check` pass. E2E covers the
  folder-only/count-free chrome, current-file locator, native-menu ownership and all actions,
  persisted oversized Settings dimensions being reduced to a simulated current 800×600 work area,
  current-parent placement, and existing media/PDF/DevTools behavior.
- Normal and 800×600 native captures were visually inspected: the established Royal Blue/light
  hierarchy and Index Rail remain intact, the crosshair stays quiet and legible, and no action,
  file row, preview, or status content is clipped. Full `yarn typecheck:web` remains blocked by the
  repository's unrelated existing connector, poker-test, Home, and shared typing failures; it
  reports no OnlyPreview diagnostic.
