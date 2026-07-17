---
id: eyes-on-agents-hook-delivery-007
scope: lightweight Codex hook helper and durable commit-acknowledged delivery
status: done
depends-on: [eyes-on-agents-sync-persistence-006]
---

# EyesOnAgents Reliable Codex Hook Delivery

## Objective

Replace the full-application Electron hook launch with a separate Node-mode helper and make every
global Hook event recoverable while Bitterless is closed or the acknowledgement is lost.

## Context

- [Codex observation contract](../../features/eyes-on-agents-codex-observation.md)
- [EyesOnAgents integration](../../integrations/eyes-on-agents.md)
- [EyesOnAgents delivery analysis](../analysis/eyes-on-agents.md)

## Required behavior

- Bundle a helper entry that runs with `ELECTRON_RUN_AS_NODE=1` and never imports `app.main` or
  creates Electron windows.
- Keep the Codex hook command at a stable Bitterless-owned shim path across upgrades.
- Assign a stable delivery ID per invocation and atomically persist an outbox file whenever direct
  committed delivery cannot be proven.
- Replay oldest-first, acknowledge only after the repository transaction commits, and persist a
  receipt in the same transaction as runtime application.
- Dedupe a replay after an acknowledgement loss across application restarts.
- Bound payloads and outbox growth; quarantine corruption and surface coverage gaps without leaking
  event payloads.
- Preserve the current trusted-event admission epochs, write drain, listener isolation, Windows and
  macOS behavior, and unrelated hook definitions.

## Expected paths

- `electron.vite.config.ts`
- `src/main/app.main.ts`
- `src/main/eyesOnAgents/codexHookBridge.{helper,server}.ts`
- `src/shared/eyesOnAgents/codexHookBridge.{contract,type}.ts`
- `src/preload/sqlite/dao/eyesOnAgents.*`
- `src/preload/sqlite/coreSqlite.release.ts`
- `scripts/eyes-on-agents/`
- `scripts/sqlite-migrations/`

## Verification

- Bridge tests prove the shim uses the dedicated Node entry and no full app entry.
- Offline, timeout, lost-ACK, replay, restart dedupe, commit failure, corruption, overflow, and
  Windows quoting cases are deterministic.
- Repository tests prove receipt and event application are one transaction.
- The retained multi-version SQLite audit converges to the fresh schema.
- EyesOnAgents typechecks and production build complete without starting Electron.

## Review

- Round 1: [eyes-on-agents-hook-delivery-007-1](../reviews/eyes-on-agents-hook-delivery-007-1.md)
  — accepted after fixing packaged Helper path resolution and Windows `%`-path ownership/removal;
  no remaining P0/P1/P2 findings.
