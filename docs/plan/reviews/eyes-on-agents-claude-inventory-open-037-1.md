# EyesOnAgents Claude Inventory And Open Review — Round 1

Status: accepted

Date: 2026-08-17

## Findings

No open P1, P2, or P3 finding remains in the reviewed task 037 scope.

## Blocking-fix closure

- **Provider identity ambiguity — closed.** Desktop identity collisions are detected in both
  `cliSessionId -> desktopSessionId` directions and revoke Open for every affected row. Desktop-ID
  and transcript-path remaps now persist an ambiguity marker across partial polls; only a complete,
  unique source scan restores the corresponding Open or Preview capability.
- **Watcher lifecycle and fallback — closed.** The Main-owned supervisor keeps one child/socket,
  restarts an unexpected exit, and fences stop against a pending restart. The child runs through
  Electron's Node mode with an IPC parent-lifetime channel, so a parent disconnect terminates it on
  Windows as well as Unix; the Unix PPID check remains a fallback. Watcher setup failure does not
  block the canonical polling scan.
- **Bounded process and socket behavior — closed.** Agent View uses allowlisted executable
  candidates, fixed argv, `shell: false`, bounded output, and a timeout path that escalates from
  `SIGTERM` to `SIGKILL` and rejects only after child close. The profile-local UDS/named-pipe bridge
  accepts one exact 1 KiB content-free frame with a per-run nonce, records the post-`chmod` socket
  identity, coalesces bursts, and removes only its own socket on stop.
- **Runtime evidence — closed.** A background Agent View row without an explicit state is working;
  an interactive row without a state remains unknown. Active leases extend independently, stable
  start evidence preserves working order, a changed start establishes a new run, and repeated
  terminal evidence performs no write. Agent View names fill missing titles without replacing a
  Desktop title.
- **Content and capability boundary — closed.** Monitoring enumerates and stats direct UUID JSONL
  files without opening transcript bodies. Desktop metadata reads are canonical, no-follow, size
  bounded, and field allowlisted. Main derives the fixed Claude Desktop route from persisted
  identity; Preview revalidates the persisted transcript path and expected thread UUID before the
  existing OnlyPreview explicit-target flow.

## Contract assessment

- The Main-owned Claude observation singleton performs bounded hot/cold polling plus complete
  manual/activation discovery, while concurrent invalidations coalesce into at most one upgraded
  follow-up scan.
- Claude polling and lease expiry occur before and independently of the Codex App Server refresh
  gate. Codex App Server, Hook, raw snapshots, archive, notification, and unread paths remain
  provider-scoped and their existing suites pass.
- Explicit Claude Desktop `isArchived` is the only Claude archive evidence. Missing, malformed,
  inaccessible, CLI-only, or incomplete evidence does not infer archive or erase a retained field.
- Migration `260817144544` adds the private transcript, freshness, and identity-ambiguity columns;
  fresh and retained provider-aware baselines converge through the audited idempotent migration.

## Verification

- `yarn test:eyes-on-agents:claude` — pass, including real UDS lifecycle, helper reconnect,
  supervisor singleton/restart/stop, IPC parent-death, command forced-kill, scan coalescing, and
  stop-generation coverage.
- `yarn test:eyes-on-agents:repository` — pass, including archive/title/runtime transitions,
  bidirectional collisions, partial-poll ambiguity retention, and full-scan recovery.
- `yarn test:eyes-on-agents:core` — pass.
- `yarn test:eyes-on-agents:project-resolver` — pass.
- `yarn test:eyes-on-agents:app-server` — pass.
- `yarn test:eyes-on-agents:bridge` — pass.
- `yarn test:eyes-on-agents:project-filter` — pass.
- Task-037 polling and Claude renderer source assertions in `yarn test:eyes-on-agents:ui` — pass.
  The combined UI command remains 47/50 because of three pre-existing, out-of-scope source-shape
  assertions for notification construction and two English copy strings; none exercises or is
  changed by task 037.
- `yarn audit:sqlite-migrations` — pass, including all 13 Core baselines and the provider-aware
  pre-Claude-inventory baseline.
- `yarn typecheck:eyes-on-agents:core` — reaches only the two documented pre-existing
  `codexHookBridge.contract.ts` `rawInput` typing errors; task 037 adds no strict-project error.
- `node scripts/environment/runWithRuntimeProfile.cjs release_prod -- yarn _build:release` — pass;
  the standalone `out/main/claudeDirectoryWatcher.js` entry is emitted.
- `git diff --check` — pass before this review file was authored.
- No Electron process or UI automation was launched.

## Conclusion

**Pass.** Task 037 is accepted and task 038 may proceed. Ral's Electron UI acceptance remains
intentionally manual and is not claimed by this review.
