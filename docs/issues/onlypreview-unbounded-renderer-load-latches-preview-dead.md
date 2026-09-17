# An unbounded hidden-renderer load latches OnlyPreview dead until restart

Status: fixed in both apps; owner verification pending. Mirrored byte-identically into
`micromeet-cowork` (`apps/cowork/src/main/fileSearch/fileSearchWindow.service.ts`).

Found 2026-09-17 while reviewing Ral's report that「cowork 的 preview 导致的主进程卡死」. **The
review disproved that causation** — see *OnlyPreview is the victim, not the cause* — but it found
this, which is why the symptom read that way.

## The defect

`fileSearchWindow.service.ts` awaited the hidden file-search renderer's load with **no bound**:

```ts
if (is.dev && process.env.ELECTRON_RENDERER_URL) await window.loadURL(target.url);
else await window.loadFile(target.filePath);
```

Every step *after* it is bounded — `waitForFileSearchRuntimeReady` 10s
(`fileSearchRuntimeReady.service.ts`), project authority 10s (`PROJECT_AUTHORITY_TIMEOUT_MS`),
preview chunk 5s (`fileSearchPreviewReadClient.service.ts`). This one was the only await on the
chain without a deadline.

The four listeners registered just above it (`did-fail-load`, `render-process-gone`,
`unresponsive`, `closed`) cover **"the load failed"**. They do not cover **"the load was never
answered"**.

**It happened.** `~/Library/Application Support/COWORK_TEST_DEBUG/logs/main-2026-09-17.log`:
`04:36:24.102Z` emits `runtime-window tag=w1 phase=start elapsedMs=0`, and for the rest of that
session there is **no `renderer-loaded` and no `runtime-window-terminal`, ever**. A healthy open is
342ms (`10:50:29.319Z phase=renderer-loaded elapsedMs=342`).

## Why one stalled load kills the whole subsystem

```text
loadURL never settles
  → attachSurface never returns
  → the finally in openOnMount (onlyPreviewWindow.helper.ts:578-582) never runs
  → this.surfaceOpening stays set forever
  → every later ensureStandalone / openOnMount awaits opening.ready forever (:478, :541)
  → OnlyPreviewTargetMutationQueue (onlyPreviewOpenRouter.service.ts:63-74) stops advancing
  → every subsequent open / select / navigate hangs silently, with nothing surfaced, until restart
```

Electron runs its network service **in the main process**, so a single transient main-thread stall
is enough to make this localhost load miss its response — and from then on OnlyPreview is
permanently dead. That is the loop that makes a momentary stall elsewhere look exactly like
"OnlyPreview froze everything".

## Repair

One change: race the load against `RENDERER_LOAD_TIMEOUT_MS = 30_000` and against `stopped`. On
expiry it calls `lifecycleFence.fail('File-search renderer load timed out.')` — the same vocabulary
as the four load-failure events — **and rejects**, which is the part that matters: the rejection
reaches the existing recovery path that was never being entered.

Nothing else needed changing, and that is the point worth recording: the recovery already existed at
`onlyPreviewWindow.helper.ts:569-582` — the `catch` emits `visible-window-terminal outcome=failure`,
calls `destroyStandalone()` and rethrows; the `finally` clears `surfaceOpening`. The latch was never
a missing-recovery bug, it was an await that never handed control to the recovery. So
`onlyPreviewWindow.helper.ts` and `onlyPreviewOpenRouter.service.ts` are untouched.

30s rather than matching the 10s siblings: this deadline exists to break a permanent latch, not to
enforce startup speed, and a cold `yarn dev` legitimately waits on Vite compiling that renderer.
Genuine failures still surface immediately through the four events.

## Verification

`node --test tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` — 7/7, including the new
*"the hidden renderer load is bounded, so a stalled load cannot latch OnlyPreview dead"*, which pins
the constant, the race containing both load forms, the fence call, the rejection, the `clearTimeout`,
the distinct superseded message, and — the other half of the invariant — that
`onlyPreviewWindow.helper.ts` still clears `surfaceOpening` in a `finally`. `yarn typecheck:node`
adds no diagnostic for the touched file in either repo.

The guard lives in bitterless only; cowork has no counterpart suite for this service. The two copies
are byte-identical and must stay so — `diff` them if either is edited.

## OnlyPreview is the victim, not the cause

For the record, because the owner's hypothesis was the opposite and the evidence is unambiguous:

- OnlyPreview **never ran** during the stall episodes. Both captured `yarn dev` boots contain zero
  OnlyPreview runtime lines (every `onlypreview` match is Vite build output), and the whole day's
  persisted log has only two OnlyPreview episodes — `04:36:24Z` and `10:50:28Z` — neither in the
  sessions that stalled.
- The stall lives in the LLM / host-mutation FIFO: `09:25:37.217Z llm-sync ok` →
  `09:25:55.195Z provider readiness "openai-codex" timed out after 8000ms` is 18.0s, of which the
  first 10.0s precedes that probe's own 8s window. Worse instances the same day:
  `getLlmConfig took 333784ms` with `renderer-config STUCK after 15000ms — boot stalled here`, and
  `getLlmConfig took 23206ms`. `getLlmConfig` runs inside `queueCoworkHostMutation`
  (cowork `mainWindow.controller.ts:1147`).
- OnlyPreview holds no part of that FIFO: `runCoworkHostMutation` / `queueCoworkHostMutation` have
  zero call sites under `miniapps/onlypreview/`, `windows/onlyPreview*`, or `fileSearch/`.

The cowork-specific part of this issue is **exposure, not code**: cowork builds the composite into a
restored mini-app tab 25ms after the control renderer's config handshake (`04:36:24.076Z` →
`.101Z`), i.e. inside the already-contended boot window, whereas bitterless only builds it when the
operator opens OnlyPreview.

## Two findings deliberately left alone

- **`search` is dispatched with `timeoutMs: null` in cowork** (`onlyPreviewSearchRuntime.handler.ts`),
  and the relay makes a `null` deadline never settle. bitterless uses `SEARCH_TIMEOUT_MS = 60_000`.
  This divergence is deliberate and documented in cowork's own comment, with three tests pinning
  850s without settling — a tradeoff for Ral to re-decide, not an oversight, so it is recorded rather
  than "fixed".
- **The search index reached 5.3 GB for one workspace** on this machine
  (`search-index-v6/<hash>.sqlite` = 5,681,782,784 bytes) with 14 orphaned
  `…candidate-<uuid>-journal` files dated Sep 7–16, i.e. copy-then-promote cycles that never cleaned
  up. Renderer-side, so not a main-thread stall, but a real growth/retention problem in both apps.
