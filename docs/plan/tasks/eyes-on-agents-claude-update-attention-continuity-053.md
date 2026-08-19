---
id: eyes-on-agents-claude-update-attention-continuity-053
scope: keep Claude observation installed across Bitterless updates and preserve working/unread attention through refreshes
status: in-progress
depends-on: [eyes-on-agents-claude-legacy-marketplace-recovery-050, eyes-on-agents-claude-deletion-sync-051, eyes-on-agents-claude-desktop-visibility-lifecycle-052]
---

# EyesOnAgents Claude Update And Attention Continuity

## Objective

Make a normal Bitterless application update transparent to an already valid Claude observation
installation, and make Claude match Codex attention semantics: one admitted user prompt remains
working until a terminal Hook event, then remains in Focus as unread with a red dot until the user
acknowledges it.

## Evidence

- The production update from `0.0.73` to `0.0.74` changed the version-code-derived Claude plugin
  version. The exact previously installed Bitterless plugin was therefore classified as drift and
  exposed as **Repair**, even though its owner, marketplace, namespace, installation identity, and
  artifacts were otherwise valid.
- Repair rotated the installation ID and cleared its outbox. Claude sessions already open before
  Repair continued to emit through the old loaded plugin generation, so their later `Stop` events
  remained in the old outbox and could not complete the current runtime row.
- Every EyesOnAgents window activation calls Claude status refresh. The current refresh path stops
  a healthy listener and force-invalidates all Hook-owned active rows before starting the same
  listener again, so merely returning to Bitterless can remove a live response from Focus.
- Normal Claude inventory upsert currently clears `is_unread` when `is_deleted = 0`. Transcript and
  Desktop metadata refreshes therefore clear both working and completed attention even though no
  user acknowledgement or deletion occurred.
- Thread cards currently attach the unread dot only to `idle`; a valid later `SessionEnd` can leave
  the row terminal and unread without showing the dot.

## Required behavior

- A normal app release may update the expected owned Claude plugin version and artifacts without
  becoming user-visible drift. When the current profile's marketplace, owner marker, namespace,
  user scope, installed state, and previous installation identity are all strictly proven, Main
  performs a bounded automatic artifact upgrade before listener activation.
- The trusted automatic upgrade preserves the installation ID, receipt history, provider cutoff,
  and every owned pending outbox delivery. Existing Claude sessions may continue delivering through
  their already-loaded helper while new sessions load the upgraded artifacts.
- Repair of a proven installed Bitterless artifact drift uses the same stable installation identity
  and does not clear its outbox. Interrupted pre-commit setup, ownership ambiguity, coverage loss,
  or an incompatible protocol remains fail closed and may require the existing explicit fresh
  generation/reload recovery; no unknown installation is silently adopted.
- A generation that an older Bitterless build already rotated away is not rediscovered from its
  self-reported outbox directory. The previous committed identity was not retained, so those events
  cannot be distinguished from a pre-commit setup generation. Existing sessions affected before
  this fix require one `/reload-plugins` or a newly opened Claude session; future trusted updates
  and proven Repairs keep the identity stable and do not repeat that requirement.
- Automatic upgrade failure keeps a bounded actionable error and never reports observing from an
  unverified installation. It also never mutates another profile, plugin, marketplace, or Claude
  setting.
- Claude status refresh is non-destructive while the same valid listener generation is already
  running. Window activation and **Check status** must not stop the listener, invalidate a Hook
  epoch, clear runtime, or change unread state.
- If the listener is actually absent, failed, replaced, or bound to a different installation,
  retry may invalidate the stale Hook epoch once before starting and replaying that generation.
  Provider disable, coverage loss, explicit remove, and application shutdown retain their existing
  lifecycle fences.
- Claude inventory updates never clear runtime or unread attention. A verified deletion clears it;
  a verified Desktop restore starts read; explicit Open/Read all acknowledge confirmed terminal
  rows. No other metadata, transcript, poll, watcher, or Agent View reconciliation marks a row read.
- `UserPromptSubmit` keeps the row working through thinking, commands, tools, polling, and repeated
  window activation. Only a newer admitted `Stop`, `StopFailure`, or `SessionEnd` ends that Hook
  epoch under the task-052 terminal rules.
- A successful `Stop` leaves the row terminal and unread in Focus. `idle`, `ended`, and `failed`
  unread rows show the existing red dot; active working/waiting rows show only the loader. Codex
  lifecycle, unread, notification, and card behavior remain unchanged.

## Path

- `src/main/eyesOnAgents/claudePluginBridge.service.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/renderer/eyesOnAgents/src/components/ThreadCard/ThreadCard.vue`
- focused Claude bridge/lifecycle/repository/render tests under `scripts/eyes-on-agents/`
- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents-layout.md`

## Implementation

- Strictly proven committed installations now use a stable-generation automatic upgrade and Repair
  path. The plugin artifacts and Claude cache are refreshed while the existing installation ID,
  receipts, cutoff, restart state, and outbox remain intact; staged failures resume idempotently.
- Healthy status checks now inspect without stopping or invalidating the current listener. A missing,
  failed, or identity-mismatched listener is the only Check-status path that invalidates and restarts,
  with provider-version fences around slow refresh and replay work.
- Ordinary Claude Desktop/transcript inventory no longer clears unread. Only the actual
  deleted-to-verified-restored transition clears deletion/unread state; inactive historical
  tombstones cannot clear a later Prompt/Stop unread state.
- The existing thread card loader covers all active working/waiting states. Terminal
  `idle`/`ended`/`failed` unread states use the same red dot and therefore remain in Focus until an
  explicit acknowledgement.
- The Claude aggregate now includes the release/Repair continuity regression. A stale Agent
  connections source assertion that still required the removed Codex Review action was aligned with
  the already-shipped status-first settings contract.

## Verification

- Simulate an exact installed previous release, start the next release, and prove automatic upgrade
  reaches exact/observing without Repair, installation-ID rotation, outbox deletion, or receipt loss.
- Repair a strictly owned installed drift and prove the same continuity; ambiguous/corrupt ownership
  remains zero-mutation and actionable.
- Prove `UserPromptSubmit -> inventory refresh -> repeated window activation/status check -> tool
  time -> Stop` remains working until Stop and then remains unread in Focus.
- Prove a healthy status check performs no listener stop/start and no Hook invalidation; a genuinely
  stopped listener retry invalidates once and restarts.
- Prove ordinary Desktop/transcript upserts preserve working and terminal unread, while verified
  deletion and verified restore retain their task-051 behavior.
- Prove terminal `idle`, `ended`, and `failed` unread cards show one red dot; active states show the
  loader without a terminal dot.
- Run focused bridge/lifecycle/repository/render suites, Claude aggregate, Core/UI strict typechecks,
  renderer i18n, SQLite migration audit where storage fixtures are touched, and `git diff --check`.
  Do not launch Electron; Ral owns development and packaged Claude E2E.

## Verification evidence

- `yarn test:eyes-on-agents` — PASS, including Core, repository, Codex bridge, Claude aggregate, and
  UI 68/68.
- `yarn typecheck:eyes-on-agents:core` — PASS.
- `yarn typecheck:eyes-on-agents:ui` — PASS.
- `yarn check:renderer-i18n` — PASS.
- `yarn audit:sqlite-migrations` — PASS (14 Core, 7 Maestro, 10 Todoist sync, 8 Trench baselines).
- `git diff --check` — PASS.
- Electron, packaged Claude, and end-to-end interaction were not started; Ral owns that final check.
