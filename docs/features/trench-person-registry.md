# BL Trench person registry and Trenchers

Status: Data layer independently verified; Trenchers UI independently verified; person import
implemented with independent Verify pending

## Purpose

Trenchers turns wallet-shaped evidence into a durable human identity layer. A `person` represents
one trader and owns one or more global wallet addresses. One EVM address can be used on multiple
chains, so the address and its chain accounts are separate entities: `trench_wallets` stores one
`(namespace, canonical_address)` row, while `trench_wallet_chain_accounts` stores zero or more
`(wallet_id, chain)` rows. General name/avatar/note metadata is stored once on the wallet; chain
classification, presence, ranks, balances, and profit remain chain-account facts. Normalized X
identity belongs to the person and keeps its provider evidence in the external-identity relation. Cross-wallet
identity, the person's profile, and membership live in dedicated tables. A global wallet belongs to
at most one active person, while a person may own any bounded number of wallets across SOL, BSC,
and Robinhood.

`Anonymous` / `无名氏` is a renderer label, not a duplicated database name. A newly discovered
wallet starts under an active person whose `display_name` is null. GMGN X identity, an explicit
human edit, an agent edit, or a non-overwriting import may enrich that profile later.

## Data model

```text
trench_persons
  1 ─────── N trench_person_wallets N ─────── 1 trench_wallets
                                                  │
                                                  └─ N trench_wallet_chain_accounts
  │
  ├─ N trench_person_external_identities
  └─ N trench_person_identity_conflicts

trench_person_imports 1 ─────── N trench_person_import_chunks
```

### `trench_persons`

| Field | Contract |
| --- | --- |
| `person_id` | UUID primary key |
| `status` | `active | merged`; merged rows retain `merged_into_person_id` for audit and never appear in active lists |
| `display_name` | nullable, 200 Unicode code points; null renders localized Anonymous |
| `avatar_url` | nullable bounded HTTPS URL |
| `note` | nullable, 2,000 Unicode code points; person-level human/agent analysis only |
| field sources | separate `display_name_source`, `avatar_source`, and `note_source` values |
| `metadata_json` | bounded canonical cross-wallet profile facts, never wallet-local facts |
| timestamps | created and last profile update instants |

Profile-source priority is `manual > agent > gmgn > import > system`. Priority applies per field,
not to the whole row, so a manual note can coexist with a later GMGN avatar. Automatic enrichment
may replace a lower-priority populated value or fill an empty value; it cannot overwrite an equal
or stronger value. Explicit UI edits write `manual`. Existing wallet `name`, `avatar_url`, `note`,
classification, and metadata retain their separate registry ownership.

### Global wallets and chain accounts

`trench_wallets` is globally unique by `(address_namespace, canonical_address)`. V1 namespaces are
`evm` and `solana`; EVM canonicalization lowercases the 20-byte address and Solana preserves the
validated Base58 spelling. This table owns address spelling plus general name, avatar, note, and
metadata.

`trench_wallet_chain_accounts` is unique by `(wallet_id, chain)` and owns `wallet_kind`,
classification source/time, chain first/last seen, and other chain-specific facts. INDEX candidate
and materialized result rows reference `wallet_account_id`, so one global EVM wallet may have
independent BSC and Robinhood ranks/profit in the same run without duplicating its metadata.

The 019 schema migrates deterministically: equal EVM address rows across chains converge to one
global wallet, retain a separate chain account for every old row, and map all candidate/result FKs
to the matching account. Metadata resolves by source priority without overwriting manual/agent
values. Migration preserves every chain result even when two old wallet IDs converge. The immutable
ledger must be exactly this ordered manifest, retaining every historical identity:
`260807114211 initial-index-schema` (018), `260811170011 chain-partitioned-index` (019),
`260813155644 global-wallet-person-registry` (023), then
`260813155645 person-import-ledger` (025). A missing predecessor, reordered or unknown entry, or a
wrong version/name identity fails before schema work begins. Fresh databases apply all four in
that order; upgrades append 025 without rewriting an earlier ledger row.

