---
id: onlypreview-tree-html-preview-010-4
status: pass
reviewed_task: onlypreview-tree-html-preview-010
target: working-tree-2026-08-09
base: cf9ca882649f17dd34b3dc4089ccf88ca2be2670
date: 2026-08-09
review_type: independent-follow-up-static-and-node-no-runtime
---

# Verdict

**PASS. No open P1, P2, or P3 finding.** The P2 recorded in review 3 is resolved: the 5px resize
target now paints as a continuation of the Project surface rather than exposing a third canvas
color.

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Resolved Finding

- **Resolved P2:** `--onlypreview-project-surface: #f9fafc` has one declaration, and both the Project
  pane and 5px resize handle use that same opaque token
  (`src/renderer/onlypreview/shell/src/App.less:1-5,188-195,419-427`). The handle therefore merges
  continuously into the Project surface instead of revealing the Shell canvas between Project and
  Preview. No third-color 5px stripe remains.
- The handle block has no left/right border, contrasting literal fill, or center-rule pseudo-element
  (`src/renderer/onlypreview/shell/src/App.less:419-427`). The 5px grid column remains unchanged
  (`src/renderer/onlypreview/shell/src/App.less:179-185`).

# Retained Contract Evidence

- Chromium scrollbar styling remains locally scoped to `.onlypreview-shell__tree`; both width and
  height are exactly 8px, and the track/corner remain transparent
  (`src/renderer/onlypreview/shell/src/App.less:272-293`).
- Tree overflow and rows are unchanged: `overflow: auto`, intrinsic `max-content` width with a
  `100%` floor, 27px row height, visible overflow, and complete non-wrapping names
  (`src/renderer/onlypreview/shell/src/App.less:272-309,354-357`).
- The regression guard now requires the Project-surface token and independently requires its use by
  both Project and handle, while retaining the border/pseudo-element and scrollbar guards
  (`tests/onlypreview/onlyPreviewCore.test.mjs:1776-1829`).

# Verification

| Check | Result |
|---|---|
| Focused tree/HTML source guard | PASS — 1/1 |
| Round-4-scoped `git diff --check` | PASS |

# Runtime Boundary

This re-review used source inspection and one focused pure Node source test only. It did not launch
Electron, Playwright, E2E, the full Bitterless application, a build, or any Keychain-capable path.
No source, task, package, review-3, or unrelated dirty-tree file was modified.
