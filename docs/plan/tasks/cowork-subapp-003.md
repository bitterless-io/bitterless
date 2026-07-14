---
id: cowork-subapp-003
scope: Cowork development SQLCipher key storage without operating-system Keychain access
status: done
depends-on: [cowork-subapp-001]
verify:
  - VITE_ENV=dev never calls Electron safeStorage or opens the macOS Keychain
  - development uses a random 32-byte key persisted only under userData/cowork with mode 0600
  - BITTERLESS_E2E keeps its process-ephemeral random key and is unavailable in packaged builds
  - VITE_ENV=prod retains safeStorage-backed encrypted key storage
  - existing databases without the matching environment key fail closed and are never deleted
---

# Avoid Keychain Access In Cowork Development

## Objective

Prevent Cowork development runs from triggering an operating-system Keychain prompt while keeping
production SQLCipher key protection unchanged. The environment boundary is `VITE_ENV`: only
`VITE_ENV=prod` may call Electron `safeStorage`.

## Context

- `docs/features/cowork-subapp.md`
- `src/cowork/main/security/sqliteKey.service.ts`
- Ral observed macOS asking for a Keychain named for `Bitterless_DEV_DEBUG` when opening Cowork.

## Path

- `docs/features/cowork-subapp.md`
- `docs/plan/tasks/cowork-subapp-003.md`
- `src/cowork/main/security/sqliteKey.service.ts`
- `scripts/cowork/check-embedded-host.mjs`
- focused verification files only when required

## Implementation constraints

- Preserve the E2E-only, module-cached random key branch already used by Task 002.
- For `VITE_ENV=dev`, create a separate random 32-byte hexadecimal key file below the isolated
  Cowork config directory and enforce owner-only file/directory permissions where supported.
- Do not call `safeStorage.isEncryptionAvailable`, `encryptString`, or `decryptString` on the dev
  execution path.
- For `VITE_ENV=prod`, retain the current encrypted `sqlite-key.bin` behavior and fail closed when
  `safeStorage` is unavailable.
- Keep dev and prod key filenames distinct. Do not decrypt, migrate, overwrite, or delete an
  existing database/key implicitly; a database without its matching selected key must fail closed
  with a recoverable error.
- Never log key material or copy a generated key into the repository.

## Verification

1. Focused dev/prod/E2E branch check with `safeStorage` spies or an equivalent executable harness.
2. Targeted TypeScript check for the changed main-process file.
3. `yarn check:cowork`.
4. `yarn build`.
5. `git diff --check`.
