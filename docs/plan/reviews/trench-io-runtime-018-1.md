# Review: trench-io-runtime-018

## Findings

- **P1 · blocking:** None.
- **P2 · blocking:** None.
- **P3 · non-blocking:** None.

## Contract evidence

- `src/renderer/trench-io/` contains the complete native owner implementation: the blank document,
  preload, SQLCipher connection, migration, repository, and protected-key service. The obsolete
  `src/preload/trenchStorage/` and `src/renderer/trenchStorage/` directories do not exist.
- `src/renderer/trench-io/index.html:1-14` has `default-src 'none'`, `base-uri 'none'`,
  `form-action 'none'`, `frame-src 'none'`, and `object-src 'none'`; its body is empty and it has no
  script, link, style, image, iframe, or renderer bridge.
- `electron.vite.config.ts:186-203,426,473,519` binds the exact `trench-io` preload and renderer
  entries and post-validates the built document. The fresh isolated output is a 299-byte blank page
  plus `out/preload/trench-io.js`; searches found no obsolete `trenchStorage` or `trench-storage`
  source/output identifier.
- `src/renderer/trench-io/trenchIo.database.ts:1-87` is the only `trench-io` source importing
  `better-sqlite3-multiple-ciphers`. `src/main/**` has no import of that driver, and the empty HTML
  executes no SQL or page code. The BrowserWindow in
  `src/main/trench/trenchIoWindow.service.ts:62-79` retains `sandbox:false`,
  `contextIsolation:true`, `nodeIntegration:false`, and `webSecurity:true`.
- `src/main/trench/trenchIoWindow.service.ts:17-169`,
  `src/main/xpc/trenchIoSystem.handler.ts:10-39`, and
  `src/shared/trench/trenchIndex.type.ts:258-300` consistently use `trench-io` / `TrenchIo` for the
  document, preload, arguments, private XPC handler, capability/instance contract, errors, and
  runtime handler. `src/main/app.main.ts:507-508` and
  `src/shared/startup/startupDiagnostics.ts:3-12` use the exact `trench-io` startup identity.
- The lifecycle still denies popups, fences navigation and redirects, revokes the old capability,
  broadcasts unavailable state, and performs bounded 250/1000/3000 ms restart attempts. The
  focused Electron test destroys the live hidden window, observes a different runtime instance,
  rereads the prior snapshot, and completes Reanalyze.
- `src/renderer/trench-io/trenchIo.database.ts:15-23` preserves
  `userData/trench/trench.db` and `trench.key.bin`.
  `src/renderer/trench-io/trenchIo.migration.ts:3-59` preserves schema version
  `260807114211` and all `trench_*` table/index identities; the native repository suite proves
  existing transaction, recovery, and publication behavior after relocation.
- `src/shared/trench/trenchMcp.schema.ts:170-299` still defines exactly the legacy 12 public
  `trench.*` tools. Both the static exact-name assertion and the executable MCP contract passed.

## Verification evidence

- PASS — `node --test scripts/coin/trench-index-layout.test.mjs`: 8/8.
- PASS — `node tests/coin/run-unit.mjs`: 126/126.
- PASS — `node tests/coin/run-trench-index-unit.mjs`: 4/4 native SQLCipher repository tests.
- PASS — `yarn tsc -p tests/coin/tsconfig.trench-io.json`.
- PASS — `yarn typecheck:node` and
  `yarn vue-tsc --noEmit -p tests/coin/tsconfig.trench-renderer.json --composite false`.
- PASS — `yarn typecheck:sqlite-migrations`, `yarn check:renderer-i18n`, and
  `yarn audit:sqlite-migrations`: 11 Core + 7 Maestro + 10 Todoist sync + 3 Trench baselines.
- PASS — `node scripts/mcp/trench-contract.test.mjs`: exact 12-tool contract.
- PASS — `node --test tests/omni/trenchOmniEmbedding.test.mjs`: 6/6.
- PASS — `git diff --check`.
- PASS — fresh isolated DEBUG_DEV `yarn build` in
  `/tmp/bitterless-trench-io-verify.YHtt9i`. Post-build inspection found only
  `out/preload/trench-io.js` and `out/renderer/trench-io/index.html` for this runtime, verified the
  empty CSP document, and found no obsolete path or process identifier in built Main/preload/
  renderer output.
- PASS — isolated DEBUG_DEV
  `yarn test:e2e:coin tests/coin/specs/trench-index.spec.ts --project electron`: 1/1. It covered
  Add, persisted read, hidden-runtime replacement/recovery, Reanalyze, and standalone/Omni layouts.
- The first direct internal E2E invocation was rejected before Electron launch because it did not
  inherit the selected runtime profile. The public `test:e2e:coin` DEBUG_DEV wrapper then passed;
  this was a verification invocation mismatch, not a product failure.

## Existing unrelated issue

`yarn tsc -p tests/coin/tsconfig.trench-node.json` remains blocked by four pre-existing errors
outside task 018: `src/main/codex/codexCredential.service.ts:794`,
`src/main/coin/data/memeAnalysis.normalize.ts:967`, and
`src/main/coin/resources/coinResource.service.ts:97,111`. The dedicated strict `trench-io` project
passes without suppressions, so these errors do not reduce confidence in this runtime migration.

## Safety

The build and Electron test ran only in the isolated `debug_dev` copy. No command targeted the
running DEBUG_PROD application, profile, database, or MCP server; DEBUG_PROD application processes
were still present after verification.

## Conclusion

**pass** — the native owner is fully relocated and renamed to `trench-io`, its page is inert and
CSP-locked, SQLCipher remains preload-only, storage compatibility and recovery are preserved, and
the public 12-tool Trench surface is unchanged.
