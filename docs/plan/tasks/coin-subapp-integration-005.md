---
id: coin-subapp-integration-005
scope: Coin end-to-end integration, acceptance, and sync readiness
status: owner-verification-pending
depends-on: [coin-ai-analysis-004]
---

# Coin Sub-application Integration

## Objective

Exercise the full feature through the real Bitterless host boundary, close contract gaps, and
produce lifecycle, resource-security, data, AI, visual, and second-machine setup evidence. Per the
owner's 2026-07-15 direction, this runtime pass is owner-executed; no additional agent-side E2E,
build, typecheck, or visual verification is authorized for this handoff.

## Contract

- Exercise Home → Coin first/repeated Open, close/reopen, geometry, language, logout, quit/update,
  and relaunch. No duplicate/orphan/hidden/remote renderer may remain.
- Exercise Resources through production boundaries: Codex connect status, GMGN detect/key/probe,
  Alchemy encrypted config/probe, service status, masking, failures, and fresh-machine unavailable
  states.
- Exercise each analysis adapter using local HTTP fixtures across success, unsupported, missing,
  partial, stale, failure, cancellation, persistence, and reopen.
- Exercise complete Meme output, concept/attention evidence, polling, deterministic decisions, and
  background Codex strict analysis. An injectable Codex test transport may replace the external
  response but cannot bypass credential/context/schema/correlation/persistence boundaries.
- Audit the compiled renderer/accessibility tree for no chat, composer, provider selector, browser,
  Maestro tool, credential, Node API, private key, signing, or trading command.
- Verify docs explain installation and that code sync intentionally excludes machine credentials.

## Paths

- `tests/coin/`
- `scripts/coin/`
- verified Coin integration fixes
- `docs/plan/reviews/`
- `docs/features/coin.md`
- `docs/features/coin-layout.md`
- `docs/guides/coin-data-sources.md`
- `docs/guides/gmgn-cli.md`

## Verification

- Owner runs `yarn dev` for local/debug sources or `yarn dev:prod` for production sources after
  completing the GMGN and Alchemy setup guides.
- Owner may run focused unit/contract tests, Electron Playwright, Maestro lifecycle checks,
  `yarn check:maestro`, node/renderer typechecks, and `yarn build` when a full verification pass is
  wanted.
- Capture every analysis tab, Resources, Sources, and AI state at `1360x860` and `800x600`; inspect
  overflow, overlap, loading stability, and Royal Blue consistency.
- Write an independent requirement matrix with automated check, screenshot, manual observation, or
  explicit production credential gate for every contract item.

## Owner Run Order

1. Follow `docs/guides/gmgn-cli.md`, then configure the personal key and run the fixed read-only
   probe from Coin → Resources.
2. Follow `docs/guides/coin-data-sources.md`, adding separate mainnet HTTPS endpoints for Robinhood
   Chain, BSC, and Solana; add WSS endpoints when the Alchemy app exposes them.
3. Start Bitterless with `yarn dev`, log in, open Coin, and confirm Resources reports the selected
   providers without exposing credentials.
4. Exercise Monitor, Screener, Meme Discover/Analyze, Strategy (including a complete existing
   position for HOLD), History restore, Sources, and Codex Analyze with AI/Cancel.
5. Close and reopen Coin, then restart Bitterless and confirm geometry, persisted results, resource
   readiness, and validated AI receipts restore without chat or trading controls.
