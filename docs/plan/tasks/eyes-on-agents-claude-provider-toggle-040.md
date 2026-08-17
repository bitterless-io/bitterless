---
id: eyes-on-agents-claude-provider-toggle-040
scope: Persisted Claude provider support switch with complete Codex isolation
status: implemented; owner verification pending
depends-on: [eyes-on-agents-claude-directory-runtime-039]
---

# EyesOnAgents Claude Provider Toggle

## Objective

Let Ral pause all Claude support from the Connections drawer while preserving every Claude row and
configuration, and keep the complete existing Codex inventory, Hook, Focus, unread, notification,
Open, archive, and refresh behavior working independently.

## Context

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/analysis/eyes-on-agents-claude.md`

## Path

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`
- `docs/plan/analysis/eyes-on-agents-claude.md`
- `docs/plan/README.md`
- `docs/plan/tasks/eyes-on-agents-claude-provider-toggle-040.md`
- `src/main/eyesOnAgents/**`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/shared/eyesOnAgents/**`
- `src/renderer/eyesOnAgents/**`
- `src/renderer/common/i18n/{en,zh}.ts`
- `scripts/eyes-on-agents/**`

## Required behavior

- Persist exact `{ schemaVersion: 1, enabled: boolean, hookAdmissionAfter: number | null }` at
  `eyes_on_agents / claude_provider_v1` through
  the existing Core setting table. Missing defaults to enabled; malformed fails closed with a
  bounded visible error. No migration is required.
- Expose `snapshot.claudeProvider` and one strict pathless
  `setClaudeProviderEnabled({ enabled })` action. Reject unknown keys/non-boolean values.
- Closing persists first, disables Hook intake, joins/stops Hook listener and directory observation,
  cancels Main retry and Claude background refresh, force-expires Claude runtime authority, and
  clears only the Bitterless-owned Claude Hook outbox.
- Closing does not uninstall/disable the plugin, clear directory configuration, or delete/mutate
  Claude rows, Domain, unread, archive, Open, receipt, or annotation history.
- Opening first persists `enabled: true` with the reserved `Number.MAX_SAFE_INTEGER` pending-
  admission sentinel, clears the owned outbox, captures and serially persists a finite cutoff, then
  starts the saved directory observation/full refresh and restores the Hook listener only for a
  valid retained plugin installation. Restart with the pending sentinel repeats cleanup and
  finalization before admission. Live/replay events whose `occurredAt` is at or before the finite
  cutoff are ACK-dropped without inventory/runtime/receipt/proof/unread/broadcast/notification
  effects, so delayed helpers and a crash before cleanup cannot reintroduce disabled-period
  activity. Missing/default-on and ordinary enabled restart keep a null/existing finite cutoff and
  preserve legitimate enabled-period offline delivery.
- Start the Hook socket unarmed, order coverage inspection and replay before live admission, and
  require proof that the durable backlog is empty before live admission. A replay or cleanup
  failure keeps the listener unarmed. Protect renderer application with a monotonic provider
  snapshot revision so a late enabled response cannot overwrite a newer Off response.
- Serialize provider setting hydration with preference writes and fence every write across App/auth
  runtime generations so a delayed pre-logout toggle cannot revive Claude after a later resume.
- Snapshot projection omits Claude while disabled. Every Claude-specific Open, Preview, move,
  bridge, directory, inventory, polling, notification, and Hook intake path is gated in Main.
- Read all acknowledges only visible providers, so hidden Claude unread rows remain unchanged.
- Codex App Server, Codex Hook, auto-connect, tiered polling, latest-question capture, Open, Focus,
  unread, notification, and archive paths do not depend on or mutate the Claude preference.
- Put one small Arco Switch in the existing Claude card header. Off keeps only header plus one
  neutral explanation; all Claude directory/plugin/guide details fold away. Rename the plugin
  removal action to **Remove plugin**. Add no card row, decorative border, shadow, or brand panel.

## Verification

- Preference tests cover missing/default-on with null cutoff, valid persistence/restart, explicit
  enable cutoff, malformed fail-closed, strict input, and write failure leaving the current runtime
  unchanged.
- Lifecycle tests cover cold-start off, auth resume off, in-flight scan/Hook fencing, listener and
  retry shutdown, outbox clearing at both boundaries, delayed old-event ACK-drop, crash after
  pending persistence before cleanup, concurrent finalization/disable ordering, enabled restart
  preserving legitimate offline events, management recovery without cutoff advancement, and
  disabled delivery/no notification.
- Projection tests cover mixed Codex/Claude Focus, All, Domain, Project filters, global search,
  Open/Preview/move guards, re-enable restoration, and provider-scoped Read all.
- Codex isolation tests prove Sync, manual Refresh, activation, ten-second polling, Hook inspection,
  notification, and connection behavior remain complete while Claude is off.
- UI/i18n tests cover the small header switch, busy state, folded copy, plugin-action rename, and
  absence of new border/card rows.
- Run full EyesOnAgents, migration audit, Core/UI typechecks, renderer i18n, production build, and
  `git diff --check` without launching Electron.
- Independent review must report no open P1, P2, or P3 finding before completion.

## Implementation evidence

- `ClaudeProviderPreferenceService` owns the exact three-key schema, missing/default-on behavior,
  bounded malformed-setting error, and persist-before-runtime writes. Main serializes hydration and
  toggle writes on a short provider-intent tail while a separate App generation fences logout,
  shutdown, and authenticated resume races without delaying Codex initialization.
- Explicit enable uses a crash-safe pending sentinel, owned-root cleanup, finite cutoff
  finalization, and generation-checked activation. Normal enabled restart/resume preserves its
  existing cutoff and offline outbox; healthy repeated enable is idempotent.
- Disable publishes the Off projection immediately after persistence, closes intake, joins
  observation/listener/background work, force-expires only Claude runtime authority, and clears
  only the Main-derived Bitterless Claude outbox root. It retains plugin, directory, inventory,
  Domain, archive, unread, Open, receipt, and annotation data.
- `ClaudeHookBridgeServer` starts with a real unarmed live barrier. Coverage and every durable
  backlog item must settle before admission; a failed consume/removal leaves the item recoverable,
  closes live admission, and returns no acknowledgement. A post-arm stabilization drain catches
  late helper persistence, and listener stop joins admitted commits without a late socket ACK.
- Main ACK-drops delivery and coverage evidence at or before the persisted cutoff without touching
  inventory/runtime/delivery receipt/proof/unread/notification state. Current gaps revoke intake.
- Snapshot construction captures a monotonic provider revision, retries asynchronous reads across
  a provider transition, filters Claude rows in Main, and retains truthful management error/status
  only while recovery is allowed. The renderer refuses an older revision after a newer response.
- Claude data actions, Hook intake, polling, and notifications require the published runtime;
  plugin/directory recovery uses the narrower enabled-management gate. Provider-scoped Read all is
  selected in Main under the same intent ordering boundary. Background polling rechecks its runtime
  generation after every asynchronous expiry write before broadcasting.
- The existing Claude connection card now owns one small accessible Arco Switch, folded Off copy,
  visible recovery error, and **Remove plugin** wording without a new row, border, shadow, or brand
  surface. Codex activation, polling, Hook, notification, Open, archive, and prompt paths remain
  independent.

## Verification evidence

- `yarn test:eyes-on-agents:claude` — passed inventory, Hook/outbox, real socket admission,
  directory runtime, exact preference, two-phase cutoff, lifecycle race, snapshot revision, and
  owned-root cleanup suites.
- `scripts/eyes-on-agents/claude-provider-isolation.test.mjs` — passed stored-Off auth resume with
  complete Codex startup/polling, delayed toggle write across shutdown/resume, and in-flight Hook
  completion plus background-poll broadcast fencing.
- `scripts/eyes-on-agents/claude-hook-admission.test.mjs` — passed six real Unix-socket fixtures,
  including ordered replay, current/pre-cutoff gap authority, unavailable storage, failed durable
  consume, and stop-without-late-ACK behavior.
- `yarn test:eyes-on-agents` — passed the complete non-Electron EyesOnAgents suite.
- `yarn typecheck:eyes-on-agents:core` and `yarn typecheck:eyes-on-agents:ui` — passed.
- `yarn audit:sqlite-migrations` — passed 14 Core, 7 Maestro, 10 Todoist sync, and 8 Trench
  baselines.
- `yarn check:renderer-i18n` — passed.
- `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn _build:release` — passed
  and emitted the Claude Hook and directory watcher helpers without launching Electron.
- `git diff --check` — passed.
- Electron was not launched; live switch/folded-card acceptance remains with Ral.

## Review

- Independent functional review:
  [eyes-on-agents-claude-provider-toggle-040-1](../reviews/eyes-on-agents-claude-provider-toggle-040-1.md)
  — accepted with no open P1, P2, or P3 finding.
- Standard code review:
  [eyes-on-agents-claude-provider-toggle-040-code-review](../reviews/eyes-on-agents-claude-provider-toggle-040-code-review.md)
  — no task-040-introduced TS-1, TS-2, FE-1, or FE-2 finding; five pre-existing oversized files
  remain recorded as structural debt outside this task.
- Implementation is complete. Live switch persistence, folded-card rendering, and Codex-only
  operation while Claude is Off remain with Ral because Electron was intentionally not launched.
