---
id: translator-thinking-off-008
scope: omni-translator Codex runtime controls
status: in-progress
depends-on: [translator-runtime-diagnostics-007]
---

# Objective

Keep Translator's complete request deadline at exactly 60 seconds and make its GPT-5.5 inference
explicitly reasoning-free by setting both Pi thinking off and the Codex wire payload reasoning
effort to `none`, without changing other runtime consumers.

# Context

- `docs/features/translator.md`
- `docs/issues/translator-timeout-and-thinking-off.md`
- `docs/features/model-provider.md`

# Path

- `src/main/translator/translator.service.ts`
- `src/main/codex/codexRuntime.service.ts`
- `tests/coin/unit/codexRuntime.service.test.ts`
- `tests/translator/translatorRuntimeDiagnostics.test.mjs`
- `docs/features/translator.md`
- `docs/issues/translator-timeout-and-thinking-off.md`

# Verification

- Independent source review verifies the exact `60_000 ms` timer remains at the accepted-request
  boundary and all previously deadline-bound stages remain covered.
- Independent source review verifies Translator sends Pi thinking off plus explicit Codex reasoning
  effort `none`, retains Fast priority, and leaves default runtime consumers unchanged.
- `git diff --check`.
- Per owner instruction, do not run automated tests, typecheck, Electron, build, package, or release
  commands. The owner will manually verify latency and translation output.
