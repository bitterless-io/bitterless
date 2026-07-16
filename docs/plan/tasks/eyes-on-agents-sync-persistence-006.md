---
id: eyes-on-agents-sync-persistence-006
scope: persist Codex thread inventories and make Focus attention refreshable and durable
status: done
depends-on: [eyes-on-agents-archive-sync-005]
---

# EyesOnAgents Source Persistence, Unread Attention, and Refresh

## Objective

Make Codex-to-Bitterless synchronization auditable and recoverable: retain each validated
`thread/list` source object locally, preserve Bitterless Domain/read annotations independently,
derive Focus from live runtime plus a persistent unread marker, and expose an explicit Refresh that
works after disconnection or error.

## Required behavior

- Add an idempotent SQLite migration for `eyes_on_agents_thread_snapshot` and
  `eyes_on_agents_thread.is_unread`; backfill only genuinely unread legacy completions.
- Persist the latest validated objects from both active and archived paged inventories without
  returning raw JSON to any renderer.
- Preserve raw snapshots and normalized rows across restart, archive/unarchive, Domain movement,
  and partial inventory absence.
- Set unread on every accepted running discovery/status/start event and terminal event. Successful
  Codex deep-link Open clears it; a later running observation sets it again.
- Keep Focus derived from active runtime or persistent unread. Archived rows remain hidden.
- Replace the connected-only icon Sync with a visible Refresh action that can connect from
  disconnected/error and is disabled while another board action, connect, or sync is in flight.
- Preserve activation refresh, connection intent, hook trust boundaries, and the prohibition on
  Electron-spawning tests.

## Privacy boundary

The exact list object may include a first-message-derived `preview`. Store it only in encrypted local
SQLite. Do not log, export, broadcast, render, or enrich it with `thread/read`; never persist turns,
model output, tool payloads, diffs, or approval details.

## Expected paths

- `src/shared/eyesOnAgents/eyesOnAgents.type.ts`
- `src/preload/sqlite/dao/eyesOnAgents.*`
- `src/preload/sqlite/coreSqlite.release.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/renderer/eyesOnAgents/src/components/EyesOnAgentsMenuBar/`
- `src/renderer/common/i18n/{en,zh}.ts`
- `scripts/eyes-on-agents/`
- `scripts/sqlite-migrations/`
- EyesOnAgents integration, layout, and analysis documents

## Verification

- Repository tests prove fresh and multi-version migration, raw payload restart persistence,
  Domain/read independence, active -> unread, Open -> read, active refresh -> unread, terminal ->
  unread, and archive preservation.
- Service tests prove both inventories are passed to source persistence and malformed entries are
  isolated without logging raw payloads.
- UI source tests prove Refresh is labelled, available while disconnected/error, and guarded while
  another board action, connection, or sync is already in flight.
- SQLite release audit proves upgrades from every retained historical schema converge to the fresh
  schema.
- Run all EyesOnAgents, migration, Node typecheck, and production build checks without starting
  Electron.

## Review

- Round 1: [eyes-on-agents-sync-persistence-006-1](../reviews/eyes-on-agents-sync-persistence-006-1.md)
  — accepted after repository restart tests, exact App Server inventory verification, multi-version
  SQLite audit, strict typechecks, i18n validation, and production compilation.
