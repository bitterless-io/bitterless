# Separate runtime policy from provider adaptation

Status: implemented · focused code verification complete; human testing pending · 2026-09-14

## Intent and current boundary

Ral requests lighter adapters whose provider mapping cannot change the product
system prompt. BL already sends BaseAgent.fullSystemPrompt() to pi, but its
optional runtime contract permits default fallback, and PiRuntimeAdapter mixes
SDK mapping, host tool execution, session state and policy in one 563-line file.
The parallel CoWork fix also repairs AI-CRMS dropping this prompt entirely.

## Contract

- BaseAgent owns table 1 + table 2. Make the complete nonempty systemPrompt a
  required runtime input; reject missing/blank values before session/auth work,
  preserve its text, and never silently restore the pi default persona.
- Put provider-independent prompt validation, session defaults and host tool
  execution in their appropriate policy/execution modules. Keep existing shared
  budget, logging and history services in place.
- PiRuntimeAdapter orchestrates provider/model/auth selection and SDK session
  creation. Extract the native session bridge and protocol/resource-loader mapping
  into cohesive pi modules. Retain pi's native loop, auto-compaction, steering,
  context entries, error sanitization and usage events; do not build another loop.
- Disk SYSTEM.md / APPEND_SYSTEM.md / AGENTS.md / CLAUDE.md and pi skill discovery
  remain off. Shared prompt policy resolves cwd and defines the final system text
  including the existing cwd suffix; pi receives the host text and explicit cwd
  so its SDK produces exactly that text. CoWork AI-CRMS uses the same policy,
  ensuring identical host text/cwd yields identical system content across providers.
  No adapter authors product prompt text. Retain BL-specific auth diagnostics.
- Use the same provider-independent contract and equivalent pi module boundaries
  as CoWork. No prompt wording, UI, model/preset, dependency, branch or release change.

## Verification and handoff

Focused tests must exercise nonempty/blank/missing prompt behavior, exact host text
through the real pi loader boundary, tool success/failure, steering and context
mapping after extraction. Run relevant existing runtime checks and scoped type
verification, reporting baseline failures separately. No Electron E2E or live
model calls; hand completed code to Ral for human testing.

## Delivery

PiRuntimeAdapter is reduced from 563 to 114 lines, retaining model/auth selection
and SDK session creation. Runtime responsibilities now have explicit homes:

| Module | Responsibility |
|---|---|
| runtimeSystemPrompt.ts | Required host text, cwd resolution and canonical final system |
| runtimeSessionPolicy.ts | Tool exposure, compaction and steering defaults |
| hostToolExecution.ts | Tool execution, timing and sanitized errors |
| piRuntimeProtocol.ts | Resource loader, tool schemas/results, event and usage mapping |
| piRuntimeSession.ts | Native session/context/steering/abort bridge |

All five equivalent helpers are synchronized with CoWork; implementations stay in
their own repositories. Product prompt wording and existing auth diagnostics remain.

Verification from the BL repository:

- `node --test tests/maestro/maestroRuntimeAdapterContract.test.mjs`: 8/8 passed;
  real pi builder and fake SDK cover canonical prompt equality, missing/blank
  rejection before SDK/auth, empty discovery, tools/events/session/steering/context.
- `node --test tests/maestro/maestroContextExport.test.mjs`: 8/8 passed after updating
  the old fixture loader for extracted session code and its missing host imports.
- `node scripts/maestro/check-agent-runtime.mjs` and
  `node scripts/maestro/check-codex-auth-store.mjs`: passed.
- Activity protocol checks pass after relocation; the suite retains a pre-existing
  obsolete raw-tool-label assertion. HEAD BaseAgent already appends optional tool
  argument summaries, while that assertion still expects the raw name.
- `TYPECHECK_SURFACES_LIST_ERRORS=1 yarn typecheck:node main`: 64 diagnostics,
  identical file/line/code locations to the HEAD-source overlay baseline; no
  diagnostics in this task's BaseAgent/runtime files. A preceding whole-tsconfig
  attempt exhausted memory in the existing preload LangGraph graph, so the
  repository's supported main surface was used for the completed check.
- Scoped diff whitespace checks passed.

No Electron GUI/E2E, live model, build, package or release was run.
