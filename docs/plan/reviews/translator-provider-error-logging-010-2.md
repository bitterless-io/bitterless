---
id: translator-provider-error-logging-010-2
status: blocked
reviewed_task: translator-provider-error-logging-010
target: working-tree
base: dev/next
date: 2026-08-25
review_type: independent-source-and-contract-rereview
supersedes: translator-provider-error-logging-010-1
---

# Verdict

**BLOCKED. The transport/terminal ambiguity is fixed, but provider body/message text can still
control persisted diagnostic fields.**

# Findings

## P1 blocking — terminal category/status/name/code are still derived from arbitrary body text

The revised implementation correctly replaces persisted detail with a fixed canonical sentence,
but `summarizeProviderValue()` still passes every provider `errorMessage` through
`providerEvidenceText()` and derives `httpStatus`, `errorName`, `errorCode`, and `category` from that
text (`src/main/codex/codexRuntime.service.ts:385-410`, `:444-503`, `:526-547`). On the real Pi SSE
path, the assistant `errorMessage` may be the raw non-JSON or unexpected-JSON HTTP response body, as
documented in review 010-1. Consequently, a response body or echoed source such as
`FetchError code=ECONNRESET HTTP 429 rate limit exceeded for tenant Acme` writes
`category=rate-limit httpStatus=429 errorName=FetchError errorCode=ECONNRESET`, even though none of
those values came from a trusted structured status/name/code field. Replacing only `detail` does not
make the remaining fields non-body-derived.

The new body regression covers JSON, HTML, and plaintext strings that contain no recognized status,
error name, code, or category phrase, while the preceding test explicitly expects all four fields
to be extracted from an `errorMessage` string (`tests/coin/unit/codexRuntime.service.test.ts:530`,
`:573-590`, `:603-659`). It therefore codifies rather than closes this privacy boundary.

This still violates the requirement that request/response body and source/output content never
influence Translator log output (`docs/features/translator.md:227-230`;
`docs/plan/tasks/translator-provider-error-logging-010.md:36-43`). Keep raw `errorMessage` and
`Error.message` only for process-local auth/provider classification. Persist category/status/name/code
only from fixed runtime state or separately typed structural fields: for example, a Pi
`provider_transport_failure` should have the fixed `transport` category and may use its direct
allowlisted transport/name/code/phase fields, while an unstructured assistant `errorMessage` should
produce only a generic fixed terminal category/detail. If terminal HTTP status is required, capture
it at a typed response hook rather than parsing the eventual body-derived message. Add a regression
whose raw JSON/HTML/plaintext body contains `HTTP 429`, `FetchError`, `ECONNRESET`, rate-limit,
timeout, and WebSocket/SSE terms and prove none controls the persisted evidence.

- P2 blocking: none.
- P3 non-blocking: none.

# Resolved From Review 010-1

- **Transport versus terminal identity — resolved.** `CodexRuntimeDiagnosticSummary` now has
  separate `transportDiagnostic` and `terminalDiagnostic` records. The structured Pi WebSocket
  diagnostic cannot inherit from or overwrite the final provider failure
  (`src/main/codex/codexRuntime.service.ts:185-198`, `:1016-1028`).
- **Log origin — resolved.** The logger emits distinct `[provider-transport]` and
  `[provider-terminal]` metadata arguments plus separately scoped canonical detail arguments. The
  existing NDJSON formatter preserves those sanitized strings in `args`; no role is implicit or
  merged (`src/main/logging/translatorLog.service.ts:66-88`, `:144-161`;
  `src/main/logging/logSanitizer.service.ts:50-65`).
- **Raw detail — partially resolved.** The only detail values admitted to the summary are fixed
  canonical strings selected from the category. JSON, HTML, plaintext bodies, source/output, and
  provider messages are no longer copied verbatim into `detail`
  (`src/main/codex/codexRuntime.service.ts:505-524`). The P1 finding concerns the other fields still
  derived from that raw evidence.

# Contract Assessment

- Pi's real `provider_transport_failure` assistant diagnostic remains captured. Only configured
  transport, fallback transport, phase, and selected error evidence enter the transport summary;
  `requestBytes` and `eventsEmitted` are not read.
- Authentication classification still runs on process-local provider evidence before construction
  of `CodexRuntimeError('provider-error')`. `CodexRuntimeAuthRequiredError` therefore retains the
  existing epoch-fenced invalidation and public `login-required` behavior
  (`src/main/codex/codexRuntime.service.ts:1089-1105`, `:1121-1130`;
  `src/main/translator/translator.service.ts:372-410`).
- The diagnostic summary still terminates at the Main-owned Translator logger. No diagnostic field
  was added to the shared Translator XPC/result contract.
- Fixed lifecycle stage and phase values remain short and allowlisted. Terminal `lastStage` and
  `lastPhase` remain separate and readable through the global opaque-token sanitizer
  (`src/main/logging/translatorLog.service.ts:17-39`, `:90-121`, `:129-161`).

# Verification

- `git diff --check` — pass.
- Current task-scoped source, design, pinned Pi provider path, and focused tests — inspected.
- Automated tests and typecheck — not run per owner instruction.
- Electron, build, package, and release commands — not run per owner instruction.

# Conclusion

The second implementation closes verbatim body leakage and cleanly separates transport from
terminal evidence. It is not ready to package until unstructured provider/body text can no longer
control any persisted category, status, name, or code field.
