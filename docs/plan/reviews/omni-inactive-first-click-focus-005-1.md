---
id: omni-inactive-first-click-focus-005-1
status: pass
reviewed_task: omni-inactive-first-click-focus-005
target: working-tree-2026-08-20
date: 2026-08-20
review_type: independent-code-contract-and-static-build
---

# Findings

No P1, P2, or P3 blocking or non-blocking finding was identified in the reviewed scope.

# Contract evidence

- The installed Electron `40.10.6` declaration confirms that `BaseWindow` accepts
  `BaseWindowConstructorOptions` and that `acceptFirstMouse` is a macOS-only option which delivers
  a click on an inactive window through to its web contents
  (`node_modules/electron/electron.d.ts:2633-2635,3722-3728`). The selected API therefore matches
  the exact native-window boundary in the task contract rather than relying on renderer timing.
- Omni adds `acceptFirstMouse: true` only inside the existing
  `process.platform === 'darwin'` constructor branch
  (`src/main/windows/omniWindow.helper.ts:404-425`). The non-macOS branch remains the pre-existing
  `{ frame: false }` object and receives no `acceptFirstMouse` value, so Windows behavior is
  unchanged.
- Website cells are covered, not only Mini Apps. A browser cell creates its URL/chrome
  `WebContentsView` and adds it directly to the Omni `BaseWindow.contentView`
  (`src/main/windows/omniWindow.helper.ts:890-903`); its independent remote-page content
  `WebContentsView` is selected by the browser branch and added to that same top-level content view
  (`src/main/windows/omniWindow.helper.ts:911-944`). Native hit testing therefore receives the
  activation click at the one window that owns both Website cell layers and can route it to the
  exact chrome or remote content view under the pointer.
- The same content insertion path also covers Mini Apps
  (`src/main/windows/omniWindow.helper.ts:911-945`), consistent with the feature contract's browser
  and mini-app wording (`docs/features/omni-miniapp-cells.md:222,241-243`) and the issue contract's
  exact-child routing (`docs/issues/omni-inactive-window-first-click-focus.md:24-31`).
- The task-scoped source diff changes only the `BaseWindow` constructor option. It adds no renderer
  file, click listener, delayed callback, `sendInputEvent`, synthetic `MouseEvent`, or manual
  `webContents.focus()` call. The existing browser-chrome and content `focus` listeners remain
  unchanged and only record the active-cell frame after native focus has occurred
  (`src/main/windows/omniWindow.helper.ts:974-978,1104-1113`).
- The issue, feature, task, total index, and delivery index describe one consistent native-window
  contract and keep live desktop acceptance with Ral. The documented window-wide consequence that
  the first click may activate a link or button is explicit
  (`docs/issues/omni-inactive-window-first-click-focus.md:33-43`).

# Verification

| Check | Result |
|---|---|
| `yarn build` | pass — Main, preload, and renderer bundles built successfully; only existing Vite chunking warnings were emitted |
| `git diff --check` | pass for the complete current worktree |
| task-scoped source diff audit | pass — one macOS `BaseWindow` option only; no renderer, delay, synthetic-click, or manual-focus implementation |
| installed Electron API audit | pass — Electron `40.10.6` exposes the option on `BaseWindowConstructorOptions` and marks it `darwin`-only |
| Electron E2E | not run, as required; no Electron application was launched during this review |

The required owner acceptance path is:

1. Open two **Website** cells A and B whose remote pages both contain an input.
2. Focus A's page input, activate an external application, then click B's page input exactly once.
3. Confirm that the same click activates Omni and places the caret in B. Repeat once against B's
   Website URL input to cover the browser-menubar child view.
4. Repeat with a Mini App input as secondary coverage and confirm already-active-window clicks are
   unchanged.

# Conclusion

**Pass.** The implementation is the minimal macOS-only native-window change required by the task,
covers both layers of Website cells as well as Mini Apps, leaves Windows unchanged, and introduces
none of the prohibited focus or event workarounds. Live first-click behavior remains for Ral's
desktop acceptance sequence above.
