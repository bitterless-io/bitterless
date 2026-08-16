# Review: trench-person-import-skill-025

- Scope: current `dev/current` worktree paths owned by task 025
- Date: 2026-08-13
- Review state: fresh re-verification pass after Develop remediation

## Findings

None.

## Resolved findings

1. **Resolved · P2 — The portable converter accepted Base58 strings that were not 32-byte Solana
   addresses, then emitted chunks rejected by the public import parser.** The original disposable
   reproduction used `'z'.repeat(44)`, which decodes to 33 bytes but was emitted with exit status 0.
   The converter now decodes Base58, requires exactly 32 bytes, and requires exact canonical
   re-encoding before emitting a Solana row
   (`skills/bitterless-trench/scripts/convert-person-import.mjs:11-13,68-105`). The fresh CLI
   regression accepts both a 32-zero-byte canonical address and the canonical wrapped-SOL address,
   while rejecting 31-byte, 33-byte, and the original 33-byte `z` boundary
   (`scripts/mcp/trench-person-import-converter.test.mjs:109-140`). All three installed skill trees
   are byte-identical to the corrected source.

2. **Resolved · P2 — The canonical person-registry docs declared only 018/019/023 while task 025
   implemented a four-entry 018/019/023/025 immutable ledger.** The feature now names all four exact
   version/name identities in order and states that fresh databases apply all four while upgrades
   append 025 without rewriting history (`docs/features/trench-person-registry.md:68-77`). The
   delivery analysis independently repeats the exact four identities and no-predecessor-rewrite
   invariant (`docs/plan/analysis/trench-person-registry-analysis.md:37-43`). No stale three-entry
   wording remains in either canonical context document.

3. **Resolved · P2 — `tools/list` advertised `displayEmoji.maxLength: 32` while the parser and
   converter enforced 16 Unicode code points.** The public schema now exposes 16, matching the
   unchanged shared parser and converter (`src/shared/trench/trenchMcp.schema.ts:353-365`;
   `src/shared/trench/trenchPerson.validation.ts:204-217`). The fresh MCP contract asserts the
   exposed bound, accepts exactly 16 astral emoji code points through the real bridge parser, and
   rejects 17 (`scripts/mcp/trench-contract.test.mjs:222-270`).

## Contract evidence

- The hidden `trench-io` repository owns all task-025 SQL. Main validates and forwards through the
  capability/instance-fenced client and contains no SQL or SQLite import. The hidden preload parses
  the request again before calling the repository.
- One repository transaction covers staging and finalization. It verifies per-chunk hash and exact
  content, enforces contiguous ascending chunks, binds import/request/source identities to one
  envelope, rehashes all stored chunks, checks row count and whole-content hash, rejects conflicting
  duplicates, publishes live rows, bumps revision, and records the completed receipt in the same
  transaction (`src/renderer/trench-io/trenchIo.repository.ts:772-907`). Exact completed replay
  returns the stored aggregate receipt without another revision.
- Publication uses global `evm` versus `solana` wallet identity. Missing explicit chain accounts are
  allowed; existing wallet/account/person/membership bytes are not updated; equal names on distinct
  addresses create distinct people (`src/renderer/trench-io/trenchIo.repository.ts:1832-1902`).
- Main emits one revision-only `trench/person-changed` event only for a newly completed, non-replayed
  finalize (`src/main/trench/trenchPersonImport.service.ts:16-29`). Receipts and events contain no
  imported row content.
- The bridge/schema expose exactly one new `trench.person.import` route and 13 total `trench.*`
  tools. Input fields are closed with `additionalProperties: false`; there is no path or raw-source
  property. The skill keeps only the production MCP dependency named `bitterless`.
- The source skill and additive `.agents`, `.claude`, and `~/.codex` copies each contain the same
  seven files and are byte-identical under `diff -qr`; each declares version `260813155645` and
  includes the OpenAI metadata plus import tool/schema/workflow references.

## Verification evidence

- `node tests/coin/run-trench-index-unit.mjs` — **pass**, 21/21 native SQLCipher tests, including
  ordered staging, atomic rollback, replay, same-name separation, missing-account insertion,
  byte-preserving existing-wallet/person paths, and cross-chain global EVM identity.
