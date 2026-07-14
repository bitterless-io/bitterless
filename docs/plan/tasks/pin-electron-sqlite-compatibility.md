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

Pin Electron to the latest Electron 40 patch release compatible with the prebuilt Electron ABI
assets published for `better-sqlite3-multiple-ciphers@12.6.2`, without a semver range.

## Context

- `better-sqlite3-multiple-ciphers@12.6.2` publishes Electron prebuilt binaries through ABI 143.
- Electron 40 uses ABI 143; Electron 41 uses ABI 145.
- Electron 40.10.6 is the latest stable Electron 40 release.
- The local dependency tree currently has no `better_sqlite3.node`, so the native dependency must be
  reinstalled or rebuilt after the version is pinned.

## Path

- `package.json`
- `yarn.lock`

## Verification

- Confirm `package.json` contains exactly `"electron": "40.10.6"`.
- Confirm `yarn.lock` resolves `electron@40.10.6`.
- Confirm the native addon exists and can open an in-memory database under Electron 40.10.6 on
  macOS arm64.
- Run `yarn typecheck` and report unrelated pre-existing failures separately.
