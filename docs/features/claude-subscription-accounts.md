# Claude Subscription Accounts

Status: Accepted

## Purpose

Bitterless owns a pure-local pool of Ral's Claude subscription accounts and exposes an embedded
OpenAI Responses-compatible endpoint for Codex. Every authorization and inference request runs
through the installed, unmodified Claude Code CLI. Bitterless does not restore BL Relay, call the
Anthropic API directly, or use separately billed API keys.

Anthropic's current legal boundary prohibits developers from collecting, storing, or
intermediating Claude.ai credentials or session tokens. It permits an end user to sign in through
unmodified Claude Code. Therefore the CLI owns login, refresh, Keychain access, logout, and
execution; Bitterless never reads, parses, encrypts, copies, returns, or persists a credential.

## Architecture and ownership

```text
Maestro Workbench · Configuration
        │ metadata-only XPC
        ▼
ClaudeSubscriptionService (Electron Main)
        ├── ClaudeAccountRepository ── account metadata + exact isolated paths
        ├── ClaudeAuthorizationCoordinator
        │       ├── fixed Expect/script PTY ──► unmodified `claude auth login --claudeai`
        │       └── isolated BrowserWindow partition
        ├── ClaudeAccountRouter ── context leases + exclusive maintenance fence
        ├── ClaudeCliExecutor ──► unmodified `claude auth status --json` / `claude -p`
        └── ClaudeResponsesServer ── 127.0.0.1:8741/v1/responses ◄── Codex
```

- Renderer receives account ID, local label, optional email, paid subscription type, status,
  activity counts, timestamps, server state, and sanitized typed errors only.
- Configuration directories, Keychain namespace inputs, browser partitions, OAuth URLs, terminal
  output, provider bodies, cookies, and credential material never appear in XPC outputs or events.
  A manual code crosses only as the bounded one-time `submitAuthorizationCode` input while the real
  CLI prompt is active, then Main clears it immediately.
- Main owns filesystem containment, PTY/browser/process lifetimes, routing, snapshots, and the
  loopback server. The CLI owns all credential material.
- Codex owns filesystem and external tool execution. Claude tools, MCP, Chrome, and session
  persistence are disabled; Claude returns final text or one normalized Codex function request.

## CLI-owned isolated credential storage

The version-2 registry under `<userData>/claude-subscription/` stores metadata and exact paths:

```ts
interface StoredClaudeSubscriptionAccount {
  id: string;
  label: string;
  email?: string;
  subscriptionType: 'pro' | 'max' | 'team' | 'enterprise';
  configDirectory: string;
  secureStorageConfigDirectory: string;
  anthropicConfigDirectory: string;
  partition: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
```

For this iteration, the exact managed paths are:

- `CLAUDE_CONFIG_DIR=<root>/accounts/<id>/profile`;
- `CLAUDE_SECURESTORAGE_CONFIG_DIR=<same exact absolute NFC profile path>`;
- `ANTHROPIC_CONFIG_DIR=<profile>/anthropic`;
- `partition=persist:bitterless-claude-account-<id>`.

The three paths are persisted rather than recomputed before logout. Managed directories are plain
directories contained below the account root, use mode `0700`, and cannot be symlinks. Registry
writes share one repository mutation queue, then use a `0600` same-directory temporary file and
atomic rename, so concurrent mutations for different accounts cannot overwrite one another.

`CLAUDE_SECURESTORAGE_CONFIG_DIR` is an undocumented current Claude Code compatibility contract.
At startup, Bitterless resolves the absolute CLI to a canonical regular file, requires macOS to
validate its Developer ID signature against Anthropic's Claude Code identifier and Team ID, and
then stream-scans the binary for the exact ASCII marker. A failed signature check or
missing/unreadable marker disables authorization and execution; there is no unsigned executable or
global-Keychain fallback. The signature proves official, unmodified provenance while the marker
proves compatibility intent; every CLI upgrade remains a behavioral compatibility risk and must be
revalidated.

On macOS, the current CLI uses this path to isolate its Keychain namespace. If Keychain writing
falls back to `<secureStorageConfigDirectory>/.credentials.json`, Bitterless detects only the
file's presence, never reads or follows it, removes only that exact managed entry, rejects the
request, and marks a persisted account for reconnect. Authorization failures also attempt
same-environment logout before removing a provisional account. Plaintext fallback is never accepted
for routing.

