# Review: trench-gmgn-electron-argv-021

## Findings

- **P1 · blocking:** None open.
- **P2 · blocking:** None open.
- **P3 · non-blocking:** None.

## Resolved during Verify

- The initial review found that the Windows `.cmd` branch delegated a package entry without
  proving that the discovered candidate was the matching package launcher. Develop replaced that
  path with a fail-closed mapping in `src/main/coin/resources/gmgnCli.service.ts:244-388`.
  Delegation now starts only from the exact `LOCALAPPDATA/Yarn/bin/gmgn-cli.cmd` + Yarn global
  package pair or exact `APPDATA/npm/gmgn-cli.cmd` + npm global package pair. The candidate must be
  a regular, bounded, NUL-free file containing only an accepted Yarn/npm scaffold and exactly one
  invocation whose `%~dp0` / `%dp0%` target realpaths to the package-declared entry. Package name,
  bin, exact env-node shebang, the real package root inside the matching real `node_modules`
  container, and the real entry inside that root all fail closed.
- During re-review I specifically challenged unique invocation and whole-package-root escape.
  Develop tightened the parser to `invocationCount === 1`
  (`src/main/coin/resources/gmgnCli.service.ts:332-361`) and anchored the real package root below
  the matching real package-container root (`src/main/coin/resources/gmgnCli.service.ts:363-388`).
  Deterministic tests now reject both cases at
  `tests/coin/unit/gmgnCli.service.test.ts:420-518`; parent `node_modules` relocation as one unit is
  explicitly supported and covered at `tests/coin/unit/gmgnCli.service.test.ts:520-551`.

## Independent Windows boundary evidence

- I built the current service in memory and exercised it with a platform-independent harness.
  Realistic Yarn full cmd-shim, simple `node`, direct `%~dp0\\node.exe`, and npm full cmd-shim
  launchers were all accepted. Each produced exactly
  `--eval, <fixed bootstrap>, <real declared entry>, --version`, retained child PATH byte-for-byte,
  and added only `ELECTRON_RUN_AS_NODE=1` for the App-Node transport.
- The same harness rejected without a process call: duplicate exact invocation, whole package-root
  escape, cross Yarn/npm pair, and a cmd from an unknown directory. It also rejected wrong package
  name, wrong entry shebang, and an extra launcher command. Source/unit coverage additionally
  rejects blank, missing, NUL-bearing, oversized, symlinked launcher, entry escape, and malformed
  mappings. The exact native `.exe` path remains a direct command with original `--version` argv
  and no `ELECTRON_RUN_AS_NODE`.
- The bootstrap is one fixed source constant and contains no key, path, renderer value, or other
  user input. Every fixed GMGN command is appended after the verified entry; the Commander fixture
  observes the original allowlisted arrays exactly for `--version`, trending, token info, and
  profit-ranked token traders.

## Verification evidence

- PASS — `node tests/coin/run-unit.mjs`: 146/146, including old direct-entry Commander failure,
  fixed bootstrap success, POSIX and Windows verified-entry gates, exact argv/environment, native
  direct execution, and unknown-script rejection.
- PASS — independent bounded real-provider smoke with the installed verified entry, app Electron,
  exact minimal desktop PATH, current credential, and only the fixed read-only trending probe:
  `exit=0`, parseable JSON, `code=0`. stdout/stderr were redirected to owner-only temporary files,
  no payload or key was printed, and the temporary directory was removed immediately. No Trench
  operation or persistence path ran.
- PASS — INDEX native integration 6/6; static Trench layout 12/12; Omni embedding 6/6; MCP contract
  1/1 with exactly 12 public `trench.*` tools.
- PASS — Trench renderer typecheck, `yarn typecheck:node`, `yarn typecheck:mcp`, and renderer i18n.
- PASS — fresh isolated DEBUG_DEV build.
- PASS — fresh isolated DEBUG_DEV Electron E2E
  `tests/coin/specs/trench-index.spec.ts --project electron`: 1/1 in 33.2 seconds. Settings Verify,
  Add/INDEX recovery, four-CA preservation, narrow Omni layouts, no-secret screenshot path, and
  zero renderer/network errors remained green.
- INFO — strict focused `tsc --noEmit -p tests/coin/tsconfig.trench-node.json` still reports the
  same four out-of-task dirty-worktree errors: Codex credential `never.catch`, meme metric
  `unknown`, and two Coin resource cancellation-union errors. The authoritative project Node
  typecheck and fresh build pass.
- PASS — task-path `git diff --check`. DEBUG_PROD retained the same bounded process identity before
  and after re-verification; none of these tests stopped, restarted, or used its profile, database,
  MCP server, or Trench records.

## Conclusion

**pass** — the original Windows P2 and the two fail-closed re-review challenges are resolved. No
open P1/P2/P3 finding remains; the verified entry, fixed argv transport, environment, native path,
real-provider read, exact 12-tool compatibility, and isolated Electron recovery flow pass.
