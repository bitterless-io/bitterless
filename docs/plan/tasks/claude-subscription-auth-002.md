---
id: claude-subscription-auth-002
scope: unmodified Claude CLI-owned authorization and Main XPC account service
status: implemented; owner verification pending
depends-on: [claude-subscription-core-001]
---

# Objective

Connect the core to Electron Main without credential custody: add fixed `auth login --claudeai` and
`auth logout` orchestration, a fail-closed CLI compatibility probe, per-account CLI-owned isolated
credential namespaces and BrowserWindow partitions, metadata-only service/runtime/XPC, clipboard
profile handoff, two-way routing maintenance, and bounded lifecycle teardown. Do not implement the
Maestro Workbench UI in this task.

The earlier setup-token/safeStorage implementation was blocked by
`docs/plan/reviews/claude-subscription-auth-002-1.md` and is removed. Anthropic prohibits developer
collection/storage/intermediation of Claude.ai credentials; only the unmodified CLI may own them.

# Context

- `docs/features/claude-subscription-accounts.md`
- `docs/plan/analysis/claude-subscription-accounts.md`
- `docs/plan/reviews/claude-subscription-auth-002-1.md`

# Path

- `src/main/claudeSubscription/`
- `src/main/security/safeStoragePolicy.service.ts`
- `src/main/xpc/claudeSubscription.handler.ts`
- `src/main/xpc/xpc.helper.ts`
- `src/main/app.main.ts`
- `src/shared/startup/startupDiagnostics.ts`
- `src/shared/claudeSubscription/`
- `tests/claudeSubscription/`
- `docs/features/claude-subscription-accounts.md`
- `docs/plan/tasks/claude-subscription-auth-002.md`

# Verification

- Tests cover chunked ANSI/OSC-8 URL/manual-prompt parsing with no token parser, bounded one-time
  manual code, cancellation, timeout, malformed output, process-group teardown, and propagation of
  an inner non-zero fake CLI exit through Expect/script.
- Tests cover canonical regular-file marker probing, chunk boundaries, missing/unreadable marker,
  and no compatibility fallback.
- Tests cover one sanitized environment for login/status/logout/Test/prompt, exact
  `CLAUDE_CONFIG_DIR`, `CLAUDE_SECURESTORAGE_CONFIG_DIR`, `ANTHROPIC_CONFIG_DIR`, and absence of
  inherited OAuth/API/cloud/host credentials.
- Tests cover paid Claude.ai first-party status, optional/null email, subscription-required errors,
  plaintext fallback rejection, strict logged-out exit/status, metadata commit, provisional logout,
  reconnect fail-closed state, and remove ordering/partial failures.
- Source tests prove BrowserWindow uses the exact account partition, no preload/Node/DevTools, and a
  trusted navigation allowlist.
- Tests prove exclusive account maintenance closes both routing race directions and stop rejects new
  work while awaiting already-admitted mutations.
- Tests prove XPC outputs/events are strict metadata only, inputs are strict, the manual code exists
  only in the bounded submit action, and serialized monotonic snapshots expose asynchronous typed
  auth errors.
- Tests prove copied Codex profile matches the documented loopback Responses provider.
- Strict task TypeScript includes every touched task source, including `xpc.helper.ts`.
- Per Ral's 2026-08-24 direction, implementation agents do not run tests, typecheck, lint,
  formatting, build, Electron, Claude, browser, network, or E2E. Ral performs verification.

# Remaining gate

- Ral runs the prepared automated and live-login verification and accepts the CLI-owned isolation,
  cleanup semantics, maintenance races, lifecycle gate, and strict task scope.
