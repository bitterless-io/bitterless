---
id: claude-subscription-core-001-1
status: blocked
reviewed_task: claude-subscription-core-001
target: dev-next-working-tree-2026-08-24
date: 2026-08-24
review_type: independent-code-contract-and-offline-runtime
---

# Independent Review — claude-subscription-core-001

## Verdict

**BLOCKED.** The encrypted repository, allowlisted child environment, strict first-party OAuth
status predicate, bounded process output, basic routing replay boundary, loopback bind, Origin/body
guards, and text SSE path are present and their focused tests pass. The task is not deliverable yet
because shutdown can hang on an unfinished request body, namespace tool calls are not represented as
Responses namespace calls, preflight timeouts bypass the documented authentication/failover path,
health can call undecryptable accounts eligible, and the planned runtime schemas/integration proof
are missing.

## Findings

### P1

#### 1. [P1][blocking] Server shutdown hangs while a client leaves the JSON request body unfinished

- **Design:** the embedded server must stop with Bitterless and its verification explicitly includes
  server shutdown (`docs/features/claude-subscription-accounts.md:189-210,257-266`). Main cleanup is
  also required to abort every active request before quit
  (`docs/plan/analysis/claude-subscription-accounts.md:39-40`).
- **Code:** `ClaudeResponsesServer.close()` aborts only the controllers in `#activeRequests`, then
  waits for `server.close()` (`src/main/claudeSubscription/claudeResponses.server.ts:167-173`). The
  controller is passed to `runtime.execute()` only _after_ `readJsonBody()` finishes
  (`claudeResponses.server.ts:228-240`), while `readJsonBody()` has no signal/close path and waits for
  `end`, `aborted`, or a socket error (`claudeResponses.server.ts:261-317`).
- **Evidence:** a fresh pure-Node `net.Socket` probe sent valid POST headers plus one byte of a large
  declared JSON body, kept the client socket open, and called `server.close()`. After 250 ms it
  reported `{"closeResolvedWhileBodyOpen":false}`; destroying the client socket was the only event
  that allowed close to resolve. `closeIdleConnections()` cannot close this active request.
- **Impact:** a stalled or faulty local client can keep Bitterless cleanup pending indefinitely;
  aborting the execution controllers does not cover the body-reading phase.
- **Required fix:** make body reading cancellation-aware and ensure close terminates active request
  sockets as well as executor children, removes listeners, and waits for handler settlement. Add a
  regression using an unfinished body that proves bounded `close()` completion without the client
  voluntarily closing.

#### 2. [P1][blocking] Namespace tools are flattened into a non-namespace function call and the function-done event is incomplete

- **Design:** flat and namespace Codex functions must become decision tools, and both final text and
  function calls must produce valid ordered OpenAI Responses SSE
  (`docs/features/claude-subscription-accounts.md:204-211`).
- **Code:** namespace children are converted to a single dotted name such as `browser.open`
  (`src/main/claudeSubscription/claudeResponses.translator.ts:49-63`), and the output contract has no
  `namespace` field (`src/shared/claudeSubscription/claudeSubscription.contract.ts:100-107`). The
  emitted `response.function_call_arguments.done` event also omits its required `name`
  (`src/main/claudeSubscription/claudeResponses.stream.ts:171-176`).
- **Protocol evidence:** the locally installed current OpenAI Responses declaration represents the
  input as `NamespaceTool { name, tools }`, the output call as separate optional `namespace` plus
  child `name`, and requires `name` on `ResponseFunctionCallArgumentsDoneEvent`
  (`/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/openai/src/resources/responses/responses.ts:870-907,2626-2656,2882-2917`). The installed Codex is `0.137.0` and includes namespace-aware dynamic tools.
- **Test gap:** the namespace test asserts the dotted internal name, and the function SSE test checks
  only event type order/delta; neither validates a namespace round trip or the event/item protocol
  shape (`tests/claudeSubscription/claudeResponses.translation.test.ts:79-107,184-214`).
- **Impact:** a Claude decision for a Codex namespace tool cannot round-trip to the namespace and
  child function Codex advertised; strict consumers may additionally reject the malformed done
  event. The core tool-use path therefore is not Responses-compatible.
- **Required fix:** preserve an internal decision identifier separately from the original
  `{ namespace, name }`, emit both protocol fields on the function-call item, include `name` in the
  done event, and add schema-level flat and namespace fixtures through the HTTP SSE boundary.

