---
id: onlypreview-standalone-only-002
scope: Remove OnlyPreview from Omni and make the sub-application standalone-only
status: in-progress
depends-on: [onlypreview-mvp-001]
---

# Objective

Apply the corrected product boundary in `docs/features/onlypreview.md`: OnlyPreview opens only as
its independent `BaseWindow` graph with Shell and Preview `WebContentsView`s plus its own Setting
window. Remove it from every Omni selection, persisted type, runtime mapping, cell lifecycle, and
embedded rendering path without changing Home launch, OS file-open routing, preview formats,
settings, packaging associations, or read-only capability security.

# Context

- `docs/INDEX.md`
- `docs/features/README.md`
- `docs/features/onlypreview.md`
- `docs/features/omni-miniapp-cells.md`
- `docs/features/window-state-persistence.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/analysis/omni-miniapp-cells.md`

# Path

- `src/shared/omni/omni.types.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/main/windows/omniWindow.helper.ts`
- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/renderer/omni/omniControl/src/components/OmniPane.vue`
- `src/preload/onlypreview/**`
- `src/renderer/onlypreview/shell/**`
- `src/renderer/onlypreview/preview/src/App.vue`
- `src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts`
- `tests/onlypreview/**`
- `tests/motto/mottoIntegration.test.mjs`
- `docs/INDEX.md`
- `docs/features/README.md`
- `docs/features/onlypreview.md`
- `docs/features/omni-miniapp-cells.md`
- `docs/features/window-state-persistence.md`
- `docs/plan/README.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/analysis/omni-miniapp-cells.md`
- `docs/plan/tasks/onlypreview-standalone-only-002.md`

# Implementation Constraints

1. Preserve the visible Home `onlypreview` card, standalone singleton, separate Setting window,
   OS open router, file associations, index/classifier/protocol services, and exact public name.
2. `onlypreview` must be absent from Omni's accepted IDs, Control options, runtime target map,
   preloads, per-cell host state, and teardown paths. Persisted `onlypreview` is unsupported input
   and uses Omni's existing fail-closed layout recovery.
3. Remove the OnlyPreview preload container mode and renderer embedded-preview adapter instead of
   leaving unreachable Omni branches or a hidden selectable value.
4. Keep Shell and Preview as separate sandboxed native child views sharing one content host;
   Setting retains its settings-only host.
5. Preserve the capability/result-envelope, path-containment, token-streaming, read-only Monaco,
   selectable PDF, and explicit child-view cleanup contracts unchanged.
6. Keep historical task and review documents unchanged; this follow-up records the correction.
7. Do not add dependencies or change unrelated Omni mini-app behavior.

# Verification

- `node --test tests/onlypreview/*.test.mjs`
- focused Omni layout/runtime tests prove `onlypreview` is rejected and cannot be selected
- focused Home/auth/logging/i18n regressions remain green
- `yarn typecheck:node`
- `yarn check:renderer-i18n`
- targeted error-level ESLint over every touched TS/Vue/test source
- `yarn build`
- Playwright/Electron OnlyPreview standalone flows, including multi-view bounds, previews, and Setting
- `git diff --check`
