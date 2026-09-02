---
id: eyes-on-agents-claude-multi-env-plugin-install-086
scope: Run the existing Claude plugin/hook install-enable-remove flow against a chosen environment's CLAUDE_CONFIG_DIR
status: pending
depends-on: [eyes-on-agents-claude-multi-env-data-model-084]
verify: focused EyesOnAgents plugin-bridge unit tests, Core strict typecheck; no Electron
---

# EyesOnAgents Claude Multi-Environment Plugin Install

## Objective

Let the Claude plugin/hook install/enable/remove/status flow target any configured environment's
`CLAUDE_CONFIG_DIR`, by threading an optional `env` override through the CLI runner and adding
`{ environmentId }` to the relevant XPC methods — WITHOUT changing the existing single
`installationId`/socket/outbox continuity/rotation state machine in any way. Every environment
within one Bitterless profile continues to share that one installation identity; this task only
changes which directory the `claude` CLI process runs against.

## Context

- `docs/features/eyes-on-agents-claude-multi-environment.md` — "Plugin / Hook installation per
  environment" section, and its "Scope decisions" section explaining exactly why the
  installation-identity state machine is out of scope here.
- `docs/features/eyes-on-agents-claude-observation.md` — "Claude plugin Hooks" section: read this
  IN FULL before touching `claudePluginBridge.service.ts`. It documents an extremely invariant-dense
  installation-identity/continuity/rotation contract (installationId rotation, trusted-upgrade
  detection, interrupted-setup Repair boundary, coexistence across Bitterless profiles). This task
  must not change any of those rules — it only adds a target-directory parameter to the CLI
  invocation layer beneath them.

## Required behavior

- `claudeCommand.runner.ts`'s CLI invocation gains one additional optional parameter (do not change
  its existing call signature's required arguments): when a target `configDirectory` is given, the
  spawned process's environment is `{ ...process.env, CLAUDE_CONFIG_DIR: configDirectory }`;
  otherwise it is `process.env` unchanged (today's exact behavior, for the one automatic
  environment). Thread this parameter up through `claudePluginBridge.service.ts`'s
  `runClaudeCommand`/`this.runCommand` call sites used by install/enable/remove/status — do not
  change any other behavior in those methods.
- `installClaudeBridge`, `getClaudeBridgeStatus`, `refreshClaudeBridgeStatus`, `removeClaudeBridge`
  (wherever they are registered in `src/main/xpc/eyesOnAgents.handler.ts`) each gain an
  `{ environmentId }` parameter. Each resolves that environment via task 084's
  `ClaudeDirectoryConfigService.listEnvironments()`, passes its `configDirectory` (or `undefined` for
  the one automatic environment) down to the CLI runner, and otherwise runs the existing, byte-for-byte
  unmodified install/enable/remove/status sequence. An unknown `environmentId` is a clear rejected
  error, not a silent fallback to the default environment.
- Do NOT introduce a second `installationId`, a per-environment socket, or a per-environment outbox
  directory. Do NOT change the installation-identity rotation, trusted-upgrade, or interrupted-setup
  Repair logic described in `eyes-on-agents-claude-observation.md`'s "Claude plugin Hooks" section —
  every environment's installed plugin definition still calls the helper with the exact same
  `{ endpoint, installationId, outboxPath }` args used today.
- Logging: extend the existing plugin-bridge mutation/error logging (stage + sanitized error name,
  never raw CLI output/executable path/`configDirectory` value) with the target environment's
  `id`/`label`.

## Path

- `src/main/eyesOnAgents/claudeCommand.runner.ts`
- `src/main/eyesOnAgents/claudePluginBridge.service.ts` (call-site changes only — passing the
  resolved `configDirectory` through; do not touch the installation-identity state machine logic
  itself)
- `src/main/xpc/eyesOnAgents.handler.ts` (add `{ environmentId }` to the four methods listed above)
- a new or extended focused test file under `scripts/eyes-on-agents/` (e.g.
  `claude-environment-plugin-install.test.mjs`)

## Verification

- New tests cover: installing/enabling/removing/checking status for a non-default environment spawns
  the CLI with `CLAUDE_CONFIG_DIR` set to that environment's directory and does not touch the default
  environment's installation state; installing for the automatic environment spawns with no
  `CLAUDE_CONFIG_DIR` override, matching today's exact behavior; an unknown `environmentId` rejects
  cleanly with no CLI spawn attempted.
- Re-run the existing Claude plugin bridge test suite in full (find it — likely covers
  `claudePluginBridge.service.ts`'s installation-identity/continuity rules) and confirm it passes
  completely unmodified; this task must not need to change a single existing assertion there. If it
  does need a change, stop and treat that as a signal this task has drifted into the
  installation-identity state machine, which is explicitly out of scope.
- Run `yarn typecheck:eyes-on-agents:core`.
- Do not launch Electron.