### P2

#### 3. [P2][blocking] `/health` reports accounts eligible without proving that their credential can be decrypted

- **Design:** eligibility requires an enabled, **decryptable** account; unavailable secure storage or
  failed decryption makes the account unusable (`docs/features/claude-subscription-accounts.md:66-75,169-172`).
- **Code:** `listRoutingAccounts()` sets `hasValidCredential` from only the non-empty ciphertext
  string (`src/main/claudeSubscription/claudeAccount.repository.ts:330-338`). Cipher availability
  and decryption are checked later only in `getExecutionCredential()`
  (`claudeAccount.repository.ts:341-363`). Router health trusts the earlier flag when calculating
  `eligible` (`src/main/claudeSubscription/claudeAccount.router.ts:120-148,160-166`).
- **Impact:** after loading an existing registry with unavailable `safeStorage`, `/health` can return
  `ok: true` and a positive eligible count even though every lease fails with
  `storage_unavailable`. Corrupt/undecryptable ciphertext is likewise advertised as usable until a
  request happens to select it. This contradicts the metadata-only UI state, which already shows
  `reconnect` when the cipher is unavailable.
- **Required fix:** establish credential usability before publishing routing/health eligibility,
  without retaining plaintext, and test unavailable-cipher and decryption-failure registries through
  repository + router health.

#### 4. [P2][blocking] A timeout during `auth status` is returned as execution timeout instead of authentication failure

- **Design:** before every prompt, malformed output, non-zero exit, **timeout**, or a non-first-party
  auth source must become a typed authentication failure
  (`docs/features/claude-subscription-accounts.md:138-146`). Explicit authentication rejection then
  marks the account `needs_login` and permits one retry; request/execution timeout must not be replayed
  (`claude-subscription-accounts.md:174-184`).
- **Code:** the preflight directly awaits `runClaudeProcess()` and calls the authentication predicate
  only after it resolves (`src/main/claudeSubscription/claudeCli.executor.ts:188-200`). The runner
  rejects a timeout as `ClaudeTimeoutError` before any predicate executes
  (`claudeCli.executor.ts:295-319`). `ClaudeTimeoutError` is not a routing failure, so runtime neither
  invalidates the account nor tries the second account
  (`src/main/claudeSubscription/claudeResponses.server.ts:71-93`).
- **Test gap:** the existing hang mode returns a successful auth status and hangs only the real prompt,
  so it correctly proves _execution_ timeout is not replayed but does not exercise preflight timeout
  (`tests/claudeSubscription/fixtures/fake-claude-cli.mjs:18-34`; `tests/claudeSubscription/claudeCli.executor.test.ts:224-243`).
- **Required fix:** distinguish preflight process failures from prompt process failures, preserve
  caller cancellation as `request_aborted`, map the documented preflight timeout to
  `claude_authentication`, and add a two-account regression proving exactly one failover.

#### 5. [P2][blocking] The planned strict shared schemas and real core integration paths are absent

- **Design:** core-001 owns a shared strict metadata/command schema using Zod
  (`docs/plan/analysis/claude-subscription-accounts.md:12-19`), and malformed requests must fail
  explicitly (`claude-subscription-accounts.md:56-65`). The same analysis enumerates real
  repository-to-router and server-to-executor connections as core-001 verification obligations
  (`claude-subscription-accounts.md:35-38`).
- **Code:** `src/shared/claudeSubscription/` contains TypeScript interfaces and redaction only; there
  is no runtime schema/parser. At the HTTP boundary, a supplied malformed function `parameters`
  value is silently replaced with an empty object schema rather than rejected
  (`src/main/claudeSubscription/claudeResponses.translator.ts:11-15,17-31`).
- **Test gap:** repository tests stop at the repository, router/runtime tests use
  `FakeClaudeAccountSource`, server tests use both a fake source and fake executor, and executor tests
  call the executor directly. No offline test crosses real repository -> router -> runtime -> real
  `ClaudeCliExecutor` (with the fake child) -> HTTP/SSE, nor server close -> real executor
  termination (`tests/claudeSubscription/claudeSubscriptionTest.helper.ts:20-61`;
  `tests/claudeSubscription/claudeResponses.server.test.ts:15-51,263-334`).
- **Impact:** the next XPC task has no strict metadata/command boundary to reuse, malformed caller
  data can be normalized silently, and the integration relationships called out by the delivery plan
  remain proven only against mocks.
