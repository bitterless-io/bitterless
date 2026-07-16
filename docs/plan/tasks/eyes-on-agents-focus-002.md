---
id: eyes-on-agents-focus-002
scope: Codex Desktop lifecycle connection and long-running Focus correctness
status: done
depends-on: [eyes-on-agents-001]
---

# EyesOnAgents Desktop Focus Reliability

## Objective

Make the existing EyesOnAgents Connect action establish the complete observation path required for
Codex Desktop tasks, and keep a running Desktop task in Focus until terminal lifecycle evidence is
received.

## Context

- `docs/integrations/eyes-on-agents.md`
- `docs/issues/archived/eyes-on-agents-desktop-focus.md`
- Codex Desktop and Bitterless each own a separate stdio App Server. No supported cross-process
  active-status endpoint exists in the bundled Codex 0.144.5 protocol.

## Required implementation

- Install or repair the Bitterless-owned Codex hook bridge as part of explicit and automatic
  EyesOnAgents connection.
- Inspect the installed definitions through App Server `hooks/list`. Add a truthful `needs_trust`
  state until all exact Bitterless command hooks are enabled and trusted/managed; never pass
  `--dangerously-bypass-hook-trust` or modify managed policy.
- Remove the bridge when EyesOnAgents is explicitly disconnected.
- Track the current bridge listener start time and trust hook-active evidence only when it was
  observed during that same continuously listening runtime.
- Remove the 60-second hook-active expiry. A matching `Stop` event remains the normal terminal
  transition.
- Keep App Server `notLoaded` normalization and hook-evidence preservation unchanged.
- Make the connection panel explain that the Desktop bridge is managed by the Connect lifecycle,
  show the one-time Codex hook review step, and retain repair/cleanup only where truthful.

## Expected paths

- `src/main/eyesOnAgents/`
- `src/shared/eyesOnAgents/`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/`
- `src/renderer/common/i18n/en.ts`
- `src/renderer/common/i18n/zh.ts`
- `scripts/eyes-on-agents/`
- `docs/integrations/eyes-on-agents.md`
- `docs/issues/eyes-on-agents-desktop-focus.md`
- this task and its review artifacts

## Verification

- Focused contract tests prove hook-active evidence remains active beyond 60 seconds within one
  listener lifetime and becomes unknown across listener lifetimes.
- Service tests prove explicit/automatic connect installs the bridge and disconnect removes it.
- Supervisor/bridge tests prove `hooks/list` trust inspection distinguishes trusted, untrusted,
  disabled, and malformed/missing owned definitions without exposing unrelated hook commands.
- Bridge tests prove listener start time is surfaced and reset.
- Run the focused EyesOnAgents suite, relevant strict type checks, `yarn typecheck`, `yarn build`,
  `git diff --check`, and an independent source review.

## Review

- Round 1: `docs/plan/reviews/eyes-on-agents-focus-002-1.md` — blocking findings resolved.
- Round 2: `docs/plan/reviews/eyes-on-agents-focus-002-2.md` — accepted.
- Round 3: `docs/plan/reviews/eyes-on-agents-focus-002-3.md` — blocking findings resolved.
- Round 4: `docs/plan/reviews/eyes-on-agents-focus-002-4.md` — accepted.
- Round 5: `docs/plan/reviews/eyes-on-agents-focus-002-5.md` — blocking findings resolved.
- Round 6: `docs/plan/reviews/eyes-on-agents-focus-002-6.md` — blocking findings resolved.
- Round 7: `docs/plan/reviews/eyes-on-agents-focus-002-7.md` — blocking findings resolved.
- Round 8: `docs/plan/reviews/eyes-on-agents-focus-002-8.md` — blocking findings resolved.
- Round 9: `docs/plan/reviews/eyes-on-agents-focus-002-9.md` — accepted.
