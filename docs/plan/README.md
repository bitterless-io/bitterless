# Bitterless Delivery Plan

Tasks are executed serially in the existing working directory because this Electron project shares a
large native dependency installation and the current branch contains an unrelated in-progress
Electron/SQLite pin. Development and verification are performed by different agents.

## Active delivery

| id | scope | status | depends-on |
|---|---|---|---|
| [cowork-subapp-001](tasks/cowork-subapp-001.md) | complete Cowork runtime and host integration | done | — |
| [cowork-subapp-003](tasks/cowork-subapp-003.md) | dev-local SQLCipher key without OS Keychain | done | cowork-subapp-001 |
| [cowork-subapp-002](tasks/cowork-subapp-002.md) | parity checks and Bitterless-launched Electron E2E | done | cowork-subapp-001, cowork-subapp-003 |

Analysis: [Cowork sub-application migration](analysis/cowork-subapp-migration.md).

## Concurrency guard

`package.json`, `yarn.lock`, and `tasks/pin-electron-sqlite-compatibility.md` contain another
in-progress change that pins Electron `40.10.6`. Cowork work may add dependencies and scripts only by
surgically preserving that exact Electron pin and all unrelated hunks.
