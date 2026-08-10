---
id: onlypreview-tree-html-preview-010-3
status: blocked
reviewed_task: onlypreview-tree-html-preview-010
target: working-tree-2026-08-09
base: cf9ca882649f17dd34b3dc4089ccf88ca2be2670
date: 2026-08-09
review_type: independent-follow-up-static-and-node-no-runtime
---

# Verdict

**BLOCKED. One P2 blocking finding remains.** Scrollbar sizing/scope and resize interaction are
correct, but the 5px resize column still paints as a contrasting stripe through its transparent
background.

# Findings

## P2 — blocking — Transparent resize handle still reveals a contrasting 5px canvas stripe

The contract requires the existing 5px keyboard/pointer target to remain while removing its visible
borders, center rule, and contrasting fill
(`docs/plan/tasks/onlypreview-tree-html-preview-010.md:83-85`;
`docs/features/onlypreview.md:527-530`). The borders and pseudo-element are gone, but
`background: transparent` does not make this grid column visually disappear:

- the Shell paints `--onlypreview-canvas`, `#F6F7FA`
  (`src/renderer/onlypreview/shell/src/App.less:1-8,40-49`);
- the workspace has no background and therefore exposes that Shell canvas beneath transparent
  descendants (`src/renderer/onlypreview/shell/src/App.less:178-185`);
- the Project surface is `#F9FAFC`
  (`src/renderer/onlypreview/shell/src/App.less:187-194`);
- the 5px handle is transparent while the Preview surface is white
  (`src/renderer/onlypreview/shell/src/App.less:418-433`).

The full handle column therefore composites to `#F6F7FA`, which differs from both adjacent
surfaces and remains a visible third-color stripe. This violates the explicit “no contrasting
fill” visual contract even though no border or center rule remains.

The regression guard currently requires `background: transparent` and checks only for the removed
border properties, pseudo-element, and two old grey colors
(`tests/onlypreview/onlyPreviewCore.test.mjs:1814-1823`). It consequently passes while preserving
the defect. The implementation and guard must ensure the hit target visually merges into an
adjacent surface (or otherwise has no distinct composed fill) without changing the 5px grid/DOM or
its keyboard/pointer behavior.

# Confirmed Contract Evidence

- Project-tree Chromium scrollbar rules are locally scoped under
  `.onlypreview-shell__tree`, set both width and height to exactly 8px, and keep the track/corner
  transparent (`src/renderer/onlypreview/shell/src/App.less:271-292`).
- Tree scrolling and row geometry remain intact: `overflow: auto`, `width: max-content`,
  `min-width: 100%`, 27px height, visible row overflow, and complete non-wrapping names
  (`src/renderer/onlypreview/shell/src/App.less:271-308,354-357`).
- The functional resize boundary remains a 5px grid column and a focusable separator with pointer
  capture plus Left/Right keyboard handling
  (`src/renderer/onlypreview/shell/src/App.less:178-185,418-426`;
  `src/renderer/onlypreview/shell/src/App.vue:248-264,377-392`).

# Verification

| Check | Result |
|---|---|
| Focused tree/HTML source guard | PASS — 1/1, but does not detect the composed-background defect above |
| Follow-up-scoped `git diff --check` | PASS |

# Runtime Boundary

This follow-up used source inspection and a pure Node source test only. It did not launch Electron,
Playwright, E2E, the full Bitterless application, a build, or any Keychain-capable path. No source,
task, package, or unrelated dirty-tree file was modified.
