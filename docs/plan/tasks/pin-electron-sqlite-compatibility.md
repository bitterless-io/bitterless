---
id: runtime-001
scope: desktop runtime dependencies
status: done
depends-on: []
verify:
  - Electron is pinned to exact version 40.10.6
  - Yarn lockfile resolves electron@40.10.6 without a range
  - better-sqlite3-multiple-ciphers loads under Electron ABI 143 on macOS arm64
  - yarn typecheck
---

# Pin Electron For SQLite Compatibility

## Objective

Keep Electron on the exact `40.10.6` patch release and pin
`better-sqlite3-multiple-ciphers@12.11.1`, the latest upstream release that publishes an Electron
40 prebuild, without semver ranges.

## Context

- [`better-sqlite3-multiple-ciphers@12.11.1`](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/releases/tag/v12.11.1)
  publishes prebuilt binaries for Electron 29–42, including Electron 40.
- Electron 40 uses ABI 143; Electron 41 uses ABI 145.
- Electron 40.10.6 is the latest stable Electron 40 release.
- Electron 43 is outside the upstream `12.11.1` prebuild list and is not part of the Bitterless
  runtime contract.
- The native dependency must be reinstalled after the SQLite version changes.

## Path

- `package.json`
- `yarn.lock`

## Verification

- Confirm `package.json` contains exactly `"electron": "40.10.6"`.
- Confirm `package.json` contains exactly `"better-sqlite3-multiple-ciphers": "12.11.1"`.
- Confirm `yarn.lock` resolves `electron@40.10.6`.
- Confirm `yarn.lock` resolves `better-sqlite3-multiple-ciphers@12.11.1`.
- Confirm the native addon exists and can open an in-memory database under Electron 40.10.6 on
  macOS arm64.
- Run `yarn typecheck` and report unrelated pre-existing failures separately.
