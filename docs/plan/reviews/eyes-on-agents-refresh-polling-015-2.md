# EyesOnAgents Refresh Polling Review — Round 2

Status: accepted

Date: 2026-07-21

## Findings

No open P1, P2, or P3 finding remains.

Round 1's **P2 · blocking** contract mismatch is closed. The task now requires reuse of the existing
full `syncThreads()` path, permits that operation's existing transitive observation-artifact
inspection, and prohibits a second timer, renderer RPC, or direct polling inspection call
(`docs/plan/tasks/eyes-on-agents-refresh-polling-015.md:25-41`). The integration, layout, and
observation contracts now say the same thing: full sync may reach existing `hooks/list` inspection
when observation is enabled, but the poll adds no independent Hook polling mechanism
(`docs/integrations/eyes-on-agents.md:174-197`,
`docs/integrations/eyes-on-agents-layout.md:149-155`,
`docs/features/eyes-on-agents-codex-observation.md:183-190`).

That revised contract accurately describes the unchanged call graph. The renderer tick calls only
`syncThreads()` (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:284-300`); the main full
sync may then run `refreshBridgeInspection()` and `listHooks()` as its artifact-inspection phase
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:318-329,772-802,950-957`). The source guard requires
the shared sync call and rejects direct activation, bridge-status, or emitter calls inside the tick
(`scripts/eyes-on-agents/ui-source.test.mjs:110-127`).

Round 1's **P3 · non-blocking** lifecycle-guard gap is closed. Current mount source starts polling
before its first `await`, and unmount stops it
(`src/renderer/eyesOnAgents/src/App.vue:95-106`). The guard now locates both positions and requires
the polling start index to precede the first mount `await`
(`scripts/eyes-on-agents/ui-source.test.mjs:80-92`), preventing the late post-unmount start scenario
identified in Round 1.

## Static contract assessment

- One store-owned `refreshTimer` starts one `window.setInterval()` at exactly `10_000` milliseconds.
  A non-null handle makes repeated starts no-ops; stop clears that handle and resets it to `null`
  (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:53,116-127`).
- The only other EyesOnAgents renderer interval is the independent renderer-global presentation
  clock. The guard counts one interval in each store, requires those to be the only interval-owning
  renderer files, and continues to prohibit card-local timers
  (`scripts/eyes-on-agents/ui-source.test.mjs:75-108,130-156`).
- Mount starts both store lifecycles synchronously and unmount stops both. Poll startup cannot resume
  after an initial snapshot-loading suspension because it occurs before that suspension.
- A tick drops while `snapshotPromise` or `busyAction` exists, with no retry flag or queued promise.
  It also rejects absent, `connecting`, and `syncing` connection state. Connected state synchronizes;
  disconnected/error state synchronizes only while `autoConnectEnabled` remains true
  (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:284-300`).
- `syncThreads()` enters the shared `runSnapshotAction()` guard synchronously, so a refresh extending
  beyond the next interval remains the sole request. Other shared board actions, including explicit
  Disconnect, keep the timer inert while in flight
  (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:181-190,321-335`).
- A successful explicit Disconnect disables auto-connect in the main service, and the subsequent
  snapshot therefore keeps later polling ticks from reconnecting
  (`src/main/eyesOnAgents/eyesOnAgents.service.ts:311-315`). It consequently also prevents the
  transitive artifact inspection attached to full sync.
- Timer-triggered rejections are caught at the interval boundary. The existing action path records
  `actionError`, preserves the last applied snapshot on failure, and releases `busyAction` in
  `finally` (`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:118-120,321-335`).
- Manual Refresh and focus activation retain their prior handlers and shared sync/load behavior; the
  polling changes add only the separate timer lifecycle and guarded tick. Activation's explicit
  bridge-status refresh remains outside the polling callback.

## Conclusion

**Pass.** Both Round 1 findings are closed. Task 015 meets its revised static contract for one
idempotent ten-second inventory timer, synchronous mount start and complete cleanup, non-overlapping
connection-intent-aware refreshes, authoritative explicit Disconnect, caught timer failures, reuse
of full `syncThreads()`, and no separate Hook polling path. It is ready for Ral's runtime
verification.

## Verification

Per owner instruction, this review ran no tests, build, typecheck, formatter, or Electron process.
The assessment used only current documents, source, source guards, Round 1 findings, and `git diff`.
Only this Round 2 review document was changed by the reviewer.
