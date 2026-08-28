# Task 080 independent review 3 — final protocol validation

- Date: 2026-08-28
- Branch: `dev/next`
- Scope: final Task 080 working tree after retired-request and generation-scope repairs
- Result: **PASS — 0 P1, 0 P2, 0 P3**
- Electron / Playwright / packaged-app E2E: not run (explicitly excluded)

## Final finding status

No remaining P1, P2, or P3 finding was found.

| Prior finding                                                                   | Final status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancelled, superseded, terminal, and unknown request IDs were not distinguished | **CLOSED**   | The bounded registry now distinguishes pending from known retired requests. Successful cancellation, replacement, terminal completion, and timeout produce tombstones whose valid late batches are ignored, while a never-issued current request latches `INDEX_PROTOCOL_ERROR` (`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:189-242,415-447`; `src/main/fileSearch/fileSearchRetiredRequest.registry.ts:24-136`; focused lifecycle tests at `tests/onlypreview/onlyPreviewFileSearchRelayProtocol.test.mjs:216-403`). |
| A prior-generation terminal could repopulate or overwrite the current registry  | **CLOSED**   | Search cleanup now calls `retireSettled()` only when its expectation still matches both the active workspace and generation (`fileSearchRuntimeRelay.service.ts:233-243`). The same-request-ID regression leaves the old search pending across reinitialize, retires the current request, settles the old request, verifies the current late batch remains ignored, and proves a later call is not latched (`onlyPreviewFileSearchRelayProtocol.test.mjs:324-372`).                                                               |
| Relay deep-negative coverage was removed                                        | **CLOSED**   | Fresh isolated fixtures cover snapshot extra keys, invalid nested entries, non-finite memory, an invalid specialized hint/media pairing, browse marker/type/extra-key/symlink failures, an absolute-path batch result, and malformed browse/cancel terminals (`onlyPreviewFileSearchRelayProtocol.test.mjs:430-575`).                                                                                                                                                                                                             |
| Relay test exceeded the 800-line TS-1 cap                                       | **CLOSED**   | Relay service: 774 lines; retired registry: 136; coordinator test: 750; protocol test: 575. Every reviewed TS/JS file is below 800 lines.                                                                                                                                                                                                                                                                                                                                                                                         |
| New issue document failed Prettier                                              | **CLOSED**   | The issue table and all scoped Task 080 files pass the repository formatter.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Contract audit

| Area                                                                            | Result   |
| ------------------------------------------------------------------------------- | -------- |
| Rich-format `previewHint` / `mediaType` / `isText` matrix                       | **PASS** |
| Dedicated `INDEX_PROTOCOL_ERROR` propagation and Project-only wording           | **PASS** |
| Active-generation latch, pending-call wakeup, and future-call rejection         | **PASS** |
| Capability check ordering                                                       | **PASS** |
| Structurally valid stale-event tolerance                                        | **PASS** |
| Cancelled, superseded, terminal, timeout, reused, and unknown request lifecycle | **PASS** |
| Generation reset and late prior-generation settlement                           | **PASS** |
| Fixed retired-request memory cap                                                | **PASS** |
| Detach / reattach recovery                                                      | **PASS** |
| Sensitive-value isolation                                                       | **PASS** |
| Restored deep-validation regression coverage                                    | **PASS** |

## Independent verification

| Check                                                                                                                                                                                           | Result                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `node --test tests/onlypreview/onlyPreviewFileSearchRelayProtocol.test.mjs tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` | **PASS — 26/26**                  |
| `yarn typecheck:node`                                                                                                                                                                           | **PASS**                          |
| scoped ESLint over the relay, registry, and three focused tests                                                                                                                                 | **PASS**                          |
| scoped Prettier over Task 080 docs, relay/registry, and focused tests                                                                                                                           | **PASS**                          |
| `git diff --check`                                                                                                                                                                              | **PASS**                          |
| Electron / Playwright / packaged smoke / E2E                                                                                                                                                    | **NOT RUN — explicitly excluded** |

## Conclusion

**PASS.** The Task 080 implementation now satisfies the rich-format Project index contract,
fail-closed current-generation behavior, allowed stale/late races, bounded retired-request
lifecycle, dedicated UI wording, and regression-coverage requirements. All findings from reviews 1
and 2 are closed, and this final review found no new P1, P2, or P3 issue.
