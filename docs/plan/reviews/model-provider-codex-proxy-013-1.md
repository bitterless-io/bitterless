# Review: model-provider-codex-proxy-013 (1)

## Findings

### P1 · blocking — Codex and Maestro race over the same process-global dispatcher

- Contract: `docs/features/model-provider.md:120-124` and
  `docs/plan/tasks/model-provider-codex-proxy-013.md:35-38` require the configured profile-local
  dispatcher to carry both Codex login and later model requests while leaving callback ownership
  unchanged.
- Codex code: `src/main/codex/codexProxy.service.ts:133-140,157-165` installs and restores its
  `EnvHttpProxyAgent` through Undici's process-global `setGlobalDispatcher()`.
- Conflicting code: `src/main/maestro/net/proxy.ts:22-43` independently replaces that same global
  dispatcher for the complete lifetime of a Maestro lease.

This cannot guarantee the documented Codex route. If Maestro acquires its lease while a browser
login is waiting for its callback, the later OAuth token exchange uses Maestro's environment proxy
instead of the profile-local Codex proxy. The same replacement can occur between a runtime load and
its later provider request. In the opposite ordering, Codex's restore overwrites the active Maestro
dispatcher; Maestro's release then skips its guarded restore because the current dispatcher is no
longer `maestroDispatcher`, leaving unrelated Main-process traffic on the Codex proxy.

The primary network boundary therefore remains order-dependent and cross-subsystem traffic can be
rerouted. Delivery requires one coordinated global-dispatcher owner (or an equivalent dispatcher
that performs stable per-request/per-origin routing) so Codex and Maestro cannot overwrite each
other.

### P2 · blocking — Task-required focused source tests are absent

- Contract: `docs/plan/tasks/model-provider-codex-proxy-013.md:20-27` includes focused source tests
  for strict parsing and runtime installation in the task path.
- Evidence: no test references `parseCodexProxySettings`, `ensureCodexProxyDispatcher`, or the
  `codex-proxy` lifecycle. The only task implementation is the new
  `src/main/codex/codexProxy.service.ts` plus its two runtime call sites.

The owner's instruction not to *run* automated tests does not remove the task's test-artifact
contract. Add bounded source tests for exact schema/URL acceptance and rejection, missing-file
fallback, present-invalid fail-closed behavior, safe lifecycle logging, environment immutability,
loopback bypass, and installation-before-import ordering. They can remain unexecuted in this
delivery, as the task already records.

## Audited contract evidence

- Strict parsing rejects extra/missing keys and restricts the URL to `http`/`https`, the three
  loopback hosts, an explicit port in `1..65535`, and no trailing URL components
  (`src/main/codex/codexProxy.service.ts:37-87`).
- Missing-file fallback is limited to `ENOENT`; unreadable, malformed, and invalid present files
  throw a typed configuration error and the rejected process-cached setup promise keeps later Codex
  operations fail-closed (`src/main/codex/codexProxy.service.ts:89-130,157-159`).
- No proxy environment variable is assigned. Success logs expose only fixed fields, scheme,
  loopback host class, and port; error messages are fixed and contain no raw configuration value
  (`src/main/codex/codexProxy.service.ts:113-154`).
- Both embedded Pi imports are sequenced after proxy setup
  (`src/main/codex/codexCredential.runtime.ts:10-13` and
  `src/main/codex/codexRuntime.runtime.ts:9-12`). Pi's OAuth token exchange and Codex SSE path both
  use global `fetch`, so the process-global Undici dispatcher is the relevant request boundary.
- IPv6 callback bypass is correct for Undici 8.3: its `EnvHttpProxyAgent` intentionally preserves
  brackets from `URL.host` before exact `noProxy` matching, so `[::1]` in
  `CODEX_PROXY_NO_PROXY` matches `http://[::1]:1455` while `127.0.0.1` and `localhost` match
  directly (`node_modules/undici/lib/dispatcher/env-http-proxy-agent.js:65-70,93-100,112-127`).
- `git diff --check` passed. Per owner instruction, no automated tests, typecheck, lint, build,
  packaging, release, or Electron launch was run.

## Conclusion

**BLOCKED.** Resolve the process-global dispatcher ownership conflict and add the task-owned focused
source tests, then request a new independent review.
