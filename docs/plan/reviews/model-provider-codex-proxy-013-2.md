# Review: model-provider-codex-proxy-013 (2)

## Findings

No blocking or non-blocking findings.

## Verification evidence

- The prior process-global race is resolved by one coordinator-owned routing dispatcher. It is
  installed once, retains the original global dispatcher as fallback, and neither the Codex nor
  Maestro adapters calls `setGlobalDispatcher` directly
  (`src/main/networking/outboundHttpDispatcher.service.ts:119-145,175-182`,
  `src/main/codex/codexProxy.service.ts:162-168`, and
  `src/main/maestro/net/proxy.ts:30-37`).
- Routing order is stable and contract-scoped: exact OpenAI/ChatGPT domain or subdomain matches use
  the Codex proxy, exact IPv4/hostname/IPv6 loopback destinations always use the captured fallback,
  a live Maestro lease handles only the remaining destinations, and all other traffic uses the
  fallback (`src/main/networking/outboundHttpDispatcher.service.ts:8-45,62-76`). Hostile suffixes
  do not pass the domain-boundary predicate.
- Maestro-first and Codex-first initialization converge on the same installed dispatcher. Maestro
  leases are counted; every returned release is idempotent; the Maestro route clears only after the
  final lease; and Codex routing is unaffected by acquire/release ordering
  (`src/main/networking/outboundHttpDispatcher.service.ts:124-171`).
- Dispatcher lifecycle uses a `Set` of the fallback, Codex, and Maestro delegates, so each unique
  delegate participates once in each coordinated close/destroy operation and promise/callback
  overloads settle through the same completion (`src/main/networking/outboundHttpDispatcher.service.ts:47-60,78-106`).
- Proxy settings remain strict and fail-closed. The implementation accepts only the exact
  versioned two-key schema and explicit `http`/`https` loopback URL with port `1..65535`; only
  `ENOENT` authorizes the missing-file fallback; every other read/JSON/schema/install failure
  rejects the cached process setup (`src/main/codex/codexProxy.service.ts:51-123,142-187`).
- The Codex adapter does not mutate proxy environment variables. Its `EnvHttpProxyAgent` receives
  both proxy directions plus `127.0.0.1,localhost,[::1]`, and logs only fixed lifecycle fields,
  scheme, loopback host class, and port (`src/main/codex/codexProxy.service.ts:5,151-181`). Undici
  8.3 intentionally keeps IPv6 brackets from `URL.host` during `noProxy` matching, so `[::1]`
  correctly bypasses `http://[::1]:1455`.
- Both embedded Pi modules still await the shared proxy setup before their dynamic imports
  (`src/main/codex/codexCredential.runtime.ts:10-13` and
  `src/main/codex/codexRuntime.runtime.ts:9-12`). This covers Pi's global-fetch OAuth exchange and
  subsequent Codex model transport through the stable dispatcher.
- Focused tests substantively cover strict parsing, missing and invalid settings, fail-closed
  caching, safe diagnostics, environment immutability, dispatcher options, hostile domain suffixes,
  missing-Codex fallback, both initialization orders, lease counting/idempotent release, unique
  delegate lifecycle, and import ordering
  (`tests/modelProvider/codexProxy.service.test.ts:68-402`). The test is wired into the canonical
  model-provider runner (`tests/modelProvider/run-tests.mjs:10-14`).
- `git diff --check` passed. Per owner instruction, the focused tests and all other automated tests,
  typecheck, lint, build, packaging, release, and Electron launch were not run.

## Conclusion

**PASS.** The previous P1 dispatcher-ownership race and P2 missing-test artifact are resolved, and
the task is ready for the owner's build and runtime verification.
