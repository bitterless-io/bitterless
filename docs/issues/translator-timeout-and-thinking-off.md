# Translator Latency And GPT-5.5 Thinking

Status: In progress

Implementation:
[translator-thinking-off-008](../plan/tasks/translator-thinking-off-008.md)

## Symptom

A short translation can take long enough to end in the generic retryable `Translation failed.`
state. Translator must have a hard 60-second end-to-end ceiling, and it should not spend GPT-5.5
reasoning time on a bounded translation request.

## Evidence

- The current Main service already defines `TRANSLATOR_TIMEOUT_MS = 60_000` and starts its timer
  before provider-context lookup; that exact value must remain a delivery contract.
- Pi accepts `thinkingLevel: "off"`, but Pi 0.80.10 converts that to an omitted reasoning option.
  GPT-5.5's documented default reasoning effort is not `none`, so omission does not prove that
  thinking is disabled.
- GPT-5.5 officially accepts `reasoning.effort: "none"`. Translator's existing payload hook can
  apply this explicitly beside its Fast `service_tier: "priority"` override.

## Required Behavior

- Every accepted translation reaches a completed, cancelled, or error result within 60 seconds.
- Translator creates the Pi session with thinking off and sends explicit provider payload
  `reasoning: { effort: "none" }`.
- The low effort recorded in the shared model-provider target remains unchanged for availability
  and compatibility; the Translator-only inference override does not alter other consumers.
- The Fast priority tier remains enabled.

## Acceptance

- Source contract retains the exact `60_000 ms` end-to-end timeout.
- A Translator runtime request uses GPT-5.5, low provider target, Fast service tier, Pi thinking
  off, and explicit wire reasoning effort `none`.
- A normal Codex runtime caller that does not request thinking off preserves its prior effort.
- No UI, login, model-provider persistence, or public result-contract change is introduced.
