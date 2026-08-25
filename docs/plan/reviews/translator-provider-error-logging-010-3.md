---
id: translator-provider-error-logging-010-3
status: pass
reviewed_task: translator-provider-error-logging-010
target: working-tree
base: dev/next
date: 2026-08-25
review_type: independent-source-and-contract-rereview
supersedes: translator-provider-error-logging-010-2
---

# Verdict

**PASS. Review 010-2's remaining P1 is closed, and no new P1, P2, or P3 finding was identified.**

# Findings

- P1 blocking: none.
- P2 blocking: none.
- P3 non-blocking: none.

# Resolved From Review 010-2

- Free-form `errorMessage` and `Error.message` no longer enter any persisted summary builder.
  Assistant error text is retained only in the pre-existing process-local list used for auth and
  runtime-sentinel classification; it is not passed to transport or terminal diagnostic
  construction (`src/main/codex/codexRuntime.service.ts:939-944`, `:981-990`, `:1033-1037`,
  `:1046-1048`, `:1060-1074`).
- An unstructured assistant provider failure now receives only `observedProviderStatus` from the
  typed response callback, or the fixed `provider-unknown` category when no response status exists.
  Its detail is selected from a fixed canonical map. Provider body/source/output keywords therefore
  cannot control category, status, name, code, or detail
  (`src/main/codex/codexRuntime.service.ts:425-461`, `:1071-1074`).
- A genuinely thrown `Error` is summarized only from its structural `status`, `statusCode`, `name`,
  and `code` fields plus the independently observed HTTP status. Its message and attached body are
  never read. Non-`Error` rejections do not receive structural fields at all
  (`src/main/codex/codexRuntime.service.ts:463-489`, `:1094-1103`).
- The regression inputs now include JSON, HTML, and plaintext bodies containing every formerly
  recognized phrase (`HTTP 429`, `FetchError`, `ECONNRESET`, rate limit, timeout, WebSocket, and
  SSE) and require the same fixed `provider-unknown` summary. A separate thrown-Error case proves
  that conflicting message content cannot override its real structural status/name/code
  (`tests/coin/unit/codexRuntime.service.test.ts:613-670`, `:672-728`). Tests were source-reviewed
  but deliberately not executed per owner instruction.

# Contract Assessment

- **Typed response observation:** `CodexRuntimePiAgent.onResponse` uses Pi's exported typed callback.
  The wrapper reads only the integer `response.status`, does not access headers, model fields, IDs,
  or bodies, invokes the prior callback with the original response/model, and restores that exact
  callback in runtime `finally`. Restoration is identity-fenced so a later legitimate replacement
  is not overwritten (`src/main/codex/codexRuntime.service.ts:123-126`, `:651-675`, `:1005-1013`,
  `:1104-1107`). Pi's agent snapshot reads `agent.onResponse` when the prompt starts, so the wrapper
  is on the real provider path.
- **Typed transport evidence:** Pi `provider_transport_failure` is accepted only by its fixed type.
  The summary reads configured/fallback transport and phase through fixed value maps and reads only
  the diagnostic error's direct name/code fields. It does not read the diagnostic message,
  `requestBytes`, `eventsEmitted`, status-like detail fields, headers, or raw objects; its category
  and detail are fixed to transport (`src/main/codex/codexRuntime.service.ts:491-531`).
- **Transport versus terminal separation:** `CodexRuntimeDiagnosticSummary` retains distinct
  `transportDiagnostic` and `terminalDiagnostic` records. The logger emits explicitly scoped
  `[provider-transport]` and `[provider-terminal]` argument records, so WebSocket setup evidence
  cannot be mistaken for the terminal SSE/provider cause
  (`src/main/codex/codexRuntime.service.ts:185-201`, `:987-996`;
  `src/main/logging/translatorLog.service.ts:66-88`, `:144-161`).
- **NDJSON/privacy boundary:** All persisted detail values are fixed canonical strings and are
  sanitized again at the Translator logger. Metadata is individually selected and token-bounded;
  the raw diagnostic object is never serialized. The application formatter keeps the additional
  sanitized strings in NDJSON `args`, so the new evidence is actually retained
  (`src/main/logging/translatorLog.service.ts:63-88`, `:129-182`;
  `src/main/logging/logSanitizer.service.ts:50-65`).
- **Authentication and public contract:** Raw provider text still reaches the existing auth
  classifier before any provider-error summary is returned. Deterministic auth failures remain
  `CodexRuntimeAuthRequiredError` and continue through Translator's epoch-fenced invalidation to the
  existing public `login-required` result. Diagnostic summaries are passed only to the Main-owned
  logger; no Translator XPC/result contract changed
  (`src/main/codex/codexRuntime.service.ts:1060-1074`, `:1094-1103`;
  `src/main/translator/translator.service.ts:284-290`, `:372-410`).
- **Lifecycle readability:** Fixed short stage/phase values and separate terminal
  `lastStage`/`lastPhase` remain intact and stay below the global opaque-token redaction threshold.
  The public timeout, target, retry, provider/model, login, and renderer behavior is otherwise
  unchanged (`src/main/logging/translatorLog.service.ts:17-39`, `:90-121`;
  `src/main/translator/translator.service.ts:214-299`).

# Verification

- `git diff --check` — pass.
- Current task-scoped source, design, pinned Pi callback/diagnostic paths, and focused tests —
  inspected.
- Automated tests and typecheck — not run per owner instruction.
- Electron, build, package, and release commands — not run per owner instruction.

# Conclusion

The task is ready for owner packaging and production-log verification. Persisted Translator
diagnostics now expose trusted transport/status/structural evidence and fixed canonical causes
without allowing provider body, message, source, or output text to influence the log record.
