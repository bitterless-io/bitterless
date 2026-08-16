# Review: trench-index-chain-separation-019

## Findings

- **P1 · blocking:** None open.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

## Resolved during Verify

- The first runtime probe found that `parseTrenchIndexWorkspaceSnapshot` accepted valid v2
  `chainProjections` together with obsolete top-level `targets` and `wallets`. That was a blocking
  parser-contract defect. During Verify, Develop added exact required-key validation at the
  workspace and projection boundaries in
  `src/shared/trench/trenchIndex.validation.ts:39-48,118-177` plus regression fixtures in
  `tests/coin/unit/trenchIndex.validation.test.ts`. I independently rebuilt the parser and reran the
  probe against the corrected shared tree: mixed-both, targets-only, wallets-only, and an unknown
  projection field all returned `REJECTED` with the expected unknown-field errors. The final focused
  unit suite also passed, so this finding is resolved and is not open in the disposition above.

## Contract evidence

- `src/renderer/trench-io/trenchIo.migration.ts:3-4,215-335,412-421` advances the Trench ledger from
  `260807114211` to monotonic `260811170011`. The 018→019 transaction copies every run column,
  derives chain by joining the central wallet registry, copies every result metric, and computes
  deterministic `ROW_NUMBER()` ranks partitioned by run and chain. The repository-state row and all
  untouched history/snapshot/candidate tables retain their rows; database reopen runs both
  `integrity_check` and `foreign_key_check`. Fresh and upgraded databases assert the same columns,
  indexes, and two-entry ledger.
- The result table stores only `run_id`, `wallet_id`, chain-local rank, and metrics. Its rank range is
  `1..100`, the run publication cap is 300, and the unique rank index is
  `(run_id, chain, chain_rank)`. Address, name, avatar, note, metadata, wallet kind, and
  classification remain solely in `trench_wallets`; the static audit rejects their duplication in
  candidate or result tables.
- `src/main/coin/index/trenchIndex.normalize.ts:516-594` rejects wrong-chain candidate evidence,
  aggregates by chain-qualified identity, applies the exact five deterministic sort keys, slices
  each chain to 100, and assigns `chainRank` from 1. Unit fixtures executed independent full BSC and
  Solana top-100 partitions, deterministic ties, cross-chain separation, and global fail-closed
  non-user exclusion.
- `src/renderer/trench-io/trenchIo.repository.ts:291-353,458-586` always emits ordered SOL then BSC
  projections and conditionally RHC, rejects target/candidate chain mismatch before mutation,
  enforces at most 300 total and contiguous per-chain ranks, requires eligible central-registry user
  evidence, and completes the full active-target run in one transaction. The native suite exercised
  wrong-chain atomic failure retention and a populated current/history 018 upgrade.
- `src/shared/trench/trenchIndex.validation.ts:118-177` accepts only the exact v2 workspace and
  exact projection shapes; it rejects v1, mixed legacy flat fields, missing/unknown fields,
  reordered/duplicate projections, wrong-chain rows, rank gaps/duplicates, and partitions over 100.
- `src/renderer/coin/src/components/TrenchIndexWorkspace/TrenchIndexWorkspace.vue:3-18,67-121`
  implements one keyboard-operable tablist whose local selection drives both headers, lists, ranks,
  and empty states. `TrenchIndexWorkspace.less:10-58,140-144` keeps the selector in the existing
  32px white INDEX row and limits chain accents to the selected 2px SOL `#14b887` or BSC `#c89500`
  rails. Tab clicks mutate only the local ref; no storage/client/provider call is present.
- `src/renderer/coin/src/views/index/trenchIndexAddInput.ts:13-52` partitions pasted rows before the
  command boundary and emits only explicit selected-chain targets. The component returns with
  `done(false)` before `store.addTarget` when every entry is wrong-chain. Unit, static, and Electron
  tests covered exact opposite-chain counts in both directions, mixed retention, localized English
  and Chinese warning strings, no-call all-wrong input, and the retained modal error.
- `Reanalyze all` still executes the single full active set; Trench Header Refresh calls only
  `trenchIndexStore.refresh()`. SQLCipher remains imported only by
  `src/renderer/trench-io/trenchIo.database.ts`; the paths remain
  `userData/trench/trench.db` and `trench.key.bin`. The exact legacy 12 public `trench.*` tools pass
  both static and executable MCP contract checks.

