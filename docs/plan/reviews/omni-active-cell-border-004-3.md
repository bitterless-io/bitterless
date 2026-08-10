---
id: omni-active-cell-border-004-3
target: working-tree-2026-08-09-native-active-cell-frame-fixes
compared_with: omni-active-cell-border-004
status: fail
---

# Verdict

**FAIL. One blocking P2 finding remains.** The lifecycle replay and both stale source guards from
review `omni-active-cell-border-004-2` are fixed, but stale-state cleanup can now clear a successful
same-ID replacement.

# Findings

## P2 (blocking) — An obsolete initial Website load can clear the active state of its replacement

The initial Website load rejection handler clears activity using only the logical cell ID
(`src/main/windows/omniWindow.helper.ts:985-1004`):

```ts
content.webContents.loadURL(url).catch(() => {
  this.clearActiveCellIfMatching(id);
});
```

It does not verify that `content` is still the current operation view for that ID. If the user
switches content mode, or navigation crosses a browser-profile boundary while the initial load is
pending, the old view is destroyed and a new view with the same ID is installed. The old
`loadURL()` promise can then reject and this unscoped callback clears the active state belonging to
the successful replacement. That contradicts the explicit requirement to retain focus across a
successful same-ID replacement.

The newer replacement handler already demonstrates the required guard at
`src/main/windows/omniWindow.helper.ts:1147-1150`, and mini-app load rejection similarly looks up
the exact current `content` at lines 824-830. Apply the same identity check to the initial Website
catch—for example, find the current cell and return unless `currentCell.content === content`—before
calling `clearActiveCellIfMatching(id)`. Add a source guard for this current-view check so future
cleanup hardening cannot reintroduce the race.

# Resolved findings from review 004-2

- **Lifecycle replay fixed:** `bindCellActiveFrameLifecycle` now replays once at `dom-ready` and
  again at `did-finish-load` (`src/main/windows/omniWindow.helper.ts:1194-1201`). The latter occurs
  after the SDK's `DOMContentLoaded` mount (`src/preload/omni/omniCellActiveFrame.sdk.ts:73-84`) and
  repeats for every successful navigation/reload.
- **Removal/failure clearing substantially fixed:** mini-app target validation, view creation/add,
  synchronous/asynchronous renderer load failure, and mini-app renderer death all flow through
  `reportMiniAppLoadFailure`, which clears a matching active ID
  (`src/main/windows/omniWindow.helper.ts:768-838, 851-915, 1089-1105`). Browser chrome creation,
  initial content rejection, replacement creation/add/load failure, and browser renderer death also
  have explicit clearing paths (`src/main/windows/omniWindow.helper.ts:866-915, 978-1005,
  1089-1151`). The finding above is the remaining identity-scope defect in those paths.
- **Source guards fixed:** the Layout guard now excludes only `.omni-pane--active`, preserving the
  unrelated splitter's blue token (`tests/omni/omniLayoutLifecycle.test.mjs:461-465`), and the
  Trench guard now expects both `--mode=omni` and the active-frame argument spread
  (`tests/omni/trenchOmniEmbedding.test.mjs:50-64`).

# Full native-frame contract evidence

- Browser chrome, raw Website content, and exactly the five supported mini-app preloads—Todo,
  EyesOnAgents, Translator, Motto, and Trench—import the common active-frame SDK. Without both
  required arguments the SDK returns without modifying the document.
- Main encodes the cell ID and supplies an explicit `browser-menubar`, `browser-content`, or
  `miniapp-content` region. Browser-menubar focus and the shared Website/mini-app content focus
  handler both update the retained active ID; fan-out targets both native views of every cell.
- The raw Website preload and common SDK import no Electron, `electron-xpc`, IPC, filesystem, or
  `contextBridge` capability and expose no new page bridge. Trench remains sandboxed, and the SDK
  uses only preload process arguments and DOM APIs.
- The SDK owns one fixed, inset-zero, maximum-z-index overlay with `box-sizing: border-box` and
  `pointer-events: none`. It sets no margin, padding, width, height, or native bounds, so it does not
  participate in page layout or pointer behavior.
- The visible frame is exactly `2px solid #C2410C`. Browser chrome has top/left/right borders only,
  Website content has left/right/bottom borders only, and mini-app content has all four sides; the
  browser seam is not doubled.
- Full Omni cleanup, explicit close, and deleted-cell layout reconciliation clear retained state.
  The superseded Control-preview blue frame/store subscription and Omni-cell renderer active class
  and subscription remain removed without disturbing the unrelated Trench/menu additions.

# Verification scope

Only read-only source inspection was performed with `sed`, `rg`, and `git diff`/status inspection.
No tests, lint, typecheck, build, application launch, diff-check, or other verification command was
run.
