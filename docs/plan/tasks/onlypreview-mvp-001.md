---
id: onlypreview-mvp-001
scope: OnlyPreview local-file preview sub-application and host integrations
status: ready
depends-on: []
---

# Objective

Implement the complete accepted OnlyPreview MVP in `docs/features/onlypreview.md`: standalone
multi-`WebContentsView` app, indexed directory tree, read-only multi-format preview, app-specific
Setting window, Home entry, Omni entry, and OS/package file-open integration.

# Context

- `docs/features/README.md`
- `docs/features/onlypreview.md`
- `docs/features/omni-miniapp-cells.md`
- `docs/features/window-state-persistence.md`
- `docs/design/colors.md`
- `docs/plan/analysis/onlypreview.md`

# Path

- `electron.vite.config.ts`
- `electron-builder.yml`
- `package.json`
- `src/main/app.main.ts`
- `src/main/logging/logPolicy.service.ts`
- `src/main/onlypreview/**`
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/main/xpc/xpc.helper.ts`
- `src/main/xpc/auth.handler.ts`
- `src/preload/onlypreview/**`
- `src/renderer/onlypreview/**`
- `src/renderer/common/assets/icons/onlypreview.svg`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `src/renderer/home/src/emitter/onlyPreview.emitter.ts`
- `src/renderer/home/src/views/miniApp/MiniApp.vue`
- `src/renderer/home/src/views/miniApp/miniApps.constant.ts`
- `src/renderer/omni/omniControl/src/components/OmniPane.vue`
- `src/shared/onlypreview/**`
- `src/shared/omni/omni.types.ts`
- `src/shared/window/window.types.ts`
- `scripts/renderer-i18n/check-renderer-i18n.mjs`
- `tests/onlypreview/**`
- focused existing integration tests affected by the new Home/Omni/logging entries
- `docs/INDEX.md`
- `docs/features/README.md`
- `docs/features/onlypreview.md`
- `docs/features/omni-miniapp-cells.md`
- `docs/features/window-state-persistence.md`
- `docs/plan/README.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-mvp-001.md`

# Implementation Constraints

1. Preserve the exact `onlypreview` stable ID and `OnlyPreview` user-facing name.
2. Do not expose an arbitrary absolute-path read API. Use Main-issued workspace capabilities,
   relative file refs, realpath containment, and non-recursive symlink handling.
3. Every renderer is sandboxed, context-isolated, Node-disabled, web-security-enabled, and fenced
   to its exact first-party local target.
4. The standalone window must use a `BaseWindow` with separate Shell and Preview
   `WebContentsView`s and explicitly close both webContents. Omni uses the documented in-renderer
   Preview host adapter.
5. Use existing Monaco and Electron/Chromium capabilities. Do not add a new dependency unless the
   accepted contract becomes impossible with the installed stack.
6. Text and code are selectable but never editable. User HTML is source, never executable.
7. Use a tokenized internal streaming scheme for PDF/images/audio/video; never put absolute paths
   in resource URLs.
8. Add the separate OnlyPreview Setting window; do not depend on the incomplete Home Settings
   navigation bridge.
9. Follow Bitterless Vue/BEM/XPC/file-naming rules, use Arco controls, and keep the theme light.
10. Preserve unrelated code, the existing Electron/SQLite pins, and historical review documents.

# Verification

- `node --test tests/onlypreview/*.test.mjs`
- focused existing Omni/Home/logging/auth/i18n tests updated by the implementation
- `yarn typecheck:node`
- `yarn typecheck:web`
- `yarn check:renderer-i18n`
- targeted `yarn eslint --no-cache` over every touched TS/Vue/config/test source
- `yarn build`
- output audit for `out/preload/onlypreview.js` and all three `out/renderer/onlypreview/**/index.html`
- Playwright/Electron fixture flow and saved screenshots for normal and `800×600` layouts
- `git diff --check`

If packaged macOS/Windows builds are unavailable, report file-association and codec verification as
an exact remaining owner handoff. Source/config inspection is not proof of installed OS behavior.

