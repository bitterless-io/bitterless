---
id: window-state-persistence-001
scope: unified bounds, mode, and physical-display persistence for every visible top-level window
status: implemented-owner-verification-pending
depends-on: []
verify:
  - independent static review confirms every reachable user-visible top-level window has one stable key
  - static source review covers secondary displays, disconnected displays, work-area changes, and malformed state
  - owner manually verifies move, resize, maximize, close, reopen, and multi-display restore without agent-launched Electron
---

# Unified Top-level Window State Persistence

## Goal

Replace the duplicated partial window-layout implementations with one Main-owned service that
remembers normal bounds, window mode, and physical display for every reachable user-visible
top-level Bitterless window.

## Delivery

1. Add an atomic multi-key store and pure capture/restore algorithm under `src/main/windows/`.
2. Register Home, Todo, Omni, EyesOnAgents, Maestro, Coin, Plugin Content, and Plugin Options under
   stable independent keys.
3. Flush on close and explicit destroy, restore before first show, and react safely to display
   removal or work-area changes.
4. Lazily import existing SQLite, Coin, and Cowork state without dual-writing after migration.
5. Exclude hidden SQLite, worker, PDF, DevTools, and embedded child surfaces.

## Constraints

- Main creation must not wait for Core SQLite.
- Every visible product window keeps the Bitterless `800x600` minimum.
- Electron display/window coordinates remain in DIP; no manual DPI conversion.
- macOS Mission Control Space restoration is outside Electron's supported API.
- Do not launch Electron for agent verification; Ral performs the final live multi-display check.

## Result

- One atomic Main-owned state map now stores independent state for Home, Todo, Omni,
  EyesOnAgents, Maestro, Coin, Plugin Content, and Plugin Options.
- Each registered window captures normal bounds, maximized/fullscreen mode, display identity,
  display work area, and work-area-relative coordinates; writes are trailing, deduplicated, and
  flushed on close or explicit destroy.
- Restore reasserts bounds before first show, clamps onto connected work areas, and falls back to
  the primary display when the saved physical display is unavailable.
- Existing SQLite, Coin, and Cowork geometry is imported lazily. Home creation remains independent
  of Core SQLite readiness.

## Review

- Round 1: [window-state-persistence-001-1](../reviews/window-state-persistence-001-1.md) — accepted
  after Omni creation/teardown fencing and strict geometry validation were added; no static blocker
  remains. Live multi-display verification is intentionally left to Ral.
