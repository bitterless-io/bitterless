---
id: onlypreview-shell-ux-005-1
status: blocked
reviewed_task: onlypreview-shell-ux-005
target: 2cefb37e1f4ff1ff382553686ea4596b08da058f
base: 4fa92ff390b655bcf7e3e18bd603131fc3aa7da4
date: 2026-08-08
review_type: independent-source-contract-node-electron-and-visual
---

# Verdict

**BLOCKED — one P2 blocking Settings placement finding remains. No P1 or P3 finding was
identified.**

The folder-first renderer boundary, count/read-only-free chrome, current-file locator, Main-owned
native file menu, and retained standalone/DevTools/file-association behavior pass their focused
source and runtime gates. Settings is correctly authorized and parented, but a persisted size from
a larger still-connected display is not constrained to the current parent's smaller display.

# Findings

## P2 · blocking — Settings clamps position but not restored size to the current parent's work area

`windowStateService.resolve('onlypreview-settings')` resolves and constrains persisted dimensions
against the display stored with that window state. If that larger display remains connected, those
dimensions are retained even after the active OnlyPreview parent has moved to a smaller display
(`src/main/windows/windowState.service.ts:214-226`;
`src/main/windows/onlyPreviewWindow.helper.ts:288-291`). `settingsBoundsForParent` then selects the
current parent's display and clamps only `x` and `y`; it returns the input `width` and `height`
unchanged (`src/main/windows/onlyPreviewWindow.helper.ts:146-161`). The same unchecked helper is used
both when reopening an existing Settings singleton and immediately before first show
(`src/main/windows/onlyPreviewWindow.helper.ts:274-315`).

A pure evaluation of the committed formula with a current work area of `1024×768`, a parent of
`1000×700`, and a valid persisted Settings size of `1600×1000` returns
`{ x: 1920, y: 0, width: 1600, height: 1000 }` for a work area beginning at `(1920, 0)`. Its right
edge is `3520` versus the work-area edge `2944`, and its bottom edge is `1000` versus `768`: it
overflows by `576×232`. This is not the unavoidable small-screen case: `1024×768` is already larger
than the required `800×600` minimum.

The Electron acceptance persists only `900×650`, which fits the runner's current work area, before
asserting full containment (`tests/onlypreview/specs/onlyPreview.spec.ts:1485-1502,1566-1630`). It
therefore passes without exercising the cross-display size transition that the task explicitly
requires.

Before centering, constrain each restored/current dimension against the *current parent display*:
`width = max(800, min(width, max(workArea.width, 800)))` and the analogous `height` expression with
`600`, then derive `x/y` from that constrained size. Add coverage where the persisted dimensions
exceed a different current parent's work area. When a platform work area itself is smaller than
`800×600`, the BrowserWindow minimum makes full containment impossible; the precise fallback is the
minimum `800×600` at the work-area origin. That exceptional case does not excuse overflow on the
reproduced `1024×768` display.

# Contract Assessment

- The renderer API exposes `chooseFolder(hostToken)` and no absolute-path picker. Main's dialog is
  directory-only and owned by the active standalone `BaseWindow`; `Cmd/Ctrl+O` dispatches the folder
  command. The separate Main-owned OS-open route still accepts an absolute file target and creates
  its containing workspace (`src/shared/onlypreview/onlyPreview.types.ts:130-133`;
  `src/main/xpc/onlyPreview.handler.ts:55-75,276-282`).
- The visible Shell has only Open Folder and Settings in its MenuBar. Visible Open File, Refresh,
  indexed counts, and READ ONLY labels are absent, while native refresh shortcuts and Monaco's
  actual read-only/accessibility behavior remain. Both required screenshots confirm the resulting
  chrome and unclipped status rail (`src/renderer/onlypreview/shell/src/App.vue:31-52,271-288`;
  `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue:4-20`).
