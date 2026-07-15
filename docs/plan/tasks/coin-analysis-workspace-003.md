---
id: coin-analysis-workspace-003
scope: Coin analysis tabs, source adapters, persistence, and strategy decisions
status: pending
depends-on: [coin-resource-settings-002]
---

# Coin Analysis Workspace

## Objective

Make Monitor, Screener, Meme, Strategy, History, and Sources operational with typed adapters,
truthful source states, local receipts, and deterministic `BUY`, `HOLD`, or `SELL` decisions.

## Contract

- Implement the complete result contract in [`coin.md`](../../features/coin.md), including the
  screenshot-level Meme holder/cohort/EOA/key-wallet output and current concept/attention evidence.
- Keep credentials and arbitrary URLs out of the renderer. Host adapters consume configured resource
  values and return typed ready/unavailable/error/stale receipts.
- Reuse Monitor and Screener HTTP contracts. `sample` mode is explicit and labelled; no failure path
  substitutes fixtures, samples, zeros, or empty success.
- Support Meme discover/recently-filled polling controls and one `chain + CA` analysis. Live
  unavailable state points to the precise Resources prerequisite.
- Implement strictly parsed, versioned, atomic owner-only Coin state. Keep prior valid results during
  refresh/failure and restore history without issuing a request.
- Implement deterministic strategy v1. Without position inputs, only `BUY` or `SELL`; `HOLD` requires
  entry price, remaining amount, invested amount, and risk input.
- Every data action has loading/duplicate protection, cancellation where useful, source timestamps,
  and distinct empty/unavailable/error/stale states.

## Paths

- `src/main/coin/data/`
- `src/main/coin/state/`
- `src/main/coin/strategy/`
- `src/shared/coin/`
- `src/preload/coin/`
- `src/renderer/coin/`
- `tests/coin/`

## Verification

- Use real local HTTP fixtures for request shape, parsing, unavailable behavior, refresh retention,
  cancellation, and no automatic sample fallback.
- Verify complete Meme rendering with full/partial/missing fixtures; every missing metric shows
  `null + reason` rather than zero.
- Verify persistence/recovery and deterministic decision fixtures including the HOLD position gate.
- Run focused tests/typechecks/build and screenshots for every analysis tab at both target sizes.

