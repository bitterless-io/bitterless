# Result: Trench INDEX Analysis

## Outcome

Trench now presents one count-free `INDEX` workspace backed by a dedicated hidden SQLCipher owner.
One Add command accepts 1–1000 CAs, resolves and deduplicates the complete batch before persistence,
atomically creates one full-target-set run, and publishes a deterministic global Top 100 only after
every target succeeds. Reanalyze remains a separate full-set command.

## Delivered

- Shared strict INDEX commands, receipts, snapshots, validation, revisions, and content-free change
  events, with the existing 12 `trench.*` MCP tools and legacy JSON repository unchanged.
- Explicit GMGN `token traders --order-by profit --direction desc --limit 100` reads, documented
  token-info normalization, wrong-chain empty-sentinel rejection, bounded evidence sanitization,
  and deterministic cross-CA ranking.
- Fail-closed global wallet classification: AMM/LP, exchange/custody, contract/program/system,
  bridge/router, treasury/vesting, provider non-user, and unknown identities remain audited but
  cannot enter INDEX. Any non-user evidence excludes that wallet across the complete run.
- One central `trench_wallets` registry for address, name, avatar, note, general metadata, wallet
  kind, classification source, and classification time. Module candidate/result tables reference
  only `wallet_id`; provider evidence contains no registry-owned identity or metadata fields.
- Independent `userData/trench/trench.db`, SQLCipher key policy, eight-table migration, transactional
  batch Add, idempotent receipts, orphan recovery, failed-run retention, atomic publication, and
  highest-market-cap value/provenance preservation.
- A fenced, hidden `trenchStorage` renderer/preload runtime with capability/instance checks,
  registration-race recovery, bounded restart, and visible unavailable recovery.
- Localized English/Chinese two-column UI with multiline batch Add, separate Reanalyze, current and
  highest market cap evidence, joined wallet ranking, accessible error states, and responsive
  standalone/Omni behavior.

## Verification

- PASS — `node tests/coin/run-unit.mjs`: `126/126` focused Coin/Trench unit tests.
- PASS — `node tests/coin/run-trench-index-unit.mjs`: `4/4` native SQLCipher repository tests.
- PASS — `node --test scripts/coin/trench-index-layout.test.mjs`: `5/5` renderer/process contracts.
- PASS — `yarn typecheck:node`, narrow Trench renderer `vue-tsc`, and `yarn check:renderer-i18n`.
  The stricter test-project node invocation is still blocked by the four pre-existing errors named
  in the independent review; no task-scoped failure is hidden or suppressed.
- PASS — `yarn audit:sqlite-migrations`: 11 Core + 7 Maestro + 10 Todoist + 3 Trench baselines.
- PASS — `node scripts/mcp/trench-contract.test.mjs`, the 12-tool MCP compatibility gate.
- PASS — `node tests/coin/trenchAgentGuide.test.mjs`: `6/6`; and
  `node --test tests/omni/trenchOmniEmbedding.test.mjs`: `6/6`.
- PASS — fresh `yarn build`, including `out/preload/trenchStorage.js` and
  `out/renderer/trenchStorage/index.html`.
- PASS — isolated read-only gmgn-cli `1.5.2` source smoke (no app/storage session) for Ral's five BSC fixtures:
  币安人生 `0x924fa68a0fc644485b8df8abfa0a41c2e7744444`, 哈基米
  `0x82ec31d69b3c289e541b50e30681fd1acad24444`, 龙虾
  `0xeccbb861c0dda7efd964010085488b69317e4444`, 币有
  `0xe9337dde3dd9e97f1f45a56412767ce5098e7777`, and MarsCoin
  `0xfe189e97832da1573e4e4ff034f4ffc3a15c7777`. All five returned the exact requested
  address and non-empty token identity. Each CA also returned 100 structurally valid trader rows for
  the exact `profit DESC, limit 100` request, in non-increasing profit order. Every wrong-chain probe
  returned the verified same-address empty sentinel and was rejected as `no-match`; wallet details
  and unstable live prices were not recorded.
- PASS — isolated DEBUG_DEV Electron E2E: one multiline BSC + Solana Add created two targets, one
  eligible wallet, one full-set run, and exact profit/descending/100 trader calls. Standalone
  1360×860 and Omni 800×568, 398×568, and 800×282 screenshots were inspected at original
  resolution with no body overflow, clipped required actions, or missing structured data.
- PASS — `git diff --check`.

No DEBUG_PROD process, profile, database, or MCP record was touched. All persisted test data used
temporary E2E/native-test directories and was removed by test cleanup.

## Review

- [`../reviews/trench-index-analysis-017-1.md`](../reviews/trench-index-analysis-017-1.md) — pass;
  no P1, P2, or P3 finding.
