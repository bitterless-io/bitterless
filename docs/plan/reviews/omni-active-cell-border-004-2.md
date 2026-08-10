---
id: omni-active-cell-border-004-2
target: working-tree-2026-08-09-native-active-cell-frame
compared_with: omni-active-cell-border-004
status: fail
---

# Verdict

**FAIL. Three blocking P2 findings remain.**

# Findings

## P2 (blocking) — The initial/reload replay can run before the SDK-owned frame exists

The SDK defers frame creation until its isolated-world `DOMContentLoaded` callback when the
document is still loading (`src/preload/omni/omniCellActiveFrame.sdk.ts:73-84`). Main independently
reacts to `webContents` `dom-ready` and immediately performs a one-shot lookup of that element
(`src/main/windows/omniWindow.helper.ts:1139-1158`). There is no readiness handshake, retry, or
later `did-finish-load` replay, and the returned `false` is discarded. The source therefore does not
establish which same-lifecycle callback wins. If Main's lookup occurs first, an already-focused view
stays unframed after initial load/navigation/reload until another focus transition happens. This is
especially visible when focus was recorded while the view was still loading.

Fix by making replay occur at a milestone guaranteed to follow SDK mounting (for example,
`did-finish-load`), or by treating a `false` result as a bounded retry/ack path. Keep a replay on every
navigation/reload and do not silently discard “frame not mounted” as success.

## P2 (blocking) — Failed or crashed active views leave a retained stale active cell ID

The mini-app load rejection path removes the cell and destroys its views without clearing
`activeCellId` (`src/main/windows/omniWindow.helper.ts:798-818`). The shared
`render-process-gone` path does the same for both Website and mini-app content
(`src/main/windows/omniWindow.helper.ts:1059-1074`). Target/runtime creation failures during a
same-ID content-mode replacement can likewise return from `addCell` after the old active views were
removed (`src/main/windows/omniWindow.helper.ts:558-578, 831-887`). By contrast, explicit close and
tree deletion do clear a removed active ID (`src/main/windows/omniWindow.helper.ts:569-570,
631-638`).

The stale ID is user-visible later: a subsequent layout commit can recreate the same logical cell,
and `addCell` calls `applyActiveCellFrameState`, restoring the orange frame even though the new view
has never received focus (`src/main/windows/omniWindow.helper.ts:929-942`). That violates the
feature's “last focused surviving cell” rule (`docs/features/omni-miniapp-cells.md`, **State
Variants / Active cell**).

Centralize removal/failure cleanup so every permanently removed active runtime clears the retained
ID and fans out the inactive state. Preserve the ID only for an intentional, successful same-cell
runtime replacement, and clear it if replacement creation/load fails.

## P2 (blocking) — The static source guards are inconsistent with the current implementation

Two assertions are statically guaranteed to reject this worktree even though their matched source
is unrelated or intentionally changed:

- `tests/omni/omniLayoutLifecycle.test.mjs:463-465` forbids
  `oklch(0.68 0.2 250)` anywhere in `OmniPane.less`, but the pre-existing splitter marker still uses
  that exact valid color at `src/renderer/omni/omniControl/src/components/OmniPane.less:130-139`.
  The guard should exclude only the superseded `.omni-pane--active` rule/pseudo-element, not a color
  token used by unrelated splitter UI.
- `tests/omni/trenchOmniEmbedding.test.mjs:50-62` still requires the exact single-item source form
  `additionalArguments: ['--mode=omni']`. The implementation now intentionally supplies
  `--mode=omni` plus the encoded active-frame arguments at
  `src/main/windows/omniWindow.helper.ts:674-692`. Update this guard to require `--mode=omni` and
  `createOmniCellActiveFrameArguments(cellId, 'miniapp-content')` together.

These are source-level contradictions found by inspection; no test execution is needed to establish
them.

# Contract evidence without findings

- Browser chrome, raw Website content, and exactly the Todo, EyesOnAgents, Translator, Motto, and
  Trench preloads import the common SDK. Standalone instances no-op because they receive neither
  required SDK argument.
- Main supplies an encoded cell ID and explicit `browser-menubar`, `browser-content`, or
  `miniapp-content` region. Both browser chrome focus and the shared Website/mini-app content focus
  lifecycle update the retained active ID.
- The raw Website preload and common SDK import no Electron, `electron-xpc`, native IPC, or
  `contextBridge` API and expose no page privilege.
- The frame styles are fixed and inset-zero at maximum z-index, use `box-sizing: border-box` and
  `pointer-events: none`, and do not set margin, padding, width, or height. The color and width are
  exactly `2px solid #C2410C`.
- Browser chrome draws top/left/right only; Website content draws left/right/bottom only; mini-app
  content draws all four sides, avoiding a doubled native-view seam.
- Trench keeps `sandbox: true`; the SDK is import-free and uses only preload-available process/DOM
  state. No static sandbox incompatibility was identified.
- The superseded Layout-preview active store/subscription/class and the old Omni-cell renderer
  active subscription/class are absent. Unrelated Trench additions and the accepted menu/splitter
  styling remain present.

# Verification scope

Only read-only source inspection was performed with `sed`, `rg`, and `git diff`/status inspection.
No tests, lint, typecheck, build, application launch, diff-check, or other verification command was
run.
