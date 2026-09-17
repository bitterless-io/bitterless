# Control login must retain the Control frame

Status: implemented; code-verified, visual acceptance pending · 2026-09-17

## Request and cause

Ral requires the login page inside Control to look like the existing Control panel: rounded
frame, blue active shadow, and pale warm-white background in both Bitterless and Cowork.
ControlAuthApp uses the existing control-app/card classes but does not bind the focused modifier or subscribe to window focus/blur. Its compact Login body is transparent; the Control card already owns the warm surface.

## Contract

```text
Control viewport — existing cool-gray surround / 8px inset
┌──────────────────────────────────────────┐
│ Rounded Control card (16px), #FFFCF7      │
│ Existing close button                    │
│                                          │
│ Login / checking / recovery / setup       │
│ Scrollable within the same card          │
└──────────────────────────────────────────┘
Focused Control renderer → existing blue 2px shadow
Blur to browser/another window → no active shadow
```

Reuse the existing Control surface tokens and geometry; do not add a full-page white/gradient
background or a second card around login. Close/resize stay usable, shadow is not clipped,
and authentication-state transitions do not change the frame's spacing or color. Login-only
focus listeners are disposed on unmount. Keep form/API/auth behavior unchanged. No new dependencies.

Owner clarification: the warm background fills the full available Control card height and width
inside its existing outer padding, not only the form's content box. The login form is vertically
centered within the card body. Keep close/resize at their existing edge positions. If the form
is taller than the available body (short window, validation, institution/setup flow), centering
must yield to top-accessible scrolling rather than clipping the first fields.

## Verification

Compile touched Vue/Less, run targeted source/interaction checks for shared surface/radius,
focus and blur binding/cleanup, and preserve narrow-panel scrolling.
Ral explicitly cancelled E2E: no more app launches, login attempts, E2E repairs or full builds.
The attempted Cowork auth test stopped in build preflight with
`build-renderer-import-missing`, before application launch or credential submission.
Bitterless real-account E2E was not run. This is not a passing E2E claim.

## Result

The centering follow-up uses a full-height warm Control card and a flex-column scroll body.
The nonshrinking form panel uses automatic block margins: positive free space centers it;
overflow collapses those margins to zero, retaining top-accessible scrolling. The strengthened
2/2 tests and compiled Vue/Less checks passed after this follow-up. No fixed-height breakpoint
forces a fitting form to the top.

`ControlAuthApp.vue` now binds the existing focused-card modifier, initializes focus from
`document.hasFocus()`, and listens for focus/blur only while the login surface is shown.
Listeners are removed when chat replaces login and on unmount, and restored on logout.
Existing Control CSS and compact Login transparency are reused unchanged.

`tests/maestro/controlLoginFrame.test.mjs`: 2/2 passed, covering focus/lifecycle cleanup and
compiled Vue/Less geometry, surface, scrolling and shadow clearance. Scoped ESLint and
whitespace checks passed. No E2E, application launch or full build performed for this fix.