## Official authorization flow

```text
Add / Reconnect
    ▼
/usr/bin/expect -c <fixed static Tcl>        shell:false, detached process group
    ▼
/usr/bin/script -q /dev/null <absolute claude> auth login --claudeai
    │ exact three-directory environment; BROWSER=/usr/bin/true
    ▼
parse only a trusted Anthropic HTTPS OAuth URL or a real manual-code prompt
    ▼
isolated BrowserWindow; Ral completes first-party/email login and consent
    ▼
normal CLI exit
    ▼
same environment: claude --safe-mode --setting-sources ''
  --settings '{"apiKeyHelper":null}' auth status --json
    ▼
persist metadata only after strict paid-subscription verification
```

The fixed Expect program passes the executable as argv, removes its one-shot environment variable
before spawning Claude, waits for the inner process, and propagates non-zero/signal failure.
Cancellation uses bounded process-group `SIGTERM` then `SIGKILL`; stop awaits process settlement.
Terminal output is bounded and retained only as a redacted parser tail for URL/manual-prompt
detection. Token-shaped text has no parser or persistence path.

The BrowserWindow has no preload, Node integration, subframe Node integration, webview attachment,
DevTools, popup, permission, download, or external-open capability. It uses sandbox, context
isolation, web security, and the exact account partition. Navigation permits trusted Anthropic
HTTPS hosts and only the exact advertised loopback callback. URL userinfo is rejected.

This iteration promises Claude first-party/email sign-in only. Google and enterprise SSO are not
verified and are not enabled by widening the trust fence.

The manual code is accepted once, only while a real prompt is visible, and must be a bounded
single line without CR, LF, or NUL. It is cleared after submit/cancel/terminal state.

## Verification and account lifecycle

`auth status --json` is accepted only when all of these are true:

- process exit is zero and JSON reports `loggedIn: true`;
- `authMethod` is exactly `claude.ai`, `apiProvider` is exactly `firstParty`;
- `apiKeySource` is absent;
- `forcedLoginMethod` is absent or `claudeai`;
- `subscriptionType` is one of `pro`, `max`, `team`, or `enterprise`.

`null`, `free`, unknown plans, API keys, cloud providers, malformed output, and plaintext fallback
all fail closed. Optional `email` may be a bounded string or null; only a valid string is exposed as
metadata. Subscription status is also checked before every prompt. The account Test action adds a
bounded real no-tool prompt because local `auth status` proves credential presence, not service-side
validity.

Reconnect uses the existing isolated CLI namespace. Claude may replace the old credential during
login; therefore any failed or cancelled reconnect keeps the registry row but immediately marks it
`reconnect`/`needsLogin` and removes it from routing. The UI must ask Ral to retry and must not claim
that the old credential remains usable. Existing-account failures never clear its partition or
directory and never run automatic logout.

Remove is ordered and fail closed:

1. acquire exclusive account maintenance after proving there is no active request;
2. run unmodified `claude auth logout` in the exact persisted environment;
3. require logout exit zero, then strict logged-out status exit one with exactly
   `loggedIn:false`, `authMethod:'none'`, `apiProvider:'firstParty'`;
4. require `.credentials.json` to be absent;
5. immediately mark the account non-routable, then clear its exact Electron partition;
6. remove metadata and the exact managed directory.

Logout failure preserves the account record but marks it `reconnect`, because a failed command does
not prove the CLI left the credential unchanged. If partition or registry cleanup fails after
logout, the row likewise remains visible as `reconnect` and cannot be leased. A new provisional
account that reaches CLI login but fails verification or metadata commit receives best-effort
same-environment logout, partition cleanup, and managed-directory cleanup.

## Child environment and execution

All login, status, logout, Test, and prompt children use the same allowlist helper. It passes only
basic identity/path, locale, proxy, temporary-directory, certificate, terminal, and platform
variables, then injects the exact three account directories and value-free Claude
telemetry/title/survey disables. It never injects `CLAUDE_CODE_OAUTH_TOKEN`.

