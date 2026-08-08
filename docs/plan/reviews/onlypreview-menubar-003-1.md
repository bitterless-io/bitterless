---
id: onlypreview-menubar-003-1
status: blocked
reviewed_task: onlypreview-menubar-003
target: 57f5a6cf6a63af5f7a649c856fd7755aea952eeb
base: ab1b89b4313114c84a7a3e488e23e67319cd8cd2
date: 2026-08-08
review_type: independent-source-contract-runtime-and-visual
---

# Verdict

**BLOCKED. One P2 blocking documentation-contract finding and one P3 non-blocking test-reliability
finding remain. No P1 finding was identified.**

# Findings

## P2 · blocking — The normative `OnlyPreviewApi` block omits all three new window commands

The feature contract says that its code block is the Main API surface, but that interface still moves
directly from `updatePreviewBounds` to file and settings operations and omits `minimizeWindow`,
`toggleMaximizeWindow`, and `closeWindow` (`docs/features/onlypreview.md:142-160`). The same document
later requires capability-scoped typed XPC methods for those exact commands
(`docs/features/onlypreview.md:335-336`), and the task requires them to mutate only the active
standalone window (`docs/plan/tasks/onlypreview-menubar-003.md:54-56`). The implementation correctly
adds the three methods to the shared interface, handler, and active-host-checked window helper
(`src/shared/onlypreview/onlyPreview.types.ts:149-154`;
`src/main/xpc/onlyPreview.handler.ts:141-171`;
`src/main/windows/onlyPreviewWindow.helper.ts:192-207,330-348`).

This leaves the accepted feature document internally inconsistent and makes its explicit API block
an incomplete source of truth. Add the three capability-scoped methods to that interface block (and,
if useful, make clear that “read-only” refers to the local-file boundary). This is blocking under the
docs-first contract discipline; no runtime implementation change is required for this finding.

## P3 · non-blocking — The new hover acceptance sends only one synthetic mouse move

The hover assertion sends one `mouseMove` to the Shell and then polls only the computed style
(`tests/onlypreview/specs/onlyPreview.spec.ts:466-484`). In the first independent full E2E run that
single input did not establish `:hover`, so the test timed out with a transparent background even
though the rest of the flow continued to pass. The exact test then passed in isolation, and a second
complete run passed 3/3; the refreshed normal screenshot also visibly contains the expected Settings
hover treatment. This is evidence of an input-injection race rather than a product behavior failure.
Make the acceptance retry the hover input or use a hover primitive that waits for the pointer state so
the gate does not fail nondeterministically.

# Contract Assessment

- The old 44px white topbar is gone. The Shell owns one 32px `#4E5882` MenuBar with a `#3D4666`
  bottom divider, 27px light controls, compact identity/path hierarchy, and no decorative shadow.
  The normal screenshot shows the translucent Settings hover state; source supplies a visible
  two-pixel focus outline and active/disabled states
  (`src/renderer/onlypreview/shell/src/App.vue:8-114`;
  `src/renderer/onlypreview/shell/src/App.less:54-168`).
- macOS uses the hidden titlebar, `{ x: 12, y: 8 }` traffic-light position, and 78px renderer gutter.
  Windows receives localized minimize, maximize/restore, and close controls, while the application
  menu is auto-hidden (`src/main/windows/onlyPreviewWindow.helper.ts:350-364`;
  `src/renderer/onlypreview/shell/src/App.vue:78-112`; screenshot and Electron assertions).
- The MenuBar is the drag region and its action group is `no-drag`. Double-clicks originating in that
  action group are ignored; double-clicking the identity/non-action region toggles maximize and
  restore through Main (`src/renderer/onlypreview/shell/src/App.vue:15,31,380-383`;
  `src/renderer/onlypreview/shell/src/App.less:54-68,114-118`). Electron acceptance exercised both
  maximize transitions and proved that an action-region double-click does not toggle the window.
