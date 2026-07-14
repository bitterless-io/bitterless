# Review: cowork-subapp-003

## Findings

- **P2 · blocking — An existing production key is trusted after decryption without validating the
  selected SQLCipher key format.** The contract makes `VITE_ENV=prod` the protected-key branch and
  requires malformed selected keys to fail closed without changing the database or key
  (`docs/plan/tasks/cowork-subapp-003.md`, Objective and Implementation constraints;
  `docs/features/cowork-subapp.md`, Security and errors). Development reads pass through
  `assertSqliteKeyFormat()`, but `readEncryptedKey()` returns the result of
  `safeStorage.decryptString()` directly (`src/cowork/main/security/sqliteKey.service.ts:27-37,
  61-64`). A decryptable legacy/corrupt value such as an empty, short, or non-hex string is
  therefore accepted as the production SQLCipher key. With no database yet, that value can reach
  database creation instead of failing at the key-store boundary; with an existing database,
  failure is deferred to SQLite rather than being an explicit malformed-key rejection. The
  executable harness covers malformed development input, missing production input, and unavailable
  `safeStorage`, but has no malformed decrypted-production case
  (`scripts/cowork/check-embedded-host.mjs:174-237`). **Minimal fix:** pass the decrypted production
  value through `assertSqliteKeyFormat()` with a production-specific source label, then add a
  harness case whose safeStorage spy decrypts an existing `sqlite-key.bin` to malformed text and
  proves rejection plus unchanged key/DB bytes (and no database creation when testing a key-only
  profile).

- **P3 · non-blocking — `wx` prevents key overwrite races but the losing creator does not converge
  on the winner.** Both production and development creation correctly use `flag: 'wx'`, so a
  concurrent first-run process cannot overwrite the key that won the race
  (`src/cowork/main/security/sqliteKey.service.ts:39-44,66-83`). However, neither path catches
  `EEXIST`; the loser surfaces the raw filesystem error even though a valid selected key now exists,
  and the harness does not exercise this branch. This is fail-closed and preserves data, so it does
  not violate the no-overwrite contract, but it makes a recoverable startup race fail unnecessarily.
  Prefer catching only `EEXIST` and reading/validating the winning key via `readEncryptedKey()` or
  `readDevelopmentKey()`; rethrow every other error and add a focused winner/loser assertion.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Exact environment selection | pass | E2E is checked before data-root or `VITE_ENV` selection; otherwise only exact `prod` and `dev` values select a store, and every other/missing value throws (`sqliteKey.service.ts:86-99`). |
| Development safeStorage boundary | pass | The dev branch contains no safeStorage call. Executable spies forbid all three methods and remained untouched for fresh/reused, malformed, and DB-with-missing-key cases. |
| Development persistence and permissions | pass | Fresh dev returned a persistent 64-character lowercase hex key in `cowork/config/sqlite-key.dev.hex`; harness verified config mode `0700`, key mode `0600`, stable reuse, and absence of `sqlite-key.bin`. |
| Production protected storage | partial / blocked | Fresh/reused and unavailable-safeStorage harness cases pass; production encrypts once, decrypts on reuse, stores non-plaintext bytes, and fails before writing when protection is unavailable. Decrypted plaintext format is not validated (Finding 1). |
| E2E isolation | pass | Unpackaged E2E returned one module-cached 32-byte random key, created no data root, and called no safeStorage method. Packaged E2E rejected before disk/safeStorage access. |
| Missing/malformed fail-closed cases | partial / blocked | Missing dev/prod selected keys with existing DBs and malformed dev keys reject without changing DB/key bytes or migrating the other environment's key. Malformed decrypted production plaintext is untested and accepted (Finding 1). |
| Creation no-overwrite behavior | pass with P3 | Both writers use `wx`, so the winner cannot be overwritten. Losing-process recovery is not implemented or tested. |
| Focused executable check | pass | `node scripts/cowork/check-embedded-host.mjs` exited 0. |
| Cowork parity checks | pass | `yarn check:cowork` ran all 36 checks and exited 0. |
| Targeted semantic typecheck | pass | TypeScript Program check for `src/main/env.d.ts` plus `sqliteKey.service.ts` reported 0 diagnostics. |
| Production build | not repeated | The develop handoff reported `yarn build` passing after the final implementation. This review made no implementation changes; focused runtime/type checks covered the changed boundary. |
| Patch hygiene | pass | `git diff --check` exited 0. |

## Conclusion

**blocked** — the dev/E2E Keychain boundary, persistence, permissions, missing-key behavior, and
production safeStorage flow are implemented and executable checks pass. Production must also reject
a decrypted value that is not the expected 64-character SQLCipher key before Task 003 is
deliverable. The `EEXIST` convergence improvement is non-blocking but should be addressed alongside
that focused fix.
