---
id: eyes-on-agents-claude-deletion-sync-051
scope: synchronize explicit Claude Desktop deletion tombstones into the EyesOnAgents projection
status: in-progress
depends-on: [eyes-on-agents-claude-inventory-open-037, eyes-on-agents-claude-hook-last-user-prompt-049]
---

# EyesOnAgents Claude Deletion Sync

## Objective

When Claude Desktop deletes a Code session, remove it from Bitterless promptly and prevent its
residual JSONL, Agent View row, or late Hook deliveries from recreating the card or producing alerts.

## Context

- `docs/features/eyes-on-agents-claude-observation.md`
- `docs/integrations/eyes-on-agents.md`
- `docs/integrations/eyes-on-agents-layout.md`

Claude Desktop deletion writes positive `deleted_<uuid>` tombstones below the bounded
`claude-code-sessions/<account>/<org>` metadata scope and commonly leaves the CLI JSONL in place.
Archive remains the independent explicit `isArchived` field. File absence is not deletion evidence.

## Required behavior

- Scan only direct, regular, non-symlink filenames matching exact `deleted_<uuid>` below canonical
  account/organization roots. Do not read tombstone contents or unrelated Claude data.
- Persist every valid tombstone in a Main-private provider table even when no thread exists. Match an
  existing row by canonical Claude `threadId`, or by its unique `local_<uuid>` Desktop identity.
- Deletion is a soft tombstone, not archive or hard deletion. Hide the row from every renderer
  projection and exclude it from Open, Preview, move, Read all, title repair, runtime reconciliation,
  completion alerts, sounds, and notification dispatch.
- Clear deleted rows' runtime/turn/unread/Open/Preview/latest-question and other transient display
  capabilities. Preserve provider identity, Domain assignment, and content-free delivery/completion
  receipts needed for deduplication.
- Persisted tombstones take precedence over JSONL, Agent View, and Hook input. Late Hook deliveries
  are acknowledged/consumed without inventory mutation, observation proof, alert, notification, or
  sound; they must not remain in the outbox retry loop.
- A valid tombstone wins over simultaneous stale live metadata. Missing files, failed or partial
  enumeration, invalid filenames, symlinks, and candidate-limit overflow never delete anything.
- Restore only when a healthy complete Desktop scan observes unique valid live metadata for the
  same Desktop/CLI identity pair, no matching tombstone exists in any healthy source scope, and the
  live evidence is newer than the persisted deletion. Restore keeps the Domain, starts unread=false,
  and does not restore an old latest-question preview.
- Watcher invalidation for a Desktop tombstone triggers deletion reconciliation promptly; activation,
  manual Refresh, and startup full scans remain recovery paths.
- Codex persistence, runtime, archive, unread, Open, alert, and notification behavior is unchanged.

## Path

- `src/main/eyesOnAgents/claudeDesktopInventory.adapter.ts`
- `src/main/eyesOnAgents/claudeObservation.service.ts`
- `src/main/eyesOnAgents/claudeHookBridge.server.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/preload/sqlite/dao/eyesOnAgents.table.ts`
- `src/preload/sqlite/dao/eyesOnAgents.migration.ts`
- `src/preload/sqlite/dao/eyesOnAgents.dao.ts`
- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `scripts/eyes-on-agents/claude-inventory.test.mjs`
- `scripts/eyes-on-agents/repository.test.mjs`
- focused deletion/replay tests under `scripts/eyes-on-agents/`

## Verification

- CLI-ID and Desktop-ID tombstones hide existing rows; duplicate markers are idempotent.
- A tombstone discovered before its row prevents later JSONL, Agent View, and Hook creation.
- Residual JSONL does not restore Preview or visibility.
- Late `UserPromptSubmit` and `Stop` deliveries are acknowledged once, do not restore the row, and
  produce no unread state, observation proof, notification, or sound.
- Valid tombstones override simultaneous stale metadata; a later healthy unique metadata restore
  requires tombstone absence and newer evidence.
