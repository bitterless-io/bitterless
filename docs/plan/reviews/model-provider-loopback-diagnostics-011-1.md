# Review: model-provider-loopback-diagnostics-011

Reviewed commit: `94ae813`  
Base: `5e25373`

## Findings

### P2 blocking — cancelling while the companion is binding can leak the IPv6 listener

- Design:
  - `docs/plan/tasks/model-provider-loopback-diagnostics-011.md` requires listener resources to be
    cleaned up on cancellation, timeout, and replacement.
  - `docs/features/model-provider.md` requires the companion to be attempt-local.
- Code:
  - `src/main/codex/codexCredential.service.ts:475`
  - `src/main/codex/codexCredential.service.ts:477`
  - `src/main/codex/codexCredential.service.ts:767`

`createBrowserCallbackCapture()` is raced directly against `waitForAbort()`. If cancellation or
timeout wins while the asynchronous bind is still pending, `performConnect()` enters `finally`
before the capture has been assigned to `attempt.capture`. A later successful bind resolves to an
unobserved capture, so neither `cancelConnect()` nor `finally` can close it. That leaked
`::1:1455` server can then make every later login fail its companion bind.

Minimum fix: retain the capture-creation promise and guarantee that a capture resolving after the
attempt is no longer active is cancelled and closed. Assignment and cleanup need one ownership
handoff so every successfully created capture is either stored on the active attempt or closed by
the losing branch.

### P2 blocking — the existing modern-browser test contradicts the new macOS companion contract

- Design:
  - `docs/features/model-provider.md` requires a modern macOS login to create the IPv6 companion
    and verify loopback ownership before opening the browser.
  - `docs/issues/codex-model-login-browser-success-stuck.md` acceptance requires existing login
    checks to pass.
- Test/code:
  - `tests/coin/unit/codexCredential.service.test.ts:293`
  - `tests/coin/unit/codexCredential.service.test.ts:388`
  - `tests/coin/unit/codexCredential.service.test.ts:411`
  - `tests/coin/unit/codexCredential.service.test.ts:420`
  - `src/main/codex/codexCredential.service.ts:471`
  - `src/main/codex/codexCredential.service.ts:622`

The modern-browser test still asserts that callback capture is never created and deliberately
throws if it is. On macOS, the implementation now necessarily creates that capture. The fake
runtime also owns no real IPv4 listener and the test injects no loopback observer, so ownership
verification cannot reach the test's `openExternal` path. Finally, it asserts removed lifecycle
stages (`callback-listener-ready` and `callback-accepted`). This is a deterministic contract
failure, not an unverified edge case.

Minimum fix: update this test to model the accepted contract: run as macOS, provide a fake IPv6
capture, inject a fake ownership observer that records start/verify/stop, route `manual_code`
through the companion or explicitly simulate the IPv4 success path, and assert the new
announced → verified → callback/token → credential lifecycle. Add cancellation coverage for a
late-resolving capture so the first finding cannot regress.

## Static review notes

- Pi 0.80.10 binds its browser callback server to `127.0.0.1`, announces
  `http://localhost:1455/auth/callback`, accepts `manual_code`, validates a supplied state, and
  remains the only token-exchange and credential owner.
- The implementation's normal IPv6 path returns the companion redirect through that same Pi
  `manual_code` interaction. Probe correlation and callback logs are value-free: they expose fixed
  paths, address family, booleans, and status only.
- Windows does not create the macOS-only IPv6 companion; it still verifies the current-process
  `localhost` and direct IPv4 routes before browser open.
- No tests, typecheck, lint, build, application run, or network login were executed, per owner
  request.

## Conclusion

**blocked**

Fix both blocking findings and perform another independent static review before merge.
