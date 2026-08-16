# Trench GMGN verification fails under Electron Node mode

状态：已修复

## Symptom

Trench GMGN settings reports CLI `Ready` and API key `Configured`, but `Verify existing key`
returns `GMGN CLI could not complete the read-only probe`.

## Evidence

- The saved key passes `gmgn-cli config --check`.
- Direct execution of the exact fixed read-only probe succeeds with a GMGN `code: 0` response.
- Running the same verified package entry through the app Electron binary with
  `ELECTRON_RUN_AS_NODE=1` and the desktop GUI PATH exits `1`; Commander reports the absolute
  `dist/index.js` path as an unknown command.
- A fixed child bootstrap that clears child-only `process.execArgv`, sets
  `process.defaultApp = true`, and imports the already verified entry succeeds with the same key,
  probe, Electron binary, and minimal PATH.

The credential itself is not the cause. No key value, response payload, or provider stderr belongs
in this issue or application logs.

## Root cause

`gmgn-cli` calls Commander `program.parseAsync()` without explicit parse options. Commander sees
the Electron runtime and its eval argv, chooses Electron/eval argument conventions, and includes
the package entry path in user arguments. Task 020's synthetic Node fixture inspected
`process.argv.slice(2)` but did not use Commander, so `--version` and E2E passed while a real market
subcommand failed.

## Required fix

Only the already constrained Yarn package entry may use a fixed Electron-Node bootstrap that
normalizes child argv before importing it. Native executables remain direct. Unknown scripts,
renderer-selected paths, shell execution, PATH expansion, private keys, trading commands, and new
IPC/MCP capabilities remain forbidden.

Task: [`trench-gmgn-electron-argv-021`](../plan/tasks/trench-gmgn-electron-argv-021.md).

## Resolution

The verified Yarn package entry now runs behind one fixed Electron-Node bootstrap:

```text
Electron --eval <fixed-bootstrap> <verified-entry> <original allowlisted GMGN args...>
```

The bootstrap clears only the child `process.execArgv`, sets `process.defaultApp = true`, then
imports `process.argv[1]`. A Commander fixture proves the old direct-entry shape rejects a nested
command and the new shape preserves `--version`, the fixed probe, token info, and profit-ranked
token traders arguments exactly. A bounded real-provider smoke with the app Electron runtime,
minimal desktop PATH, installed verified entry, and existing local credential completed with exit
`0` and a parseable `code: 0` envelope; its payload and stderr were discarded without a Trench
write.
