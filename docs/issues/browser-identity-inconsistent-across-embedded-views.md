# Embedded views present a self-contradictory browser identity

Status: fixed

## Report

The three surfaces that load third-party web content each presented a different, internally
inconsistent browser identity to the remote site:

- **Omni browser cells** (`src/main/windows/omniWindow.helper.ts`) hardcoded
  `Chrome/146.0.0.0` and applied it with `setUserAgent()` only. The engine was Chromium 144, so the
  UA string claimed 146, `navigator.userAgentData` reported 144, and no `Sec-CH-UA` header was sent
  at all — three mutually contradictory signals. The constant also hardcoded a macOS UA, so a
  Windows build advertised macOS.
- **Maestro operation views** (`src/main/maestro/capture/chromeIdentity.ts`) were structurally
  correct — UA derived from `process.versions.chrome`, plus a CDP
  `Network.setUserAgentOverride` carrying `userAgentMetadata` — but three details were wrong:
  a hardcoded GREASE brand, the brand list in the wrong order, and a missing `formFactors`.
- The CDP override was applied on a **background** attach while navigation proceeded in parallel,
  so a tab's *first* document request — the one a bot-detection edge scores — could go out with no
  override at all.

An `acceptLanguage` defect affected every surface: Chromium synthesises q-values itself, for both
`session.setUserAgent(ua, langs)` and CDP `Network.setUserAgentOverride`. Passing the pre-weighted
`'en-US,en;q=0.9'` put the malformed **`en-US,en;q=0.9;q=0.9`** on the wire (measured on both
paths) — a louder anomaly than the value it was meant to fix.

Background research, measurements and the reproducible probe harness live in the overmind
workspace at `areas/agent-runtime/anti-bot/` (start with `cloudflare.html`).

## Root Cause

Browser identity was assembled per call site from hand-written constants, instead of being derived
in one place from the engine actually shipping in the build. Hand-written constants cannot track a
Chromium bump: the GREASE token is a function of the milestone, so `Not=A?Brand`/`24` was correct
for Chrome 140 and silently wrong for 144 and 150.

## Fix

`chromeIdentity()` is now the single source of identity, and every value is derived:

- GREASE brand computed from the Chromium major, mirroring Chromium's `GenerateBrandVersionList`.
  Self-checks against measured real Chrome: 140 → `Not=A?Brand`/24, 144 → `Not(A:Brand`/8,
  150 → `Not;A=Brand`/8.
- GREASE entry listed **first**, matching real Chrome's brand order.
- `formFactors: ['Desktop']` added — without it `getHighEntropyValues()` returns `[]` while the
  wire says `Desktop`.
- `platformVersion` from `process.getSystemVersion()` instead of the constant `15.0.0`.
- Default `acceptLanguage` is now the bare list `'en-US,en'`.
- Omni cells consume `chromeIdentity().userAgent` instead of the hardcoded constant.
- `ViewSlot.attachReady` retains the background attach promise; the first **remote** navigation
  awaits it through `awaitAttach()` (bounded at 3s, so a hung attach degrades to the previous
  behaviour rather than hanging the tab). Display is still never blocked.
- Toggling the per-tab debugger back on republishes `attachReady`, so a navigation issued right
  after the toggle waits for the re-applied override.

Deliberately **not** fixed: omni cells still have no CDP override, so they retain stock-Electron
client-hint behaviour (no `Sec-CH-UA` on top-level navigations, no `Google Chrome` brand). Adding
one would mean attaching a debugger to those views, which would take DevTools away from them. The
identity is now incomplete there, but no longer self-contradictory.

## Runtime dependency boundary

The browser-identity fix derives its values from the bundled engine and does not authorize an
Electron major upgrade. Bitterless remains pinned to Electron `40.10.6` (Chromium 144). The
transient Electron `43.2.0` manifest change and its forced `node-abi@4.33.0` resolution are reverted.

`better-sqlite3-multiple-ciphers` advances independently from `12.6.2` to `12.11.1`. The
[upstream v12.11.1 release](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/releases/tag/v12.11.1)
publishes prebuilt binaries for Electron 29–42, including the required Electron 40 target.

## Verification

- `yarn typecheck:node` — pass
- `yarn build` — pass
- `chromeIdentity()` derives Chrome major, GREASE brand, platform, and full version from the actual
  runtime, including the measured Chromium 144 identity shipped by Electron 40.
- Cloudflare Turnstile obtained a token on a real-sitekey page under both Electron 40 and 43
  (837 chars, fresh profile, focused and unfocused).

The Electron 43 measurement remains historical evidence for the derived identity algorithm, not a
release dependency. Native SQLite loading under Electron 40 is re-verified after installing
`12.11.1`; the owner performs the final signed application package test.
