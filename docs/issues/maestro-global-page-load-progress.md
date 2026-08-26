# Maestro browser page loading should live in each tab

Status: implemented; owner verification pending

## Observed behavior

Maestro currently renders one simulated 2px progress bar across the bottom of the browser chrome.
It is driven by a global renderer state and only receives loading events from the active operation
tab. The bar is not real page progress, and switching tabs during a load can drop the matching stop
event and leave the global indicator visible.

## Required behavior

Follow the current Micromeet Cowork tab-loading contract:

```text
idle tab      [ favicon  page title                     × ]
loading tab   [ spinner  page title                     × ]
settled tab   [ favicon  page title                     × ]

browser chrome
┌─ tab strip ─────────────────────────────────────────────┐
│ per-tab loading icon; no global page progress bar       │
├─ address and actions ───────────────────────────────────┤
│ unchanged                                                │
└──────────────────────────────────────────────────────────┘
```

- Loading is transient Main-owned state on each tab. It is never persisted and is never a single
  active-tab flag.
- `did-start-loading` shows a 16px loader in that tab's favicon slot, whether the tab is active or
  in the background. The title and close-button geometry must not move.
- `did-stop-loading`, main-frame `did-fail-load`, renderer exit, view teardown, and tab/window
  teardown clear the state and its timer.
- Every loading start rearms a 30-second watchdog. Expiry only ends the visual loading state and
  records a warning; it does not stop or reload the page.
- Remove the simulated progress DOM, CSS, renderer state/timers, shared `LoadProgress` type, and
  `coach/load-progress` broadcast end to end.
- Preserve the fixed Home tab, AI-CRMS login tab, Bitterless branding, tab persistence, favicon
  fallback, navigation, capture, Workbench, and current 36px/48px chrome geometry.

## State contract

| State | Favicon slot | Exit paths |
|---|---|---|
| idle | favicon or globe fallback | `did-start-loading` |
| loading | rotating 16px loader | stop, main-frame failure, renderer exit, teardown, or 30s watchdog |
| watchdog settled | favicon or globe fallback | next loading start |

Reduced-motion environments retain the loader glyph without rotation.

## Acceptance

- Opening or reloading a page shows loading only in the owning tab, with no full-width progress bar.
- Switching tabs during a load does not lose the background tab's eventual stop state.
- A page that never becomes fully idle cannot leave the loading icon visible beyond 30 seconds.
- Closing, cooling, crashing, or resetting a loading tab leaves no timer or loading state behind.
- Ral verifies the visual behavior in the real Electron window.

Implementation task: [maestro-tab-loading-indicator-011](../plan/tasks/maestro-tab-loading-indicator-011.md).