### Membership and identities

`trench_person_wallets.wallet_id` is unique and points to the global wallet, not a chain account.
Membership records `person_id`, `link_source`, bounded
evidence, and timestamps. Link sources are `index-auto | gmgn-x | import | manual | agent |
transfer-evidence`. A transfer alone is never strong enough to merge people automatically.

An equal EVM address on two chains is the same global wallet record by product definition. Its
chain-account classification can still differ—an address may be a user account on one chain and
contract/non-user evidence on another. Only a published user chain account auto-ensures person
membership; non-user accounts remain excluded without duplicating or clearing global metadata.

V1 external identity is a normalized X handle: trim whitespace, remove one leading `@`, normalize
NFC, lowercase ASCII, and validate `1..15` ASCII letters/digits/underscore. The unique identity is
`(provider='x', canonical_value)`. Display spelling remains relation-held evidence, never wallet
metadata.

X is person-owned and is never retained in wallet metadata. New GMGN evidence carries both the
canonical value and the original bounded display spelling into the external-identity row together
with target/rank/time provenance. The 019 upgrade removes legacy X aliases from wallet metadata;
when a current published user wallet has valid legacy evidence it migrates that evidence to the
person identity relation without relabelling its source. Invalid or contradictory legacy identity
metadata aborts the whole upgrade.

During the 019→023 transaction, every distinct global wallet represented by a current published
`user` chain account receives one deterministic anonymous person and membership. The migration does
not create people for historical-only results, candidate-only addresses, or current non-user rows,
and it does not change the current run pointer or repository revision. One EVM wallet published on
BSC and Robinhood still receives only one membership.

On a successful INDEX publish, the same `trench-io` transaction ensures a person for every
published user wallet:

1. Upsert/reuse the global wallet, then upsert the current chain account and preserve an existing
   global-wallet membership.
2. If the wallet has a valid GMGN X handle already mapped to an active person, attach to it.
3. Otherwise create one anonymous person and attach the wallet.
4. Enrich lower-priority person name/avatar fields from GMGN evidence.
5. If an X handle connects two uncurated automatic/import/GMGN people, deterministically retain the
   identity owner, move memberships and identities, and mark the other person `merged`.
6. If either side has manual/agent profile data or a manual/agent membership, do not merge. Record
   one bounded open identity conflict for later human resolution.

Provider name/avatar evidence is passed separately from the merged wallet row. Existing
manual/agent wallet fields retain their stronger provenance when first projected to a person, while
GMGN fields are labelled GMGN only when supported by the current provider batch. A mixed legacy
wallet is conservatively fenced as agent-curated rather than being mislabelled as GMGN.

Only wallets actually published in the per-chain INDEX are auto-ensured. Excluded AMM, exchange,
contract, unknown, and candidate-only rows do not become Trenchers.

### Current profit projection

Person profitability is queried, never copied into `trench_persons`. The current projection joins
active membership through chain accounts to the current `trench_index_wallets` run and reports:

```text
wallet_sum_total_profit_usd      = SUM(current wallet total_profit_usd)
wallet_sum_realized_profit_usd   = SUM(known current wallet realized_profit_usd)
wallet_sum_unrealized_profit_usd = SUM(known current wallet unrealized_profit_usd)
ranked_wallet_count              = COUNT(current INDEX memberships)
```

The API and UI label this evidence `wallet-sum-v1`. It is useful for discovery but is not
transfer-aware cost attribution.

## Buy in wallet A, transfer to wallet B, sell in wallet B

Exact person-level profit requires an ordered token-flow ledger, not a sum of GMGN trader rows.
For every person, token, chain, and declared analysis horizon, a future flow analyzer must ingest a
complete finalized event stream with transaction/log identity, block/slot order, raw amount,
decimals, `from`/`to` owners, decoded swap quote amount, and pagination completeness.

