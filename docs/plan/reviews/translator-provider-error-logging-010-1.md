---
id: translator-provider-error-logging-010-1
status: blocked
reviewed_task: translator-provider-error-logging-010
target: working-tree
base: dev/next
date: 2026-08-25
review_type: independent-source-and-contract
---

# Verdict

**BLOCKED. One P1 privacy finding and one P2 diagnostic-accuracy finding must be resolved before
packaging.**

# Findings

## P1 blocking — direct provider response bodies can enter `provider-detail`

The new `diagnosticMessage()` treats every Pi `errorMessage` or thrown `Error.message` as safe
free-form detail after generic credential redaction. Its body-removal expressions require leading
whitespace before `{`, `[`, `<!doctype html`, or `<html`, so a body beginning at character zero is
not removed (`src/main/codex/codexRuntime.service.ts:380-396`). The pinned Pi provider has a concrete
path that produces exactly that input: for a non-2xx SSE response, `parseErrorResponse()` initializes
the error message from the complete response text and retains it when the payload is non-JSON or
does not contain the expected `error` object; that message is then assigned to the assistant
`errorMessage` (`node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js:273-279`,
`:311-319`, `:1141-1162`). A response such as `{\"maintenance\":\"tenant Acme\"}` or an HTML body
therefore survives the new pre-sanitizer and is written as a `[provider-detail]` NDJSON argument.
The shared sanitizer removes known credential shapes, but it does not remove arbitrary business,
source, output, or response-body text.

This violates the explicit design and task prohibition on request/response bodies and source/output
content (`docs/features/translator.md:227-230`;
`docs/plan/tasks/translator-provider-error-logging-010.md:36-43`). The focused tests cover an
attached `body` property but do not exercise a body carried in `Error.message`; that property is
ignored while the unsafe path is the message itself
(`tests/coin/unit/codexRuntime.service.test.ts:591-632`). Fix by rejecting structured/HTML body-like
messages from position zero as well as after a safe prefix, and by making provider detail an actual
semantic allowlist rather than accepting arbitrary plaintext response content. Add regression cases
for raw JSON, HTML, and plaintext body/error messages containing ordinary non-secret source text.

## P2 blocking — transport failure identity is merged with the final fallback failure

`observeProviderDiagnostic()` first summarizes Pi's WebSocket transport diagnostic and then merges
the final assistant `errorMessage` into the same flat object
(`src/main/codex/codexRuntime.service.ts:1007-1017`). `mergeProviderDiagnostic()` lets the later
summary replace `category` and `detail` while retaining the earlier `errorName` and `errorCode` when
the final summary lacks them (`src/main/codex/codexRuntime.service.ts:495-511`). The committed test
demonstrates the resulting mixed record: the final category/status/detail describe an SSE 429, but
`errorName=WebSocketError` and `errorCode=ws-limit` still describe the earlier WebSocket setup
failure (`tests/coin/unit/codexRuntime.service.test.ts:573-582`). The NDJSON logger gives these fields
no origin qualifier, so an operator cannot reliably tell which error is the final provider cause.

This contradicts the contract that WebSocket fallback evidence remain distinguishable from the SSE
HTTP rejection or other final runtime cause (`docs/features/translator.md:215-221`). Preserve the
transport observation and final failure as separately named fields/records, or clear the earlier
error identity whenever the final category/detail replaces it. The test should assert that transport
evidence cannot be mistaken for the terminal provider error.

- P3 non-blocking: none.

# Contract Assessment

- The pinned Pi 0.80.10 OpenAI Codex provider does attach
  `provider_transport_failure` to the assistant message before SSE fallback, with
  `configuredTransport`, `fallbackTransport`, `phase`, `eventsEmitted`, and `requestBytes`. The new
  runtime reads only the first three accepted fields and does not read the latter two
  (`node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js:206-211`;
  `src/main/codex/codexRuntime.service.ts:536-571`). Structured diagnostic capture is therefore on a
  real production path rather than a test-only shape.
- The diagnostic summary type does not include request bytes, event counts, bodies, headers, IDs,
  source/output, tokens, OAuth fields, or raw objects. The logger selects fields individually and
  sanitizes detail again before the shared application boundary; it never serializes the diagnostic
  object (`src/main/logging/translatorLog.service.ts:102-156`). The P1 finding is specifically the
  unrestricted message value crossing that otherwise narrow type boundary.
- Fixed runtime stages resolve to short allowlisted `stage` plus `phase` values. The long
  `provider-auth-observation` stage maps to `provider-auth-observe`; terminal records include
  separate `lastStage` and `lastPhase`. Each token remains shorter than the application's 24-byte
  opaque-token rule and is therefore readable (`src/main/logging/translatorLog.service.ts:12-95`;
  `src/main/translator/translator.service.ts:214-278`).
- Provider metadata and detail are passed as additional string arguments. The existing NDJSON
  formatter preserves sanitized data after the first message in `args`, so these values are not
  silently discarded (`src/main/logging/translatorLog.service.ts:143-156`;
  `src/main/logging/logSanitizer.service.ts:50-65`).
- Authentication classification remains ahead of `CodexRuntimeError('provider-error')`; deterministic
  auth failures still become `CodexRuntimeAuthRequiredError`, and Translator keeps the existing
  epoch-fenced invalidation/`login-required` flow. The optional diagnostic is copied only into the
  Main-owned logger entry and the shared Translator XPC/result contract is unchanged
  (`src/main/codex/codexRuntime.service.ts:1079-1093`, `:1112-1121`;
  `src/main/translator/translator.service.ts:284-290`, `:372-410`).

# Verification

- `git diff --check` — pass.
- Current task-scoped source, design, pinned Pi provider path, and focused tests — inspected.
- Automated tests and typecheck — not run per owner instruction.
- Electron, build, package, and release commands — not run per owner instruction.

# Conclusion

The implementation reaches the real Pi diagnostic path and fixes unreadable stage evidence, but it
is not ready to package until provider detail cannot carry response/body content and transport versus
terminal-failure fields are unambiguous.
