# Review: todo-mcp-smoke-cli-and-skill (round 3)

## Findings

No P1, P2, or P3 finding was found in the round 3 scope. Round 2's remaining P1 is closed.

## Round 2 finding closure

| Required boundary | Result | Evidence |
|---|---|---|
| Full UUID ownership marker | pass | Each run uses the complete `randomUUID()` inside both the original/updated title and note (`scripts/mcp/todo-smoke.mjs:486-499,502-530`). The fixture asserts the RFC 4122 UUID shape and marker propagation (`scripts/mcp/todo-smoke.test.mjs:110-119`). |
| Untrusted response ID | pass | A create response ID is stored only as `responseCandidateId`; it is promoted to `validatedOwnedId` only after a fresh `todo.get` proves marker, domain, source, importance, title, and note (`scripts/mcp/todo-smoke.mjs:443-466,513-522`). The wrong-ID fixture points at a human decoy; the CLI preserves that decoy and recovers/deletes only the owned row (`scripts/mcp/fixtures/todo-mcp.fixture.mjs:156-169`; `scripts/mcp/todo-smoke.test.mjs:133-141`). |
| Pre-delete ownership proof | pass | Every destructive path goes through `deleteOwnedAndVerify()`, which performs `todo.get`, asserts the complete ownership predicate, then deletes and verifies `todo.status === deleted` (`scripts/mcp/todo-smoke.mjs:468-484,573-575,685-697`). The fixture records and asserts that ownership get occurs in the same fresh session before delete (`scripts/mcp/todo-smoke.test.mjs:60-80`). |
| Decoy preservation | pass | Recovery filters on full marker, exact original/updated title, domain, `source: ai`, non-important state, and marker-bearing note (`scripts/mcp/todo-smoke.mjs:443-456,601-612`). Same-title human-source and wrong-note decoys remain undeleted in the executable fixture (`scripts/mcp/fixtures/todo-mcp.fixture.mjs:133-149`; `scripts/mcp/todo-smoke.test.mjs:143-150`). |
| Ambiguous ownership | pass / fail-closed | Candidate collection refuses more than one fully owned row before any delete, and also tracks IDs across polls so sequential ambiguity cannot authorize deletion (`scripts/mcp/todo-smoke.mjs:627-655,665-683`). The two-owned-row fixture exits 1, issues zero deletes, and preserves both rows (`scripts/mcp/fixtures/todo-mcp.fixture.mjs:151-154`; `scripts/mcp/todo-smoke.test.mjs:161-177`). |
| Settlement polling / delayed commit | pass | Production recovery polls for a defined window of at least 11 seconds (the Bitterless helper's 10-second bridge request timeout plus one second), performs a final candidate collection, deletes only one proven candidate, and confirms zero remain (`scripts/mcp/todo-smoke.mjs:11-15,618-625,658-697`). The test-only override shortens only fixture runtime. The delayed fixture returns an empty first list, releases the pending create after that response, and proves a later poll finds and cleans it (`scripts/mcp/fixtures/todo-mcp.fixture.mjs:125-129,211-231`; `scripts/mcp/todo-smoke.test.mjs:152-159`). |

## Verification

| Check | Result | Evidence |
|---|---|---|
| Expanded safe fixture suite | pass | `yarn test:mcp:todo-smoke` exited 0 in 21.75 seconds and reported `ownership-safe settlement cleanup, ambiguity, and helper shutdown cases passed`. It includes normal lifecycle, timeout/malformed response, post-create failure, wrong response ID, same-title decoys, delayed first-zero commit, ambiguous owned rows, non-zero helper exit, and forced termination. |
| Script syntax | pass | `node --check` exited 0 for the CLI, test, and fixture. |
| Patch hygiene | pass | `git diff --check` exited 0 before this review file was added. |
| Real Bitterless safety | pass | All mutation tests used the file-backed deterministic fixture. No real helper/bridge was invoked, no real Todo was written, and no Bitterless process was restarted or terminated. |

## Conclusion

**pass** — the remaining cleanup P1 is closed. The CLI now establishes an explicit ownership chain
before every delete, preserves unrelated decoys, fails closed on ambiguity, and polls through a
defined settlement window that covers a create committed after the first recovery list returned
zero.
