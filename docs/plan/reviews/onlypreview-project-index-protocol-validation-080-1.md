# Task 080 independent review 1 — Project index protocol validation

- Date: 2026-08-28
- Branch: `dev/next`
- Scope: committed Task 080 implementation plus the current relay/test working tree
- Result: **CHANGES REQUIRED — 0 P1, 2 P2, 2 P3**
- Electron / Playwright / packaged-app E2E: not run (explicitly excluded)

## Findings

### P2 — cancelled, superseded, and unknown search batches are not distinguished

The relay tracks every call only as a live `PendingCall`. A `cancel` request is independent and does
not revoke or remove its matching pending `search`
(`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:191-203`; the existing test explicitly keeps
the search live while cancel completes at
`tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs:545-569`).

`_searchBatchDisposition()` therefore still returns `broadcast` for a valid batch whenever that
cancelled search has not produced its terminal response
(`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:401-427`). An independent source-level
reproduction against the current relay completed `cancel`, left the original search pending, then
published its batch; the relay produced one `onlypreview/search-batch` broadcast. This contradicts
Task 080's requirement that a late batch for a superseded/cancelled request be ignored
(`docs/plan/tasks/onlypreview-project-index-protocol-validation-080.md:29-30`).

The inverse case is also too permissive: when no pending search matches, lines 408-419 ignore every
well-formed current-generation batch, even if its `requestId` was never issued. The contract allows
only a known completed/superseded/cancelled request to take that path; a fabricated current request
ID is a protocol violation and should latch `INDEX_PROTOCOL_ERROR`.

Recommended repair: retain a bounded, generation-scoped lifecycle for issued search request IDs
(active and terminal/revoked). Mark the prior request superseded when a replacement search is
admitted and mark a request revoked when cancel is admitted. Broadcast only an active request,
ignore only a known terminal/revoked request, and latch an otherwise unknown current-generation
request. Add races for cancel-before-search-terminal, replacement-search-before-old-batch, a known
terminal late batch, and an unknown request ID.

### P2 — the relay suite lost meaningful deep-validation coverage

Before Task 080, the relay test exercised malformed snapshot, browse, and batch payloads: an
absolute-path/extra-key snapshot, an unexpected index-entry key, non-finite memory, missing/wrong/
extra browse-entry fields, an invalid symlink, and an absolute-path search result. The current diff
removes those cases. The remaining public-event test mostly proves valid rich-format payloads and
one malformed Preview terminal response
(`tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs:576-699`); the latching test has
only one negative entry, `sheet` paired with `pdf` (`:701-745`).

This matters because Task 080 changes rejection from a silent drop into a runtime-wide latched
failure. A regression in exact-key, normalized-path, memory, browse-entry, symlink, or batch-result
validation can now pass the suite despite crossing the hidden-renderer/Main trust boundary. It also
leaves the test named “deeply validates public relay values” without the adversarial event matrix
its name claims.

Recommended repair: restore each removed malformed shape using a fresh relay fixture per case, so
the first expected latch does not contaminate later cases. Assert publish rejection, pending-call
wakeup, no broadcast, and immediate future-call failure where applicable.

### P3 — the modified relay test exceeds the 800-line limit (`TS-1`)

`tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs` is 907 lines. This violates
`TS-1`, and restoring the missing protocol cases would make the monolithic file larger.

Recommended repair: move relay protocol fixtures and tests into a dedicated
`onlyPreviewSearchRuntimeRelayProtocol.test.mjs` plus a small shared harness, leaving coordinator,
lifecycle, and readiness tests in the existing file.

### P3 — the new issue artifact does not pass the task's formatting gate

`yarn prettier --check docs/issues/onlypreview-project-index-protocol-preview-error.md` fails on the
format matrix at lines 16-21. Task 080 explicitly requires formatting checks
(`docs/plan/tasks/onlypreview-project-index-protocol-validation-080.md:40`).

Recommended repair: apply the repository formatter to the new issue artifact and rerun the scoped
check. The broader scoped formatter also reports unrelated pre-existing drift in
`onlyPreview.types.ts` and two old test lines; those are not attributed to Task 080 here.

## Contract audit

