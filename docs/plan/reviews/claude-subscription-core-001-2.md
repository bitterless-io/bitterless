---
id: claude-subscription-core-001-2
status: pass
reviewed_task: claude-subscription-core-001
target: dev-next-working-tree-2026-08-24
date: 2026-08-24
review_type: independent-code-contract-and-offline-runtime
---

# Independent Review — claude-subscription-core-001 Round 2

## Verdict

**PASS.** All six Round 1 findings are closed. The repaired core now cancels unfinished request
bodies during shutdown, resolves listen/close races without leaving a listener, preserves flat and
namespace function-call protocol shapes, bases health eligibility on decryptability, distinguishes
the bounded authentication preflight from prompt execution, exposes strict metadata-only Zod
boundaries, and proves the real offline repository-to-HTTP chain. No blocking P1, P2, or P3 finding
remains.

## Round 1 finding closure

| Round 1 finding                 | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 unfinished-body shutdown     | CLOSED | Every accepted request is tracked with its request, response, controller, and handler promise; close aborts and destroys all three I/O surfaces before waiting for handlers (`src/main/claudeSubscription/claudeResponses.server.ts:116-168,232-253`). Body reading consumes that signal and removes all listeners on settlement (`claudeResponses.server.ts:310-330,340-420`). The raw-socket regression keeps a declared JSON body unfinished and proves close finishes within one second (`tests/claudeSubscription/claudeResponses.server.test.ts:397-433`).                                                                                                                                                                                                                                          |
| P1 namespace/function SSE shape | CLOSED | Namespace decisions retain a collision-safe internal identifier separately from child `name` and optional `namespace` (`src/main/claudeSubscription/claudeResponses.translator.ts:52-121`; `src/main/claudeSubscription/claudeCli.executor.ts:498-541`). Function items conditionally contain `namespace`, while `response.function_call_arguments.done` always contains child `name` and no namespace (`src/main/claudeSubscription/claudeResponses.stream.ts:52-99,160-182`). Strict Zod assertions round-trip both flat and namespace fixtures through HTTP SSE (`tests/claudeSubscription/claudeResponses.server.test.ts:22-52,157-225`).                                                                                                                                                             |
| P2 health decryptability        | CLOSED | Routing records derive `hasValidCredential` by actually decrypting and trimming ciphertext without returning or retaining the plaintext; failures mark reconnect and return false (`src/main/claudeSubscription/claudeAccount.repository.ts:330-367,391-404`). Repository-to-router health tests cover unavailable secure storage and decryption failure (`tests/claudeSubscription/claudeAccount.repository.test.ts:143-166`).                                                                                                                                                                                                                                                                                                                                                                           |
| P2 preflight timeout/failover   | CLOSED | Authentication status has its own default 15-second deadline, separate from the 15-minute prompt deadline (`src/main/claudeSubscription/claudeCli.executor.ts:24-27,145-168,198-235`). Preflight process failure becomes typed authentication failure except caller abort, while prompt timeout remains `ClaudeTimeoutError` (`claudeCli.executor.ts:198-218,220-235,287-387`). Runtime retries only typed auth/usage failures and caps attempts at two (`src/main/claudeSubscription/claudeResponses.server.ts:40-103`; `src/main/claudeSubscription/claudeSubscription.errors.ts:100-103`). A real fake-child integration proves one account's preflight timeout marks it for login and succeeds once on the second account (`tests/claudeSubscription/claudeSubscription.integration.test.ts:83-136`). |
| P2 strict schemas/integration   | CLOSED | Shared strict Zod schemas cover snapshot schema/revision/observation, every server/account/auth-flow state, sanitized auth error, and every command input (`src/shared/claudeSubscription/claudeSubscription.schema.ts:15-163`). Negative tests reject extra/secret fields, invalid revision/server/auth state, bad identifiers, multiline code, and extra command keys (`tests/claudeSubscription/claudeSubscription.schema.test.ts:55-240`). The offline integration uses the real repository, router, runtime, executor/spawned fake CLI, loopback HTTP server, and SSE (`tests/claudeSubscription/claudeSubscription.integration.test.ts:19-192`).                                                                                                                                                    |
| P3 complete task-directory lint | CLOSED | Full ESLint over implementation, shared contract, tests, helpers, and the fake CLI fixture exits cleanly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Additional contract evidence