- The Tabler crosshair is disabled without a selected file. With one selected it clears search,
  expands ancestors, updates tree focus, waits for Vue rendering, calls
  `scrollIntoView({ block: 'center', inline: 'nearest' })`, and focuses that row without a Main call
  or preview reload (`src/renderer/onlypreview/shell/src/App.vue:95-108,384-402`;
  `src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:207-213`). The Electron test passed
  the collapsed-ancestor, active-element, search-clear, and centered-scroll assertions.
- File right-click calls the exact capability-scoped `showFileContextMenu` boundary. Main resolves
  the file before constructing a localized native `Menu`, attaches it to the active `BaseWindow`,
  and supplies Preview, system-open, and reveal actions. Every callback calls the existing file
  operation with the canonical relative request, causing a fresh host/workspace/file resolution;
  no absolute path, clipboard capability, or renderer popup is introduced
  (`src/main/xpc/onlyPreview.handler.ts:171-202`). The Electron native-menu ownership and all three
  callbacks passed.
- Settings requests first require the active standalone host, use that `BaseWindow` as parent, and
  bypass `windowStateService.show()` so saved `x/y` cannot be reapplied. Its secure preferences and
  singleton behavior remain intact. The P2 above is limited to current-display size clamping.
- Existing Shell/Preview per-input-owner DevTools listeners retain the exact F12 and platform
  modifier shortcuts, reject auto-repeat, detach, toggle independently, and register only in debug
  or unpackaged E2E. The 5-test Electron suite passed its independent `devtools://`/unchanged-bounds
  test. OnlyPreview remains excluded from Omni, and the target preserves the standalone sibling-view
  graph, OS file associations, navigation fences, sandbox, context isolation, disabled Node
  integration, web security, capability ownership, media/PDF rendering, and teardown gates.

# Scope Audit

- Target `2cefb37e1f4ff1ff382553686ea4596b08da058f` is the direct child of supplied docs base
  `4fa92ff390b655bcf7e3e18bd603131fc3aa7da4`. Its 15 changed files are limited to the task/delivery
  records, OnlyPreview Main/shared/renderer/i18n implementation, and focused Node/Electron tests.
- No dependency, lockfile, packaging catalog, Omni implementation, preload, or unrelated product
  source changed in the target.
- The sole pre-existing uncommitted file is the user-owned `package.json` name change from
  `Bitterless` to `Bitterless_DEBUG`. Verification did not alter it; its diff SHA-256 remains
  `3d1803a21e22dd01c928cd459520d6c0dc0a6b8c769571b505960d0bc032b5cd`.

# Verification

- `node --test tests/onlypreview/*.test.mjs` — pass, 31/31.
- `yarn typecheck:node` — pass.
- `yarn check:renderer-i18n` — pass.
- Targeted no-cache, error-level ESLint over every touched TS/Vue/MJS implementation and test file —
  pass.
- `yarn build` — pass; emits Main, the OnlyPreview preload, and Shell/Preview/Settings renderers.
- `yarn test:e2e:onlypreview` — pass, 5/5. Folder-only/count-free chrome, locator behavior, native
  Menu ownership/actions, ordinary Settings parenting/placement, detached per-view DevTools, and
  immutable text/PDF/image/audio/video behavior all pass.
- Visual inspection of `out/playwright/onlypreview/screenshots/onlypreview-normal.png` (1180×760) and
  `onlypreview-800x600.png` (800×600) — pass. The crosshair is legible; Open File, Refresh, counts,
  and READ ONLY are absent; rows, preview content, and status rail remain unclipped.
- `yarn typecheck:web` — existing repository baseline failure only. Diagnostics are confined to
  unchanged connector, poker-test, Home, Maestro, Omni, eyes-on-agents, and shared path-helper
  sources; no OnlyPreview source reports a diagnostic and none of the failing files is changed by
  this target.
- `git diff --check 4fa92ff390b655bcf7e3e18bd603131fc3aa7da4..2cefb37e1f4ff1ff382553686ea4596b08da058f`
  and current `git diff --check` before this review file — pass.

The build retains its existing mixed static/dynamic-import advisory, and Electron retains its
existing `NO_COLOR` / `FORCE_COLOR` warning. Neither is a task regression.

# Conclusion

**blocked**