Inherited Anthropic API/auth/base URL/profile/federation/organization variables, OAuth/refresh
tokens and scopes, host credential files, provider-managed flags, Bedrock/Vertex/Foundry/Mantle,
AWS/Google/Azure selectors, API-key helpers, and competing config directories are excluded.

The prompt process uses safe mode, empty setting sources, `apiKeyHelper:null`, no Chrome/tools/MCP,
no session persistence, a `0600` system prompt, bounded stdout/stderr, and a strict decision schema:

```ts
type ClaudeDecision =
  | { action: 'final'; text: string }
  | { action: 'tool_call'; tool_name: string; arguments: string };
```

Model aliases are fixed: `claude-sonnet → sonnet`, `claude-opus → opus`, and
`claude-haiku → haiku`. Effort mapping remains request-specific. Authentication and explicit
usage-limit failures may fail over once; malformed requests, decisions, timeout, cancellation, and
unknown errors do not.

## Routing, maintenance, and lifecycle

Eligible accounts are enabled, paid, context-capable, not in maintenance, not `needsLogin`, and not
cooling down. Routing reuses an eligible prompt-cache binding, otherwise selects the least-active
account with round-robin ties. Account directories are revalidated before health/snapshot reporting
and before a lease; a missing, replaced, or symbolic-link context is marked `reconnect`, excluded,
and routing continues to the next eligible account.

Maintenance is an exclusive per-account reservation. An active request prevents maintenance;
maintenance prevents a new lease. Candidate selection, post-context-await eligibility, and the
final synchronous grant all check maintenance, closing both race directions. Reconnect, Test,
rename, enable/disable, and remove hold the reservation across every await. Stop closes action
admission synchronously, cancels PTY/browser/tests/server work, and awaits already-admitted account
lifecycle operations before returning. Snapshot reads and publications share one serialized queue
with monotonic revisions, so a concurrent XPC response cannot hide a sanitized asynchronous auth
error before the terminal null flow. Lease grant/release, usage cooldown, cooldown expiry, and
authentication/context invalidation coalesce into metadata-only snapshot broadcasts, keeping
Configuration activity and status current without exposing prompts or account paths.

## Loopback Responses and Codex handoff

The optional server binds only `127.0.0.1:8741`, rejects browser `Origin`, exposes aggregate
`/health`, the fixed `/v1/models`, and streaming `/v1/responses`. It never silently changes host or
port. Responses preserve instruction/message/function ordering and emit ordered SSE ending in
`response.completed` and `[DONE]`.

The copy action writes a fixed Codex profile to the Main clipboard and returns only success/error.
Bitterless does not edit Codex configuration automatically.

## Maestro integration

The implementation target for `ui-003` is the Maestro Workbench `配置` tab, not a new standalone
service. The Maestro Mini App must again be visible and openable. Model, Mini Apps, and Connector
configuration currently surfaced in Home Settings move into Workbench configuration, where Claude
account management, server state, and config-copy actions live.

Workbench also gains provider ID `local` (label `Local`). It is fixed to the same
`http://127.0.0.1:8741/v1` Responses endpoint and only the accepted
`claude-sonnet`/`claude-opus`/`claude-haiku` aliases. It does not accept an arbitrary URL or API key
and does not create another server. Existing Codex OAuth/Translator behavior remains independent.

## Billing boundary

Bitterless proves paid first-party subscription authentication and prevents local API-key/cloud
fallback. It cannot control Anthropic's server-side usage-credit setting. Ral must disable usage
credits on every connected account when the desired behavior is a hard stop after included plan
usage. The UI shows state, email when available, and plan type; it never estimates remaining quota.

## Entry points

- `src/shared/claudeSubscription/`
- `src/main/claudeSubscription/`
- `src/main/xpc/claudeSubscription.handler.ts`
- Maestro Workbench configuration integration in follow-up task `claude-subscription-ui-003`

## Sources

- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Claude Code model configuration](https://code.claude.com/docs/en/model-config)
- [Claude Code headless mode](https://code.claude.com/docs/en/headless)
- [Claude account login methods](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)
- [Claude plan usage with Agent SDK and `claude -p`](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Codex configuration reference](https://developers.openai.com/codex/config-reference)
