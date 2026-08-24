# Claude Subscription Accounts Delivery Analysis

## Goal and source-of-truth correction

Deliver the accepted [feature contract](../../features/claude-subscription-accounts.md) inside
Bitterless Main. BL Relay and direct Anthropic API integration remain out of scope.

The auth-002 review found the earlier setup-token design invalid. Anthropic's current legal and
compliance documentation says developers may not collect, store, or intermediate Claude.ai
credentials or session tokens; the supported exception is the end user signing in through
unmodified Claude Code. The design therefore changed from Bitterless token custody to isolated,
CLI-owned login/Keychain/logout. Old setup-token, encrypted-token, cipher, and safeStorage code is
removed rather than migrated.

## Module decomposition

| Module | Input | Output | Boundary | Task |
|---|---|---|---|---|
| Shared contract/schema | unknown XPC values | strict metadata snapshots/actions | no path, partition, URL, output, or credential in outputs/events; code is one bounded submit input | core-001/auth-002 |
| Account repository v2 | verified CLI status metadata + exact managed identity | account views and execution contexts | persists paths/metadata, never credentials | core-001/auth-002 |
| CLI capability probe | absolute CLI candidate | canonical path + isolated-storage capability | regular-file streaming marker scan, fail closed | auth-002 |
| Auth login PTY | exact three-directory context | OAuth URL/manual prompt/exit only | fixed Expect → script → `auth login --claudeai` | auth-002 |
| Auth command verifier | same context | paid first-party metadata or typed failure | status/logout only; detects fallback file presence | auth-002 |
| Auth BrowserWindow | trusted URL + exact partition | isolated user interaction | first-party/email-only navigation fence | auth-002 |
| Router | routing records/context | sticky least-active lease | exclusive two-way maintenance fence | core-001/auth-002 |
| Executor | normalized payload + context | final/tool decision + usage/error | status preflight then unmodified `claude -p` | core-001/auth-002 |
| Loopback server | Responses requests | health/models/SSE | fixed `127.0.0.1:8741` | core-001 |
| Main service/runtime/XPC | lifecycle + metadata actions | serialized snapshots/events | stopped admission fence and settled teardown | auth-002 |
| Maestro Workbench configuration | metadata-only XPC | account/provider configuration UI | ui-003; no secret-bearing state | ui-003 |

## Critical integration contracts

1. Runtime resolves the CLI lazily, canonicalizes it, proves it is a regular file, requires the
   Anthropic Claude Code Developer ID identifier/Team ID through macOS code-signing verification,
   and stream-scans for `CLAUDE_SECURESTORAGE_CONFIG_DIR` before repository, auth, or execution
   becomes available. Signature failure, marker absence, or read failure has no fallback.
2. Repository v2 stores account ID, label, optional email, paid subscription type, exact three
   directories, exact partition, enabled state, and timestamps. Version 1 token-bearing registries
   fail closed without decryption. All registry mutations share one queue before atomic persistence,
   preventing cross-account lost updates.
3. Login, status, logout, Test, and prompt all use one environment builder. It injects exact
   `CLAUDE_CONFIG_DIR`, `CLAUDE_SECURESTORAGE_CONFIG_DIR`, and `ANTHROPIC_CONFIG_DIR`, never an
   OAuth token, and scrubs competing Anthropic/cloud/host auth.
4. Login is fixed shell-free `/usr/bin/expect` controlling `/usr/bin/script -q /dev/null
   <absolute-claude> auth login --claudeai`. The static Tcl propagates the inner status.
5. The coordinator parses only trusted OAuth URL and real manual-code prompt. Clean login exit is
   not success until same-context status proves paid first-party Claude.ai auth and the plaintext
   fallback file is absent.
6. Accepted status is exit zero, `loggedIn:true`, `authMethod:'claude.ai'`,
   `apiProvider:'firstParty'`, absent `apiKeySource`, absent-or-`claudeai` forced method, and plan
   `pro|max|team|enterprise`. Email may be a string or null. Free/null/unknown plans fail with
   typed `subscription_required`.
