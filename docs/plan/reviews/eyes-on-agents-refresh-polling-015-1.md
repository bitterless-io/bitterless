# EyesOnAgents Refresh Polling Review — Round 1

Status: blocked

Date: 2026-07-21

## Findings

No P1 finding.

### P2 · blocking — The periodic inventory sync transitively performs Hook trust inspection

The renderer tick calls the existing store `syncThreads()` path
(`src/renderer/eyesOnAgents/src/store/eyesOnAgents.store.ts:284-300`). That reaches the main service's
`syncThreads()`, which starts `performSync()`
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:318-329`). When observation is active,
`performSync()` calls `refreshBridgeInspection()`
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:950-957`), and the connected inspection ultimately
calls `appServer.listHooks()`
(`src/main/eyesOnAgents/eyesOnAgents.service.ts:772-802`). Consequently, a ten-second inventory tick
does inspect Hook trust whenever that observation context is active.

This contradicts all three current contracts: the integration says polling does not inspect Hook
trust (`docs/integrations/eyes-on-agents.md:189-194`), the layout says the automatic refresh never
inspects it (`docs/integrations/eyes-on-agents-layout.md:143-149`), and the observation document says
the inventory poll never calls `hooks/list`
(`docs/features/eyes-on-agents-codex-observation.md:183-188`). It also defeats the stated separation
between continuous thread inventory polling and activation-driven or explicit Hook inspection.

The new source guard does not detect this behavior. It rejects Hook-related names only within the
lexical body of `performRefreshPollingTick()` while simultaneously requiring that body to call
`syncThreads()` (`scripts/eyes-on-agents/ui-source.test.mjs:103-120`); it never follows or constrains
the main-service call path. The polling path and its guard must be made truthful to the no-Hook-
inspection contract before task 015 can pass.

### P3 · non-blocking — The lifecycle guard permits an async post-unmount timer start

The current source is safe: `startRefreshPolling()` runs synchronously during mount before the first
`await` (`src/renderer/eyesOnAgents/src/App.vue:95-100`), and unmount stops it
(`src/renderer/eyesOnAgents/src/App.vue:103-106`). However, the source guard only checks that the
matched async mount body contains a start call and the unmount body contains a stop call
(`scripts/eyes-on-agents/ui-source.test.mjs:64-85`). It does not require the start to precede the
first `await`.

A later move of `startRefreshPolling()` below `await loadSnapshot()` would still pass: unmount could
stop a still-null handle, then the suspended mount callback could resume and create an interval with
no remaining cleanup. Add an ordering guard so this currently correct lifecycle property cannot
regress.

## Static contract assessment

- Exactly one inventory-refresh `setInterval` exists in the EyesOnAgents renderer, alongside the
  separate presentation-only current-time interval. No per-card timer or second refresh timer was
  introduced.
- The refresh handle starts at `null`; repeated start is idempotent while non-null; stop is
  idempotent, calls `window.clearInterval()`, and resets the handle to `null`. The delay is exactly
  `10_000` milliseconds.
- Mount starts polling synchronously before snapshot loading can suspend; unmount stops polling.
  The P3 concerns regression coverage, not the present ordering.
- Each tick drops while a snapshot promise or shared busy action exists, rejects missing,
  `connecting`, and `syncing` connection state, synchronizes while connected, and retries
  disconnected/error only when auto-connect remains enabled.
- `syncThreads()` acquires the shared busy action synchronously before its first suspension, so later
  interval ticks are dropped rather than overlapped or queued. Explicit Disconnect holds the same
  busy guard and returns a snapshot with auto-connect disabled, which keeps later ticks inert.
- Timer-triggered rejection is caught at the interval boundary. The existing snapshot action still
  records `actionError`, retains the last applied snapshot on failure, and releases the busy guard.
- The task diff does not alter manual Refresh or focus-activation handlers. Activation still owns
  its existing coalescing and explicit Hook-status refresh behavior.
- The task, integration, layout, and observation documents agree with one another about interval
  ownership, timing, connection intent, overlap prevention, and Hook separation. The P2 is the
  mismatch between those documents and the transitive runtime source.

## Conclusion

**Blocked.** The timer ownership, lifecycle, timing, connection-intent, busy/load, rejection, and
explicit-Disconnect mechanics pass static inspection, but periodic `syncThreads()` still reaches
`hooks/list`. Close the P2 runtime/contract mismatch and harden the P3 lifecycle source guard before
accepting task 015.

## Verification

Per owner instruction, this review ran no tests, build, typecheck, formatter, or Electron process.
The assessment used only current documents, source, source guards, and `git diff`. Only this Round 1
review document was changed by the reviewer.
