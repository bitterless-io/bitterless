---
id: trench-record-browser-011
scope: Read-only three-module Trench renderer and dedicated non-analysis preload
status: done
depends-on: [trench-record-store-mcp-010]
---

# Trench Record Browser

## Objective

Replace the current analysis desk with a read-only CA Records, Index Wallets, and Negative Wallets
vault that previews the Main repository and live-refreshes after MCP writes.

## Scope

- Add a dedicated Trench preload containing only `electron-xpc`, static host context, and no legacy
  Coin analysis bridge.
- Add `TrenchHandler` discriminated read-only list/get methods and a renderer subscriber for
  revisioned data changes. This is an app-wide trusted first-party read surface; mutation remains MCP-only.
- Replace CommandBar, SignalRail, active Meme analysis, Decision, Resources, History, provider/X
  header state, and analysis status bar with the layout in `coin-layout.md`.
- Implement module navigation, search, selection, metadata, exact JSON preview/copy, independent
  scroll, loading/empty/error/refresh states, and selection preservation.
- Keep the existing standalone Coin/Trench native window lifecycle and 800×600 Main minimum, but
  decouple that lifecycle from legacy Coin IPC/service registration.
- Do not mount, import, register, or eagerly instantiate any data-source, clipboard, AI, strategy,
  resource, or X-browser UI/runtime from the active Trench import graph.

## Acceptance

- The three module selectors and corresponding list/detail flows are usable at 1360×860 and 800×600.
- No visible analysis control exists, and runtime inspection finds no analysis/data/AI/clipboard/X
  method in the Trench preload global.
- One already-open window receives a synthetic repository broadcast, refreshes its list, preserves
  an unchanged selection, and previews the exact selected persisted JSON.
- Long CA/wallet strings and large bounded JSON do not resize the shell or create body overflow.
- Invalid repository entries produce isolated truthful errors; valid entries remain available.
- Unpackaged E2E uses only its isolated temporary SQLite password/key and must never call Electron
  `safeStorage`, open the macOS Keychain permission UI, or read a workspace/keychain credential.

## Verification

- Renderer/store unit tests for module filters, selection fencing, refresh races, and error states.
- Focused renderer/preload/Main typechecks.
- Electron screenshots and interaction test at both standalone sizes.
- Static import/runtime-preload audit for absence of legacy analysis capability.
- A fail-closed E2E credential-boundary tripwire proves that any attempted `safeStorage` call fails
  the test with a diagnostic before the operating-system credential API is touched.

## Implementation result

- The standalone window now loads the dedicated sandboxed `trench.js` preload and exposes only the
  frozen `{ host, platform }` context. The active Main/preload/renderer graph no longer reaches the
  legacy Coin analysis, provider, strategy, resource, X-browser, native IPC, or clipboard surface.
- Main registers the six-method read-only `TrenchHandler`. Every read returns a discriminated result,
  maps expected repository conditions to bounded public codes, sanitizes unknown failures, and
  forwards only the existing content-free revision broadcast. Repository mutation remains MCP-only.
- The active renderer is the three-module record vault. Its reactive store subscribes before fetch,
  fences list/detail/query/source generations and revisions, coalesces broadcasts, restarts stale
  cursors, preserves or truthfully falls back selection, and keeps old evidence visible while
  refreshing. Invalid rows remain isolated from usable records and are never passed to detail gets.
- CA detail renders identity/reference metadata and the exact persisted document. Index detail pages
  bounded source provenance and revalidates `{ contractAddress, analysisId, contentHash }` before
  opening source JSON. Negative detail keeps tag provenance/explanation separate from nullable
  holdings and provides independent exact-copy controls for tag and holdings documents.
- The responsive record/detail panes stay bounded at 1360×860 and 800×600, with independent scroll,
  keyboard/focus restoration, accessible module tabs and record states, and a bounded syntax-color
  path that falls back to an exact plain document above 128 KiB rather than creating unbounded spans.
- E2E and debug Todoist customer SQLite use an injected isolated 64-hex runtime password before any
  password-protection capability is created; debug uses its own database namespace. All active Main
  `safeStorage` access is behind one fail-closed policy/facade. Release behavior still constructs and
  uses the OS protection capability. The E2E network guard permits only the exact loopback Todo sync
  mock and continues to deny every other request.
- Developer gates pass: Trench store/credential/JSON tests `15/15`, task 010 repository regressions
  `14/14`, the real stdio/local-RPC Trench contract, strict Main/preload/shared and renderer
  typechecks, Todo sync and MCP typechecks, i18n check, active import audit, focused ESLint error
  check, production `yarn build`, `git diff --check`, and focused Electron/Playwright `1/1`.
- The Electron run proves an active Todo sync session, loopback sync success, no protected key
  sidecar, no `safeStorage` tripwire, no denied/unexpected network, exact small and greater-than-128
  KiB documents, live selection-preserving refresh, three-module drill-in, singleton/reopen/window
  state, and no Node or legacy analysis capability. Screenshots are at
  `out/playwright/coin/screenshots/trench-vault-1360x860.png` and
  `out/playwright/coin/screenshots/trench-vault-800x600.png` and were visually inspected for clipping,
  overflow, evidence hierarchy, and narrow-width usability.
- The broad historical Coin unit runner passes `109/110`; its sole failure remains the pre-existing
  `GMGN regular-wallet rank 1 is retained as independent` normalizer expectation. The focused Trench
  browser and repository suites are green and do not change that behavior.

## Verification result

Independent source, unit, typecheck, build, Electron, target-display, Keychain-isolation, and visual
verification passed with no remaining blocker or important finding. See
[`trench-record-browser-011.md`](../results/trench-record-browser-011.md).
