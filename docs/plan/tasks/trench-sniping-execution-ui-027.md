---
id: trench-sniping-execution-ui-027
scope: BL Trench Canary, financial Armed, execution rail and activity controls
status: pending
depends-on: [trench-sniping-workbench-026]
---

# Trench Sniping execution controls

## Objective

Extend the verified monitor/simulation workbench with the real server-owned
`Observe → Simulate → Canary → Armed` qualification rail, one-action Canary confirmation,
financial execution rail, always-available Disarm and sanitized receipt/reconciliation activity.
This task does not start until Bitterless Private tasks 004 and 005 are independently verified.

## Context

- [`../../features/trench-sniping-layout.md`](../../features/trench-sniping-layout.md)
- Bitterless Private `docs/features/sniping.md`
- Bitterless Private `docs/features/sniping-flap-quote-product.md`
- [`trench-sniping-workbench-026.md`](trench-sniping-workbench-026.md)

## Path

- existing Sniping renderer stores/views/components and typed Main relay
- execution/qualification typed bridge additions
- Canary/Arm confirmation and execution/activity projections
- i18n, focused tests, task/result/README docs

## Contract

1. Require verified executable-release projections and commands from Private tasks 004/005. Never
   infer execution readiness from monitor-only `desired_state=armed` or renderer state.
2. Show server-owned qualification evidence and transition reasons. No stage can be skipped, and
   changing a fingerprint invalidates the applicable exact/shadow/Canary evidence immediately.
3. Canary is one explicit owner-confirmed minimum-amount action and never arms a loop. Arm has a
   separate exposure confirmation. Disarm remains direct and available while providers are offline.
4. The financial execution rail is `Signal → Match → Risk → Intent → Trade → Receipt`; customer
   projections remain sanitized and contain no JWT, secret reference/value, calldata, signature,
   raw transaction, endpoint URL, provider body or database access.
5. Preserve the 026 layout, responsive contracts, stable names, keyboard/focus/pending/conflict
   states and separate SPCX/GME instances.

## Verification

- Store/component tests cover qualification order/invalidation, stale revision, one-Canary cap,
  explicit confirmations, always-available Disarm, exposure limits, receipt/reorg/reconciliation,
  and zero monitor-only semantic confusion.
- Static/typed bridge/i18n/Omni source checks, isolated DEBUG_DEV build and `git diff --check` pass.
  No Electron/browser E2E or automated screenshot is run; Ral performs runtime acceptance.
