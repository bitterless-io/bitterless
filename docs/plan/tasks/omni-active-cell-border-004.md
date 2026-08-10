---
id: omni-active-cell-border-004
scope: Omni native WebContentsView active-cell focus visibility
status: implemented; owner verification pending
depends-on:
  - omni-pane-menubar-003
verify:
  - Main remembers the most recently focused browser or mini-app cell
  - every browser chrome, browser content, and supported mini-app content preload includes the common active-frame SDK
  - Main updates the SDK-owned frame for the active cell and reapplies state after navigation or reload
  - the active real cell receives one continuous 2px #C2410C frame without a doubled browser seam
  - inactive and cleared cells hide the frame
  - the frame does not change native bounds, page geometry, scrolling, selection, or pointer behavior
  - remote Website pages receive no new privileged bridge API
  - independent static source review; Ral owns live runtime acceptance
---

# Omni Active Cell Border

## Objective

Make the active Omni window immediately visible in its real browser or mini-app views with a 2px
accent-orange frame, while preserving exact split geometry, native bounds, and webpage behavior.

## Context

- `docs/features/omni-miniapp-cells.md`
- `docs/design/colors.md`

## Layout

```text
╔════════════════ active · 2px #C2410C ═══════════════════╗
║ browser menubar (browser only)                          ║
╟─────────────────────────────────────────────────────────╢
║ Website or Mini App operation view                     ║
╚═════════════════════════════════════════════════════════╝
```

## Path

- `src/main/windows/omniWindow.helper.ts`
- `src/preload/omni/omniCellActiveFrame.sdk.ts`
- `src/preload/omni/omni.preload.ts`
- `src/preload/omni/omniCellContent.preload.ts`
- `src/preload/{todo,eyesOnAgents,translator,motto,trench}/*.preload.ts`
- `src/renderer/omni/omniCell/src/App.vue`
- `src/renderer/omni/omniCell/src/App.less`
- `tests/omni/omniLayoutLifecycle.test.mjs`
- `docs/features/omni-miniapp-cells.md`
- `docs/plan/tasks/omni-active-cell-border-004.md`

## Verification

1. Inspect every active Omni cell preload entry for the common SDK import and exact cell/frame args.
2. Inspect Main for active-state fan-out, reload replay, cleanup, and no privileged Website bridge.
3. Inspect the SDK for the exact segmented 2px orange overlay and pointer/layout invariants.
4. Do not run tests or the application; Ral will perform live runtime acceptance.

## 2026-08-09 Superseded Layout-Preview Pass

- Independent review: `docs/plan/reviews/omni-active-cell-border-004-1.md` — PASS, no P1/P2/P3
  findings.
- Focused Omni lifecycle test: pass, 11/11.
- Targeted Vue/store ESLint: exit 0 with no errors; only existing/same-style Prettier warnings.
- Scoped `git diff --check`: pass.
- Web typecheck audit reported no diagnostic in the five implementation/test files; unrelated
  repository baseline diagnostics keep the full command from passing.
- Owner feedback superseded this pass: the active effect must be injected into the real native
  cell views through preload SDKs, and its first visual color is accent orange rather than blue.

## 2026-08-09 Native View SDK Delivery

- Browser chrome, raw Website content, and all five supported Mini App preloads load the common
  DOM-only active-frame SDK with encoded cell and frame-region arguments.
- Main fans active state into each real `WebContentsView`, replays it after DOM and full-load
  milestones, clears it for removed/failed/crashed views, and ignores late failures from obsolete
  same-ID Website views.
- The frame is exactly `2px solid #C2410C`: browser chrome and content render complementary outer
  segments; Mini Apps render all four sides. It is fixed, inset, pointer-transparent, and does not
  resize page or native-view geometry.
- Raw Website content receives no Electron, XPC, native IPC, or context-bridge capability from the
  SDK.
- Independent final static review: `docs/plan/reviews/omni-active-cell-border-004-4.md` — PASS, no
  P1/P2/P3 findings. Reviews `-2` and `-3` record the blocking lifecycle/stale-state findings fixed
  before this pass.
- Per owner instruction, no test, lint, typecheck, build, application launch, or diff-check command
  was run. Live visual acceptance remains with Ral.
