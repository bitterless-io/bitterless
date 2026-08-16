# Trench GMGN Electron argv compatibility result

## Outcome

The existing GMGN API key was valid. The failure was the Electron Node-mode argv shape used for
the already verified Yarn package entry. Main now executes that entry through one fixed bootstrap
so Commander identifies the entry as its script and parses only the unchanged allowlisted GMGN
arguments as user input.

No renderer, IPC, credential, storage, INDEX ranking, `trench-io`, or MCP contract changed.

## Implementation

- `GMGN_ELECTRON_NODE_BOOTSTRAP` is one fixed source constant:
  `process.execArgv=[]; process.defaultApp=true; import(process.argv[1])`.
- A verified Yarn env-node entry runs as
  `Electron --eval <fixed-bootstrap> <verified-entry> <original-args...>` with
  `ELECTRON_RUN_AS_NODE=1`.
- The verified absolute package entry is the first user argv. `--version`, the fixed read-only
  trending probe, token info, and profit-ranked token traders arguments follow without addition,
  removal, reordering, or rewriting.
- Native executables remain direct. Exact Yarn candidate/package/bin/shebang verification and
  unknown-script rejection are unchanged.
- Windows `.cmd` delegation is fail-closed: only the exact expected Yarn or npm candidate is
  considered, its bounded launcher must contain only the known scaffold and map to the exact
  package-declared real entry exactly once. The exact allowed `node_modules` installation root is
  realpathed first and anchors containment; relocating that parent root as one unit is allowed,
  while package-root or entry escape is rejected. Package name/bin, existence, and env-node
  shebang are rechecked. Blank, duplicate, malicious, unrelated, missing, and realpath-escaping
  mappings are rejected; native `.exe` execution remains direct.
- The sanitized child `PATH` remains byte-identical. No environment value other than
  `ELECTRON_RUN_AS_NODE` was added for the Electron-Node transport.

## Deterministic regression evidence

The unit fixture is a Yarn-style package/bin/symlink whose entry uses Commander
`program.parseAsync()`:

- the old Electron direct-entry shape rejects the nested fixed trending command with a process
  failure;
- the fixed bootstrap parses `--version` and the nested fixed trending command successfully;
- token info and token traders also execute through Commander;
- the fixture records exactly the original allowlisted arrays, including
  `--order-by profit --direction desc --limit 100 --raw`;
- assertions retain native direct execution, byte-identical PATH, the single allowed environment
  addition, and unknown env-node rejection.
- platform-independent Windows fixtures validate the exact Yarn candidate/package mapping and
  exact bootstrap/env request, then reject blank, extra-command, unrelated, missing, and
  duplicate or realpath-escaping launcher/package combinations without spawning a process. A
  positive fixture proves the allowed whole-parent installation-root relocation policy.

The Electron E2E fixture now uses the same Commander parsing behavior instead of reading only
`process.argv.slice(2)`. The existing standalone/Omni settings Verify, four-CA preservation,
explicit Add retry, INDEX rendering, no-secret screenshot, and network/renderer-error gates remain
covered.

## Real-provider smoke

A bounded local smoke used the installed verified package entry, the app Electron binary, exact
minimal desktop `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, the existing local GMGN credential, and only
the fixed read-only trending probe. The bounded evidence was:

```json
{"exit":0,"parseable":true,"code":0}
```

The response payload and stderr were redirected only to a temporary directory, were never printed,
and were deleted immediately after the status/code check. The key was never placed in argv,
stdout, logs, docs, test artifacts, or Trench storage. No Trench record or SQLite row was written.

## Verification

- PASS — `node tests/coin/run-unit.mjs`: 146/146, including the Windows launcher boundary.
- PASS — `node tests/coin/run-trench-index-unit.mjs`: 6/6 native repository integration.
- PASS — `node --test scripts/coin/trench-index-layout.test.mjs`: 12/12.
- PASS — `node --test scripts/mcp/trench-contract.test.mjs`: 1/1, exact 12-tool contract.
- PASS — `node --test tests/omni/trenchOmniEmbedding.test.mjs`: 6/6.
- PASS — Trench renderer `vue-tsc`, `yarn typecheck:node`, `yarn typecheck:mcp`, and
  `yarn check:renderer-i18n`.
- PASS — fresh isolated DEBUG_DEV
  `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn build`.
- PASS — isolated DEBUG_DEV
  `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn test:e2e:coin tests/coin/specs/trench-index.spec.ts --project electron`:
  1/1 expected in 33.3 seconds after the final Windows containment fix. The HTML report records `ok: true`, zero unexpected, zero flaky,
  zero skipped, and no errors.
- PASS — `git diff --check` for the task path.
- INFO — the stricter focused `tsc --noEmit -p tests/coin/tsconfig.trench-node.json` remains blocked
  by four pre-existing dirty-worktree type errors outside task 021: one Codex credential `never`
  catch, one meme-analysis unknown numeric metric, and two Coin resource cancellation-union errors.
  The project build and authoritative Node typecheck both pass.

All build and Electron acceptance used DEBUG_DEV. The running DEBUG_PROD application, profile,
database, MCP server, and Trench records were not stopped, restarted, read through test fixtures,
or modified.
