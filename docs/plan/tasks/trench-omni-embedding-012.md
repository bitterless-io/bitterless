---
id: trench-omni-embedding-012
scope: Real BL Trench operation view inside Omni cells
status: done
depends-on: [trench-record-browser-011]
---

# Trench Omni Embedding

## Objective

Add Trench to Omni's first-party mini-app allowlist and load the same read-only record vault directly
inside an Omni cell without launching or depending on the standalone window.

## Scope

- Add `trench` to the shared ID/parser/display URL, Main runtime map, Control selector, i18n, icon,
  persisted layout round trip, packaged target audit, and navigation fence.
- Load the dedicated Trench preload and local renderer in the operation `WebContentsView` with
  sandbox, context isolation, web security, no Node integration, and `--mode=omni`.
- Extend the Omni runtime map with per-mini-app sandbox configuration; do not weaken Trench to the
  current generic `sandbox: false` default.
- Hide standalone chrome; remove renderer minimum dimensions and drag/traffic-light behavior in the
  embedded host.
- Allow multiple Trench cells to read the same repository and receive data-change broadcasts.
- Preserve the browser URL and selected mini-app ID when switching between Browser and Mini App. A
  remounted Trench selects its first current row; per-cell record selection is not persisted.

## Acceptance

- Selecting Trench creates a local child operation view and creates no standalone Coin/Trench
  `BrowserWindow`.
- Standalone and one or more Omni Trench instances show the same records and update after one MCP
  write without reload.
- A Trench view cannot navigate its privileged preload to remote content or open an in-cell popup.
- 800×568, 398×568, and 800×282 cells keep module/list/detail navigation reachable with no body
  horizontal overflow.
- Switching or closing one cell destroys only its view; other Trench cells and repository state
  remain live.

## Verification

- Omni parser/runtime/round-trip tests updated from four to five mini apps.
- Main-side WebContentsView Electron test for real embedded identity, security preferences,
  standalone absence, teardown, live refresh, and responsive screenshots.
- Production build audit confirms the Trench preload and renderer assets exist.

## Implementation result

- Omni now recognizes `trench` as its fifth bounded mini app across the shared parser/display URL,
  dedicated runtime map, Control selector, localized label, icon, and persisted layout round trip.
  The real child operation view loads the local Coin renderer with the dedicated Trench preload,
  sandbox, context isolation, web security, no Node integration, disabled webviews/insecure content,
  and `--mode=omni`; the preload-observed host identity proves that argument reached the renderer.
- Privileged Trench cells deny popups and fence navigation/redirects away from their local renderer.
  Main-side Electron acceptance drives real HTTPS popup/navigation attempts while stubbing and
  recording `shell.openExternal`, proving both fence paths run without opening a browser or changing
  the operation view URL.
- The same read-only vault adapts to embedded 800×568, 398×568, and 800×282 cells without standalone
  chrome or body overflow. Real interactions cover narrow Back navigation and short-height CA →
  Index wallet → source document → Back reachability. Fresh screenshots under
  `out/playwright/coin/screenshots/trench-omni-*.png` were inspected at original resolution.
- The native WebContentsView E2E proves initial embedded-only operation creates zero standalone
  Trench BrowserWindows; browser URL plus `miniAppId: trench` survive Browser ↔ Mini App switching;
  the remounted cell selects the newest first row; two cells and a subsequently opened standalone
  window all receive one MCP write; removing the secondary cell destroys its WebContents; and a
  later MCP write still refreshes the remaining embedded and standalone views.
- Detail-source generations now reset whenever direct or automatic list/detail context changes, so
  an old deferred Index source cannot overwrite or obscure a new search, record, issue, fallback, or
  cleared selection. Deferred store regressions cover direct changes and refresh-time auto-selection.
- Production Coin HTML now places CSP first and charset second, authorizes every inline Monaco
  bootstrap by its exact SHA-256 hash, keeps charset inside the first 1024 bytes, and rewrites/audits
  worker paths against the actual output. The fresh production build rejects stale or unsafe output.
- Developer verification passes: Trench store tests `16/16`, Omni task tests `6/6`, Motto regression
  tests `18/18`, Omni layout tests `10/10`, renderer i18n, Node and focused renderer typechecks,
  focused ESLint with zero errors, production `yarn build`, and the focused Electron E2E `1/1`.
  The E2E used isolated HOME/userData, mock Keychain, the configured target-display route, no
  `safeStorage` tripwire, and no denied/unexpected network or renderer error.

## Verification result

- Independent Verify on 2026-08-09 found no blocker or important issue and accepted the frozen
  parser/runtime/security/lifecycle/responsive contract.
- Fresh production build and post-build asset/CSP freshness gates passed; the independent Electron
  E2E passed `1/1` on exact display `DELL S2721QS` with mock Keychain and zero `safeStorage` access.
- All three fresh responsive screenshots were inspected at original resolution. Full evidence is in
  [`../results/trench-omni-embedding-012.md`](../results/trench-omni-embedding-012.md).
