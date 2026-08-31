# Maestro Control exposes obsolete entries and bypasses the Royal Blue Arco theme

Status: implemented; owner verification pending

## Observed behavior

The Maestro Control header still renders two adjacent product entries that are no longer part of
the intended chat surface:

```text
Control header before
┌─────────────────────────────────────────────────────────────┐
│ [Maestro] [Connector]                         [Demo ▾] [×] │
└─────────────────────────────────────────────────────────────┘
```

The Control-side Connector selector leads only to a placeholder. It is distinct from the useful
Connector entry in the fixed Home rail, which opens the existing Workbench Connector pane. The
Demo trigger exposes Booking and Compact development actions in the normal Control header.

Maestro Home, Control, and Workbench also import Arco's precompiled `arco.css`. That stylesheet
bypasses the renderer Less pipeline and therefore bypasses the canonical Royal Blue mapping in
`theme.ts`; standard Arco primary and interaction states remain Arcoblue. Local Home already uses
the themed Less entry.

## Required behavior

```text
Control header after
┌─────────────────────────────────────────────────────────────┐
│ [Maestro]                                             [×] │
└─────────────────────────────────────────────────────────────┘

Arco button
default #4E5882  ->  hover #606B9D  ->  pressed #323955
```

- Remove the Connector selector and Demo trigger/menu from the Control header, including UI-only
  state, handlers, imports, placeholder, and styles that become unreachable.
- Keep the fixed Home Connector entry and Workbench Connector pane/runtime. This issue removes the
  empty Control shortcut, not Connector configuration or messaging capability.
- Keep the Main-owned Demo service/XPC contract available for non-UI callers; remove only its normal
  Control entry.
- Make every first-party Maestro renderer compile Arco through the existing Less theme pipeline so
  standard buttons inherit the Royal Blue palette from `theme.ts`.
- Remove Control-local Arcoblue primary/outline overrides. Keep sizing, typography, radius, and
  feature-specific Royal Blue button styling.
- Preserve warning, danger, success, recording, loading, and disabled semantics; they must not be
  recolored as primary actions.
- Preserve MenuBar geometry, browser tabs/loading watchdog, Control close/reopen, fixed Home
  navigation, Workbench panes, connector runtime, capture, i18n, and update behavior.

## Acceptance

- The Control header contains Maestro and Close, with no visible Connector or Demo entry.
- The fixed Home Connector action still opens Workbench Connectors.
- Maestro's Arco Button default, hover, pressed, and keyboard-focus states derive from the Royal
  Blue theme; no Control-local `#165dff`/`#0f50dc` `.arco-btn` override remains.
- Source inspection finds no UI-only Demo/Connector placeholder code left in `ControlApp.vue`.
- Ral verifies the real Electron visuals and interaction behavior.

Implementation task:
[maestro-control-entry-royalblue-076](../plan/tasks/maestro-control-entry-royalblue-076.md).
Independent review:
[Review 1](../plan/reviews/maestro-control-entry-royalblue-076-1.md) approved with no P0-P2
findings.
