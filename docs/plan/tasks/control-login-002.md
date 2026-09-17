---
id: control-login-002
scope: application login in Control with anonymous browsing
status: done
depends-on: [login-renderer-001]
---

# Move application login into Control

## Objective

Replace the full-window loginRenderer with Control-owned login while preserving anonymous
browsing and enforcing account auth for chat/protected miniapps. Remove unused login UI/wiring.

## Context

- [Current contract](../../features/control-login.md)
- [Superseded design](../../features/login-renderer.md)

## Path

- Main authentication and window lifecycle/commands; Control login UI and state integration.
- Protected miniapp login entry, CRMS guide (Cowork only), build/preload wiring and focused tests.
- Feature/task/index docs are orchestrator owned.

## Verification

Run the feature's focused behavior and type/build checks. No independent review.
Owner subsequently cancelled login/logout E2E; do not execute further tests or fix its preflight.
Configured scope (inactive): Cowork test, Bitterless production.
Use runtime-only credentials and isolated userData, with secret-bearing capture disabled;
verify effective backend first and execute the two apps serially. No other business testing.
Preserve other agents' changes; do not commit, sync, switch branches or modify unrelated UI.

## Result

Control-owned login, anonymous browsing, auth-protected chat/miniapp lifecycle, and matching
Control login frame are implemented. Focused verification is recorded in the feature and
[frame issue](../../issues/control-login-frame-mismatch.md). E2E was explicitly cancelled by Ral;
the Cowork attempt stopped at build preflight before app launch or credential submission.
No successful real-account login/logout E2E is claimed.
