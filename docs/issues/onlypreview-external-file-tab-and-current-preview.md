# External file tabs and current-preview identity

Status: implemented; owner testing pending, 2026-09-14.

Ral reports stale footer paths, stale Recents/highlight, and OS Open With files replacing OnlyPreview instead of opening a new tab.

## Classification and evidence

Footer/highlight synchronization are defects: Shell App.vue derives the status breadcrumb and metadata from Project selection, which external/MCP opens deliberately preserve. RecentsPanel.vue paints selectedEntryId, a keyboard/click selection that need not be the presented file. RecentsStore listens only to history writes, so presentation-only navigation does not update its current cursor until another operation refreshes it. Cold explicit opens record before asynchronous Project restore, which can move the visible history scope after that record.

OS routing is an owner-authorized policy change: task 164 explicitly reused the singleton and recorded history. The OS queue in app.main.ts and MCP currently share that opener. Address-bar nonnative files likewise call the singleton; component-based file tabs were still listed as remaining work in address-bar-local-path.md.

## Accepted contract

- OS Open With regular files opens a fresh main-window file tab for every accepted open. Directory opens retain the Project route. MCP preview.open retains OnlyPreview semantics.
- A file tab owns its host, single-file authority and Preview region; it never binds or indexes a Project or writes OnlyPreview Recents. Existing preview components and their security boundaries are reused.
- Address-bar component previews (Markdown/Office/code) convert the initiating browser/New Tab slot into a file tab. Native formats (PDF/images/media/HTML) keep loading in that browser slot. Neither route writes OnlyPreview Recents; OS Open With always creates a fresh tab.
- OnlyPreview footer path and metadata follow its live presentation. With no presented target, the existing Project selection breadcrumb remains available.
- Recents current-file background follows Main's activeEntryId. Keyboard/click selection remains separate and does not change the current-file background until a preview is accepted. Presentation changes refresh the cursor; stale responses remain fenced.
- No Electron E2E, independent review, packaging, release or Git sync. Ral performs installed-app testing.

## Verification

- Targeted Node suites: 148 tests, 147 pass, 1 existing failure across the final core group and address-routing guards. Includes file-tab lifecycle (7/7), route/composite independence, OS queue, authority isolation, pending-open closure/failure cleanup, Project history persistence, current footer identity and stale Recents responses.
- Existing failure: RecentsRenderer's unrelated line-count assertion requires onlyPreviewShell.store.ts below 800 lines; this task does not modify that store.
- Scoped semantic checks: all Main/shared = 64 existing diagnostics, no additions; renderer OnlyPreview/Maestro/common/shared plus filepreview = 5 existing diagnostics, no additions. Remaining web errors are missing Home emitter handler modules (2), OnlyPreviewTreeSelection's unknown error-code argument (1), and pathMain.helper null/string assignments (2). Full repository typecheck is not green.
- Scoped ESLint: zero errors; pre-existing formatting warnings retained instead of reformatting unrelated source.
- Standalone production Vite build of the new filepreview renderer passes (6,842 modules; 321 KB JavaScript). Build output is scratch-only; no profile/package metadata changed.
- No Electron/E2E, independent review, packaging, installation, release or Git operations.

## Human acceptance

In the newly built BL, keep a Project with an internal file open. Finder Open With external Markdown, Office/PDF and an unknown-extension file: each gets a new main-window tab, preserves Project and OnlyPreview preview, and does not enter OnlyPreview Recents. Repeat while BL is closed and while OnlyPreview is detached. Enter an external Markdown/Office path in a new tab's address bar: the same slot must become the file preview, without leaving an extra blank tab, and must retain the same history isolation. Use MCP/OnlyPreview to preview external A then B; footer, file metadata and colored recent must follow B. Single-click another recent: keyboard selection changes while current highlight stays B; double-click/Enter, Back and Forward update preview/footer/highlight together. Repeat A→B quickly, close one file tab, and confirm other tabs remain usable.