- Open File and Open Folder remain labelled and retain their target-loading disable behavior. Refresh
  and Settings remain icon-only with localized title/accessible labels and their prior workspace and
  business behavior. The three Windows labels are localized in both supported dictionaries
  (`src/renderer/onlypreview/common/onlyPreviewI18n.ts:12-24,115-127`). Stable `name` attributes and
  shallow `onlypreview`-rooted BEM selectors remain throughout the Shell; no Tailwind utility or
  EyesOnAgents-private component/emitter/store/handler import was introduced.
- Each window command carries the Main-issued host token, is returned through the existing typed
  result envelope, and reaches `requireStandaloneWindow`. That helper first requires a live content
  host and then requires exact equality with the currently active standalone host before resolving
  the singleton `BaseWindow`; a Settings or revoked/stale host cannot control another window
  (`src/renderer/onlypreview/shell/src/onlyPreviewShell.store.ts:159-175,317-323`;
  `src/main/xpc/onlyPreview.handler.ts:152-171`;
  `src/main/windows/onlyPreviewWindow.helper.ts:330-348`).
- The standalone graph still creates one `BaseWindow` and separate Shell and Preview
  `WebContentsView`s with the same sandbox, navigation fencing, shared content capability, explicit
  detach/close, and auth/host teardown. OnlyPreview remains absent from Omni source/runtime mappings;
  the commit changes no Omni file and imports no EyesOnAgents implementation surface. Settings stays
  a separate settings-only `BrowserWindow`; no Settings source changed, and its E2E persistence flow
  passed.
- Main now initializes and clamps Preview at exactly 32px below the MenuBar, at least 180px + 5px to
  the right, and no lower than 25px above the status rail
  (`src/main/windows/onlyPreviewWindow.helper.ts:25-33,96-112,209-218,428-437`). The minimum-size E2E
  matched the native Preview bounds to the Shell DOM host and proved `y === 32` plus the status-rail
  ceiling.
- Visual inspection of `out/playwright/onlypreview/screenshots/onlypreview-normal.png` (1180×760) and
  `onlypreview-800x600.png` (800×600) confirms the EyesOnAgents-derived daylight hierarchy, macOS
  inset, compact actions, path ellipsis, preserved two-column surface, exact Preview separation, and
  intact status rail. The responsive result remains legible without collapsing or covering actions.
- The only uncommitted pre-existing file is `package.json`. Its diff SHA-256 remains exactly
  `3d1803a21e22dd01c928cd459520d6c0dc0a6b8c769571b505960d0bc032b5cd`; `57f5a6c` contains no
  `package.json` change and adds no dependency.

# Verification

- `node --test tests/onlypreview/*.test.mjs` — pass, 29/29.
- `yarn typecheck:node` — pass.
- `yarn check:renderer-i18n` — pass.
- Targeted `yarn eslint --quiet` over all touched TS/Vue/MJS sources and tests — pass.
- `yarn build` — pass; emits the OnlyPreview preload plus Shell, Preview, and Settings renderers.
- First `yarn test:e2e:onlypreview` — 2/3; only the one-shot Settings-hover assertion timed out.
- Focused rerun of the first Electron test — pass, 1/1.
- Second complete `yarn test:e2e:onlypreview` — pass, 3/3.
- `view_image` inspection of both required refreshed screenshots — pass; dimensions are exactly
  1180×760 and 800×600.
- `git diff --check ab1b89b..57f5a6c` and current `git diff --check` — pass.
- Base/target commits, changed-file scope, package diff hash, standalone/Omni boundaries, Main host
  checks, renderer imports, i18n/accessibility markers, native bounds, and Settings isolation were
  independently inspected.

# Known Baselines

- The build retains existing Vite advisory warnings for mixed static/dynamic imports and the empty
  `omniCellContent` preload chunk. The Electron runner retains the existing `NO_COLOR` /
  `FORCE_COLOR` warning. None is a failing task regression.
- Signed packaged macOS/Windows file-association checks and the complete codec matrix remain the
  explicit manual handoff already documented by the feature contract; they are outside this MenuBar
  task's acceptance boundary.
