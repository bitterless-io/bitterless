---
id: omni-active-cell-border-004-4
target: working-tree-2026-08-09-native-active-cell-frame-final
compared_with: omni-active-cell-border-004
status: pass
---

# Verdict

**PASS. No P1, P2, or P3 blocking or non-blocking finding was identified.**

# Findings

None.

# Evidence

- The initial Website rejection handler now finds the current logical cell and returns unless its
  operation view is the exact `content` whose load rejected
  (`src/main/windows/omniWindow.helper.ts:985-1006`). An obsolete load from a destroyed view can no
  longer clear a successful same-ID mode/profile replacement. The replacement handler retains its
  equivalent identity guard at lines 1149-1152, and mini-app load resolution/rejection checks the
  exact cell/content pair at lines 818-838.
- Mini-app target validation, view creation/add, synchronous/asynchronous renderer load failure,
  and renderer-process failure clear a matching retained active ID through
  `reportMiniAppLoadFailure` (`src/main/windows/omniWindow.helper.ts:768-838, 851-915,
  1091-1107`). Browser chrome creation, initial content rejection, replacement creation/add/load
  failure, renderer-process failure, explicit close, deleted-cell reconciliation, and full Omni
  cleanup also clear activity on their bounded failure/removal paths.
- Successful same-ID replacement remains intentionally active: layout reconciliation retains the ID
  while the logical leaf still exists (`src/main/windows/omniWindow.helper.ts:558-578`), newly
  attached views receive the retained state, and only a failure belonging to the current view can
  clear it.
- The SDK mounts its frame on `DOMContentLoaded`; Main replays at both `dom-ready` and the later
  `did-finish-load` milestone on every successful navigation/reload
  (`src/preload/omni/omniCellActiveFrame.sdk.ts:73-84` and
  `src/main/windows/omniWindow.helper.ts:1196-1203`). This removes the earlier one-shot lifecycle
  ordering gap.
- Browser chrome, raw Website content, and exactly the Todo, EyesOnAgents, Translator, Motto, and
  Trench preloads import the common SDK. Main passes an encoded cell ID and an explicit
  `browser-menubar`, `browser-content`, or `miniapp-content` region. Missing/invalid SDK arguments
  no-op, so standalone mini-app windows are unaffected.
- Browser-menubar focus and the shared Website/mini-app content focus lifecycle retain the active
  ID. Main fans the resulting active/inactive state to both native views of every cell and targets
  only the SDK-owned element and marker through each view's `webContents.executeJavaScript`.
- The SDK overlay is fixed and inset-zero at maximum z-index, uses
  `box-sizing: border-box` and `pointer-events: none`, and sets no margin, padding, width, height, or
  native bounds. It therefore does not participate in page geometry, scrolling, selection, or
  pointer behavior.
- The visual is exactly `2px solid #C2410C`. Browser menubar draws top/left/right only, Website
  content draws left/right/bottom only, and mini-app content draws all four sides, producing one
  continuous outer browser frame without a doubled seam.
- The raw Website preload and common SDK import no Electron, `electron-xpc`, IPC, filesystem, or
  `contextBridge` capability and expose no bridge to remote pages. Trench keeps its sandboxed
  runtime; the common SDK uses only preload process arguments and DOM APIs.
- The superseded Control-preview active store/subscription/class and Omni-cell renderer active
  subscription/class remain absent. Unrelated Trench and menu/splitter work remains intact.
- The Layout guard now excludes only `.omni-pane--active`, the Trench guard accepts `--mode=omni`
  plus active-frame arguments, and the Omni lifecycle guard now requires the current cell/content
  identity check (`tests/omni/omniLayoutLifecycle.test.mjs:461-481` and
  `tests/omni/trenchOmniEmbedding.test.mjs:50-64`).

# Verification scope

Only read-only source inspection was performed with `sed` and `rg`. No tests, lint, typecheck,
build, application launch, diff-check, or other verification command was run.
