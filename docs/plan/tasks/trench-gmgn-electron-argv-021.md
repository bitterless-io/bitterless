---
id: trench-gmgn-electron-argv-021
scope: BL Trench GMGN provider
status: done
depends-on: [trench-gmgn-settings-020]
---

# Trench GMGN Electron argv compatibility

## Objective

Make every allowlisted real GMGN command work through the verified Yarn env-node entry under the
desktop Electron runtime. Correct Commander's Electron/eval argv interpretation without widening
the executable, environment, credential, IPC, or read-only command boundaries established by task
020.

## Context

- [`../../features/trench-index.md`](../../features/trench-index.md)
- [`../../issues/trench-gmgn-electron-node-argv.md`](../../issues/trench-gmgn-electron-node-argv.md)
- [`../analysis/trench-index-analysis.md`](../analysis/trench-index-analysis.md)
- [`trench-gmgn-settings-020.md`](trench-gmgn-settings-020.md)
- [`../reviews/trench-gmgn-settings-020-1.md`](../reviews/trench-gmgn-settings-020-1.md)

The current branch is `dev/current`; do not switch or create a branch/worktree. Preserve unrelated
dirty changes. Keep DEBUG_PROD running and untouched. A real-provider probe is read-only and must
return only bounded status evidence; it must not persist GMGN payloads or Trench records.

## Path

- `docs/INDEX.md`
- `docs/features/trench-index.md`
- `docs/issues/trench-gmgn-electron-node-argv.md`
- `docs/plan/analysis/trench-index-analysis.md`
- `docs/plan/tasks/trench-gmgn-electron-argv-021.md`
- `docs/plan/results/trench-gmgn-electron-argv-021.md`
- `docs/plan/README.md`
- `src/main/coin/resources/gmgnCli.service.ts`
- `tests/coin/unit/gmgnCli.service.test.ts`
- `tests/coin/fixtures/gmgnCli.fixture.ts`
- `tests/coin/specs/trench-index.spec.ts`
- focused test configuration only when required to execute the real-provider gate

## Contract

1. Preserve task 020's exact Yarn candidate/package/bin/shebang verification. Only a verified Yarn
   entry uses the app runtime; native executables stay direct and unknown env-node scripts fail
   closed. Windows `.cmd` delegation additionally requires one exact allowed Yarn/npm candidate,
   a bounded known launcher scaffold that resolves to the matching package-declared real entry,
   exactly one invocation, and realpath containment anchored at the expected fixed global
   `node_modules` installation root. Relocating that exact parent root as one unit is allowed;
   package-root or entry escape is rejected. Blank, duplicate, unrelated, extra-command, missing,
   or cross-root launchers fail closed.
2. The verified entry executes through one constant bootstrap. The bootstrap clears only the child
   runtime's `process.execArgv`, sets `process.defaultApp = true`, then imports `process.argv[1]`.
   The verified absolute entry is the first user argv; fixed read-only GMGN arguments follow.
3. `ELECTRON_RUN_AS_NODE=1` remains the only added environment value. The sanitized child PATH is
   byte-for-byte unchanged. No shell, login shell, Node-directory injection, arbitrary code/path,
   renderer input, or provider response logging is allowed.
4. `--version`, the fixed read-only trending probe, `token info`, and profit-ranked `token traders`
   must all reach GMGN as the original allowlisted argument arrays. The bootstrap is transport only;
   it cannot add, remove, or rewrite a GMGN command argument.
5. Error classification remains typed and value-free. This task does not change the GMGN API key,
   settings UI, INDEX persistence/ranking, `trench-io`, or the exact 12 public MCP tools.

## Verification

- A Commander-based Yarn fixture fails under the old direct-entry Electron/eval argv shape and
  succeeds through the fixed bootstrap with exact minimal GUI PATH. Unit assertions cover both
  `--version` and a nested market subcommand, exact argv preservation, native direct execution, and
  unknown script rejection. Platform-independent Windows fixtures prove one valid exact
  candidate/launcher/package mapping and reject blank, malicious, unrelated, missing, and
  duplicate or realpath-escaping `.cmd`/package combinations while preserving exact
  bootstrap/env behavior. A separate fixture proves the explicit parent-root relocation policy.
- A bounded read-only real-provider smoke uses the installed verified GMGN package entry plus the
  app Electron binary and minimal PATH. It proves exit `0` and a parseable `code: 0` envelope for
  the fixed trending probe without printing or persisting the response or key. Missing local
  credential/CLI may skip this explicit local smoke but cannot weaken deterministic fixtures.
- Fresh isolated DEBUG_DEV build and focused Electron E2E use a Commander-compatible fixture and
  prove Verify succeeds plus Add/INDEX recovery remains explicit. Existing settings, four-CA
  preservation, narrow Omni, and no-secret screenshot assertions remain green.
- Coin unit, INDEX native integration, renderer/node/MCP typechecks, static layout, i18n, exact
  12-tool MCP, Omni, `git diff --check`, and independent Verify review pass. DEBUG_PROD stays
  running and untouched.
