---
id: onlypreview-preview-debug-identity-011-1
status: pass
reviewed_task: onlypreview-preview-debug-identity-011
target: working-tree-2026-08-09
base: cf9ca882649f17dd34b3dc4089ccf88ca2be2670
date: 2026-08-09
review_type: independent-static-and-node-no-runtime
---

# Verdict

**PASS. No open P1 or P2 finding.** The task contract is implemented. One existing TS-1 file-size
baseline is recorded as P3 non-blocking; task 011 does not introduce it and does not need to expand
into a broad test-suite refactor.

# File Inventory

| # | File | Findings |
|---|---|---:|
| 1 | `docs/plan/tasks/onlypreview-preview-debug-identity-011.md` | 0 |
| 2 | `docs/features/onlypreview.md` | 0 |
| 3 | `docs/plan/analysis/onlypreview.md` | 0 |
| 4 | `docs/plan/README.md` | 0 |
| 5 | `src/main/windows/onlyPreviewWindow.helper.ts` | 0 |
| 6 | `src/renderer/onlypreview/shell/src/App.vue` | 0 |
| 7 | `src/renderer/onlypreview/shell/src/App.less` | 0 |
| 8 | `tests/onlypreview/onlyPreviewCore.test.mjs` | 1 |

# Findings

## 8. `tests/onlypreview/onlyPreviewCore.test.mjs`

| # | Severity | Delivery | Lines | Rule | Finding | Recommendation |
|---|---|---|---|---|---|---|
| 8.1 | P3 | non-blocking | 1-1937 | TS-1 | The shared OnlyPreview source-test file is 1,937 lines, above the 800-line rule. This was an existing baseline before task 011; the new focused guards do not create the oversized-file condition. | Split the shared source guards by capability in a separate maintenance task; do not broaden this surgical UI/Main change into that refactor. |

# Contract Evidence

- Shell and Preview are created through two separate `WebContentsView` calls, assigned to separate
  view references, and loaded through their distinct `shell` and `preview` renderer targets
  (`src/main/windows/onlyPreviewWindow.helper.ts:51-70,535-540,586-608`). This establishes separate
  `webContents` and renderer contexts; neither the implementation nor this review claims a unique
  operating-system process ID for each view.
- Automatic opening uses the exact predicate `VITE_MODE === 'debug' && BITTERLESS_E2E !== '1'`
  (`src/main/windows/onlyPreviewWindow.helper.ts:102-103`). It runs only after the initial Shell and
  Preview `Promise.all` load succeeds, targets only `previewView.webContents`, opens detached with
  `activate: false`, and rejects stale/replaced/destroyed/already-open targets
  (`src/main/windows/onlyPreviewWindow.helper.ts:571-583`).
- The automatic call is in `createStandaloneWindow`, not a `did-finish-load` or HMR listener, so a
  later refresh cannot force DevTools back open after the developer closes it. The helper contains
  no Shell, Settings, or Guide automatic-open call. The source guard fixes the global
  `openDevTools` inventory at the manual toggle plus this one Preview startup call
  (`tests/onlypreview/onlyPreviewCore.test.mjs:1211-1239`).
- The existing manual `F12`, macOS `Cmd+Option+I`, and Windows `Ctrl+Shift+I` input-owner toggle is
  retained for both child views, including the unpackaged E2E manual-enable exception
  (`src/main/windows/onlyPreviewWindow.helper.ts:105-134,586-600`). Automatic opening remains
  suppressed in E2E.
- The Project header reads the Main-owned `workspace.rootName`, falls back to the localized Project
  label, and exposes the full `workspace.displayPath` as its title
  (`src/renderer/onlypreview/shell/src/App.vue:103-112`). Its style cancels inherited uppercase and
  tracking while enforcing one-line ellipsis, so the folder's original case is preserved
  (`src/renderer/onlypreview/shell/src/App.less:192-214`).
- The MenuBar renders `displayPath` directly after `OnlyPreview`; the artificial slash node and its
  style are absent (`src/renderer/onlypreview/shell/src/App.vue:17-28`,
  `src/renderer/onlypreview/shell/src/App.less:93-108`). The POSIX path's own leading slash is
  therefore the only slash.

# Verification

| Check | Result |
|---|---|
| `node --test tests/onlypreview/*.test.mjs` | PASS — 68/68 |
| `yarn typecheck:node` | PASS |
| `yarn check:renderer-i18n` | PASS |
| Focused ESLint on Main, Shell Vue, and Core source tests | PASS — 0 errors; 13 existing Prettier warnings outside task 011's added lines |
| `git diff --check` | PASS |

# Runtime Boundary

This review used source inspection and pure/static checks only. It did not launch Electron,
Playwright, E2E, the full Bitterless application, a build, or any Keychain-capable path. Ral retains
manual acceptance after a full debug-Main restart: Preview DevTools should open detached without
taking focus, while the Shell/Settings/Guide remain quiet and both workspace labels render as
documented.