## Verification evidence

- PASS — corrected bundled-runtime parser probe built with
  `./node_modules/.bin/esbuild src/shared/trench/trenchIndex.validation.ts --bundle --platform=node
  --format=cjs --alias:@shared=./src/shared --outfile=/tmp/trench-parser-check-019.cjs`; all four
  mixed/unknown-field variants were rejected.
- PASS — `node tests/coin/run-unit.mjs`: 131/131.
- PASS — `node tests/coin/run-trench-index-unit.mjs`: 6/6 native SQLCipher repository tests.
- PASS — `node --test scripts/coin/trench-index-layout.test.mjs`: 11/11.
- PASS — `yarn typecheck:sqlite-migrations`,
  `yarn tsc -p tests/coin/tsconfig.trench-io.json --noEmit`, and
  `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false`.
- PASS — `yarn audit:sqlite-migrations`: 11 Core + 7 Maestro + 10 Todoist sync + 4 Trench
  baselines, including fresh/current/idempotent reopen and 018 upgrade convergence.
- PASS — `yarn check:renderer-i18n`, `node scripts/mcp/trench-contract.test.mjs`, and
  `node --test tests/omni/trenchOmniEmbedding.test.mjs` (6/6).
- PASS — `git diff --check`.
- PASS — fresh isolated DEBUG_DEV `yarn build` in
  `/tmp/bitterless-chain-verify-019.FWlwDj`; built version metadata is `0.0.69 / 260811170011`, the
  hidden page is the 299-byte CSP-empty document, and `out/preload/trench-io.js` exists.
- PASS — isolated DEBUG_DEV
  `yarn test:e2e:coin tests/coin/specs/trench-index.spec.ts --project electron`: 1/1. The executed
  flow proved dual-direction wrong-chain warning/no-provider-call behavior, mixed filtering,
  explicit-chain Add, independent SOL/BSC `#01`, call-free switching, full-set Reanalyze,
  `trench-io` restart/recovery, and zero document overflow in all accepted geometries.

## Visual inspection

Fresh screenshots inspected at original resolution:

- `trench-index-standalone-1360x860.png` — BSC selection, two synchronized BSC columns and `#01`;
  module row, actions, status, rails, and content remain aligned with no clipping.
- `trench-index-omni-800x568.png` — SOL selection, two synchronized SOL columns and `#01`; both
  actions and status remain reachable.
- `trench-index-omni-398x568.png` — SOL/BSC tabs remain fully visible; actions fit, status wraps to
  its own line, and the target/wallet columns stack without horizontal overflow or clipped content.
- `trench-index-omni-800x282.png` — the compact-height two-column layout retains both headers,
  actions, status, rank, address, profit, and target metrics without clipping. The E2E DOM checks
  measured both horizontal and vertical document overflow as zero for every screenshot geometry.

## Existing unrelated type failures

- `yarn typecheck:web` still fails outside task 019 in connector SDK drift, poker test globals,
  legacy Home/Omni aliases and window bridges, Home chat contracts, OnlyPreview nullability, and
  shared utility contracts. No error is in the Trench INDEX files, and the dedicated renderer and
  migration type projects pass.
- `yarn tsc -p tests/coin/tsconfig.trench-node.json --noEmit` still reports the four pre-existing
  task-018 errors at `src/main/codex/codexCredential.service.ts:794`,
  `src/main/coin/data/memeAnalysis.normalize.ts:967`, and
  `src/main/coin/resources/coinResource.service.ts:97,111`. No suppression was added.

## Safety

All build and Electron acceptance work ran in the isolated `debug_dev` copy. No command targeted or
wrote the DEBUG_PROD application, profile, database, or MCP; its application process was present
before and after verification. The isolated copy was byte-identical to the final shared 019 source
and E2E files when the acceptance run completed.

## Conclusion

**pass** — no open P1/P2/P3 finding remains. Chain partitioning is enforced through ranking,
SQLCipher storage/migration, exact v2 parsing, Add routing, and the responsive UI while preserving
one atomic full-set analysis, preload-only native ownership, existing data paths, and the 12-tool MCP
surface.
