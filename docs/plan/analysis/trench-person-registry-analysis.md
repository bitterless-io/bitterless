# BL Trench person registry delivery analysis

Status: Ready for serial delivery

## Decisions

- Final INDEX publication grows from 100 to 300 wallets per chain; the GMGN read remains Top 100
  candidates per target CA.
- One EVM address is one global wallet with multiple chain accounts; person identity is normalized
  independently of chain-account classification and profits.
- Every published INDEX user wallet has exactly one active person membership after the same commit.
- X/manual evidence can join wallets; equal names and transfers alone cannot.
- V1 person profit is explicitly `wallet-sum-v1`; exact transfer-aware FIFO needs a future complete
  chain-event ledger.
- Messy files are converted by the portable skill and imported through one staged, insert-only MCP
  tool. The API never accepts paths and never overwrites existing curated data.
- Per Ral, all 023–025 tasks use unit/type/static/migration/build gates plus independent review. No
  Electron E2E is run; standalone/Omni visual acceptance is handed to Ral.

## Module decomposition

| Module | Inputs | Outputs | Owner |
| --- | --- | --- | --- |
| INDEX policy v2 | eligible same-chain candidates | contiguous per-chain ranks `1..300` | Main normalizer + shared contract |
| Trench schema v3 | 019 SQLCipher schema | rank-300 constraints, person/import tables, preserved rows | hidden `trench-io` migration |
| Global wallet registry | provider/import address + chain | one address metadata row plus chain-specific account/classification | hidden `trench-io` preload |
| Person repository | wallet/profile/import commands | person pages/details/receipts and revision | hidden `trench-io` preload |
| Person orchestration | XPC/MCP unknown inputs | parsed private runtime calls, content-free events | Main |
| INDEX publication integration | published wallet IDs + GMGN metadata | one active membership each, deterministic X merge/conflict | hidden repository transaction |
| Module navigation | module/scope selection | INDEX chain or Trenchers viewport | coin renderer |
| Trenchers UI | person pages/details/mutations | master-detail human identity workspace | coin renderer |
| Import MCP | staged normalized chunks | atomic insert-only receipt | MCP bridge -> Main -> hidden runtime |
| Portable skill | local messy JSON file + explicit chain | deterministic chunks and verified import receipt | bundled skill |

## Integration enumeration

| Path | Required proof |
| --- | --- |
| Main analysis -> rank v2 | two or more targets can aggregate more than 100 unique eligible users and publish up to 300 per chain |
| 019 DB -> v3 migration | populated targets/runs/candidates/results survive; old current pointer remains readable; constraints become 900 total/300 per chain |
| chain-scoped wallet rows -> global wallet | equal cross-chain EVM addresses converge once, keep one account/result per chain, and preserve strongest metadata |
| fresh DB -> v3 + import ledger | exactly four immutable ledger identities exist in order: 018 `260807114211 initial-index-schema`, 019 `260811170011 chain-partitioned-index`, 023 `260813155644 global-wallet-person-registry`, 025 `260813155645 person-import-ledger`; exact tables/indexes/FKs pass audit and no predecessor identity is rewritten |
| completeRun -> person ensure | published rows and membership/profile/external identity changes share one rollback boundary |
| GMGN X -> person | identical canonical X joins uncurated people; curated collision records conflict without silent merge |
| visible XPC -> hidden runtime | Main validation reaches native repository with capability/instance fencing and no Main SQL |
| navigation -> INDEX | selected child drives both columns and Add dialog chain, without analysis on navigation |
| navigation -> Trenchers | person cursor reads and detail selection render without legacy JSON fallback |
| skill -> MCP import -> hidden DB | exact source becomes staged chunks, all chunks commit once, existing rows remain unchanged, receipt hashes reread |
| DB/person mutation -> visible views | content-free revision event causes a generation-fenced reread |

## Delivery sequence

1. [`trench-person-registry-023`](../tasks/trench-person-registry-023.md): migration, per-chain 300,
   person model, automatic INDEX membership, typed public/private repository API.
2. [`trench-trenchers-ui-024`](../tasks/trench-trenchers-ui-024.md): Arco module navigation and
   Trenchers master-detail UI using the 023 API.
3. [`trench-person-import-skill-025`](../tasks/trench-person-import-skill-025.md): staged MCP import,
   deterministic converter, portable skill update/install, and supplied-file fixture audit.

Tasks are serial on `dev/current`. Develop and Verify are distinct agents on the shared dirty
worktree; branch/worktree operations and DEBUG_PROD mutation are forbidden.