- Invalid/symlink/overflow/inaccessible/partial scans preserve rows; absence alone never deletes.
- Archive/unarchive remains independent, and Codex fixtures are behavior compatible.
- Run focused Claude inventory/repository/Hook suites, the full EyesOnAgents suite, SQLite migration
  audit, Core/UI strict typechecks, renderer i18n, production build, and `git diff --check`. Do not
  launch Electron; Ral owns packaged Claude Desktop deletion E2E.

## Implementation evidence

- Desktop discovery now enumerates only canonical account/organization scopes and recognizes exact
  direct regular `deleted_<uuid>` entries without opening their contents. Exact symlink/non-file
  markers, failed enumeration, and the shared 20,000-candidate ceiling revoke deletion authority;
  poll scans can add positive markers but only a healthy full scan can clear an absent marker.
  Metadata and tombstone evidence are bound to an unchanged direct-path file descriptor snapshot by
  device, inode, size, and mtime before their filesystem timestamp is accepted.
- Main-private SQLite persists source-qualified tombstones independently of thread rows and adds an
  explicit soft-deleted state to the provider projection. Reconciliation matches the canonical CLI
  UUID or an unambiguous `local_<uuid>` Desktop identity, hides the row, clears runtime/turn/unread,
  title/cwd/Project, Preview, latest-question, and status capabilities, and preserves the canonical
  provider/Desktop identities, Domain/archive state, plus delivery/completion receipts.
- Inventory reconciliation applies tombstones before Desktop/JSONL rows. Active or historical
  deletion evidence blocks residual JSONL and Agent View mutation; an identity observed only after
  its marker is retained as a hidden deleted row so later Hook delivery cannot create a card.
- Hook delivery commits its content-free receipt first, then returns a duplicate-style committed
  result for a deleted Claude identity. This drains live/outbox deliveries while suppressing prompt
  mutation, renderer invalidation, completion intent, notification, and sound. Dropped receipts are
  marked observation-ineligible, so first/last received status aggregates remain unchanged.
- Restore requires a healthy complete Desktop row with one non-ambiguous Desktop/CLI pair, no active
  matching tombstone in any persisted scope, and metadata mtime newer than the latest deletion.
  Restore keeps the Domain, starts read, and leaves the cleared latest-question fields empty.
- Snapshot, Open/Preview target, move, Read all, Agent View/lease reconciliation, and completion
  claims all exclude soft-deleted rows. Every deletion query remains provider-qualified to Claude;
  the Codex projection and runtime paths are unchanged.

## Verification evidence

- `yarn test:eyes-on-agents:repository` — pass; covers old-schema migration, CLI-ID and Desktop-ID
  deletion, duplicate idempotence, Domain/archive and receipt preservation, renderer/Open/move
  exclusion, tombstone-before-row JSONL/Agent/Hook suppression, late prompt/Stop ACK-drop with
  observation-ineligible receipt aggregation, partial omission, inactive marker history without live
  metadata, older evidence rejection, newer full-scan restore, and a same-UUID Codex control.
- `node scripts/eyes-on-agents/claude-inventory.test.mjs` — pass; covers exact/direct/regular marker
  discovery, content non-read, canonical scope health, symlink fail-closed behavior, file-snapshot
  TOCTOU guards, poll/full authority, and candidate-limit boundaries.
- `node scripts/eyes-on-agents/claude-hook.test.mjs` — pass; duplicate-style ACK does not advance live
  observation proof.
- `yarn audit:sqlite-migrations` — pass across every maintained Core/legacy baseline.
- `yarn typecheck:eyes-on-agents:core` and `yarn typecheck:eyes-on-agents:ui` — pass.
- `yarn check:renderer-i18n` — pass.
- `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn _build:release` — pass.
- `git diff --check` — pass.
- `yarn test:eyes-on-agents` reaches the unrelated task-045 UI source assertion and fails because it
  still requires the removed `eyesOnAgentsStore.reviewCodexBridge(...)` call; every Core, repository,
  bridge, project-filter, Claude, and other UI test before that assertion passes. No Electron or
  packaged-app E2E was launched; Ral owns the deletion E2E.
