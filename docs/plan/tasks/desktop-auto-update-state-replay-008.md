---
id: desktop-auto-update-state-replay-008
scope: replay download-ready automatic-update state after Home or Maestro renderer recreation
status: in-progress
depends-on: [desktop-auto-update-polling-007]
---

# Desktop Automatic-Update Ready-State Replay

## Objective

Make an already downloaded update visible after a renderer rebuild without creating another polling
timer, waiting for another broadcast, or restarting Bitterless.

## Context

- `docs/features/desktop-auto-update.md`
- `docs/issues/desktop-auto-update-ready-state-replay.md`
- `docs/plan/tasks/desktop-auto-update-polling-007.md`

## Path

- `src/main/updateHelper/update.service.ts`
- `src/main/xpc/update.handler.ts`
- `src/main/maestro/update/update.service.ts`
- `src/main/maestro/xpc/coach.handler.ts`
- `src/shared/maestro/coach.api.ts`
- `src/renderer/home/src/xpc/update.subscriber.ts`
- `src/renderer/home/src/store/update.store.ts`
- `src/renderer/maestro/home/src/store/update.store.ts`
- `tests/update/updatePolling.test.mjs`
- `scripts/maestro/check-update-ux.mjs`
- `docs/features/desktop-auto-update.md`
- `docs/issues/desktop-auto-update-ready-state-replay.md`
- `docs/plan/tasks/desktop-auto-update-state-replay-008.md`

## Required behavior

- Preserve the idempotent immediate plus 60-second poll delivered by task 007.
- Main records a defensive copy of the latest download-ready `UpdateInfo` before broadcasting and
  returns a defensive copy or an explicit absent value to snapshot readers.
- Home registers `app/updated` first, then requests the ready snapshot asynchronously; renderer mount
  must not wait for the request.
- Maestro registers both update broadcasts first, then requests the same ready snapshot through its
  typed XPC contract without delaying renderer initialization.
- A valid live update event received during the request wins; its state must not be overwritten by a
  stale snapshot response. In Maestro, valid `coach/update-available` suppresses the snapshot while
  remaining downloading, and only `coach/update-downloaded` becomes ready. A snapshot may initialize
  state only when no valid live update event has won.
- Validate event and snapshot shapes before changing a store. Log and ignore malformed data, and log
  snapshot request failures without hiding or blocking the renderer.
- Normalize the updater's string, note-array, or absent release notes to a real string before Main
  stores and broadcasts the ready value; a TypeScript assertion alone is not normalization.
- Preserve update button semantics: snapshot replay means downloaded and ready, never downloading.
- Preserve manual checks, feed setup, updater gates, install behavior, E2E guards, signing,
  notarization, publishing, and CDN behavior.
- Preserve unrelated primary-worktree changes.

## Verification

- Behavioral tests cover no snapshot, snapshot replay, ready-event precedence in both race orders,
  Maestro downloading-event precedence, malformed input, and defensive Main snapshot copies.
- Source/integration tests prove Main stores before broadcast, both XPC read paths exist, both
  renderers subscribe before requesting replay, and Home remains subscribed before App mount.
- `yarn test:desktop-auto-update`
- Updater-specific Maestro UX, renderer-i18n, customer-auth, focused strict Main/Home TypeScript,
  targeted lint, and committed diff checks pass.
- Independent review finds no open P1, P2, or P3 issue.
- Do not launch Electron, package, sign, notarize, publish, upload, refresh CDN, or access the remote
  feed; Ral retains real-device acceptance.
