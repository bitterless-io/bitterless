---
id: desktop-auto-update-polling-007
scope: recover automatic-update polling after metadata disagreement without restarting Bitterless
status: implemented; owner verification pending
depends-on: []
---

# Desktop Automatic-Update Polling Recovery

## Objective

Keep the main-process automatic updater retryable for the lifetime of the process so a newly
published version is found and downloaded by a running older application without requiring restart.

## Context

- `docs/features/desktop-auto-update.md`
- `docs/issues/desktop-auto-update-polling-stalls.md`
- `docs/features/sqlite-migration-release-gate.md`
- `scripts/publish.js`

## Path

- `src/main/updateHelper/update.service.ts`
- `src/main/updateHelper/updatePolling.service.ts`
- `src/main/xpc/update.handler.ts`
- `src/renderer/home/src/main.ts`
- `src/renderer/home/src/xpc/update.subscriber.ts`
- `src/renderer/maestro/home/src/store/update.store.ts`
- focused automatic-update regression tests and their package script
- `docs/features/desktop-auto-update.md`
- `docs/issues/desktop-auto-update-polling-stalls.md`
- `docs/plan/tasks/desktop-auto-update-polling-007.md`

## Required behavior

- Preserve one immediate check followed by a 60-second main-process poll.
- Repeated start requests own one timer; stop clears it and permits a later clean start.
- Timer and manual calls share one in-flight check and never overlap.
- A newer product `versionCode` is not downloadable until `checkForUpdates()` returns
  `isUpdateAvailable: true`.
- An inner not-available result is an explicit retryable metadata-disagreement error and releases
  the in-flight slot for the next tick.
- `isDownloading` covers only `downloadUpdate` and resets after either success or failure.
- Home subscribes before its root App can start the immediate poll and reads XPC `payload.params`.
- Preserve the download-ready update button, install confirmation, E2E-disable behavior, feed URL,
  signing, notarization, version preparation, publication, and CDN-refresh behavior.
- Preserve all unrelated work in the primary worktree.

## Verification

- Focused behavioral tests prove immediate/idempotent polling, shared in-flight work, and retry after
  both resolution and rejection.
- Source-contract tests prove the two-gate decision, download-only state cleanup, and Home subscriber
  ordering/payload handling.
- `yarn test:desktop-auto-update`
- Existing focused Maestro update UX, renderer bootstrap, and customer-auth checks pass; broader
  project check baselines are recorded separately when they contain unrelated failures.
- Focused strict TypeScript checks cover the changed Main and Home update modules; the configured
  Node preflight alone uses `--noCheck` and is not treated as semantic proof.
- `git diff --check` and an independent review pass.
- Do not launch Electron, package, sign, notarize, upload, refresh CDN, or publish; Ral performs the
  final real-device update check with a later release.

## Delivery evidence — 2026-07-27

- Commit `9dd43d9` replaces the sticky event-flag gate with the returned platform updater result and
  keeps feed setup, updater checking, metadata disagreement, and downloading inside one retryable
  error boundary.
- One polling coordinator owns the immediate check and 60-second timer, deduplicates scheduled and
  manual calls, and releases the shared operation after fulfillment or rejection.
- Home subscribes before App mount and reads `payload.params`; the Maestro contract comment now
  describes the same two-gate behavior.
- `yarn test:desktop-auto-update` passed 5/5. Focused strict Main and Home TypeScript checks,
  updater-specific Maestro UX, renderer-i18n, customer-auth 14/14, Node preflight, targeted lint,
  and diff checks passed.
- The broad Web typecheck and Maestro aggregate retain unrelated parent-baseline failures. A clean
  `b47be1d` comparison proves the task removes the former Home updater-payload type diagnostic and
  introduces no updater-file diagnostic.
- Independent review found no open P1, P2, or P3 issue; see
  [`desktop-auto-update-polling-007-1`](../reviews/desktop-auto-update-polling-007-1.md).
- Electron launch, packaging, signing, notarization, publication, upload, CDN refresh, and remote
  feed access were intentionally not run. Ral owns real-device acceptance with a later release.