- **Required fix:** add strict shared Zod schemas/parsers for account snapshots and commands, reject
  malformed provided tool schemas while retaining documented optional defaults, and add bounded
  offline source-integration coverage using the real core classes and fake cipher/CLI process.

### P3

#### 6. [P3][non-blocking] The new fake CLI fixture fails the repository ESLint rules when the whole task directory is linted

- **Code:** the two helper arrows in
  `tests/claudeSubscription/fixtures/fake-claude-cli.mjs:7,13` have no explicit return types under the
  active TypeScript ESLint configuration.
- **Evidence:** `yarn -s eslint src/main/claudeSubscription src/shared/claudeSubscription tests/claudeSubscription --no-cache`
  reports exactly those two errors. The task-prescribed TypeScript-only lint command passes, so this
  is non-blocking for round 1, but an ordinary repository-wide lint would still include the new file.

## Passing contract evidence

| Boundary                      | Result                        | Evidence                                                                                                                                                                                                                                                                              |
| ----------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account paths and persistence | PASS with finding 3 exception | UUID-derived exact config paths/partitions, plain-directory and realpath containment checks, `0700` directories, `0600` same-directory temp registry, atomic rename, encrypted-only registry, and metadata-only returned views are implemented and focused tests pass.                |
| Subscription-only environment | PASS                          | The child env is rebuilt from a narrow allowlist, competing auth/cloud variables are absent by construction, and only the selected OAuth token/config directory plus value-free flags are injected. Preflight and prompt reuse the same executable/env.                               |
| Claude execution isolation    | PASS with finding 4 exception | Safe mode, empty setting sources, null API-key helper, no Chrome/tools/session persistence, strict empty MCP config, bounded stdout/stderr, `0600` system prompt, strict decision parsing, SIGTERM/SIGKILL code path, and redaction are present. No live Claude process was launched. |
| Routing replay boundary       | PASS                          | Sticky least-active selection, round-robin tie break, lease release, one retry only for typed auth/usage failures, and no retry for decision/cancel/generic failures are implemented and tested.                                                                                      |
| HTTP admission                | PASS with finding 1 exception | Bind host is exactly `127.0.0.1`; any Origin is rejected; JSON content type, body byte limit, unknown model/route, client abort, aggregate health response shape, and ordinary server close are covered.                                                                              |
| Text Responses SSE            | PASS                          | Text event order, sequence numbers, completed response, usage normalization, and `[DONE]` are present and tested. Function/namespace SSE remains blocked by finding 2.                                                                                                                |
| Standalone relay removal      | PASS                          | No task source/test identifier contains BL Relay or relay naming; the only occurrence is the feature statement explicitly forbidding a standalone BL Relay.                                                                                                                           |

## Fresh verification

| Check                                                                            | Result                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `node tests/claudeSubscription/run-tests.mjs`                                    | PASS — 33/33                                                                     |
| `yarn -s tsc -p tests/claudeSubscription/tsconfig.strict.json`                   | PASS                                                                             |
| `yarn -s typecheck:node`                                                         | PASS                                                                             |
| Targeted ESLint over task `.ts` paths                                            | PASS — 0 errors/warnings                                                         |
| Broader ESLint over the complete task directories                                | FAIL — two P3 fixture errors documented above                                    |
| Prettier check over implementation, tests, fixtures, and task file               | PASS                                                                             |
| Prettier check including the two feature/analysis docs                           | FAIL — those two Markdown files are not formatted; no source/runtime impact      |
| Task-scoped `git diff --check`                                                   | PASS                                                                             |
| Pure-Node unfinished-body shutdown probe                                         | REPRODUCED — `closeResolvedWhileBodyOpen=false`; client destruction was required |
| Local protocol declaration audit                                                 | FAIL — namespace output metadata and required function-done `name` are missing   |
| Electron, Claude CLI, browser/login, Anthropic, external network, Playwright/E2E | NOT RUN — explicitly outside this independent review boundary                    |

## Conclusion

**BLOCKED.** Fix all P1/P2 findings and re-run an independent review. Task state was not changed by
this reviewer. After source-level pass, Ral still owns packaged `safeStorage`, real multi-account
login, included-plan/usage-credit configuration, real Claude quota/failover, Codex profile, and live
Codex tool-call acceptance; none of those owner-only acceptance steps was claimed here.