| Area                                           | Result             | Independent evidence                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rich-format `previewHint` / `mediaType` matrix | **PASS**           | Main's exact entry validator maps only `text`, `pdf`, `image`, `audio`, and `video` directly and maps `sheet`, `document`, `presentation`, `diagram`, and `unsupported` to `unknown`; `isText` follows `mediaType === 'text'` (`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:642-704`). Positive snapshot and browse fixtures cover all ten hints (`tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs:198-246`). |
| Dedicated error propagation and UI wording     | **PASS**           | `INDEX_PROTOCOL_ERROR` is in the shared union and relay failure allowlist (`src/shared/onlypreview/onlyPreview.types.ts:136-150`; relay `:74-92`). English and Chinese Project wording are separate, while `PROTOCOL_ERROR` retains Preview-stream wording (`src/renderer/onlypreview/common/onlyPreviewI18n.ts:184-196,370-381`). The Shell maps typed contract errors through this table.                                             |
| Latch and `Promise.race` wakeup                | **PASS**           | Current calls race the runtime operation, timeout, detach signal, and protocol signal; malformed terminals latch, pending calls wake, and future calls reject before dispatch (`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:187-225,430-435`). Focused tests cover current-generation event failure and malformed terminal failure.                                                                                           |
| Capability ordering                            | **PASS**           | The current working tree checks record shape enough to read the capability, rejects a mismatched capability before consulting or mutating the latch, then exact-validates capability-owned messages (`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:257-270`). An unauthorized malformed record cannot poison the active runtime.                                                                                               |
| Current versus stale generation                | **PASS**           | Recognized events require bounded workspace/generation identity; valid mismatches return before current-generation deep validation and broadcast (`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:275-316`). The focused stale snapshot case passes.                                                                                                                                                                             |
| Late cancelled/superseded batch                | **FAIL — P2**      | Cancellation state is absent from `_searchBatchDisposition()` and unknown current request IDs are silently ignored (`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:396-427`).                                                                                                                                                                                                                                                   |
| Detach / reattach recovery                     | **PASS by source** | `attach()` first detaches the prior runtime and constructs a new latch promise and null failure state; `detach()` resolves only the old stopped signal (`src/main/fileSearch/fileSearchRuntimeRelay.service.ts:127-160,237-243`). A fresh attachment is not poisoned by the previous generation's latch. A direct regression test is still advisable.                                                                                   |
| Sensitive-value isolation                      | **PASS**           | The new error text is constant; latching and diagnostics add no path, query, capability, content, or raw protocol value.                                                                                                                                                                                                                                                                                                                |
| Deep-validation regression coverage            | **FAIL — P2**      | The prior malformed snapshot/browse/batch matrix was removed rather than adapted to one-latch-per-fixture tests.                                                                                                                                                                                                                                                                                                                        |

## Code Review report

- Scope: Task 080 committed and working-tree TS/JS files
- Date: 2026-08-28

### File list

|   # | File                                                              | Lines | Findings |
| --: | ----------------------------------------------------------------- | ----: | -------: |
|   1 | `src/main/fileSearch/fileSearchRuntimeRelay.service.ts`           |   754 |        0 |
|   2 | `src/renderer/onlypreview/common/onlyPreviewI18n.ts`              |   406 |        0 |
|   3 | `src/shared/onlypreview/onlyPreview.types.ts`                     |   506 |        0 |
|   4 | `tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs` |   907 |        1 |
|   5 | `tests/onlypreview/onlyPreviewSearchShellUi.test.mjs`             |   142 |        0 |

### Problems

|   # | File / lines                                                            | Rule   | Problem                                                          | Recommendation                                                                 |
| --: | ----------------------------------------------------------------------- | ------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
|   1 | `tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs:1-907` | `TS-1` | JavaScript test file is 907 lines, exceeding the 800-line limit. | Split relay protocol tests and their harness from coordinator/lifecycle tests. |

No `TS-2`, `FE-1`, or `FE-2` issue was found. There is no backend rule in the active review
ruleset.

## Verification performed

| Check                                                                                                                             | Result                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `node --test tests/onlypreview/onlyPreviewSearchRelayAndCoordinator.test.mjs tests/onlypreview/onlyPreviewSearchShellUi.test.mjs` | **PASS — 16/16**                                                                                                                       |
| independent cancel-then-late-batch relay reproduction                                                                             | **FAIL contract — one late batch broadcast while cancelled search remained pending**                                                   |
| `yarn typecheck:node`                                                                                                             | **PASS**                                                                                                                               |
| scoped ESLint over the five Task 080 code/test files                                                                              | **BASELINE BLOCKED** — two pre-existing unused bindings and existing Prettier warnings in the relay test; no new production diagnostic |
| scoped Prettier over Task 080 code, tests, task, and issue                                                                        | **FAIL** — new issue table plus unrelated existing drift                                                                               |
| `git diff --check`                                                                                                                | **PASS**                                                                                                                               |
| Electron / Playwright / packaged smoke / E2E                                                                                      | **NOT RUN — explicitly excluded**                                                                                                      |

## Conclusion

**CHANGES REQUIRED.** The rich-format matrix, dedicated error wording, latching signal, capability
ordering, stale-generation handling, and reattach reset are sound. Task 080 cannot pass independent
review until the relay distinguishes active, known-terminal/revoked, and unknown search request IDs
and the removed cross-process deep-validation cases are restored. The test split and issue-format
cleanup should be completed in the same repair.
