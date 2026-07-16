# EyesOnAgents misses active Codex Desktop tasks

状态：已修复

## Symptom

Codex Desktop reports the `bitterless-monitor` task as active, but EyesOnAgents does not include it
in Focus.

## Confirmed cause

- Codex Desktop 0.144.5 owns a private stdio App Server. Bitterless owns a second stdio App Server;
  there is no supported listener or attach endpoint between them.
- `thread/list` from the Bitterless-owned server therefore returns Desktop-owned tasks as
  `notLoaded`, which correctly normalizes to `unknown` rather than proving idle or active.
- The current Connect action does not install the Desktop lifecycle bridge. On the reproduced
  profile the bridge state is `installed: false`, so no Desktop lifecycle evidence reaches
  EyesOnAgents.
- Even after bridge installation, `working` hook evidence expires after 60 seconds. Codex does not
  emit a running heartbeat, so any normal turn longer than 60 seconds disappears from Focus before
  `Stop`.

## Required correction

1. Connecting EyesOnAgents must also install or repair the metadata-only Codex Desktop bridge.
2. Codex requires a one-time review of every non-managed command hook. EyesOnAgents must inspect
   `hooks/list`, report `needs_trust` until all of its exact definitions are trusted, and never
   claim Desktop observation is ready before that review. It must not bypass Codex hook trust.
3. Disconnecting must stop that observation path and invalidate active evidence owned by it.
4. Active hook evidence remains valid while the same bridge listener lifetime is continuous and
   ends on `Stop`; it must not expire after an arbitrary 60-second silence.
5. Active evidence persisted by a previous Bitterless runtime must become `unknown` after restart,
   because a terminal event may have been missed while the listener was offline.
6. `notLoaded` discovery from the separate managed App Server must continue to preserve newer valid
   Desktop hook evidence.
7. A turn already running before bridge installation, trust approval, or listener startup remains `unknown`. Codex
   exposes no supported cross-process status backfill, so Bitterless must not fabricate `active`.

## Acceptance

- One Connect action installs the bridge and enables metadata sync; the connection panel shows the
  one-time Codex trust step until `hooks/list` proves all Bitterless hooks trusted and enabled.
- A Desktop turn remains in Focus beyond 60 seconds and leaves active Focus after its `Stop` event.
- A hook-active row from a previous bridge listener lifetime is not focused after Bitterless
  restarts.
- Focus still includes unread completion after the terminal event until opened through
  EyesOnAgents.
- Focus and bridge lifecycle behavior are covered by focused tests and the integration contract.
