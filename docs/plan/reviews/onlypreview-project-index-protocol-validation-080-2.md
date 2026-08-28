# Task 080 independent review 2 — retired request lifecycle repair

- Date: 2026-08-28
- Branch: `dev/next`
- Scope: Task 080 plus the current retired-request registry and focused relay-test repair
- Result: **CHANGES REQUIRED — 0 P1, 1 P2, 0 P3**
- Electron / Playwright / packaged-app E2E: not run (explicitly excluded)

## Finding

### P2 — a prior-generation search can repopulate and corrupt the cleared current registry

Starting a new `initialize` changes the active workspace/generation and clears retired requests
(`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:185-188`). However, a search admitted under
the previous generation may still be pending. When that old call later settles, its `finally`
unconditionally calls `retireSettled()` after removing the pending call (`:233-239`). The registry
then remembers the old expectation without checking the active workspace/generation
(`src/main/fileSearch/fileSearchRetiredRequest.registry.ts:86-99`). Entries are keyed only by
`requestId`, and `remember()` deletes any existing entry with that ID before inserting the stale
one (`:101-106`).

This breaks the intended generation reset in two concrete ways:

1. Request-ID reuse is explicitly supported by the new regression suite. If a current-generation
   request with that ID settles first, a later terminal response from the old generation replaces
   its tombstone. A valid late batch for the current request then matches neither a current
   tombstone nor a pending request and is treated as an unknown protocol violation, latching
   `INDEX_PROTOCOL_ERROR` (`fileSearchRuntimeRelay.service.ts:411-443`).
2. Even with UUIDs, enough old-generation completions after the clear consume the fixed 256-entry
   budget and can evict valid current-generation tombstones. The registry is memory-bounded, but it
   is not bounded to the active generation and can therefore turn an allowed late-batch race into a
   runtime-wide failure.

The focused tests cover a direct cap, cancel-before-terminal, replacement/supersession, terminal
and timeout late batches, sequential ID reuse, and a current unknown ID
(`tests/onlypreview/onlyPreviewFileSearchRelayProtocol.test.mjs:216-349`), but no test resets the
generation while an older search remains pending. The stale-snapshot test at `:351-372` exercises
event filtering only and cannot detect the later `finally` mutation.

Recommended repair: make the retired registry explicitly active-scope-bound, or guard
`retireSettled()` so it records only when the search expectation still matches
`active.workspaceId` and `active.generation`. Add a regression that leaves an old-generation search
pending across a new initialize, settles a current request and then the old request, and proves a
valid current late batch remains ignored without latching. Include the supported reused-ID case;
also assert old-generation settlements cannot consume the current generation's cap.

## Repaired areas verified

| Area                                           | Result                                      | Evidence                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Successful cancel while search remains pending | **PASS**                                    | A successful cancel remembers the matching active search before its terminal response; its later valid batch is validated then ignored (`fileSearchRuntimeRelay.service.ts:223-229`; focused test `onlyPreviewFileSearchRelayProtocol.test.mjs:234-258`).                                    |
| Replacement / supersession                     | **PASS**                                    | Admitting a new distinct request retires older pending requests in the same workspace/generation before dispatch (`fileSearchRuntimeRelay.service.ts:189-199`; test `:260-284`).                                                                                                             |
| Terminal and timeout late batches              | **PASS**                                    | Settled and timed-out searches become bounded tombstones and their valid late batches are ignored (`fileSearchRetiredRequest.registry.ts:86-106`; tests `:286-297,339-349`).                                                                                                                 |
| Sequential request-ID reuse                    | **PASS**                                    | A newly admitted search forgets its old tombstone before streaming (`fileSearchRuntimeRelay.service.ts:196`; test `:299-316`).                                                                                                                                                               |
| Current unknown request ID                     | **PASS**                                    | A current batch with neither a pending request nor a known tombstone returns `invalid` and latches the dedicated error (`fileSearchRuntimeRelay.service.ts:430-443`; test `:318-337`).                                                                                                       |
| Fixed memory cap                               | **PASS with generation-scope defect above** | The registry evicts the oldest entry after 256 records (`fileSearchRetiredRequest.registry.ts:24,101-106`; test `:216-232`).                                                                                                                                                                 |
| Restored deep-negative coverage                | **PASS**                                    | Fresh fixtures cover snapshot extra keys, invalid nested entries, non-finite memory, invalid hint/media pairing, browse marker/type/extra-key/symlink failures, absolute-path search results, and malformed browse/cancel terminals (`onlyPreviewFileSearchRelayProtocol.test.mjs:374-519`). |
| TS-1 line cap                                  | **PASS**                                    | Relay service: 770 lines; registry: 136; split coordinator test: 750; protocol test: 519. All are below 800 lines.                                                                                                                                                                           |
| Formatting                                     | **PASS**                                    | The issue table and all scoped Task 080 files pass Prettier; `git diff --check` also passes.                                                                                                                                                                                                 |

## Verification performed

| Check                                                                                                                                                                                           | Result                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `node --test tests/onlypreview/onlyPreviewFileSearchRelayProtocol.test.mjs tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` | **PASS — 25/25**                  |
| `yarn typecheck:node`                                                                                                                                                                           | **PASS**                          |
| scoped ESLint over the two relay TS files and three focused tests                                                                                                                               | **PASS**                          |
| scoped Prettier over Task 080 docs, relay TS files, and focused tests                                                                                                                           | **PASS**                          |
| `git diff --check`                                                                                                                                                                              | **PASS**                          |
| Electron / Playwright / packaged smoke / E2E                                                                                                                                                    | **NOT RUN — explicitly excluded** |

## Conclusion

**CHANGES REQUIRED.** The earlier cancelled/superseded/unknown lifecycle defect, removed negative
coverage, TS-1 violation, and issue formatting failure are repaired. The remaining generation-reset
race can still convert a normal stale completion plus a valid current late batch into a latched
Project index failure, so Task 080 is not yet safe to mark complete.
