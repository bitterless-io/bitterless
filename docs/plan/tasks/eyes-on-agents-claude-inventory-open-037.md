---
id: eyes-on-agents-claude-inventory-open-037
scope: Claude singleton inventory, Desktop archive reconciliation, Agent View fallback, and Desktop UI Open
status: completed
depends-on: [eyes-on-agents-provider-identity-036]
---

# EyesOnAgents Claude Inventory And Open

## Objective

Discover local Claude Code sessions without conversation capture, synchronize explicit Claude
Desktop archive state, and open matched sessions directly in Claude Desktop UI.

## Required behavior

- Resolve platform Claude roots and absolute `CLAUDE_CONFIG_DIR` without renderer paths.
- Scan only bounded canonical Desktop `local_*.json` metadata and direct UUID JSONL files.
- Allowlist metadata fields, join Desktop `sessionId` to Hook/JSONL `cliSessionId`, and persist no raw
  Claude objects or message content.
- Treat only explicit Desktop `isArchived` as archive evidence; CLI-only stays unknown.
- Add capability-aware `claude agents --json [--all]` polling with strict argv, output, and timeout
  bounds; partial failure preserves state.
- Supervise one standalone Node directory watcher that sends bounded content-free invalidations to
  Main over a profile-local Unix Domain Socket/Windows Named Pipe. Expose no HTTP/TCP interface and
  never start another Electron application/Dock process.
- Start one Main-owned socket receiver and coalesced observation service; socket events refresh
  promptly while manual/activation/10-second refresh remains the reconciliation fallback.
- Open only `claude://claude.ai/epitaxy/<desktopSessionId>` when available; never start CLI.
- Preview only the persisted canonical JSONL through existing OnlyPreview validation.

## Expected paths

- `src/main/eyesOnAgents/claude*`
- `electron.vite.config.ts`
- `src/main/eyesOnAgents/eyesOnAgents.service.ts`
- `src/main/xpc/eyesOnAgents.handler.ts`
- `src/main/xpc/onlyPreview.handler.ts`
- `src/shared/eyesOnAgents/**`
- `src/preload/sqlite/dao/eyesOnAgents.*`
- `scripts/eyes-on-agents/**`

## Verification

- Fixture scanners prove traversal, size, schema, message-content, and omission fail-closed rules.
- Watcher tests prove one helper/socket, strict bounded invalidation frames, burst coalescing,
  reconnect, no network listener, and Node-mode/no-Dock execution.
- Repository/core tests prove add/title/archive/unarchive, CLI-only unknown, changed-only writes,
  coalescing, fixed Desktop route, and safe preview.
- Run relevant EyesOnAgents tests, node/type checks, production build, and `git diff --check` without
  launching Electron.

## Implementation evidence

- Desktop and transcript adapters use canonical allowlisted roots, 40-row bounded polling, explicit
  ambiguity revocation, and stat-only JSONL discovery; conversation content is never opened during
  monitoring.
- Agent View uses fixed argv with `shell: false`, bounded output/time, capability probing across
  allowlisted installations, stable working-start timestamps, and active-only freshness leases.
- A standalone `ELECTRON_RUN_AS_NODE=1` helper watches the roots and emits strict content-free frames
  over one profile-local Unix Domain Socket/Windows Named Pipe; Main coalesces bursts and keeps Claude
  failures independent from Codex reconciliation.
- SQLite migration `260817144544` adds private transcript/freshness fields; follow-up migration
  `260817163734` adds independent transcript activity for bounded Hook-lease heartbeats. The audit
  includes provider-aware `260817143129` and Claude-inventory `260817144544` baselines.
- Main constructs the fixed Claude Desktop deep link and revalidates the persisted transcript path
  plus expected session identity before explicit OnlyPreview display.

## Verification evidence

- `yarn test:eyes-on-agents:claude`
- `yarn test:eyes-on-agents:repository`
- `yarn test:eyes-on-agents:core`
- `yarn audit:sqlite-migrations`
- `yarn tsc -p scripts/eyes-on-agents/tsconfig.strict.json --noEmit` reaches only the two pre-existing
  `codexHookBridge.contract.ts` `rawInput` typing errors; task 037 adds no strict-project error.

## Review

- Independent review required before task 038 begins.
