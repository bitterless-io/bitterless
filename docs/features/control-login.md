# Control-owned application login

Workspace continuity across this login boundary is defined in
[Control login inherits OnlyPreview Project](control-login-preview-workspace.md).

Status: implemented and code-verified; human acceptance pending · 2026-09-17

## Contract

Ral replaces the dedicated loginRenderer design. Browsing is available without signing in.
The existing Control renderer is the only credential-entry surface; no login BrowserWindow,
WebContentsView, tab, or standalone renderer entry remains. Authentication is a capability gate
for AI chat and already-protected miniapps, not a whole-window interaction gate.

```text
┌──────────────────────────────────────────────────────────────┐
│ Tabs, +, address/navigation, window controls — always usable  │
├───────────────────────────────────────┬──────────────────────┤
│ Browser / public local miniapp         │ Control (can close)  │
│                                       │ checking / login /   │
│ Protected miniapp when signed out:     │ recovery / setup     │
│ "Please sign in" + sign-in button      │       ↓ validated    │
│             └─ show/focus Control ────>│ AI chat              │
└───────────────────────────────────────┴──────────────────────┘
Control hidden → a sign-in request opens it without navigating the browser tab.
Login success → authoritative XPC update → Control chat and protected miniapp ready.
Logout / validated rejection → protected surfaces signed out; browser tabs stay open.
```

## State and security

- Retain each application's current credential owner and validated-session flow. Password,
  OTP, reset, institution/required-password setup and offline retry keep existing semantics.
  Stored credentials alone are not readiness. Provider OAuth is separate from app-account login.
- Control subscribes before its initial state read; no credential UI or chat flashes while
  state is unknown. Startup restore proceeds asynchronously without gating browser operations.
- Login/recovery/setup runs inside Control. Closing Control does not block browser use or
  discard saved credentials. A miniapp sign-in action idempotently opens/focuses Control.
- Preserve addressed authority checks, bounded requests, stale-response generations, and
  logout/account-replacement fencing. XPC broadcasts announce changes; renderers read the
  current authoritative state rather than trusting arbitrary authenticated booleans.
- Chat UI and its Main send path require a validated application session, including when a
  third-party provider is configured. Logout aborts/invalidates active authenticated work and
  prevents late responses from restoring the previous account's UI.
- Protected miniapps retain their existing API/backend checks. A guide is not authorization.
  Logout clears/hides protected page data and returns them to their guide. Public/local tools
  and ordinary browsing must not acquire a new blanket login requirement.
- Existing browser tabs, address bar, New Tab, close-tab, history, browser shortcuts, and
  window controls remain usable while checking, signed out, logging in or recovering.
  Login completion never replaces the current browser tab.

## UI

The current visual contract is [Control login frame](../issues/control-login-frame-mismatch.md):
login and authenticated chat share the same rounded warm surface and renderer-focus shadow.

Reuse existing product-specific login identity and flows, adapted to Control's narrow width.
Keep its close/resize affordances available. No new decorative palette, font or animation.
The login content owns scrolling; narrow forms fit the panel without a full-window backdrop.
Use existing system typography, compact spacing, borderless controls, visible keyboard focus,
semantic names and localized text. Do not rewrite input values in input events.
Remove unused standalone entry/preload/build wiring and superseded credential-form duplicates,
but preserve headless auth services and business views with unrelated consumers.

## Verification

Code-level tests cover anonymous browser commands and shortcuts, hidden-Control sign-in reveal,
startup restore/login/setup/retry in Control, validated chat gating, logout without tab loss,
late auth/response fencing, and absence of the standalone login entry/native overlay. Confirm
protected-page transitions use the real authority integration. Run focused bounded type/build
checks and source/unit tests; no independent review.

Ral briefly authorized login/logout-only Electron E2E, then explicitly cancelled it to prioritize
the Control frame fix. Do not run further E2E/builds or repair the unfinished E2E preflight.
The configuration remains available but actual login/logout has not been verified by E2E.
The following records that test configuration's scope, not an instruction to execute it now.

Run Cowork against its test backend and Bitterless against its production backend using the
owner-supplied accounts. Credentials are injected at runtime, never committed, copied into
project files, reports, traces or screenshots. Use isolated test userData; do not modify the
owner's installed-app session. Disable secret-bearing trace/video/network-body capture.
Verify the effective backend before credential submission, run apps serially, and clean up
test-owned processes afterwards. Scope: Control sign-in, validated ready, logout, and the
CRMS guide transitions attached to those auth actions; no unrelated business E2E.

## Human acceptance

Use both apps signed out: browse and open/close tabs; hide/reopen Control; log in via Control;
confirm chat is usable only after validation; log out and keep browsing. Resize Control during
login and verify password/OTP/recovery/setup and cold-start saved-session restore.

## Bitterless integration

The hidden Home authority remains headless and owns the existing customer session/runtime.
Control consumes its token-free bridge and reuses the existing login-only component. Remove
Maestro's native login gate and its browser-wide action/focus guards, without disabling protected
Todo/other miniapp session checks. A protected page's login action must reveal Control, not
navigate fixed Home to a credential form. Do not destroy browsing surfaces on logout.

## Delivery evidence

- Main/browser/auth-network tests: 29/29; layout/alias: 18/18; renderer/bridge/composer/session/
  workflow: 66/66. Focused TypeScript, Vue/Less, ESLint and whitespace checks passed.
- Frame follow-up: 2/2 focus/lifecycle and compiled-style tests; see the linked frame issue.
- Existing customer-auth suite remains 18/20 on unchanged endpoint-count/Todo-copy assertions.
  Whole-repository typecheck's prior heap limit was not retried or reported as passing.
- Auth-only E2E was configured and typechecked but not run against a real account. Ral cancelled
  E2E before BL execution. No application installation, release, commit or code sync performed.
