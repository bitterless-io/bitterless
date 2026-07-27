---
id: desktop-auto-update-polling-007-1
status: pass
reviewed_task: desktop-auto-update-polling-007
target: 9dd43d9
base: b47be1d
compared_with: desktop-auto-update-polling-007
date: 2026-07-27
review_type: independent-code-and-contract
---

# Verdict

**PASS.** No P1, P2, or P3 finding remains. Commit `9dd43d9` satisfies the automatic-update
polling recovery contract and is ready to merge within the stated non-packaging boundary.

# Findings

No findings.

# Evidence

- `src/main/updateHelper/updatePolling.service.ts` owns one null-checked timer, starts one immediate
  check, shares timer and manual callers through one in-flight promise, and clears that promise in
  `finally` after both fulfillment and rejection. A stopped poll can create a fresh timer later.
- `src/main/updateHelper/update.service.ts` first compares the outer `versionCode`, then treats the
  returned `checkForUpdates().isUpdateAvailable` value as the authoritative platform gate. A normal
  metadata mismatch becomes an explicit retryable error result; feed setup, updater checking,
  mismatch handling, and downloading share one error boundary.
- `isDownloading` is assigned `true` only immediately around `downloadUpdate()` and is reset in its
  `finally`. The shared polling promise therefore releases after metadata disagreement, rejected
  updater work, and successful downloading, so later scheduled or manual checks can run.
- Main broadcasts `coach/update-available` only after both gates pass. The existing downloaded-ready
  `app/updated` and `coach/update-downloaded` broadcasts remain intact.
- Home calls `initUpdateSubscriber()` before mounting `App`, whose `onMounted` hook starts polling,
  and the subscriber consumes the typed update value from `payload.params`.
- The `BITTERLESS_E2E` start/check/install guards and the existing quit, cleanup, and
  `quitAndInstall(false, true)` path are unchanged in behavior. The generic feed URL setup is
  preserved.
- The focused suite meaningfully covers the defect boundary: controlled timers prove immediate and
  idempotent ownership, deferred checks prove non-overlap and release after resolution/rejection,
  and bounded source-contract assertions protect the two gates, download-only cleanup, integration
  wiring, and Home subscription order/payload.

# Verification

| Check | Result |
|---|---|
| `yarn test:desktop-auto-update` | pass — 5/5 |
| strict Main changed-file `tsc` over `src/main/env.d.ts`, update types, polling service, update service, and XPC handler | pass |
| strict Home changed-file `tsc` over the update store and subscriber | pass |
| `node scripts/maestro/check-update-ux.mjs` | pass |
| `yarn check:renderer-i18n` | pass |
| `yarn test:customer-auth` | pass — 14/14 |
| `yarn typecheck:node` | pass — retained as configured preflight only because it uses `--noCheck`; the strict focused Main check above supplies semantic proof |
| `git diff --check b47be1d..9dd43d9` | pass |
| `yarn typecheck:web` | baseline-only failure — every target diagnostic is outside the changed updater files and reproduces on a clean `b47be1d` archive; the parent-only Home update-subscriber payload type error is fixed by this commit |

The broad `yarn check:maestro` command was not rerun in this review. Its known baseline stops before
individual checks on eight unrelated host-alias violations; the updater-specific Maestro check above
passed directly.

# Boundary

Verification did not launch Electron, run E2E, build, package, sign, notarize, publish, upload,
refresh a CDN, or access or mutate the remote update feed. Real-device update installation remains
the owner acceptance step for a later release.
