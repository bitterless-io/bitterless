# Review: trench-index-analysis-017

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

## Contract evidence

- The Add command validates the bounded one-or-N batch, checks the current workspace before any
  provider probe, resolves every item, canonical-deduplicates the result, and makes one atomic
  `addTargetsAndBeginRun` call. Repository idempotency and the run snapshot prevent partial target
  writes or more than one full-set run.
- Every target analysis issues the fixed GMGN trader request `--order-by profit --direction desc
  --limit 100`. The pure ranker aggregates by chain plus canonical wallet address, applies stable
  tie keys, caps output at 100, and globally excludes a wallet when any source identifies it as
  non-user.
- `trench_wallets` is the single wallet identity/general-metadata/classification table. Candidate
  and published INDEX tables use `wallet_id`; identity-owned fields are recursively removed from
  persisted candidate evidence. Provider classification merging is order-independent and preserves
  stronger manual/agent or structural evidence.
- `trenchStorage` is a hidden renderer/preload runtime with an independent SQLCipher database,
  migration ledger, capability/instance fence, navigation fence, bounded restart, and unavailable
  state. Main owns orchestration but imports no SQLite implementation and contains no Trench SQL.
- Run completion and `current_run_id` publication share one immediate transaction. Failed and
  interrupted runs retain the previous completed INDEX and leave auditable failure state.
- The visible renderer exposes one count-free `INDEX` module, separate Add CA and Reanalyze actions,
  two structured columns, truthful highest-market-cap evidence labels, and local-only Header
  Refresh. The existing public MCP contract remains exactly 12 `trench.*` tools.

## Verification evidence

- Independent Verify PASS: `node tests/coin/run-unit.mjs` — 126/126.
- Independent Verify PASS: `node tests/coin/run-trench-index-unit.mjs` — 4/4 native SQLCipher
  repository cases.
- Independent Verify PASS: `node --test scripts/coin/trench-index-layout.test.mjs` — 5/5 UI,
  process-boundary, and hidden-runtime contracts.
- Parent rerun PASS: narrow Trench renderer `vue-tsc`, `yarn typecheck:node`, renderer i18n, the
  31-baseline SQLite migration audit, 6/6 Omni embedding, and the exact 12-tool MCP contract.
- Fresh isolated DEBUG_DEV build and focused Electron E2E passed. The E2E submitted BSC and Solana
  together, observed two target rows and one eligible wallet, checked the exact GMGN flags, and
  reported no root overflow in standalone or the three required Omni geometries.
- Original-resolution 1360×860, 800×568, 398×568, and 800×282 screenshots were inspected. Required
  actions, target metadata, and INDEX wallet structure remain visible without page-level clipping.
- Read-only live source smoke covered all five requested BSC CAs. Each exact identity resolved,
  every wrong-chain same-address empty sentinel was rejected, and every token returned 100 valid
  trader rows in non-increasing profit order. No wallet details, prices, or Trench records were
  persisted by the smoke.
- PASS: `git diff --check`. The running DEBUG_PROD process/profile/database was not stopped or
  written during verification.

## Named broader gate

The strict test-project node invocation remains blocked by four pre-existing errors also present in
unchanged logic: `codexCredential.service.ts:794`, `memeAnalysis.normalize.ts:967`, and
`coinResource.service.ts:97,111`. The INDEX change only exports the existing holder classifier in
the affected legacy normalizer; 126/126 executable unit tests, the supported node build check, the
fresh app build, and all task-scoped strict checks pass. No gate was weakened for this task.

## Conclusion

**pass** — no P1, P2, or P3 finding. The implementation satisfies the first-phase INDEX contract,
including atomic batch ingestion, real top-100 provider reads, deterministic fail-closed wallet
ranking, centralized wallet metadata, hidden SQLCipher ownership, responsive structured UI, and
legacy MCP compatibility without touching DEBUG_PROD.
