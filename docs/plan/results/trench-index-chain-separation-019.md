# Result: Trench INDEX Chain Separation

## Outcome

Trench INDEX now treats chain as an explicit end-to-end partition while preserving one full-target
analysis run and one atomic publication. Solana and BSC each own an independent top-100 rank range,
the hidden SQLCipher runtime migrates 018 data without loss, and the workspace exposes only ordered
v2 chain projections.

## Delivered

- Replaced global INDEX ranking with deterministic per-chain aggregation, five-key sorting, and
  contiguous `chainRank` values `1..100`. Candidate evidence assigned to a different target chain
  now fails closed.
- Added `chain` and `chain_rank` to `trench_index_wallets` with unique
  `(run_id, chain, chain_rank)`. The monotonic `260811170011` migration preserves current and
  historical 018 rows, derives chain through the central wallet registry, and reranks each run and
  chain from stored metrics. Fresh and upgraded databases share the same asserted schema and two-row
  migration ledger.
- Published `bl-trench-index-workspace-v2` as ordered SOL, BSC, and conditional Robinhood
  projections. Runtime validation enforces exact required keys at both the workspace and projection
  levels, rejecting v1, mixed legacy flat arrays, unknown fields, reordered or duplicate projections,
  wrong-chain rows, and non-contiguous or over-100 rank partitions.
- Added keyboard-accessible SOL/BSC/RHC tabs inside the existing 32px INDEX row. One local selection
  synchronously filters both columns; SOL uses `#14b887`, BSC uses `#c89500`, and Robinhood remains
  hidden until data exists. `Reanalyze all` still analyzes every active target; Header Refresh stays
  a local reread.
- Scoped Add CA to the selected tab. Mixed paste drops structurally recognizable opposite-chain
  rows with a localized live count and submits retained rows with an explicit selected chain.
  All-wrong-chain input retains the dialog, reports no valid CA for that tab, and creates no
  XPC/provider/storage request. Ignored rows never route to another tab.
- Preserved the preload-only SQLCipher boundary, central `trench_wallets` registry, `trench.db`
  path/key, existing tables and data, and the exact 12 public `trench.*` MCP tools.

The frontend-design review was applied as a constraint audit: it retained the locked two-column
composition and palette, added only the specified 2px chain rails, and confirmed the tab/action/status
controls remain readable without overflow at every accepted standalone and Omni geometry.

## Verification

- PASS — `node tests/coin/run-unit.mjs`: `131/131`, including independent BSC/Solana `#1..#100`,
  deterministic ties, exact-key v2 acceptance, v1/mixed-flat/unknown-projection/rank rejection,
  wrong-chain Add partitioning, explicit selected-chain submission, and exact zero boundary calls
  for all-wrong input.
- PASS — `node tests/coin/run-trench-index-unit.mjs`: `6/6` native SQLCipher repository tests,
  including wrong-chain atomic rejection and current plus historical 018 upgrade row preservation.
- PASS — `node --test scripts/coin/trench-index-layout.test.mjs`: `11/11` UI, a11y, i18n, v2,
  schema, preload-only native module, hidden-runtime identity, and exact 12-tool static contracts.
- PASS — `yarn audit:sqlite-migrations`: 11 Core + 7 Maestro + 10 Todoist sync + 4 Trench
  baselines, including fresh/current/idempotent and 018 upgrade convergence.
- PASS — `yarn typecheck:sqlite-migrations`,
  `yarn tsc -p tests/coin/tsconfig.trench-io.json --noEmit`, and
  `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false`.
- PASS — `yarn check:renderer-i18n`, `node scripts/mcp/trench-contract.test.mjs`, and
  `node --test tests/omni/trenchOmniEmbedding.test.mjs` (`6/6`).
- PASS — isolated DEBUG_DEV `yarn build`; version info carries `260811170011`, and the build contains
  the CSP-empty `out/renderer/trench-io/index.html` plus native `out/preload/trench-io.js`.
- PASS — isolated DEBUG_DEV
  `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn playwright test -c tests/coin/playwright.config.ts tests/coin/specs/trench-index.spec.ts`:
  `1/1`. It proves both wrong-chain warning/no-call directions, mixed filtering, explicit selected-chain
  Add, each chain's matching target and `#01` wallet, call-free tab switching, full-set Reanalyze,
  hidden-runtime recovery, and overflow-free standalone/Omni rendering.
- PASS — visual inspection of `out/playwright/coin/screenshots/trench-index-standalone-1360x860.png`,
  `trench-index-omni-800x568.png`, `trench-index-omni-398x568.png`, and
  `trench-index-omni-800x282.png`.
- PASS — `git diff --check`.

The broad existing `yarn typecheck:web` remains blocked by unrelated connector SDK contracts,
missing poker test globals, legacy Home/Omni aliases, OnlyPreview nullability, and shared utility
errors. The broad strict `yarn tsc -p tests/coin/tsconfig.trench-node.json --noEmit` likewise retains
the four pre-existing Codex credential, meme-analysis, and Coin credential-union errors documented
by task 018. All focused 019 type projects pass without suppressions.

No DEBUG_PROD command, profile, application, database, or MCP record was touched. Build and Electron
acceptance used only the isolated `debug_dev` wrapper and temporary E2E data.

## Review

Independent Verify passed with no open P1, P2, or P3 findings. One mixed-shape parser defect found
during Verify was fixed and independently reproduced as rejected before final acceptance:
[`trench-index-chain-separation-019-1.md`](../reviews/trench-index-chain-separation-019-1.md).