7. New-account verification/commit failure performs best-effort same-context logout before exact
   partition/directory cleanup. Existing reconnect failure never automatically logs out or clears
   the old namespace, but is immediately marked `needsLogin`; Claude may already have replaced the
   old credential, so retry is required.
8. Remove requires exact-context logout exit zero, then strict logged-out status exit one, fallback
   absence, immediate routing invalidation, partition clear, and registry/directory removal. A
   post-logout cleanup failure leaves a visible non-routable reconnect record.
9. Router maintenance and request leases are mutually exclusive. Lease selection rechecks after
   context awaits and before the synchronous grant. Missing or replaced managed account directories
   fail closed to `needsLogin` and selection continues to another account. Service holds maintenance
   across every await in auth/Test/rename/enable/remove.
10. Service closes action admission synchronously at stop, rechecks after initialization awaits,
    cancels PTY/browser/tests/server, and awaits already-admitted account lifecycle operations.
11. Snapshot reads and publications share one serialized queue. Auth error metadata is captured
    and broadcast before later XPC reads or the terminal null snapshot, preserving monotonic
    revision semantics under slow repository reads. Routing grant/release/cooldown/login changes
    schedule coalesced metadata-only snapshots so ordinary Responses traffic updates Configuration.

## UI integration handoff

`ui-003` restores the Maestro Mini App as visible/openable and moves Home Settings model, Mini
Apps, and Connector configuration into the Maestro Workbench `配置` tab. Claude account management
lives there. Provider `local` (label `Local`) is a fixed view of the existing loopback Responses
endpoint and the three accepted Claude aliases; it has no editable URL/key and creates no service.
Google/enterprise SSO remains unverified and unsupported in this first-party/email-only boundary.

## Compatibility and product risks

| Risk | Fail-closed behavior / owner action |
|---|---|
| Undocumented secure-storage directory variable changes | marker probe disables auth/execution; Ral upgrades only after compatibility validation |
| Marker exists but semantics change | strict status, fallback-file, logout, and real owner acceptance; consider a reviewed executable SHA-256 allowlist |
| Keychain write falls back to plaintext | detect file presence only, reject, logout, clean provisional account |
| Reconnect partially changes CLI credential | retain metadata but mark reconnect/non-routable; Ral retries |
| Logout succeeds and later cleanup fails | keep row reconnect/non-routable; retry cleanup |
| Google/enterprise SSO redirects outside fence | report unsupported; do not widen to arbitrary IdP navigation |
| Anthropic usage credits allow extra billing | Ral disables usage credits per account for a hard subscription-limit stop |
| `auth status` is only a local-presence check | Test action uses a bounded real no-tool prompt; development tests remain fake |

## Delivery sequence

1. `claude-subscription-core-001`: pure repository/router/executor/Responses foundation, updated by
   auth-002 where the original token-custody interfaces were invalidated.
2. `claude-subscription-auth-002`: CLI-owned auth/login/logout, capability probe, browser, Main
   service/runtime/XPC, races, lifecycle, and fake/source tests. Keep `in-progress` until a new
   independent review closes the blocked review.
3. `claude-subscription-ui-003`: Maestro Workbench configuration and `Local` provider integration.

## Verification ownership

Automated fixtures cover the intended contracts, including PTY exit/teardown, capability marker
boundaries, environment scrubbing, status matrices, cleanup order, routing races, lifecycle gates,
and strict XPC metadata. Per Ral's latest direction, implementation agents do not run tests,
typecheck, lint, formatting, build, Electron, Claude, browser, network, or E2E; Ral performs the
verification pass.

## Sources

- [Feature contract](../../features/claude-subscription-accounts.md)
- [Blocked auth review](../reviews/claude-subscription-auth-002-1.md)
- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Claude Code headless mode](https://code.claude.com/docs/en/headless)
- [Codex configuration reference](https://developers.openai.com/codex/config-reference)
