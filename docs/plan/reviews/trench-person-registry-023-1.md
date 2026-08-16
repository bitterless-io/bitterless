# Review: trench-person-registry-023

## Findings

None.

## Resolved findings

- **Resolved · P2 — Wallet-level manual/agent/mixed provenance did not fence an X merge when the
  curated wallet had no name/avatar.** The original failing case was a `mixed` wallet with null
  name/avatar and only curated note/metadata: after a later shared-X observation it was silently
  merged with no conflict. `ensurePublishedPerson` now treats wallet metadata source and any
  manual/agent/mixed chain-account classification as explicit curated evidence, suppresses GMGN
  name/avatar enrichment for that blank profile, and creates an independent person on a first
  already-owned-X collision (`src/renderer/trench-io/trenchIo.repository.ts:1245-1317,1348-1397`).
  Existing-person collision checks now also traverse memberships to manual/agent link source,
  manual/agent/mixed wallet metadata source, and manual/agent/mixed chain-account source
  (`src/renderer/trench-io/trenchIo.repository.ts:1426-1455`). The open-conflict natural key plus
  `INSERT OR IGNORE` keeps repeated evidence at one deterministic conflict while preserving the
  original membership. Native regressions cover blank manual note-only, agent metadata-only, and
  mixed note+metadata wallets through a later shared-X collision; direct first-publication
  curated-chain-account collision; manual/agent membership fences; and the control case where two
  uncurated system/GMGN people still merge (`tests/coin/unit/trenchIo.repository.test.ts:897-1199,
  1301-1492`).

- **Resolved · P2 — A partial/unknown migration ledger was accepted as current instead of failing
  closed.** The migration now validates every row against the exact ordered 018/019/023
  version/name manifest and monotonic timestamps before applying schema work
  (`src/renderer/trench-io/trenchIo.migration.ts:1018-1041,1122-1152`). Focused audit cases reject a
  missing predecessor, unknown lower row, wrong identity, and future row without repository
  mutation.
- **Resolved · P2 — 019→023 upgrades left existing published INDEX wallets without people.** The
  migration now selects distinct global wallets represented by the current run's published `user`
  accounts and deterministically inserts one anonymous person/membership per wallet in the same
  transaction (`src/renderer/trench-io/trenchIo.migration.ts:889-917`). Native coverage confirms a
  same-EVM BSC/Robinhood wallet converges to one membership while current/historical data, results,
  candidates, revision, and current pointer survive.
- **Resolved · P2 — X evidence remained in wallet metadata and lost relation-owned display
  evidence.** New normalization retains X as typed candidate evidence rather than wallet metadata;
  repository guards reject person-owned aliases in wallet metadata. The external-identity row now
  stores canonical value, original display spelling, GMGN source, and bounded target/rank/time
  evidence. The 019 migration recursively strips supported legacy aliases, migrates valid current
  user evidence with its legacy source, and transactionally rejects invalid/conflicting aliases
  (`src/main/coin/index/trenchIndex.normalize.ts:360-371,492-511`;
  `src/renderer/trench-io/trenchIo.migration.ts:706-810,919-975`).

## Contract evidence

- **INDEX limits stay separated.** The shared validation and normalization paths keep the final
  published ceiling at 300 wallets per chain / 900 across SOL+BSC+Robinhood, while the provider
  source fetch, source-rank, and legacy CA Top100 contracts remain capped at 100. Focused unit
  coverage exercises both the 300-result publication boundary and the source Top100 boundary.
- **Global wallet and chain-account identity is implemented.** The current schema makes
  `(namespace, canonical_address)` the global wallet identity and `(wallet_id, chain)` the account
  identity. Candidate and result foreign keys terminate at `trench_wallet_chain_accounts`, and the 019
  copy/remap path preserves candidate/result rows, run history, metrics, and the current pointer.
  Current published eligible-user wallets are now backfilled once per global wallet.
- **The new-run publication path is transactional and eligibility-gated.** `completeRun` performs
  result publication and person ensure work inside its repository transaction, and its person
  ensure loop is sourced from published eligible `user` results rather than every candidate. The
  current implementation also keeps person mutations behind the hidden `trench-io` boundary and
  emits a content-free invalidation event after successful mutation.
- **Person APIs implement the requested concurrency and tenant boundary.** Shared request
  validation, the Main-to-hidden client, and the repository cover list/get/update/attach, opaque
  cursor pagination, revision compare-and-swap, and tenant-scoped lookups. Static review found no
  direct SQLite/SQL access in Main; schema, migration, query, and transaction ownership remain in
  the hidden renderer.
- **023 does not expand the later UI/import/MCP scope.** No Trenchers UI or messy-data import
  behavior is exposed by this delivery. The legacy MCP contract test still exposes exactly the
  same 12 `trench.*` tools.

## Verification evidence

Final targeted reverify checks are complete; none remain running.

- `node tests/coin/run-unit.mjs` — **pass**, 153/153.
- `node tests/coin/run-trench-index-unit.mjs` — **pass**, 17/17 against native SQLCipher. The new
  cases cover all curated-evidence categories, direct and later X collisions, blank-profile
  enrichment fences, stable membership/conflict ownership, and the uncurated merge control.
- `node --test scripts/coin/trench-index-layout.test.mjs scripts/mcp/trench-contract.test.mjs` —
  **pass**, 15/15; the MCP assertion confirms exactly 12 legacy tools.
- `yarn typecheck:sqlite-migrations` — **pass**.
- `yarn audit:sqlite-migrations` — **pass**, including eight Trench baselines for fresh/current,
  018/019 upgrade, partial pre-ledger, future, missing predecessor, unknown lower row, and wrong
  identity cases.
- `yarn tsc -p tests/coin/tsconfig.trench-io.json --noEmit` — **pass**.
- `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false` — **pass**.
- `yarn check:renderer-i18n` — **pass**.
- `git diff --check` — **pass**.
- The formerly failing mixed-provenance scenario now passes inside the native suite with two active
  people, zero merged people, one open conflict, unchanged membership, unchanged wallet-local
  note/metadata, and no copied person fields.

A fresh isolated DEBUG_DEV build was not rerun for this final targeted reverify, per the explicit
focused native/repository/type/static boundary. The initial independent verification already passed
an isolated DEBUG_DEV build at version code `260813155644`.

The broad repository Node compile was also sampled. It is not green because of four unrelated
existing errors in `codexCredential.service.ts`, `memeAnalysis.normalize.ts`, and
`coinResource.service.ts`; none is in the 023 Trench person-registry diff or masks a focused 023
compile failure.

## Safety and scope

- No Electron or browser E2E was run.
- No live provider, live application database, or production record was read or mutated.
- `bitterless-debug-prod` / DEBUG_PROD was not touched. Native probes used disposable encrypted test
  databases only.
- This review changed only this review file; it did not modify product source, the task, result,
  README, or another review.

## Conclusion

**pass** — all four original P2 findings are resolved. The final curated-evidence fence preserves
blank manual/agent/mixed wallets and memberships across both direct and later X collisions, while
the uncurated automatic merge remains intact. Task 023 is ready for the parent workflow's completion
gate; this review does not claim the separately deferred Trenchers UI/import work or owner runtime
acceptance.
