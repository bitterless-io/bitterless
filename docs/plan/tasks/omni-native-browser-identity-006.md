---
id: omni-native-browser-identity-006
scope: remove Omni's contradictory global Google Chrome UA-CH shim
status: implemented; owner verification pending
depends-on:
  - omni-browser-google-identity-003
verify:
  - both Omni browser partitions use native Electron/Chromium UA, UA-CH, and JavaScript identity
  - no Omni request hook creates or extends Sec-CH-UA with a Google Chrome brand
  - the Google profile remains a separate persistent cookie jar with unchanged hostname routing
  - focused source regression test, node typecheck, build, and git diff checks pass
  - Electron E2E is not run; owner performs the live fresh-navigation acceptance
---

# Omni Native Browser Identity

## Objective

Remove the global Omni request-header shim that claims a `Google Chrome` UA-CH brand while
`navigator.userAgentData` reports Chromium. Keep both browser profiles on the engine's native,
internally honest identity.

## Context

- `docs/features/omni-miniapp-cells.md`
- `docs/issues/browser-identity-inconsistent-across-embedded-views.md`
- `docs/plan/tasks/omni-browser-google-identity-003.md`
- `areas/agent-runtime/anti-bot/README.md` in the private overmind parent workspace

The historical anti-bot A/B results conflict, so this task does not claim that the shim is the
proven cause of the 2026-08-31 ChatGPT edge rejection. It removes a definite identity contradiction
and leaves proxy-exit versus embedded-browser attribution to a controlled runtime A/B.

## Path

- `src/main/windows/omniWindow.helper.ts`
- `tests/omni/omniLayoutLifecycle.test.mjs`
- `docs/features/omni-miniapp-cells.md`
- `docs/issues/browser-identity-inconsistent-across-embedded-views.md`
- `doc/modules/omni.md`
- `docs/INDEX.md`
- `docs/plan/README.md`
- `docs/plan/tasks/omni-native-browser-identity-006.md`

## Implementation Constraints

- Remove the session `onBeforeSendHeaders` identity hook and its registration state.
- Do not replace it with JavaScript injection, `setUserAgent()`, CDP identity overrides, or another
  request-header mutation.
- Keep `persist:omni` and `persist:omni-google`, hostname-boundary routing, profile-crossing content
  replacement, cookies, permissions, service-worker cleanup, navigation, and layout behavior.
- Do not change Maestro's separate capture identity implementation.
- Accept that WhatsApp may return to its “Chrome 100+” card; any provider-specific compatibility
  mechanism is a separate task and must not restore a global identity contradiction.
- Preserve every unrelated working-tree change, especially the current Electron/runtime and
  OnlyPreview work.

## Verification

1. Run the focused source-contract test proving the browser-view creation path has no identity
   override and still binds the selected persistent session.
2. Run `yarn typecheck:node`.
3. Run `yarn build` and `git diff --check`.
4. Do not run Electron E2E. Ral verifies a fresh `chatgpt.com` navigation after restart and, when
   useful, compares the same proxy exit in daily Chrome plus an alternate exit in Omni.

## Result

- Removed Omni's session-level `Google Chrome` UA-CH shim without adding a UA, CDP, request-header,
  or JavaScript identity replacement.
- Preserved both persistent partitions, hostname routing, cross-profile content replacement, and
  Google cookie isolation.
- Added the native-identity source contract to the existing Omni Node test suite.
- [Independent review 1](../reviews/omni-native-browser-identity-006-1.md) passed with no findings.
- `yarn test:omni-layout` passed 12/12, `yarn typecheck:node` passed, `yarn build` passed, and the
  complete working tree passed `git diff --check`.
- Electron E2E was not run. Fresh ChatGPT navigation remains for Ral's live acceptance.