- `node --test scripts/mcp/trench-person-import-converter.test.mjs` — **pass**, 4/4 in fresh
  re-verification, including valid canonical Solana addresses plus explicit 31-byte, 33-byte, and
  original `z`-boundary rejection. The supplied aggregate remains 3,120 rows / 13 chunks.
- `node scripts/mcp/trench-contract.test.mjs` — **pass** in fresh re-verification, including exact
  13-tool order, closed import input, no path argument, aggregate receipt, exact 16-code-point schema
  bound, 16 astral code points accepted, and 17 rejected.
- `yarn audit:sqlite-migrations` — **pass**, including fresh/current, 018/019 upgrades and
  fail-closed partial, future, missing-predecessor, unknown-lower, and wrong-identity baselines.
- Independent disposable 023 fixture — **pass**. A clean exact 018/019/023 database upgraded to the
  exact four-entry 018/019/023/025 ledger. A second 023 fixture with one row in the reserved
  pre-release import table rejected 025 with the expected fail-closed error while retaining the
  three-entry ledger and original row unchanged.
- `node tests/coin/run-unit.mjs` — **pass**, 171/171, including exact shared import validation.
- `yarn tsc -p tests/coin/tsconfig.trench-io.json --noEmit`, `yarn typecheck:mcp`, and
  `yarn typecheck:sqlite-migrations` — **pass**.
- `node --test scripts/coin/trench-index-layout.test.mjs` — **pass**, 18/18, including one hidden
  SQL owner, Main no-SQL boundary, exact migration identities, and exact 13-tool order.
- `yarn tsc -p tests/coin/tsconfig.trench-node.json --noEmit` — **baseline blocked** by four
  unrelated existing errors in `codexCredential.service.ts`, `memeAnalysis.normalize.ts`, and
  `coinResource.service.ts`. The focused hidden-runtime, MCP, migration, native, and build gates
  above are green and none of the four errors is in the task-025 import paths.
- Original disposable converter probe — **captured the resolved baseline**: exit status 0, chunk
  emitted, encoded length 44, decoded payload length 33 bytes. The corrected fresh CLI regression
  now rejects that same value and the temporary source/output directory was removed.
- `diff -qr` from `skills/bitterless-trench` to all three installed trees — **pass**.
- Strict JS-YAML parsing across source plus all three installed skill trees — **pass** for
  frontmatter, OpenAI sidecar, version `260813155645`, `$bitterless-trench` prompt, and sole
  production `bitterless` MCP dependency.
- Bounded task-source credential-material scan — **pass**. The exported-skill test separately
  scans all seven source/ZIP entries and also passed.
- Supplied read-only `/Users/ral/Downloads/message.txt` converter fixture — **pass** through the CLI
  test at 3,120 rows, 13 chunks, 3,120 named rows, and zero emoji rows; the asserted aggregate
  output contained no full address, generated temporary files were deleted, and no import ran.
- Pre-remediation `yarn build` baseline — **pass** under the repository DEBUG_DEV wrapper at version
  code `260813155645`; Main, Trench preload, hidden `trench-io` preload/page, and renderer bundles
  were produced. The focused fresh re-verification did not rerun that unchanged build gate.
- `node --test scripts/mcp/trench-skill-export.test.mjs` and `yarn typecheck:mcp` — **pass** after
  remediation.
- Exact four-identity documentation scan, three-tree `diff -qr`, and `git diff --check` — **pass**
  after remediation.

## Safety and scope

- No Electron/browser E2E, browser automation, screenshot, live provider, live application DB,
  MCP import, or production record operation ran.
- `bitterless-debug-prod` / DEBUG_PROD was not read, stopped, restarted, written, or otherwise
  touched. Native and converter probes used disposable synthetic fixtures only.
- This Verify delivery changes only this review file. It does not modify product source, task,
  result, README, skill, or another review, and it preserves unrelated dirty worktree changes.

## Conclusion

**pass** — all three original P2 findings are resolved. The converter and MCP parser now share the
same canonical Solana and 16-code-point boundaries, the canonical docs preserve the exact ordered
018/019/023/025 ledger, and the corrected source is synchronized to every installed skill tree.
Task 025 is deliverable within its explicit no-E2E/no-live-import boundary.
