# Translator Provider Failure Detail Is Missing From Production Logs

Status: Implemented; owner verification pending

Implementation:
[translator-provider-error-logging-010](../plan/tasks/translator-provider-error-logging-010.md)

## Symptom

A packaged Translator request can show `Translation failed.` after roughly 20 seconds while the
dedicated production log records only `errorCode=provider-error cause=***`. The owner can prove the
request reached and completed Pi prompt execution, but cannot tell whether Codex failed on
WebSocket transport, SSE fallback, HTTP rejection, rate limiting, response handling, or another
runtime error.

## Evidence

The shared Codex runtime collects Pi `errorMessage` values only long enough to classify
authentication failures. Every other provider failure is reduced to `CodexRuntimeError` with the
single code `provider-error`, so Translator receives no diagnostic detail to persist.

Translator also concatenates the active stage and cause into long hyphenated tokens. The shared
application sanitizer deliberately replaces opaque alphanumeric tokens of 24 or more characters,
which turns legitimate fixed stage and cause identifiers into `***`.

## Required Behavior

- Preserve a bounded, log-only provider diagnostic summary across the Codex runtime boundary.
- Capture Pi's structured transport diagnostic and directly observed/typed terminal evidence
  without exposing raw provider/error objects or deriving persisted fields from free-form text.
- Record short allowlisted stage/phase fields plus terminal last-stage evidence.
- Record enough safe provider evidence to distinguish transport/fallback, HTTP/rate-limit,
  response, timeout, authentication, and unknown runtime failures.
- Keep the renderer/public Translator error contract unchanged.
- Never log source, translation, prompt/output, request/response bodies, headers, IDs, tokens,
  OAuth material, credentials, or Codex login/logout lifecycle.

## Acceptance

- A WebSocket failure with SSE fallback is visible as transport/fallback evidence in
  `translator/translator.log`.
- A final provider failure records a safe category and fixed canonical detail; directly observed
  HTTP status and typed error name/code appear when available, otherwise the reason is explicitly
  unknown rather than guessed from response text.
- Fixed lifecycle stages and the terminal last stage are readable rather than `***`.
- Authentication invalidation still follows the existing shared provider flow and public
  `login-required` result.
