---
id: eyes-on-agents-claude-stop-alert-047
scope: play one completion alert for every newly accepted Claude Stop delivery
status: implemented; owner verification pending
depends-on: [eyes-on-agents-completion-alert-030, eyes-on-agents-claude-provider-toggle-040]
---

# EyesOnAgents Claude Stop Alert

## Objective

Treat a valid Claude `Stop` as the authoritative “this response ended; return to review it” signal.
Play the existing completion sound and send the existing localized notification once even when the
listener did not observe the preceding `UserPromptSubmit` and no active turn is persisted.

## Required behavior

- After the existing Claude installation, provider-runtime, enable-cutoff, schema, and delivery-ID
  admission checks, map `Stop` to a successful `turn_completed` event whose concrete `turnId` is the
  validated Hook delivery UUID.
- Preserve the delivery UUID as the durable completion identity. The Hook delivery receipt and
  completion-alert receipt remain committed in the same SQLite transaction before Main dispatches
  notification or sound side effects.
- A first accepted `Stop` alerts even when the row has no active turn and no earlier
  `UserPromptSubmit` was observed. The same delivery replay or duplicate produces no second alert.
- Each distinct accepted `Stop` represents a distinct completed Claude response and may alert once.
  This intentionally includes a later Stop emitted after another Stop hook made Claude continue.
- Preserve existing exclusions: `StopFailure`, rejected or stale generations, events at or before
  the provider-enable cutoff, disabled Claude support, failed outcomes, archived rows, events
  superseded by newer runtime evidence, and failed receipt claims do not alert.
- Do not change Codex completion identity, App Server/poll reconciliation, notification text,
  bundled sound, provider settings, renderer UI, or Claude prompt/response privacy boundaries.

## Expected paths

- `docs/issues/eyes-on-agents-completion-alert.md`
- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/plan/README.md`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- focused Claude provider/service regression coverage

## Verification

- Focused service coverage proves a standalone admitted `Stop` uses its delivery UUID as `turnId`
  and emits one completion intent without prior `UserPromptSubmit`.
- Duplicate delivery replay emits no second intent; a distinct `Stop` may emit another; and
  `StopFailure` remains silent.
- Existing repository coverage continues to prove concrete-turn receipt claims, archive exclusion,
  commit-before-side-effect ordering, and restart-safe deduplication.
- Run the focused test, `yarn test:eyes-on-agents:claude`, `yarn typecheck:eyes-on-agents:core`, and
  `git diff --check`. Do not launch Electron; Ral owns audible runtime verification.

## Implementation evidence

- Claude `Stop` now maps its already-validated Hook `deliveryId` to the runtime `turnId`; every
  other Claude Hook, including `StopFailure`, retains `turnId: null`.
- The existing DAO transaction records the delivery receipt, persists the completed transition,
  and claims the provider-qualified completion receipt before Main dispatches the existing
  notification and sound side effect.
- Focused coverage proves standalone Stop alerting without `UserPromptSubmit`, same-delivery
  deduplication, a second alert for a distinct Stop, and silent `StopFailure` behavior.
- Independent verification accepted the implementation with no P1/P2/P3 finding:
  [behavior review](../reviews/eyes-on-agents-claude-stop-alert-047-1.md) and
  [code review](../reviews/eyes-on-agents-claude-stop-alert-047-code-review.md).
- `node --test scripts/eyes-on-agents/claude-provider-isolation.test.mjs` passed 5/5;
  `yarn test:eyes-on-agents:claude`, repository and core suites,
  `yarn typecheck:eyes-on-agents:core`, and `git diff --check` passed. Electron and audible playback
  were not run; Ral owns the final real-Claude sound check.
