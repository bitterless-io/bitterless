---
id: model-provider-codex-proxy-013
scope: shared-model-provider
status: implemented; owner verification pending
depends-on: [model-provider-loopback-diagnostics-011, codex-production-login-recovery-012]
---

# Objective

Give embedded Codex login and model requests an explicit, profile-local HTTP proxy so their
outbound route remains correct even when the host process has no proxy environment variables.

# Context

- `docs/features/model-provider.md`
- `docs/features/application-diagnostics.md`
- `docs/issues/codex-network-bypasses-local-proxy.md`
- Production evidence in `~/Library/Logs/Bitterless/main.log` from 2026-08-25

# Path

- `src/main/codex/codexPaths.ts`
- `src/main/codex/codexProxy.service.ts`
- `src/main/codex/codexCredential.runtime.ts`
- `src/main/codex/codexRuntime.runtime.ts`
- `src/main/networking/outboundHttpDispatcher.service.ts`
- `src/main/maestro/net/proxy.ts`
- focused source tests for proxy parsing and runtime installation
- the feature, issue, task, and review documents for this change

# Contract

- Read optional strict JSON from `<userData>/cowork/pi/settings.json` with
  `schemaVersion: 1` and `httpProxy`.
- Accept only `http:` or `https:` URLs whose hostname is `127.0.0.1`, `localhost`, or `::1`, with
  an explicit valid port and no credentials, path, query, or fragment.
- Always bypass `127.0.0.1`, `localhost`, and `::1` so OAuth callbacks stay inside the host.
- Install the configured Undici dispatcher before either embedded Pi module is imported. Login
  token exchange and later model requests therefore share one route.
- Keep one stable process-global routing dispatcher. OpenAI/ChatGPT destinations select the Codex
  proxy while a live Maestro proxy lease applies only to the remaining destinations; neither
  subsystem may replace or restore over the other's route during concurrent work.
- Do not mutate `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, or `NO_PROXY`.
- Missing configuration preserves existing/default routing. Present but unreadable, malformed, or
  invalid configuration fails closed for Codex operations instead of silently using direct access.
- Configuration changes take effect after the next application launch.
- Logs expose only fixed lifecycle fields plus proxy scheme, loopback host class, and port. They
  never expose a raw URL, credentials, headers, tokens, response bodies, or query values.
- Provider SQLite/XPC/auth-state contracts and OAuth callback ownership remain unchanged.

# Verification

- Independent source review confirms strict parsing, fail-closed behavior, loopback bypass,
  installation before Pi import, coverage of both credential and model runtimes, and race-free
  coexistence with Maestro's proxy lease.
- `git diff --check` passes for the task-owned change.
- Per owner instruction, automated tests, Electron launch, build, packaging, and release are not run;
  the owner will build and perform runtime verification.

# Reviews

- [Initial blocked review](../reviews/model-provider-codex-proxy-013-1.md)
- [Final passing review](../reviews/model-provider-codex-proxy-013-2.md)
