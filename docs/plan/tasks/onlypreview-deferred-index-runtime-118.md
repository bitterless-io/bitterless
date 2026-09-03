---
id: onlypreview-deferred-index-runtime-118
scope: Restore the initial OnlyPreview Project listing, diagnose deferred failures, and remove the hidden fileSearch dev CSP false alarm
status: implemented; owner verification pending
depends-on: [desktop-first-visible-performance-117, onlypreview-action-diagnostics-103]
verify: focused OnlyPreview scheduler/CSP/diagnostics tests, Node and directed Web type checks, git diff --check; no Electron/Playwright/E2E
---

# Restore OnlyPreview deferred Project startup

## Objective

Repair the restored-Project kickoff introduced by task 117 without putting directory traversal back
on the first-visible path. Make a future scheduled-but-not-started failure directly identifiable in
the persisted renderer diagnostics, and remove the unrelated hidden-runtime CSP noise without
granting that privileged page script execution.

## Contract

1. `OnlyPreviewDeferredIndexService` invokes the browser scheduler through a receiver-safe wrapper.
   The initial action remains a cancelable microtask and remains outside window first-visible and
   Shell mount readiness.
2. The fixed `restore-index-grace` diagnostic distinguishes `scheduled`, `start`, `cancel`,
   `schedule-failure`, and `action-failure`. Records contain only the short tag, generation, phase,
   and bounded elapsed time.
3. A rejected deferred action is observed and logged without creating an unhandled rejection. The
   existing action remains responsible for its user-visible result and state cleanup.
4. Serve and build transformation leave `fileSearch/index.html` with `default-src 'none'`, an empty
   body, and no page scripts after Vite/Monaco injection. The production page output becomes truly
   scriptless while the preload-owned runtime behavior stays unchanged. Built-output auditing runs
   only for the build command and never reads stale or absent `out` files when a dev server closes.
5. Tests reproduce a native scheduler that rejects an invalid receiver, prove the default wrapper
   avoids that failure, cover schedule/action failure phases, and guard the scriptless privileged
   HTML transformation.

## Verification boundary

Run source/unit tests, type checks, and a build/config transform check only. Do not start Electron or
run E2E; Ral owns the live DEBUG acceptance.

## Delivery and verification

- `node --test tests/onlypreview/onlyPreviewDeferredIndex.test.mjs tests/onlypreview/onlyPreviewOpenDiagnostics.test.mjs tests/onlypreview/onlyPreviewPrivilegedHtml.test.mjs tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` — 24/24 passed.
- `yarn typecheck:node` — passed.
- `node scripts/environment/runWithRuntimeProfile.cjs release_preview -- yarn _build:release` —
  passed; both privileged blank renderer outputs retained `default-src 'none'`, an empty body, and
  no page-resource tags.
- `yarn typecheck:web` — the repository-wide command remains red on pre-existing unrelated Poker
  GTO, Home, Connector, Maestro, Omni, and path-helper errors; it reported no Task 118 file.
- `git diff --check` — passed.
- Electron/Playwright/E2E — intentionally not run; Ral will test the restarted DEBUG runtime.
