# Result: Trench IO Hidden Runtime

## Outcome

The dedicated hidden Trench SQLCipher owner now has the exact `trench-io` runtime identity. Its
blank document and complete native preload implementation are colocated under
`src/renderer/trench-io/`; Main remains a lifecycle, capability, and orchestration boundary with no
SQLite import or SQL execution.

## Delivered

- Renamed the Main lifecycle/client/capability services, private XPC handler, shared runtime types,
  process arguments, startup diagnostic stage, safe-storage caller, and error prefixes to
  `trench-io` / `TrenchIo` conventions.
- Moved the SQLCipher database, migration, repository, key-envelope, and preload sources beside the
  CSP-locked empty document under `src/renderer/trench-io/`.
- Added explicit preload and renderer build targets for `out/preload/trench-io.js` and
  `out/renderer/trench-io/index.html`. A post-transform removes renderer-wide Monaco injection and
  fails the build if the hidden output gains a page script, stylesheet, image, frame, non-empty
  body, or loses its restrictive CSP.
- Preserved `userData/trench/trench.db`, `trench.key.bin`, schema version
  `260807114211`, every `trench_*` table/index/migration name, runtime data behavior, INDEX
  contracts, and all 12 public `trench.*` MCP tools.
- Extended the focused Electron INDEX acceptance to destroy and recover the hidden runtime, prove a
  new runtime instance can read the preserved snapshot, execute Reanalyze, and retain the target and
  wallet projections.

## Verification

- PASS — `node --test scripts/coin/trench-index-layout.test.mjs`: `8/8` exact identity, blank-page,
  preload-only native module, Main SQL exclusion, lifecycle, and 12-tool static contracts.
- PASS — `node tests/coin/run-unit.mjs`: `126/126` focused Coin/Trench unit tests.
- PASS — `node tests/coin/run-trench-index-unit.mjs`: `4/4` native SQLCipher repository tests after
  relocation.
- PASS — `yarn tsc -p tests/coin/tsconfig.trench-io.json`, `yarn typecheck:node`,
  `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json`,
  `yarn typecheck:sqlite-migrations`, and `yarn check:renderer-i18n`.
- PASS — `yarn audit:sqlite-migrations`: 11 Core + 7 Maestro + 10 Todoist sync + 3 Trench
  baselines.
- PASS — `node scripts/mcp/trench-contract.test.mjs`: exact 12-tool MCP compatibility.
- PASS — isolated DEBUG_DEV `yarn build`; the resulting blank
  `out/renderer/trench-io/index.html` and native `out/preload/trench-io.js` exist, with no obsolete
  `trenchStorage` / `trench-storage` output.
- PASS — `node --test tests/omni/trenchOmniEmbedding.test.mjs`: `6/6` after the fresh build.
- PASS — isolated DEBUG_DEV
  `playwright test -c tests/coin/playwright.config.ts tests/coin/specs/trench-index.spec.ts`: `1/1`;
  Add, persisted read, hidden-runtime replacement, Reanalyze, standalone, and Omni paths all pass.
- PASS — `git diff --check`.

The broader pre-existing strict project `yarn tsc -p tests/coin/tsconfig.trench-node.json` remains
blocked by the same four unrelated errors already recorded for task 017: one Codex credential
`.catch` type, one meme-analysis unknown-number assignment, and two Coin credential cancellation
union mismatches. The new strict `trench-io` boundary project passes without suppressions.

No DEBUG_PROD command, profile, application, database, or MCP record was touched. Builds and
Electron acceptance used only the repository's isolated `debug_dev` wrapper and temporary E2E data.

## Review

Independent Verify passed with no P1, P2, or P3 findings:
[`trench-io-runtime-018-1.md`](../reviews/trench-io-runtime-018-1.md).
