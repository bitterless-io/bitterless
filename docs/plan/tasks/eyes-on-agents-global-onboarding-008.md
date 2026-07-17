---
id: eyes-on-agents-global-onboarding-008
scope: global Codex observation lifecycle, trust review, recheck, and App Server decoupling
status: done
depends-on: [eyes-on-agents-hook-delivery-007]
---

# EyesOnAgents Global Codex Observation Onboarding

## Objective

Turn Codex observation into an explicit global capability that survives App Server disconnects,
shows truthful installation/trust/listener states, and lets a user who skipped or disabled trust
return to Codex review and recheck from Bitterless.

## Context

- [Codex observation contract](../../features/eyes-on-agents-codex-observation.md)
- [EyesOnAgents layout](../../integrations/eyes-on-agents-layout.md)
- [Reliable Hook delivery](eyes-on-agents-hook-delivery-007.md)

## Required behavior

- Separate App Server and Codex observation lifecycle contexts and persisted user intents.
- Make Connect/Disconnect affect only App Server; make Enable/Repair/Disable affect only observation.
- Start the listener after launch whenever observation remains installed, even with App Server
  auto-connect disabled.
- Preserve exact local-definition validation and use fresh `hooks/list` for Codex trust.
- Add semantic Review and Check actions. Re-enable only fresh, exact, disabled Bitterless hook keys;
  never write trust hashes or expose generic configuration RPC.
- Open only `codex://settings` and tell the user to choose Settings → Hooks or use `/hooks`.
- Recheck on window activation through the existing connection or a short inspector that does not
  change persistent auto-connect intent.
- Show distinct installed, listening, needs-review reason, drift, error, and last-event facts in the
  connection panel, with English and Chinese strings.
- Preserve write fencing, evidence invalidation, persisted board data, and unrelated dirty files.

## Expected paths

- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/main/eyesOnAgents/{eyesOnAgents.service,codexDesktopBridge.service,codexAppServer.supervisor}.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts`
- `src/renderer/eyesOnAgents/src/xpc/eyesOnAgents.emitter.ts`
- `src/renderer/eyesOnAgents/src/components/ConnectionPanel/`
- `src/renderer/common/i18n/{en,zh}.ts`
- `scripts/eyes-on-agents/`

## Verification

- Core tests prove Connect/Disconnect never install/remove hooks, Disable works while connected,
  shutdown preserves both intents, and concurrent operations cannot upgrade into cross-removal.
- App Server tests prove exact `config/batchWrite` shape, no `trusted_hash`, capability failure
  fallback, and transient inspection that preserves persistent intent.
- Activation tests prove an explicitly disconnected App Server still permits bridge recheck without
  persistent reconnect.
- UI-source and i18n tests prove Enable, Review, Check again, Repair, and Disable states and remove
  the old “managed by Connect” contract.
- Full EyesOnAgents typechecks and production build complete without launching Electron.

## Review

- Round 1: [eyes-on-agents-global-onboarding-008-1](../reviews/eyes-on-agents-global-onboarding-008-1.md)
  — accepted after tightening global source ownership, separating operational errors from
  inspection timestamps, and making explicit Disable recover from corrupt local bridge state; no
  remaining P0/P1/P2 findings.
