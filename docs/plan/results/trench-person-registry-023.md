# Trench per-chain Top 300 and person registry result

## Outcome

The hidden `trench-io` runtime now owns the complete encrypted INDEX identity model. Each SOL, BSC,
and Robinhood projection may publish 300 wallets independently while every CA/provider candidate
read and source rank remains capped at 100. A wallet is global by address namespace and canonical
address, and its chain-specific evidence lives in separate chain accounts. The same EVM address on
BSC and Robinhood therefore converges to one wallet with two chain accounts rather than duplicating
wallet metadata.

Published user wallets are atomically ensured into a person registry during `completeRun`. Person
profile fields retain source-specific priority, one person can own many global wallets, normalized X
identity can safely join uncurated people, and curated collisions become explicit conflicts instead
of silent membership moves. Main exposes typed list/detail/edit/attach methods and relays only a
content-free change event; SQL and SQLCipher remain confined to the hidden renderer.

Implementation status: **implemented; independent Verify pending**. The task remains `in-progress`
until the four blocking findings in the first independent review are reverified. Task 024 still owns
the Trenchers UI, and task 025 still owns MCP/import/portable-skill work.

## Implementation

- `TRENCH_INDEX_MAX_WALLETS` is 300 per chain and publication admits at most 900 rows. Ranking stays
  deterministic and partitioned by chain; candidate reads, per-source rank, best source rank, and
  legacy CA top-profit evidence retain their 100-row boundary.
- Immutable migration `260813155644` rebuilds 019 chain-scoped wallets into global
  `(address_namespace, canonical_address)` wallets and unique `(wallet_id, chain)` accounts. Existing
  old wallet UUIDs remain as account IDs, so candidate and materialized-result FKs remap without
  losing chain evidence. Equal EVM addresses converge, metadata merges by source priority, every
  historical run/current pointer survives, and fresh databases record 018, 019, and 023 ledger rows.
- Ledger acceptance is exact and fail-closed: the ordered version/name/timestamp rows must be the
  immutable 018→019→023 manifest or a valid prefix while upgrading. Missing predecessors, unknown
  lower/future entries, wrong names, and malformed ordering are rejected before DDL.
- The 019→023 transaction backfills one deterministic anonymous person/membership for every distinct
  global wallet in the current published user INDEX. Current/historical results, candidates,
  current pointer, and revision remain unchanged; candidate-only, historical-only, and non-user
  wallets are not backfilled. A shared BSC/Robinhood EVM wallet receives one membership.
- Added person, membership, external-identity, identity-conflict, and reserved import-staging tables
  with asserted columns, indexes, checks, and FKs. No import API or public MCP tool was added.
- `completeRun` upserts the global wallet and chain account, publishes candidate/result rows through
  `wallet_account_id`, and ensures a person for every and only published eligible wallet in the same
  transaction. A failed publication rolls back both INDEX and person changes.
- GMGN X handles normalize to the exact V1 contract. Equal valid X evidence joins a new wallet to the
  identity owner; two uncurated automatic people merge with audit history retained; manual/agent
  profile or membership evidence fences the merge and records one bounded open conflict.
- X evidence is person-owned: normalization no longer writes it into wallet metadata, the external
  identity keeps canonical value, original display spelling, source, and bounded provenance, and
  detail reads return that provenance. The migration strips all supported legacy wallet-local X
  aliases, migrates valid current-user evidence without inventing its source, and rolls back on
  invalid or contradictory legacy X metadata.
- Person enrichment uses the current candidate evidence rather than treating an already merged
  wallet row as GMGN. Existing manual/agent wallet fields carry stronger field provenance into the
  person and fence later shared-X merges; mixed legacy provenance is conservatively agent-fenced.
  The fence is also structural: manual/agent/mixed wallet metadata, curated membership, or curated
  chain-account evidence blocks provider backfill and automatic identity attachment even when the
  wallet name/avatar are null and its only curated facts are wallet-owned note/metadata. Those
  wallet facts remain byte-for-byte unchanged and are never copied into person-owned fields.
- Person list/detail reads use a shared-revision cursor fence and derive current profitability from
  current INDEX rows as `wallet-sum-v1`. Manual profile editing and existing-wallet attach/move use
  expected-revision/current-membership compare-and-swap. Omitted profile fields preserve values and
  explicit null clears them.
- Shared validators run at both visible/Main and hidden-runtime boundaries. Main and visible
  renderers import no SQLite module and contain no SQL. Successful mutations increment repository
  revision and broadcast only `trench/person-changed` without record payloads.

## Verification

- PASS — `node tests/coin/run-unit.mjs`: `153/153`, including every-chain 300 from independent
  Top-100 targets, deterministic limits, parser 300/301 boundaries, X normalization, and strict
  person request validation.
- PASS — `node tests/coin/run-trench-index-unit.mjs`: `17/17` native SQLCipher tests, including fresh
  v3, populated 019→023 row/display-address preservation, same-EVM convergence into one wallet/two
  accounts and one person, current pointer/revision preservation, upgrade backfill, legacy X cleanup
  and rollback, auto-person publication, X display/provenance, uncurated merge, manual/agent
  profile/membership collision fences, blank manual/agent/mixed wallet-provenance fences, direct
  curated-wallet identity conflicts, cursor staleness, manual CAS, current-profit projection, and
  atomic rollback.
- PASS — `node --test scripts/coin/trench-index-layout.test.mjs scripts/mcp/trench-contract.test.mjs`:
  `15/15`. It covers the hidden SQL owner, typed/event boundaries, global wallet/account schema, and
  confirms the existing public MCP surface remains exactly 12 tools.
- PASS — focused hidden/shared `tsc` and focused Coin renderer `vue-tsc` projects.
- PASS — `yarn typecheck:sqlite-migrations` and `yarn audit:sqlite-migrations`, including fresh,
  populated 018, populated-current/historical 019, partial-schema, missing-predecessor,
  unknown-lower, wrong-identity, and future-version fail-closed cases.
- PASS — fresh isolated DEBUG_DEV `yarn build`; built version code is `260813155644`.
- PASS — `git diff --check`.
- NOT RUN — Electron E2E, per Ral's explicit instruction. Ral will perform later UI/runtime
  acceptance; no such acceptance is claimed here.

The broad existing `tests/coin/tsconfig.trench-node.json` project still reports four unrelated
shared-worktree errors in Codex credential handling, meme-analysis metric typing, and Coin resource
credential unions. No 023 file is involved; the focused type projects and the full DEBUG_DEV build
pass without suppressions.

No DEBUG_PROD command, process, profile, database, or MCP record was touched.

The first independent review is retained unchanged at
[`../reviews/trench-person-registry-023-1.md`](../reviews/trench-person-registry-023-1.md). Its four
P2 findings have implementation and regression coverage in this Develop pass; closure still
requires a fresh independent Verify, so the task intentionally remains `in-progress`.
