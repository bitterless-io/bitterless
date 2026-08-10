---
id: onlypreview-preview-debug-identity-011
scope: Auto-open Preview DevTools in debug and align workspace identity labels
status: implemented; owner verification pending
depends-on: [onlypreview-devtools-004, onlypreview-tree-html-preview-010]
---

# Objective

Make the standalone Preview renderer immediately inspectable during a normal debug run, show the
current workspace folder name in the Project header, and remove the redundant separator before the
absolute path in the MenuBar.

# Context

- `docs/INDEX.md`
- `docs/features/onlypreview.md`
- `docs/design/colors.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/tasks/onlypreview-devtools-004.md`
- `docs/plan/tasks/onlypreview-tree-html-preview-010.md`

# Layout

```text
┌ OnlyPreview   /workspace/overmind ──────────────────────────────────┐
├ overmind                                             [locate] ┬──────┤
│ Project tree                                                  │ file │
└───────────────────────────────────────────────────────────────┴──────┘
                                                                   │
debug initial Preview load ──► detached Preview DevTools (no focus steal)
```

# Path

- `src/main/windows/onlyPreviewWindow.helper.ts`
- `src/renderer/onlypreview/shell/src/App.vue`
- `src/renderer/onlypreview/shell/src/App.less`
- `tests/onlypreview/onlyPreviewCore.test.mjs`
- `docs/features/onlypreview.md`
- `docs/plan/analysis/onlypreview.md`
- `docs/plan/README.md`
- `docs/plan/tasks/onlypreview-preview-debug-identity-011.md`

# Implementation Constraints

1. Shell and Preview remain separate `WebContentsView` instances with separate `webContents` and
   renderer entries/contexts. Do not describe or test this as a guarantee of one unique OS process
   ID per view; Chromium may reuse renderer processes.
2. After the initial Preview view load succeeds, automatically call
   `openDevTools({ mode: 'detach', activate: false })` only when `VITE_MODE === 'debug'` and
   `BITTERLESS_E2E !== '1'`. Do not auto-open Shell, Settings, Guide, release, or isolated E2E
   DevTools, and do not repeatedly reopen DevTools after later refresh/HMR when a developer closes
   them.
3. Preserve the existing manual `F12`, macOS `Cmd+Option+I`, and Windows `Ctrl+Shift+I` toggle for
   the input-owning Shell or Preview view. Do not add XPC, preload, renderer state, or visible UI.
4. Bind the Project header to the existing Main-owned `workspace.rootName`, with the localized
   `Project` label only when no workspace exists. Preserve the folder name's case, keep it one line
   with ellipsis, and expose the complete `workspace.displayPath` as its title.
5. Remove the artificial MenuBar `/` node and its dedicated style. Keep the exact absolute
   `workspace.displayPath` and its title; the path's own leading slash is the only slash on POSIX.
6. Preserve current multi-view geometry, security preferences, Agent Guide, HTML/tree behavior,
   and all unrelated shared-worktree changes. Do not run Electron, Playwright, E2E, the full app,
   build, or any Keychain-capable path.

# Verification

- Source guards for Preview-only initial-load auto-open, debug-only/no-E2E predicate, detached
  inactive mode, and absence of Shell/Settings/Guide auto-open
- Source guards for exact `rootName`/`displayPath` binding, localized empty fallback, preserved
  filename case, ellipsis, and absence of the artificial separator node/style
- `node --test tests/onlypreview/*.test.mjs`, `yarn typecheck:node`, renderer i18n, focused ESLint,
  and `git diff --check`
- No Electron/Playwright/E2E/full-app/build/Keychain execution. Ral manually verifies the initial
  debug DevTools window and both identity labels after restarting the debug Main.

# Delivery Evidence

- Preview startup uses a dedicated `debug && !E2E` predicate and opens only the initial Preview
  `webContents` DevTools in detached, inactive mode after both child views load successfully.
- Existing per-view manual DevTools shortcuts remain unchanged.
- The Project header binds the canonical workspace `rootName`, keeps the full `displayPath` title,
  and the MenuBar no longer inserts an artificial slash before that path.
- `node --test tests/onlypreview/*.test.mjs`: PASS (68/68).
- `yarn typecheck:node`, renderer i18n, focused ESLint, and `git diff --check`: PASS.
- Independent review: `docs/plan/reviews/onlypreview-preview-debug-identity-011-1.md` — PASS, no
  P1/P2 finding. The existing oversized shared Core source-test file is recorded as non-blocking.
- Electron, Playwright, E2E, full-app startup, build, and Keychain-capable paths were not run.