```text
A buy lot ── internal transfer A→B ── B sell
  cost             move lot             realize against moved cost
```

Internal member-to-member transfers move cost lots and produce zero profit. External buys create
lots; external sells consume lots using FIFO v1. Unmatched transfers, mixed pre-existing balances,
reorgs, or incomplete ranges remain explicit `unresolved`; the system never invents a zero cost.
GMGN `portfolio activity` is a useful read-only input but its documented response does not prove a
complete counterparty-addressed transfer ledger, so task 023 exposes only `wallet-sum-v1` and keeps
transfer-aware profit as a separate chain-event integration.

## Read and edit API

Visible standalone and Omni renderers call Main through the existing Trench XPC emitter. Main owns
validation and orchestration but no SQL. The hidden `trench-io` preload owns these operations:

| Operation | Contract |
| --- | --- |
| `listPersons` | revision-fenced cursor page, query, `limit <= 100`; active profile, note, wallet counts/chains, current `wallet-sum-v1` |
| `getPerson` | one active/merged-resolved profile plus ordered wallet rows, wallet metadata, current rank/profit, and external identities |
| `updatePersonProfile` | CAS revision + optional display name/avatar/note fields; omitted preserves, explicit null clears; source `manual` |
| `attachWalletToPerson` | existing wallet only; explicit person and expected current membership; manual CAS move/link |
| `importPersonWallets` | staged bounded insert-only import described below |

Every mutation increments the shared Trench repository revision and emits one content-free
`trench/person-changed` event. Cursor reads fail with `CURSOR_STALE` after revision changes.

## Messy wallet-file import

The public production MCP adds one structured tool, `trench.person.import`. It never accepts a file
path, opens a local file, or exposes SQLite. The portable skill parses the human-supplied file and
calls the tool with normalized chunks. The exact MCP tool count becomes 13.

One import requires an explicit `chain` and explicit `walletKind: user`; EVM syntax alone never
chooses BSC or Robinhood. Each staged call carries stable `importId`, `requestId`, source SHA-256,
normalization version, chunk index/count/hash, at most 250 normalized rows, and `finalize` intent.
Rows contain canonical address, optional name, and optional `displayEmoji`; they never contain a
note unless a future schema explicitly adds one.

The hidden runtime stages exact chunks idempotently. Finalization requires every chunk and validates
the canonical whole-content hash, then publishes all live effects in one transaction:

- conflicting duplicate addresses reject the import; exact duplicates collapse deterministically;
- an existing global wallet with a person gains the explicit imported chain account when absent,
  but no wallet/person field is modified;
- an existing global wallet without a person gets the explicit chain account and one person
  membership, while all existing wallet
  metadata and notes remain byte-for-byte unchanged;
- a new address creates one global wallet, one explicit chain account, person, and membership;
  imported name/emoji use source
  `import` and may later be improved by GMGN/manual priority rules;
- equal names on different addresses never imply one person;
- retrying the same request/import content returns its receipt; same ID with different content
  fails closed.

The receipt contains only aggregate counts, hashes, revision, and replay state: no names or full
addresses. The supplied `message.txt` audit is 365,048 bytes and 3,120 unique valid EVM rows with
nonempty names and empty emoji values. Its chain remains an explicit caller decision.

## Errors and invariants

- Unknown fields, invalid chains/addresses, invalid X handles, over-limit strings/arrays, stale CAS,
  missing chunks, content-hash mismatch, or identity conflicts fail with typed, value-free errors.
- No person operation trades, signs, reads keys, or expands the existing GMGN credential bridge.
- Main, MCP, and visible renderer never import SQLite or execute SQL.
- The legacy JSON CA/Negative Wallet vault stays compatible. Its per-CA top-profit list remains 100;
  the SQLCipher INDEX/Trenchers registry is a distinct current workspace.