- Concurrent `listen()` calls share the pending startup, and `close()` waits for that startup before
  closing; a close racing startup fulfills close, rejects listen, and leaves `address()` unavailable
  (`src/main/claudeSubscription/claudeResponses.server.ts:128-130,175-253`;
  `tests/claudeSubscription/claudeResponses.server.test.ts:435-448`). Sequential and repeated close
  calls are also safe.
- Flat function-call JSON has no `namespace`; namespace calls use separate namespace and child name.
  The strict done-event schema excludes extra namespace data and requires `name`
  (`tests/claudeSubscription/claudeResponses.server.test.ts:22-52,195-220`). This matches the locally
  installed current OpenAI Responses declarations for `ResponseFunctionToolCall` and
  `ResponseFunctionCallArgumentsDoneEvent`.
- Codex effort is resolved per request with the exact accepted mapping, including Ral's
  `ultra -> xhigh`; omitted effort is `high`, and non-string/unknown values fail explicitly
  (`src/main/claudeSubscription/claudeResponses.translator.ts:124-143,175-219`;
  `tests/claudeSubscription/claudeResponses.translation.test.ts:172-207`). The executor passes the
  resolved value as `--effort` (`src/main/claudeSubscription/claudeCli.executor.ts:119-143,220-235`;
  `tests/claudeSubscription/claudeCli.executor.test.ts:202-207`).
- Caller cancellation is preserved as `ClaudeRequestAbortedError`; prompt timeout is not caught by
  the preflight classifier. Neither satisfies `isClaudeRoutingFailure`, so neither can replay on a
  second account (`src/main/claudeSubscription/claudeCli.executor.ts:182-239`;
  `src/main/claudeSubscription/claudeSubscription.errors.ts:85-103`;
  `tests/claudeSubscription/claudeAccount.router.test.ts:140-158`).
- The child environment is rebuilt from an allowlist, selected OAuth and config values are injected
  only for the child, preflight and prompt share the same environment, temporary prompt files are
  `0600`, output/body sizes are bounded, and exposed errors are redacted. Registry writes remain
  same-directory atomic renames with `0600` files and UUID-contained `0700` directories.
- No task source or test uses BL Relay/relay naming. The sole scoped match is the accepted feature's
  explicit statement that no standalone BL Relay exists.

## Fresh verification

| Check                                                                                                                                                         | Result                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `node tests/claudeSubscription/run-tests.mjs`                                                                                                                 | PASS — 49/49                                                                                 |
| `yarn -s tsc -p tests/claudeSubscription/tsconfig.strict.json`                                                                                                | PASS                                                                                         |
| `yarn -s typecheck:node`                                                                                                                                      | PASS                                                                                         |
| `yarn -s eslint src/main/claudeSubscription src/shared/claudeSubscription tests/claudeSubscription --no-cache`                                                | PASS — complete task directories, 0 errors/warnings                                          |
| `yarn -s prettier --check src/main/claudeSubscription src/shared/claudeSubscription tests/claudeSubscription docs/plan/tasks/claude-subscription-core-001.md` | PASS                                                                                         |
| `git diff --check`                                                                                                                                            | PASS                                                                                         |
| Scoped relay-name search                                                                                                                                      | PASS — only the feature prohibition sentence matches                                         |
| Local OpenAI Responses declaration audit                                                                                                                      | PASS — separate optional item namespace and required done-event name agree with emitted JSON |
| Electron, real Claude CLI, browser/login, Anthropic, external network, Playwright/E2E                                                                         | NOT RUN — explicitly outside this review boundary                                            |

## Remaining owner acceptance boundary

This source-level pass does not claim packaged Electron `safeStorage`, real multi-account login,
included-plan/usage-credit settings, live Claude quota/reset behavior, or an actual Codex profile and
tool-call session. Those remain later-task or owner acceptance checks. Task state was not changed by
this reviewer.
