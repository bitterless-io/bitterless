# Review: model-provider-loopback-diagnostics-011 (round 2)

Reviewed commit: `899883a`  
Full task diff base: `5e25373`

## Findings

None.

## Blocking-finding resolution

### Late companion creation

Resolved.

`src/main/codex/codexCredential.service.ts` now retains the capture-creation promise. If
cancellation, timeout, or replacement wins before ownership is assigned to `attempt.capture`, the
late capture is explicitly cancelled and closed. If the active attempt receives the capture, the
existing attempt cleanup remains its single owner.

The new static fixture in `tests/coin/unit/codexCredential.service.test.ts` exercises the exact
late-resolution ordering and waits for both cancellation and close evidence.

### Modern macOS test contract

Resolved.

The modern-browser fixture now:

- selects macOS behavior explicitly;
- creates one IPv6 companion;
- injects current-process loopback ownership evidence;
- verifies ownership before browser open;
- returns the IPv6 redirect through the same runtime `manual_code` interaction;
- keeps the attempt store as Pi's credential owner before promotion;
- asserts the current lifecycle stages and companion cleanup.

The fixture no longer requires the removed no-companion behavior or obsolete lifecycle stages.

## Static review notes

- The complete task diff preserves Pi 0.80.10 as the sole token-exchange and credential owner.
- Cancellation and replacement fences remain in place around callback forwarding, browser open,
  credential promotion, and final status verification.
- Loopback observers and active captures have bounded cleanup paths. Probe and callback logs remain
  limited to fixed paths, address family, booleans, response status, and sanitized failure causes.
- macOS requires the IPv6 companion; Windows retains the Pi IPv4/current-process ownership path
  without creating the macOS-only companion.
- No tests, typecheck, lint, build, application run, or network login were executed, per owner
  request.

## Conclusion

**pass**
