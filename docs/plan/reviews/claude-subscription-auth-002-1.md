---
id: claude-subscription-auth-002-1
status: blocked
reviewed_task: claude-subscription-auth-002
target: dev-next-working-tree-2026-08-24
date: 2026-08-24
review_type: independent-auth-security-lifecycle-and-offline-runtime
---

# Independent Review — claude-subscription-auth-002

## Verdict

**BLOCKED.** The fixed macOS Expect/script bridge, clean-exit requirement, fail-closed secure
storage policy, metadata-only schemas/XPC, isolated BrowserWindow, exact service-to-service removal
fence, and focused offline suite are present and pass. The task cannot ship because its central
credential-ownership design conflicts with Anthropic's current developer policy, routing can grant
a new lease while the same account is being reconnected/tested/mutated/removed, and shutdown can
finish while a newly admitted account test remains alive. The task's strict TypeScript project also
omits one modified task path and therefore still relies on the repository's `--noCheck` command for
that file.

## Findings

### P1

#### 1. [P1][blocking] Bitterless takes custody of a Claude.ai setup token, which the current official developer policy does not permit

- **Source of truth:** Anthropic's current
  [Claude Code legal and compliance guidance](https://code.claude.com/docs/en/legal-and-compliance)
  does not permit third-party developers to collect, store, or intermediate Claude.ai credentials
  or session tokens. The end-user exception for signing in through the unmodified Claude Code
  product does not give Bitterless permission to parse the resulting credential and become its
  credential store.
- **Current design:** the accepted feature explicitly requires Main to parse one
  `sk-ant-oat01-*` value and store its safeStorage ciphertext
  (`docs/features/claude-subscription-accounts.md:91-122`). This policy premise is now stale even
  though the spawned CLI executable itself is unmodified.
- **Code:** the coordinator extracts the plaintext token from accumulated CLI output and passes it
  into repository persistence (`src/main/claudeSubscription/claudeAuth.coordinator.ts:287-295,324-338`).
  The repository receives the plaintext, encrypts it, and writes `encryptedToken` into Bitterless's
  registry (`src/main/claudeSubscription/claudeAccount.repository.ts:234-277`). Encryption and XPC
  redaction reduce disclosure risk but do not change credential custody.
- **Impact:** the primary authorization/storage boundary is not an allowed third-party integration;
  passing the captured value back only to an unmodified Claude CLI does not cure the prohibited
  collection and persistence step.
- **Required fix:** revise the feature/task contract so the official Claude CLI exclusively owns
  authentication and credential persistence. Bitterless must not parse, receive, encrypt, or store
  the token. Re-review the replacement source implementation rather than treating this as a local
  redaction or safeStorage patch.

#### 2. [P1][blocking] Same-account fences are one-way; a new routing lease is admitted during reconnect/test/mutation/removal

- **Design:** reconnect, test, rename, enable/disable, remove, and a normal request must not race on
  the same account. Removal must clear only after the account has no active request, and reconnect
  must not run setup-token against a config directory concurrently used by prompt execution.
- **Code:** `ClaudeSubscriptionService` records pending authorization, tests, and account mutations
  only in service-private sets and rejects a UI operation when a lease already exists
  (`src/main/claudeSubscription/claudeSubscription.service.ts:186-205,289-344,426-433`).
  `ClaudeAccountRouter.lease()` has no knowledge of those reservations; after reading routing
  records it filters only enabled/credential/auth/cooldown state and increments activity
  (`src/main/claudeSubscription/claudeAccount.router.ts:41-89,160-177`). A request that starts after
  the service-side check is therefore still eligible.
- **Reproduction:** an offline source probe started `removeAccount()`, held
  `browserFactory.clear()` pending, and then called `router.lease()` for the only account. It
  deterministically returned:
  `{"clearPending":true,"leaseGranted":true,"accountId":"00000000-0000-4000-8000-000000000091","activeRequests":1}`.
  Releasing the partition-clear gate then removed the registry/config while that lease existed.
- **Test gap:** the latest regression correctly proves that other **service actions** are rejected
  while partition clearing is pending
  (`tests/claudeSubscription/claudeSubscription.service.test.ts:459-505`), and it is genuinely run
  by the 81-test runner. It never attempts a router lease during that window, so it proves only the
  forward direction of the fence.
- **Impact:** a request may obtain a soon-to-be-deleted config directory/credential during removal,
  or share the exact config directory with an in-progress reconnect/test/metadata transition. This
  defeats the account lifecycle isolation the fence is intended to guarantee.
- **Required fix:** add a router-visible per-account reservation/suspension primitive. Acquire it
  synchronously before the first operation await, make lease selection/recheck exclude reserved
  accounts without a check-to-lease gap, and release it in `finally`. Add deterministic reverse-
  direction regressions for remove, reconnect, test, rename, and enable/disable.

#### 3. [P1][blocking] Shutdown admits new account actions after taking its teardown snapshot

- **Design:** stop must fence new work, abort the auth PTY/window and every account-test/request
  child, await their settlement, and only then report `stopped`.
- **Code:** `stop()` publishes `#stopPromise`, but none of the action methods checks it
  (`src/main/claudeSubscription/claudeSubscription.service.ts:166-174,186-345`). `#stopInternal()`
  snapshots `#activeTests` once before awaiting `authorization.stop()` and later waits only that
  captured array (`claudeSubscription.service.ts:381-398`). A test admitted during that await is
  neither aborted nor awaited.
- **Reproduction:** an offline probe paused `authorization.stop()` after the empty test snapshot,
  started a deferred `testAccount()`, then released shutdown. The observed result was
  `{"stopResolved":true,"serverClosed":true,"executionStarted":true,"executionAborted":false,"snapshotAfterStop":"checking"}`.
- **Test gap:** the existing shutdown test starts the account test **before** calling stop and thus
  covers only work present in the one-time snapshot
  (`tests/claudeSubscription/claudeSubscription.service.test.ts:537-552`).
- **Impact:** app cleanup can resolve with a Claude child still running, and a stopped snapshot can
  simultaneously advertise an account as `checking`. The same admission hole can start a new auth
  flow after the coordinator's stop pass.
- **Required fix:** set a synchronous stopping admission fence before the first teardown await;
  reject or serialize every account/auth action while it is set, then prove stop-vs-test and
  stop-vs-auth interleavings cannot leave work behind.

### P2

#### 4. [P2][blocking] The strict task TypeScript project omits the modified XPC registration helper

- **Code:** `tests/claudeSubscription/tsconfig.strict.json:3-9` includes the Claude directories,
  handler, safeStorage policy, and top-level task tests, but not
  `src/main/xpc/xpc.helper.ts`, which is a declared and modified auth-002 path. Its import direction
  is helper -> handler, so including the handler does not pull the helper into this program.
- **Evidence:** the only broader task command is `yarn typecheck:node`, defined with explicit
  `--noCheck` (`package.json:13`). The configured strict project passes, but it does not semantically
  check that modified helper.
- **Impact:** the stated strict-type verification is incomplete and depends on the repository's
  no-check build for one integration entry point.
- **Required fix:** include the helper in the strict project (or add an equivalent strict integration
  project) and keep `noCheck: false`; verify it in the independent rerun.

## Passing contract evidence

| Boundary                     | Result                        | Evidence                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup-token process adapter  | PASS subject to finding 1     | Uses fixed `/usr/bin/expect` and `/usr/bin/script -q /dev/null <absolute claude> setup-token`, `shell: false`, a static Tcl program with the executable passed as one substituted word, one-shot env removal, detached process-group TERM/KILL, awaited close, and clean inner exit propagation. The real macOS fake-child tests pass, including token-producing non-zero exit. |
| Secret boundary              | PASS subject to finding 1     | Debug/E2E/unpackaged modes fail closed before touching Electron safeStorage; task code has no CLI-output/token logging; action errors and XPC failures are fixed typed/generic values; strict snapshots reject secret-bearing fields. This technical containment does not override the policy prohibition on credential custody.                                                |
| Authorization parsing/flow   | PASS                          | Chunked ANSI/OSC-8 trusted URLs, token delimiters/distinct-token rejection, manual-code gating, timeout, cancellation, stale events, output bounds, clean-exit-only save, and reconnect registry preservation pass focused tests.                                                                                                                                               |
| Browser isolation            | PASS                          | Exact persistent account partition, sandbox/context isolation/web security, no preload/Node/webview/DevTools, popup/download/permission denial, first-party HTTPS allowlist, exact advertised loopback protocol/host/port/path, and main-frame redirect fencing are present. No Electron window was launched.                                                                   |
| Repository and removal scope | PASS with finding 2 exception | UUID-derived exact managed config/partition, plain-directory and realpath containment, owner-only modes, same-directory atomic registry writes, symlink rejection, provisional cleanup in covered success paths, and exact service-to-service removal fence pass. Router admission is not fenced in the reverse direction.                                                      |
| Metadata/XPC/profile         | PASS                          | Inputs/results/snapshots are strict, snapshots are metadata-only with monotonic revision/observation values, boundary/startup errors are sanitized, runtime construction is lazy, and the copied profile is the documented loopback Responses profile without returning its TOML over XPC.                                                                                      |

## Fresh verification

| Check                                                                                         | Result                                                                                                                     |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `node tests/claudeSubscription/run-tests.mjs`                                                 | PASS — 81/81; runner manifest contains every `tests/claudeSubscription/*.test.ts`, including the latest removal-fence test |
| `yarn -s tsc -p tests/claudeSubscription/tsconfig.strict.json`                                | PASS for its configured include set; incomplete per finding 4                                                              |
| `yarn -s typecheck:node`                                                                      | PASS — repository command uses `--noCheck`                                                                                 |
| Targeted ESLint over task implementation, XPC, policy, and tests                              | PASS — 0 errors/warnings                                                                                                   |
| Task-scoped `git diff --check`                                                                | PASS                                                                                                                       |
| Reverse removal/lease offline probe                                                           | REPRODUCED — lease granted while exact partition clear was pending                                                         |
| Stop/action offline probe                                                                     | REPRODUCED — stop resolved with deferred test alive, not aborted, and snapshot `checking`                                  |
| Electron, real Claude CLI/login/browser, Anthropic requests, external network, Playwright/E2E | NOT RUN — explicitly outside this review boundary                                                                          |

## Conclusion

**BLOCKED.** The credential-ownership premise must be replaced at the design boundary, and the
router/action lifecycle races plus strict-check gap require source/test repair before another
independent review. Task state was not changed by this reviewer. No packaged Electron login or live
Claude acceptance is claimed.
