---
id: trench-index-analysis-017
scope: main/preload/renderer/coin/shared/trench
status: done
depends-on: [trench-todo-menubar-parity-016, trench-agent-skill-guide-015]
---

# Trench INDEX Analysis

## Objective

Implement the first Trench INDEX vertical slice: a user-managed target CA set, explicit GMGN
profit-ranked top-100 collection for every target, a deterministic global Top 100, a shared wallet
address/metadata registry, a dedicated hidden SQLCipher owner, and the count-free two-column INDEX
workspace in standalone and Omni.

## Context

- [`../../features/trench-index.md`](../../features/trench-index.md)
- [`../../features/trench-index-layout.md`](../../features/trench-index-layout.md)
- [`../analysis/trench-index-analysis.md`](../analysis/trench-index-analysis.md)
- [`../../features/trench-mcp.md`](../../features/trench-mcp.md)
- `areas/trench/index-analysis-design/index.html` in the private overmind parent

The current branch is `dev/current`; do not switch or create a branch without Ral's explicit
permission. Preserve the dirty OnlyPreview and completed Trench Menu Bar work. Keep the running
DEBUG_PROD application/profile untouched and never put real Trench records into a debug MCP server.

## Implementation path

1. Add the shared INDEX/storage types, validation, normalized provider batch, command receipts,
   workspace snapshot, stable errors, and content-free changed events.
2. Extend the existing bounded GMGN token-trader read input/args with explicit profit descending
   order and implement a pure INDEX normalizer/ranker with exact provider-field handling.
3. Add a dedicated hidden `trenchStorage` renderer/preload build target, lifecycle service, ready
   handshake, capability/instance fencing, navigation fences, and bounded restart/unavailable state.
4. Implement independent SQLCipher key/session/migrations and the eight-table first-phase schema.
   `trench_wallets` is the only wallet identity/metadata/classification table; candidate and INDEX
   tables use `wallet_id` foreign keys and sanitized evidence cannot duplicate registry-owned
   fields. Preserve every valid provider row as an eligibility-audited candidate, while only
   explicit user wallets may be aggregated.
5. Implement private typed storage reads/commands and one-transaction run publication, failed-run
   retention, orphan recovery, monotonic revision, and joined current workspace projection.
6. Implement Main's single INDEX analysis orchestrator and public XPC facade. Main may call GMGN and
   storage capabilities but must not import SQLite, execute SQL, or fall back to legacy JSON writes.
7. Replace the visible three-tab record browser with one `INDEX` module, no count spans, an action
   row, Add CA dialog, Reanalyze, target list, joined INDEX wallet list, complete busy/error/stale
   states, and responsive standalone/Omni layout.
8. Keep the existing 12-tool MCP surface and legacy JSON repository compatible. Update the SQLite
   migration release gate and packaging checks to include the fourth Trench family.
9. Add focused unit, hidden-repository integration, process-boundary, renderer, existing-MCP, build,
   and isolated Electron tests; capture and inspect required screenshots.

## Data invariants

- Active target uniqueness: `(chain, canonical_address)`.
- Shared wallet uniqueness: `(chain, canonical_address)` in `trench_wallets` only.
- No INDEX module table stores wallet address/name/avatar/note; provider evidence strips these
  registry-owned values before persistence.
- `trench_wallets` centrally stores `wallet_kind`, classification source, and classification update
  time. AMM/LP, exchange/CEX, contract, and unknown rows fail closed.
- Every valid top-100 source row persists as a candidate relation with `wallet_id`, eligibility,
  and exclusion reason; only eligible `user` rows can enter the global ranking.
- One target/run has at most 100 unique source ranks and wallet IDs.
- One run has at most 100 unique global ranks and wallet IDs.
- Only a completed all-target run can replace `current_run_id`.
- Provider enrichment never overwrites populated manual wallet metadata.
- Every read snapshot is one repository revision and every mutation is request-idempotent.

## Acceptance

- [x] Module navigation shows only `INDEX`; all tab count spans and CA/Negative entries are absent.
- [x] Add CA accepts one or N CAs, validates/resolves the complete bounded batch, atomically
      persists unique targets with no partial writes, and starts exactly one full-set analysis.
- [x] Reanalyze is a separate button and cannot create a concurrent run.
- [x] Every target uses GMGN token info and traders with `profit DESC, limit 100`.
- [x] CA rows show token name, CA, current market cap and correctly labelled highest evidence.
- [x] Global ranking follows the accepted deterministic order and contains at most 100 wallets.
- [x] `trench_wallets` owns wallet address/name/avatar/note/general metadata; all module rows use
      `wallet_id` and cross-module search/filter joins it.
- [x] AMM, LP, CEX, contract, and unknown wallets remain auditable candidates but are excluded;
      a proven user wallet remains eligible.
- [x] Trench has an independently encrypted/migrated database owned by a hidden renderer preload;
      Main has no SQLite import, connection, or SQL.
- [x] Failed, malformed, partial, interrupted, or orphaned runs preserve the previous current INDEX.
- [x] Existing 12 public `trench.*` tools and their focused tests remain compatible.
- [x] Standalone and Omni show the same revision with accessible empty/busy/error/stale states and
      no body overflow at required sizes.

## Verification

- Pure normalizer/ranker tests, including exact GMGN args, duplicates, AMM, LP, CEX, contract,
  unknown, a proven user, invalid/non-finite evidence, deterministic ties, cross-chain identity,
  and fewer than 100.
- Hidden repository tests against a temporary encrypted DB: fresh migration, schema/FK/index audit,
  central metadata preservation, joined queries, atomic publish/rollback, failed-run retention,
  orphan recovery, and revision events.
- Static process-boundary tests proving Main does not import SQLCipher/SQLite or contain Trench SQL;
  hidden runtime capability/navigation/package contracts.
- Narrowest shared/Main/preload/Trench renderer typechecks and focused unit/static tests.
- Fresh debug build and focused existing Trench MCP/schema tests confirming all 12 tools.
- Isolated DEBUG_DEV/E2E Electron standalone and Omni flows with synthetic provider fixtures and
  temporary userData. Screenshot and inspect 1360x860, 800x568, 398x568, and 800x282.
- `git diff --check` and an independent Verify report. Broader pre-existing failures must be named
  exactly and may not be hidden by weakening a task-scoped gate.

## Result

Implemented. See [`../results/trench-index-analysis-017.md`](../results/trench-index-analysis-017.md).
