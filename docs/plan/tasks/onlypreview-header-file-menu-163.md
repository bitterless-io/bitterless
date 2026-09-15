---
id: onlypreview-header-file-menu-163
scope: One header IconBtn for native Open/Reveal actions in BL and Cowork
status: done
depends-on: []
verify: Native menu and selection-fenced renderer tests, SFC/Less checks
---

# Header file actions

Replace the two labelled Shell header buttons with one right-aligned Tabler dots IconBtn, matching
the 27px navigation controls. Keep existing system type and OnlyPreview surface/ink/muted/Royal
Blue/focus tokens; no global theme change. The existing error indicator remains beside the button.
The native menu contains Open in default/system app, Reveal in folder and Copy Path, using existing
localized Main labels. Leave unsupported-content recovery buttons and Project context menus alone.

Copy Path (owner addition, 2026-09-15) copies the current preview's absolute native file path as
plain text, including external previews. Main resolves it from the current host's preview authority
after checking the menu's selection revision, then writes the clipboard without another asynchronous
step. It does not use Project tree selection or require directory/index readiness. Cancelled or
stale menus do not copy; failures use the existing preview action error indicator.

Renderer sends host capability and selection revision, never a native path. Main validates the
current presentation and opens an Electron Menu parented to the current tab/standalone host. The
result is a bounded action or cancellation; the Shell executes the existing authorized Open/Reveal
route only if the presentation revision is still current. Close/Escape/click-outside cancels;
duplicate clicks are disabled while pending. External-file handling, errors and preload I/O remain
unchanged. No new heavy Main I/O, DOM dropdown or settings write.

Verify menu labels/callbacks/cancellation/host close, invalid or changed selections, errors and
duplicate clicks, plus actual button markup/compilation. Port the narrow changes to Cowork
mini-029 without overwriting unrelated work. No Electron/E2E, independent review, release or Git.

## Delivery — 2026-09-08

Implemented in `FileActions`, the Shell store, `OnlyPreviewApi`, `OnlyPreviewHandler` and the
small native `onlyPreviewFileMenu.service.ts`. Cowork uses its existing native-label adapter.
The frontend-design skill kept the compact toolbar dimensions, existing tokens and visible focus.

- BL header-menu + adapter tests: 13/13; Cowork header-menu + native-label tests: 16/16.
  Includes native import resolution, cancellation, closed owner, changed selection, external-file
  action forwarding, duplicate clicks, errors, Vue SFC/script and Less compilation.
- Scoped source lint: no errors in either app using BL's ESLint config (Cowork has no local
  ESLint config); existing formatting warnings were not bulk-fixed.
- Additional BL external-file suite: 3/4 pass. Its old source assertion still requires
  `clearProjectSelection` after external preview registration and the old three-argument presenter;
  this conflicts with the existing Project-preservation/link-fragment implementation. This task
  changes neither that source nor that assertion.
- No Electron/E2E, full app build, independent review, release/install or Git sync performed.

Owner testing pending: in both apps, open a normal file, PDF and an external file in tab/standalone
OnlyPreview. Use the single dots button to open/reveal the current file; Escape/click-outside must
cancel without opening anything. Unsupported-file recovery buttons remain separate and unchanged.

## Copy Path addition — 2026-09-15

Added the localized native menu action; Main writes the authorized current file's absolute path
directly to the text clipboard. The public menu response and Shell action routes are unchanged.
Each app passes 11/11 header-menu tests, including project/external paths with spaces and Unicode,
stale selection/closed host cancellation, and authority/clipboard failures. Changed Main sources
transpile successfully; shared implementations and tests match, and diff checks pass. Electron/E2E
was not run. Human check: open the dots menu on a project file and an external file, choose Copy
Path and paste into a text field to confirm the complete path.
