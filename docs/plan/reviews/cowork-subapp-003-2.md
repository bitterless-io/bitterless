# Review: cowork-subapp-003 (round 2)

## Findings

None. Both findings from round 1 are resolved.

## Verification

| Check | Result | Evidence |
|---|---|---|
| Decrypted production-key validation | pass | `readEncryptedKey()` now passes the safeStorage plaintext through the shared exact 64-character lowercase-hex validator before returning it (`src/cowork/main/security/sqliteKey.service.ts:27-42`). |
| Malformed production key with existing DB | pass | The executable harness decrypts malformed `sqlite-key.bin` content, requires the production-specific validation error, and byte-compares both key and existing DB after rejection (`scripts/cowork/check-embedded-host.mjs:308-321`). |
| Malformed production key without DB | pass | The key-only harness case requires the same rejection, verifies unchanged key bytes, and proves that `config.db` was not created (`check-embedded-host.mjs:323-337`). |
| Development `EEXIST` convergence | pass | Exclusive creation catches only `EEXIST` and reads/validates the winning development key (`sqliteKey.service.ts:90-100`). Harness injection proves the winner is returned unchanged, no DB is created, and safeStorage remains untouched (`check-embedded-host.mjs:178-202`). |
| Production `EEXIST` convergence | pass | The production writer reports an `EEXIST` loss and the caller decrypts/validates the winner (`sqliteKey.service.ts:44-70`). Harness injection proves winner return, unchanged encrypted bytes, no DB creation, and the expected encrypt-candidate/decrypt-winner calls (`check-embedded-host.mjs:264-288`). |
| Non-`EEXIST` errors | pass | Both creation paths rethrow other filesystem errors. Focused `EACCES` cases verify no key is created; development calls no safeStorage, while production does not attempt to read a winner (`check-embedded-host.mjs:204-220,290-306`). |
| Development/E2E safeStorage boundary | pass | Forbidden spies recorded zero calls for normal/reused dev, dev convergence, dev failures, unpackaged E2E, and packaged-E2E rejection. E2E remains process-cached and diskless (`check-embedded-host.mjs:164-247,362-381`). |
| Focused executable check | pass | `node scripts/cowork/check-embedded-host.mjs` exited 0. |
| Cowork parity checks | pass | `yarn check:cowork` ran all 36 checks and exited 0. |
| Targeted semantic typecheck | pass | TypeScript Program check for `src/main/env.d.ts` plus `sqliteKey.service.ts` reported 0 diagnostics. |
| Production build | not repeated | The implementation change is confined to the already-built main-process service and executable harness; the prior develop build passed, and this round's semantic TypeScript plus runtime checks cover the fix. |
| Patch hygiene | pass | `git diff --check` exited 0. |

The `wx` loser reads a fully published winner in the executable race simulation. A real process that
observes the file between the winner's exclusive open and completed write can still reject a
temporarily partial value, but that remains fail-closed, cannot overwrite either key or DB, and is
recoverable on retry; it does not violate Task 003's security or persistence contract.

## Conclusion

**pass** — production plaintext is now format-validated, malformed selected keys leave storage
unchanged, dev/prod exclusive-create races converge on a validated winner, unrelated filesystem
errors are rethrown, and dev/E2E continue to make zero safeStorage calls. No P1, P2, or P3 findings
remain for Task 003.
