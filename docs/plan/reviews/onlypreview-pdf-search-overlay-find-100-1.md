---
id: onlypreview-pdf-search-overlay-find-100-1
status: passed
reviewed_task: onlypreview-pdf-search-overlay-find-100
target: working-tree
base: dev/next
date: 2026-09-01
review_type: independent-final-lifecycle-review
---

# OnlyPreview PDF Search overlay and Find readiness 100 · Review 1

- Result: **PASS** with no P0-P3 finding.
- Scope: native/renderer layout ownership, transparent dismissal, z-order, context reload/resize,
  exact PDF frame readiness, listener teardown, stale revision fencing, and pending native Find.
- Electron, Playwright, packaged smoke, E2E, and the real app were not run.

## Verification

- Search receives complete BaseWindow content bounds plus the Main-owned Preview workspace
  rectangle. Its existing surface applies the exact `24px` inset; transparent-canvas clicks are
  consumed and close through `mode: 'opener'`, while the historical Shell scrim is absent.
- Layout/context revision snapshots survive resize and renderer reload without allowing stale events
  to overwrite newer geometry or visibility.
- The PDF `did-frame-finish-load` listener is installed before navigation and accepts only the exact
  current non-main `webFrameMain.fromId()` frame at the navigation URL. Main-frame, foreign, stale,
  replaced, destroyed, and timed-out cases fail closed and remove listener/timer ownership.
- Exact PDF readiness re-raises an active Search once. The existing Find service retains a pending
  query while loading and dispatches it once across the ready transition; repeated ready sync does
  not duplicate the request.
- Developer verification passed **43/43 focused tests** and `yarn build`. Independent verification
  passed **39/39 directed Node tests**, `typecheck:node`, Web `vue-tsc --noCheck`, directed ESLint,
  and scoped `git diff --check`.
- Strict whole-project `typecheck:web` contains only pre-existing non-Task100 errors. No Main
  potentially large-file I/O, polling loop, parser, injection, PDF.js, OCR, or device-freeze risk
  was added.

Ral owns the remaining real-app PDF highlight/navigation, Search-over-PDF z-order, and transparent
outside-click acceptance.
