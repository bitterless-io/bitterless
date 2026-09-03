# A Restored Project Shows Its Path but Never Renders Its Tree

Status: fixed; owner verification pending

## Symptom

OnlyPreview opens, the MenuBar shows the restored workspace path
(`/Users/ral/Documents/projects/overmind`), and the Project tree stays empty. Choosing the same
folder again through Open Folder renders it immediately.

## Evidence

`~/Library/Logs/Bitterless_PREVIEW/main.log`, every recent boot:

```text
2026-09-02T10:47:39.945Z  restore-index-grace tag=g2 phase=scheduled generation=1 elapsedMs=0
2026-09-02T10:47:39.946Z  shell-initialized   tag=h1 outcome=success elapsedMs=12
2026-09-03T02:10:00.935Z  restore-index-grace tag=g2 phase=scheduled generation=1 elapsedMs=0
2026-09-03T02:30:50.771Z  restore-index-grace tag=g2 phase=scheduled generation=1 elapsedMs=0
```

Three boots, three `phase=scheduled` records, and **no terminal record for any of them** — no
`start`, no `cancel`, no `action-failure`. `initialize-start`, `root-listing`, and `full-count` are
absent for those sessions, so the search index never began. The OnlyPreview window itself reported
`window-terminal outcome=success elapsedMs=364`: the window is fine, the index is not.

The same log shows the behavior before the change. Boots on 2026-09-01 and earlier emit no
`restore-index-grace` at all and instead show `shell-initialized outcome=success
elapsedMs=61446…81726` — the index ran inline on the critical path, taking 60–80 seconds, and the
tree did eventually render.

## Root cause

`OnlyPreviewShellStore.initialize()` restores the workspace with `deferInitialIndex = true`, so
`applyWorkspace` hands the first index to `OnlyPreviewDeferredIndexService.run(true, …)`, which
schedules it on a microtask and returns. `initialize()` then resolves — which is why the MenuBar has
the path 1 ms later while the tree has nothing.

The scheduled index never runs. `OnlyPreviewDeferredIndexService.schedule` had exactly one exit that
emitted nothing:

```ts
this.scheduleMicrotask(() => {
  if (this.generation !== generation || this.diagnostic !== diagnostic) return;  // silent
```

Every other exit — `cancel`, `start`, `schedule-failure`, `action-failure` — records a phase, and
none of them appeared, so the queued work either ended at that line or the microtask never drained
at all. The log could not distinguish those two, which is the first defect: a state machine whose
only unrecorded exit is the one that loses work.

Both candidates share one cause: the schedule was owned solely by a microtask, with nothing able to
re-arm it. The window record for those boots shows the shell reaching `interactive` with
`backgroundThrottling=true`, so a renderer that is throttled or frozen at that moment never drains
the callback, and no other trigger exists to run it.

Open Folder recovers because `chooseFolder` reaches `applyWorkspace(workspace)` with
`deferInitialIndex` defaulting to `false`, taking `run`'s immediate branch and calling
`initializeIndex()` directly.

This regressed with `b68ad06 fix: restore desktop first-visible startup`, which introduced the
deferral to keep the 60–80 second index off first paint. That goal is right; the delivery mechanism
does not survive the boot window.

## Repair contract

- The queued index is no longer owned by the microtask alone. `OnlyPreviewDeferredIndexService`
  holds one pending entry, and `resume()` re-arms it from a real user-visible signal. Whichever
  trigger drains first consumes the entry, so the index runs exactly once: a late microtask after a
  resume is a no-op, and a resume after the microtask already ran is a no-op.
- The Shell subscribes `resume()` to `window.focus` and to `visibilitychange` reaching `visible`.
  Both fire on the way back to an interactive shell, which is precisely the state a throttled or
  frozen renderer returns through. No timer is introduced; the microtask fast path is unchanged for
  a shell that never froze.
- `resume()` still honours the workspace generation, so returning to a shell whose Project has been
  replaced records `cancel` and indexes nothing.
- Every schedule now ends in exactly one terminal record — `start`, `resumed`, `cancel`,
  `superseded`, `schedule-failure`, or `action-failure`. The previously silent exit emits
  `superseded`, and `resumed`/`superseded` are registered in the fixed diagnostics vocabulary, so a
  dropped index can no longer look identical to a completed one.
- The index stays off the first-paint critical path. Reverting to the inline 60–80 second
  `initialize()` was not acceptable and was not done.

## Related

DevTools on the Preview channel was enabled alongside this investigation
(`onlyPreviewWindow.helper.ts`): the shortcut predicate required `VITE_MODE === 'debug'`, so the
packaged Preview release could not open DevTools on the OnlyPreview window at all. Preview is the
owner-facing test channel and now carries the shortcut; Stable is unchanged and auto-open stays
debug-only.
