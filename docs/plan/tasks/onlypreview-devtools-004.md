---
id: onlypreview-devtools-004
scope: Restore independently targetable DevTools for standalone OnlyPreview child views
status: implemented; independent verification pending
depends-on: [onlypreview-menubar-003]
---

# Objective

Allow a developer to manually toggle detached DevTools for either standalone OnlyPreview Shell or
Preview `WebContentsView` with standard platform shortcuts. Preserve the release boundary, existing
multi-view geometry, sandboxing, capability model, custom MenuBar, and Settings behavior.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-menubar-003.md`
- `docs/plan/tasks/detached-devtools.md`

# Path

- `src/main/windows/onlyPreviewWindow.helper.ts`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `tests/onlypreview/specs/onlyPreview.spec.ts`
- `docs/features/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-devtools-004.md`

# Implementation Constraints

1. Bind the behavior directly to both standalone child `webContents`; do not add XPC, preload,
   renderer state, a visible MenuBar action, or an automatic-open path.
2. Support `F12`, macOS `Cmd+Option+I`, and Windows `Ctrl+Shift+I`. Ignore auto-repeat and consume
   only an exact enabled shortcut.
3. The input-owning Shell or Preview view is the only DevTools target. If its DevTools is open,
   close it; otherwise call `openDevTools({ mode: 'detach' })`.
4. Enable the path only for `VITE_MODE=debug` or the existing unpackaged-only
   `BITTERLESS_E2E=1` harness. Both release profiles must remain disabled.
5. Do not alter Settings DevTools handling, child-view bounds, security preferences, window
   controls, Omni exclusions, dependencies, or the unrelated existing `package.json` DEBUG-name
   change.

# Verification

- `node --test tests/onlypreview/*.test.mjs`
- `yarn typecheck:node`
- targeted error-level ESLint for the touched Main/test sources
- `yarn build`
- `yarn test:e2e:onlypreview`, proving Shell and Preview DevTools independently open and close,
  resolve to a `devtools://` target, and leave both native child-view bounds unchanged
- `git diff --check`

# Review

Pending independent verification.

# Delivery Evidence — 2026-08-08

- Main registers the exact non-repeating `F12`, macOS `Cmd+Option+I`, and Windows
  `Ctrl+Shift+I` shortcuts only for debug or the unpackaged E2E harness, and toggles detached
  DevTools on the input-owning Shell or Preview `webContents`.
- The focused source contract, 29 OnlyPreview Node tests, Node typecheck, targeted error-level
  ESLint, Electron Vite build, and `git diff --check` pass.
- The 4-test Electron E2E suite proves that Shell and Preview DevTools independently open and
  close with `devtools://` targets while both native child-view bounds remain unchanged.
