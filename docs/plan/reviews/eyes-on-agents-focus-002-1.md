# Review: eyes-on-agents-focus-002 (round 1)

## Verdict

**blocking findings** — the focused implementation, scoped type checks, and production build pass,
and the Codex 0.144.5 `hooks/list` decoder matches the real protocol. Two connection-transition
races can still lose the only Desktop lifecycle event for a turn, leaving the task absent from
Focus with no supported backfill.

## Findings

### [P1] A current-lifetime hook event can be erased immediately after the listener accepts it

`ensureDesktopObservation()` snapshots `wasListening`, starts the listener, and only then calls
`invalidateCodexHookStatuses()` (`src/main/eyesOnAgents/eyesOnAgents.service.ts:214-222`). Once
`bridgeListener.start()` resolves, the socket is already accepting events and
`CodexHookBridgeServer` has published the new `listeningSince`
(`src/main/eyesOnAgents/codexHookBridge.server.ts:135-152`).

This is observable after an auth suspend/resume or any same-process listener restart where the
previous in-memory hook inspection is still `installed`: a `UserPromptSubmit` received between the
listener start and repository invalidation passes the trust/lifetime gate
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:366-377`), is persisted as `turn_started`, and is
then reset to `unknown` by the delayed invalidation. Because Codex exposes no cross-process active
status backfill, that task stays out of Focus until another lifecycle event occurs. Concurrent
`connectAppServer()` / `syncThreads()` calls can also both observe the listener as stopped and run
late invalidations after the shared start.

Required correction: serialize the Desktop-observation transition and invalidate previous-listener
active evidence before opening the new listener. No invalidation associated with the old lifetime
may execute after the new listener can accept events. Add a regression that delivers
`UserPromptSubmit` at the start boundary and proves the new event survives.

### [P1] Trust inspection runs after thread enumeration, so valid hook events are dropped during sync

The integration contract requires `hooks/list` immediately after the App Server handshake and
before `thread/list` (`docs/integrations/eyes-on-agents.md:83-92`). The implementation does the
reverse: `performSync()` awaits every `thread/list` page and its repository upsert before calling
`refreshBridgeInspection()` (`src/main/eyesOnAgents/eyesOnAgents.service.ts:243-252`). The checked-in
service test encodes this incorrect order as `list`, `upsert`, `hooks`, `bridge-inspect`
(`scripts/eyes-on-agents/core.test.mjs:346-361`).

During startup/reconnect, bridge inspection is initially `needs_trust` even when the exact hooks
were already approved in an earlier runtime. `applyCodexHookEvent()` discards every event until the
state becomes `installed` (`src/main/eyesOnAgents/eyesOnAgents.service.ts:366-377`). Therefore a
`UserPromptSubmit` arriving while a multi-page `thread/list` is running is permanently lost; the
later successful trust inspection cannot recover it.

Required correction: verify hook trust before thread enumeration, update the ordering regression,
and add a service test that injects a hook event during sync and proves that an already-trusted
bridge does not lose it. If events can arrive before inspection completes, buffer only current
listener-lifetime events until the inspection result is known, then consume them only on a trusted
result and discard them on every other result.

## Protocol, security, and regression review

- Codex Desktop's bundled binary reports `codex-cli 0.144.5`. Its generated
  `v2/HooksListResponse.json` requires `data[].hooks[]` with camelCase `eventName`, `handlerType`,
  `enabled`, nullable `command`/`matcher`, and `trustStatus` in
  `managed|untrusted|trusted|modified`. A real isolated App Server probe returned that exact shape.
  `CodexAppServerSupervisor.listHooks()` parses only the bounded fields required for comparison and
  does not return keys, hashes, source paths, status messages, warnings, or errors to the bridge
  status surface (`src/main/eyesOnAgents/codexAppServer.supervisor.ts:121-155,358-375`).
- Trust gating fails closed: disabled, untrusted, modified, unknown, missing, duplicate, or changed
  owned definitions never produce `installed`; only exact enabled `trusted`/`managed` definitions
  do (`src/main/eyesOnAgents/codexDesktopBridge.service.ts:324-359`). Inspection failures expose a
  bounded generic message rather than unrelated hook commands.
- The 60-second expiry is removed correctly. Hook-active evidence is effective only when the bridge
  is trusted, listening, and the evidence timestamp is within the current listener lifetime
  (`src/shared/eyesOnAgents/eyesOnAgents.contract.ts:172-211`). Explicit disconnect stops the
  listener, removes the owned definitions, and invalidates active hook evidence while SQLite keeps
  completion/open markers (`src/main/eyesOnAgents/eyesOnAgents.service.ts:180-198`;
  `src/preload/sqlite/dao/eyesOnAgents.dao.ts:218-237`).
- The renderer/XPC changes remain within the existing `electron-xpc` API, expose no executable or
  arbitrary JSON-RPC input, preserve bilingual i18n, and keep the connection panel truthful about
  the one-time Codex review step. No prompt, response, tool payload, diff, or hook command is added
  to SQLite or the renderer snapshot.

## Verification

| Check | Result | Evidence |
|---|---|---|
| `yarn test:eyes-on-agents` | pass | Core, repository, App Server, bridge, and UI suites exited 0. |
| `yarn typecheck:eyes-on-agents:core` | pass | Scoped main/shared/preload strict check exited 0. |
| `yarn typecheck:eyes-on-agents:ui` | pass | Scoped EyesOnAgents Vue strict check exited 0. |
| Codex 0.144.5 `hooks/list` probe | pass | Isolated `/Applications/ChatGPT.app/Contents/Resources/codex app-server --stdio` returned one entry and the expected four untrusted command-hook definitions without transcript content. |
| `yarn build` | pass | Main, preload, and all renderer bundles, including EyesOnAgents, were emitted. |
| `git diff --check` | pass | Exited 0 before this review artifact was added. |
| `yarn typecheck` | baseline failure | EyesOnAgents-targeted checks pass; the repository-wide web check still reports existing diagnostics in DingTalk/Feishu/WeChat connectors, Coin, Poker tests, Home, Maestro, Omni, Todo, and shared path helpers. |

## Re-review gate

Resolve both event-loss windows, add deterministic start-boundary and during-sync regressions, rerun
the focused suite and scoped checks, and update the task/issue status only after an independent
round accepts the corrected ordering.
