# EyesOnAgents Global Codex Observation Onboarding Review — Round 1

Status: accepted

Date: 2026-07-17

## Conclusion

**Pass for task 008.** No P0, P1, or P2 issue remains in the independent review of the global
observation lifecycle, Codex trust inspection, Review/Check actions, activation refresh, renderer
boundary, or task 007 delivery guarantees. Three ownership, status-truthfulness, and recovery
defects found during review were fixed and covered by regressions before acceptance.

The implementation keeps Codex observation and App Server connection as independent capabilities:
Connect/Disconnect do not install or remove hooks, a retained observation installation starts with
App Server auto-connect disabled, and shutdown/auth suspension preserve both persisted intents.
Explicit Disable fences intake, settles accepted observation work, removes only Bitterless-owned
artifacts, and does not disconnect an already connected App Server.

## Findings resolved during review

1. **P1 — runtime trust ownership was not bound to the reporting source file.** The first
   implementation matched the command/event/matcher/type tuple but discarded `sourcePath`, so a
   same-command definition reported from another hook source could be accepted and its private key
   considered for re-enable. `hooks/list` parsing now requires an absolute `sourcePath`, and runtime
   ownership requires the exact command, `source: user`, `isManaged: false`, and canonical
   `~/.codex/hooks.json` source path. Wrong-source, managed, duplicate, and same-command spoof
   regressions fail closed and expose no keys.
2. **P2 — operational failures advanced the hook-inspection timestamp.** Outbox coverage gaps,
   admission overflow, and repository failures initially reused the hook-inspection error setter,
   making `lastInspectedAt` claim a new `hooks/list` attempt that never happened. Operational errors
   are now tracked separately; they invalidate observation while preserving the timestamp of the
   last real inspection. A subsequent actual inspection, including a failed one, updates the
   timestamp truthfully.
3. **P2 — a corrupt persisted bridge state made Disable ineffective.** If the owned installation
   state JSON was corrupt, removal failed before cleaning the stable hook/helper/outbox artifacts.
   Disable now recovers conservatively: it preserves `hooks.json` provenance and unrelated or
   lookalike hooks, strips only exact Bitterless commands, removes owned artifacts and stale outbox
   data, discards the corrupt state, and permits a clean subsequent Enable.

## Contract evidence

- Initialization starts an already-installed listener independently of App Server auto-connect.
  Connect/Disconnect mutate only App Server intent; shutdown and authentication suspension stop
  processes without uninstalling observation or clearing user intent.
- Observation teardown aborts and fences new intake, rejects or joins buffered work, waits for
  accepted writes, stops the listener, invalidates hook-derived runtime evidence, and only then
  removes owned files. The App Server lifecycle remains untouched.
- Check/activation reuse an existing App Server or use a short inspector. Intent-version checks
  prevent that temporary connection from persisting or overriding a concurrent user Connect or
  Disconnect.
- `hooks/list` warnings, errors, malformed fields, unsupported trust values, ownership mismatch,
  missing definitions, and duplicates fail closed. `installed` requires four exact user-owned
  definitions that are enabled and `trusted` or `managed`.
- Review re-enables only fresh, unique, exact-owned disabled keys. Its `config/batchWrite` request is
  limited to an `upsert` of `{ enabled: true }` under `hooks.state`; it contains no `trusted_hash`,
  policy write, persisted key, or renderer-controlled configuration surface.
- Review always targets the fixed main-process URL `codex://settings`, including capability-failure
  fallback. Renderer XPC methods are semantic and parameter-free for install, review, refresh, and
  removal; the renderer cannot supply URLs, hook keys, commands, paths, or generic RPC payloads.
- The panel distinguishes Observing from Installed, paused, reports review reasons and actual
  inspection/event timestamps, and includes the required English/Chinese actions and manual Codex
  Settings → Hooks guidance. Windows command escaping and exact ownership/removal remain covered.
- Task 007's commit-before-ACK, persistent receipt dedupe, bounded outbox/quarantine, trusted
  admission, replay, evidence invalidation, and teardown guarantees remain intact. Its independent
  review is accepted separately in `eyes-on-agents-hook-delivery-007-1.md`.
- Unrelated Coin and login edits remained present throughout the review and were not reverted or
  rewritten by this task.

## Verification

| Check | Result |
|---|---|
| `yarn test:eyes-on-agents` | pass: core, Project resolver/filter, repository, App Server, bridge/delivery, activation, rendered-DOM, and UI-source suites; UI 22/22 |
| `yarn typecheck:eyes-on-agents:core` | pass |
| `yarn typecheck:eyes-on-agents:ui` | pass |
| `yarn check:renderer-i18n` | pass |
| `yarn audit:sqlite-migrations` | pass: 11 Core + 7 Maestro retained/fresh baselines |
| `yarn build` | pass; dedicated `out/main/codexHookHelper.js` emitted |
| `git diff --check` | pass |

No Electron GUI was launched during review.
