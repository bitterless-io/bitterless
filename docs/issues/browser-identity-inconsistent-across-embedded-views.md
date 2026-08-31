# Embedded views present a self-contradictory browser identity

Status: implemented; owner verification pending — Omni uses native Chromium identity; Maestro unchanged

## 2026-08-31 correction — remove the global Chrome UA-CH shim

The 2026-07-29 shim created a definite cross-layer contradiction on every Omni browser request:
the wire claimed a `Google Chrome` brand while page JavaScript continued to report Chromium through
`navigator.userAgentData`. The historical Cloudflare A/B records disagree about whether that
contradiction alone causes a challenge, and the 2026-08-31 ChatGPT failure does not identify which
edge-risk signal rejected the fresh navigation. The shim is therefore not recorded as the proven
cause of that incident.

The contradiction itself is unnecessary and is now the repair target. Both `persist:omni` and
`persist:omni-google` must use Electron/Chromium's native UA string, UA client hints, and JavaScript
identity without request-header mutation, `setUserAgent()`, CDP identity overrides, or page-global
spoofing. The Google partition remains only as an isolated persistent cookie jar so existing Google
sessions are not merged into the default partition. Crossing the hostname boundary still recreates
the affected content view to select the correct session before navigation.

This correction supersedes the 2026-07-29 client-hint amendment below. It does not guarantee that a
proxy exit accepted by one service will be accepted by ChatGPT, and it does not replace a controlled
same-exit Chrome-versus-Omni and alternate-exit A/B when the edge block is reproduced.

Known tradeoff: the shim originally moved `web.whatsapp.com` past its server-side “Chrome 100+”
card in one measurement, so removing it may restore that card. If WhatsApp compatibility remains a
product requirement, it needs a separate provider-scoped design and verification; it must not
reintroduce a fabricated brand across both general-purpose Omni partitions.

## 2026-07-29 change — UA client hints are now created on both Omni browser profiles

This **amends the 2026-07-28 acceptance bullet** that forbade rewriting UA-CH/request headers.

New measurement (`areas/agent-runtime/anti-bot/solutions.md` #4, taken in a real Electron window
against `web.whatsapp.com` with a raw control in the same run): **Electron sends no UA client hints
at all** — a dumped main-frame navigation carries only `Accept*`, `Sec-Fetch-*`,
`Upgrade-Insecure-Requests` and `User-Agent`. WhatsApp's "works with Google Chrome 100+" card is
decided server-side; with no `Sec-CH-UA` to read it falls back to parsing the UA string, where any
unknown product token fails. Creating `Sec-CH-UA` with a `Google Chrome` brand turns that card into
the QR login page. Rewriting the UA string the way the Google profile does measured as still
blocked, so the two mechanisms are not interchangeable.

`omniWindow.helper.ts` therefore installs a session-scoped `onBeforeSendHeaders` shim on **both**
`persist:omni` and `persist:omni-google` that **creates** `Sec-CH-UA`, `Sec-CH-UA-Mobile` and
`Sec-CH-UA-Platform` (an append-only version is a silent no-op — there is nothing to append to).
Versions come from `process.versions.chrome`; the one added claim is the brand name.

**`buildGoogleProfileUserAgent` is removed in the same change.** The owner's position is that adding
a brand to the hint list is *additive* — Chromium's own `Not(A:Brand` and `Chromium/<real version>`
entries stay, no version is falsified — and that this is what Chromium-based third-party browsers
already do, so a separate UA-string rewrite is no longer warranted. **No Omni cell calls
`setUserAgent()` any more**, in either profile; `persist:omni-google` now differs from
`persist:omni` only by cookie jar (kept so existing Google sessions are not stranded).

**Two open verifications, both owner-only:**

1. **Cloudflare.** The created headers disagree with JS `navigator.userAgentData` (still `Chromium`,
   no `Google Chrome`) — the cross-checkable contradiction that measured as failing Turnstile
   (`solutions.md` #2.2), now on the default profile too. If a Turnstile site regresses, removing
   this shim is the first thing to try.
2. **Google / YouTube sign-in.** The 2026-07-28 pass was measured *with* the `Bitterless/<version>`
   token and native UA-CH; a pure Chrome UA hit `/signin/rejected`, and the raw `Electron/<v>` UA
   was never carried through a full sign-in. The combination now shipping — raw Electron UA **plus**
   a `Google Chrome` brand in the hints — has not been tested. The owner is re-running that login.
   If it regresses, restore `buildGoogleProfileUserAgent` for the Google profile only.

Amended acceptance bullet: *no Omni view calls `setUserAgent()` or attaches CDP for identity
spoofing; request headers carry only the created UA client hints described above.*

## 2026-07-28 correction

The previous fix removed hardcoded version drift but left every Omni browser cell presenting a
plain-Chrome legacy UA through `chromeIdentity().userAgent`. New same-engine A/B evidence showed
that this is still the wrong contract:

- Cloudflare passed with stock Electron identity and rejected the tested UA overrides.
- Google rejected the plain-Chrome UA in the local A/B; the stock `Electron/...` UA was
  fingerprinted but did not complete a separate identifier submission.
- Google completed password, 2FA, `CheckCookie`, YouTube `SetSID`, and an authenticated YouTube
  home page when the UA kept the honest `Bitterless/<app version>` product token and removed only
  `Electron/<version>`.
- The same Google flow also completed while CDP remained attached with `Runtime.enable`; CDP was
  not the cause of this rejection.

Omni therefore needs provider-scoped identities instead of one global Chrome identity. Default
browser cells retain untouched Electron identity in `persist:omni`. Google/YouTube cells use a
dedicated `persist:omni-google` session and receive the honest Bitterless UA before the first
request. Native Chromium UA-CH remains untouched in both profiles. A URL change that crosses the
profile boundary recreates the affected remote content view before navigation rather than changing
UA during an in-flight request.

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

## Previous fix (superseded for Omni)

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

## Current acceptance

- No Omni browser view calls `setUserAgent()`, rewrites UA-CH/request headers, injects JavaScript
  identity values, or attaches CDP for identity spoofing.
- Google/YouTube top-level URLs select `persist:omni-google` using hostname-boundary matching.
- Both persistent browser sessions expose Electron/Chromium's native network and JavaScript
  identity; the Google profile differs only by its isolated cookie jar.
- Moving a cell between default and Google profiles recreates only that cell's remote content
  runtime before loading the new URL.
- Existing Maestro capture identity behavior is outside this correction.
- Owner verification is a fresh ChatGPT navigation plus any needed same-exit and alternate-exit
  browser A/B; Google/YouTube sign-in remains a separate regression check.
