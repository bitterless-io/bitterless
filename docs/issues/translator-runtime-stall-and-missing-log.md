# Translator Remains Translating After Successful Codex Login

Status: In progress

Implementation:
[translator-runtime-diagnostics-007](../plan/tasks/translator-runtime-diagnostics-007.md)

## Symptom

Codex login completes and the shared provider snapshot becomes ready, but entering a short source
such as `hi` can leave Translator in `Translating` for an unbounded period without a result or an
actionable persisted failure.

## Evidence

Production `main.log` proves the Codex callback, token exchange, credential promotion, and ready
status completed. It contains no translation request lifecycle after that point because
`TranslatorService` does not record its Main-owned execution stages.

Source inspection exposes an unbounded path before the existing abort-aware session boundary:

```text
Translator deadline timer
  -> CodexRuntimeService.run
     -> load Pi module                         not raced with abort
     -> ModelRuntime.create + catalog refresh not raced with abort
     -> ModelRegistry.refresh                 redundant, not raced with abort
     -> create session                        raced with abort
     -> prompt                                raced with abort
```

The timer aborts one controller, but the earlier Pi/model promises do not observe or race that
signal. If catalog or availability work stalls, Main never returns the documented `timeout` result
and Renderer correctly continues waiting for the unresolved XPC call.

## Required Behavior

- The 60-second deadline covers the complete accepted translation request, including provider
  context, runtime preparation, session, prompt, provider observation, and parsing.
- The fixed Translator model is prepared without unrelated remote catalog discovery or a duplicate
  registry refresh.
- A timeout or cancellation returns through the existing result contract even when an underlying
  promise settles late.
- Translation lifecycle and sanitized failures go to the profile-specific dedicated Translator
  log. Login, logout, callback, credential, source, and translated content do not.

## Acceptance

- An uncooperative provider-context, Pi-load, target-context, session-create, prompt, or
  provider-observation promise cannot leave the request pending after the deadline.
- A successful short translation reaches a terminal completed result and records stage timings.
- Timeout, provider, invalid-output, authentication, cancellation, and supersession paths record a
  terminal sanitized stage without source or output content.
- No Translator log entry is created solely by Codex status, login, or logout.
