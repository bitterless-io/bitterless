---
id: claude-subscription-core-001
scope: Claude subscription account core and embedded Responses runtime
status: implemented; owner verification pending
depends-on: []
---

# Objective

Implement the pure Main-compatible core for metadata-only accounts, subscription-only unmodified
Claude CLI execution, sticky least-active routing with bounded failover, Codex Responses
normalization/SSE, and a loopback-only HTTP server. Auth-002 subsequently replaced the invalid
token-custody interfaces with exact CLI-owned execution contexts and two-way maintenance.

# Context

- `docs/features/claude-subscription-accounts.md`
- `docs/plan/analysis/claude-subscription-accounts.md`
- `docs/features/model-provider.md`

# Path

- `src/shared/claudeSubscription/`
- `src/main/claudeSubscription/claudeSubscription.errors.ts`
- `src/main/claudeSubscription/claudeSubscription.environment.ts`
- `src/main/claudeSubscription/claudeAccount.repository.ts`
- `src/main/claudeSubscription/claudeAccount.router.ts`
- `src/main/claudeSubscription/claudeResponses.translator.ts`
- `src/main/claudeSubscription/claudeResponses.stream.ts`
- `src/main/claudeSubscription/claudeCli.executor.ts`
- `src/main/claudeSubscription/claudeResponses.server.ts`
- `tests/claudeSubscription/`
- `docs/features/claude-subscription-accounts.md`
- `docs/plan/tasks/claude-subscription-core-001.md`

# Verification

- Node tests cover registry-v2 atomic modes, path containment, paid-plan/email metadata-only views,
  and fail-closed legacy token-bearing registries.
- Node tests cover one environment sanitizer, no token injection, exact three-directory isolation,
  plaintext fallback rejection, and strict paid `claude.ai` + `firstParty` preflight.
- Node tests cover exact model and per-request effort mapping, final/tool decisions, redaction,
  cancellation, and output limits.
- Node tests cover sticky least-active selection, exclusive maintenance in both race directions,
  cooldown/auth invalidation, one retry, and no retry for generic failures.
- Node tests cover Codex text/function fixtures, ordered SSE, loopback bind, Origin/content-type/body
  rejection, abort, and server close.
- Per Ral's 2026-08-24 direction, Ral—not the implementation agent—runs the verification commands.
