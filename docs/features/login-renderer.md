# Dedicated loginRenderer

Status: superseded by [Control-owned login](control-login.md) · 2026-09-17

The following records the prior implementation, not the current product contract. Ral replaced
the global gate with anonymous browsing and login inside Control; see the linked contract.

## Contract

Owner request: one lightweight `loginRenderer`, outside the tab registry, covering the entire
primary window below the menubar. Browser content, OnlyPreview (including PDF), Workbench, and AI
Chat cannot receive business interaction before application authentication completes. Provider
OAuth (Codex/Claude) is independent; this gate is application-account login, not provider readiness.

```text
┌──────────────────────────────────────────────────────────────┐
│ Existing menubar / window controls (uncovered)                │
├──────────────────────────────────────────────────────────────┤
│ loginRenderer — native topmost WebContentsView                │
│                                                              │
│        checking session → login / recovery / required setup   │
│                                                              │
│        covers browser + preview + AI chat, not a tab          │
└──────────────────────────────────────────────────────────────┘
Authenticated → remove child view + close webContents, clear references.
Logout / authoritative invalidation → create a fresh loginRenderer.
```

## Lifecycle and state ownership

- Main attaches an opaque native view before exposing the primary window's business surfaces.
  Initial HTML itself contains a lightweight loading state; it must not wait for an app bundle
  before covering protected content.
- The existing authoritative account/session service remains the credential owner. Login UI
  commands go through addressed XPC, not an untrusted renderer-supplied "authenticated" boolean.
- Login finishes only after authoritative validation and required account setup/selection.
  Startup restore uses a bounded check; a stored token alone does not grant access.
- Transient validation/network errors retain saved credentials and show retry; authoritative
  rejection clears the rejected session. Explicit switch-account may discard it.
- Subscribe before initial state read. Fence late restore/login results after logout, account
  replacement, renderer replacement, or parent destruction; deduplicate simultaneous requests.
- Authentication closes/destroys the login webContents (not setVisible(false), offscreen bounds,
  or a retained hidden login tab). Dispose its page listeners/timers; the host authentication
  listener survives so logout can recreate the view. Parent close cleans everything.
- Logout attaches the blocking surface before asynchronous cleanup. Auth-check or renderer-load
  failures stay blocked with a visible retry path, not a permanent unexplained spinner.
- Resize uses the full native content width and height below the current menubar measurement,
  including the chat region, whether chat is visible or not. Every view activation/layout path
  preserves login as the top layer. Escape cannot dismiss it; keyboard/tab focus cannot reach
  underlying views. Menubar window controls remain usable; business launch/shortcut paths are
  gated while checking/signed out so they cannot steal focus or raise content above login.

## UI and resource budget

Preserve each application's original login identity and supported credential flows. No new font,
marketing illustration, business router, Monaco, Office renderer, PDF library, chat bundle, or
CRMS business workspace in the login entry graph. Reuse/extract login-only components and API
helpers; do not duplicate a whole application behind the overlay. No new dependency is required.

System UI font, 14px form text, 24–26px title, 400–440px form width, 8px control radius.
Native inputs/buttons or selective existing components have explicit borderless surface styling,
visible keyboard focus and stable semantic names. Labels/controls remain left aligned; loading
is centered. Small windows scroll inside the login surface. No new decorative animation.
Keep input source values intact; trim/normalize via computed values or at submission, not by
rewriting input-event values.

## Verification and human acceptance

Code-level tests must exercise actual lifecycle/state helpers, not only matching source strings:
startup checking, valid restore, missing/invalid session, transient retry, required setup,
logout during pending restore, repeated logout/login, destroyed-view recreation, topmost ordering,
full-width bounds below menubar, focus/shortcut gate, and removal + webContents closure.
Compile the renderer/preload/main seams, check login dependency separation and localized copy.
Do not run Electron E2E or launch packaged/dev apps. Ral tests cold start, login/OTP/setup,
logout, offline retry, window resize, PDF/chat overlay ordering, and confirms the login renderer
is gone after success via process/devtools inspection.

## Bitterless integration

Retain the hidden Home customer-auth authority and its token-free epoch/revision bridge; this task
moves visible login, not credential persistence or Todo/runtime ownership. Reuse the existing
password, OTP, password-reset, first-password and saved-session recovery behavior. Fixed Home
becomes authenticated Mini Apps content only, never the visible login destination. The prior
[fixed Home login gate](../issues/maestro-local-home-login-missing.md) is superseded for placement,
not for auth validation/recovery guarantees. Main observes the trusted hidden authority, not any
renderer broadcast. Login uses a minimal dedicated preload and entry, not the Home app/router.

Palette follows existing Bitterless Login: ink #1E2237, action #4E5882, muted #8188A2,
surface #FFFFFF, backdrop #F3F5FC and #E2E4EB. Retain its centered compact form and existing
subtle background; remove no unrelated theme styles.

## Implementation boundaries

- `src/main/maestro/windows/main/maestroLoginView.service.ts` owns the native gate, authoritative
  snapshot refresh and view lifetime. The controller supplies current menubar geometry and
  business focus/activation hooks.
- `src/renderer/loginRenderer/` and `src/preload/loginRenderer.preload.ts` are separate build
  entries. The renderer reuses the login-only surface, not the Home router/application.
- The legacy hidden Home still carries the existing customer-auth/runtime authority. This change
  makes the new login page light; it does not claim to remove the old authority's total startup cost.

## Delivery evidence

- Login lifecycle/entry/ownership/reopen/logout: 21/21 passed; impacted chat layout, alias and
  shortcuts: 29/29; history/popup/first-visible: 19/19. These are separate reported suites,
  not a claim that every repository test passes.
- Dedicated native gate/preload TypeScript and login Vue TypeScript, focused ESLint, selected
  Less compilation and whitespace checks passed.
- Isolated production login build passed: JavaScript 450.13 KB (gzip 152.79 KB), CSS 98.30 KB
  (gzip 14.24 KB). Audited entry graph excludes Home router/business auth-storage runtime,
  chat, Monaco and PDF. Hidden Home authority cost is outside this entry budget.
- Existing customer-auth suite remains 18/20: old endpoint-count and Todo error-message source
  expectations fail against files byte-identical to HEAD. No unrelated product code changed.
- Full node typecheck exhausted its heap; no enlarged-heap retry. A broad Main slice has existing
  unrelated diagnostics. The legacy native-bounds fixture lacks required Electron/XPC mock
  exports. Only the focused passing checks above are claimed.
- No Electron/E2E, app launch, installation, release, commit or code sync was performed.
