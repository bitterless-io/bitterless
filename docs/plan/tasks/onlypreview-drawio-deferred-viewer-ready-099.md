---
id: onlypreview-drawio-deferred-viewer-ready-099
scope: Await and cancel the official Draw.io viewer's deferred initialization inside VuePreview
status: implemented; owner verification pending
depends-on:
  - onlypreview-drawio-readonly-032
verify: focused Draw.io Node tests, node/web typechecks, renderer i18n, focused lint, production build, and git diff check; no Electron/Playwright/E2E
---

# Await deferred Draw.io viewer readiness

## Objective

Render valid `.drawio` files when the Vue Preview mount is temporarily zero-width during a
`WebContentsView` transition. Keep the existing no-iframe, local, read-only official viewer and
make its readiness handshake bounded, cancellable, and revision-safe.

## Context

- [Deferred viewer-ready issue](../../issues/onlypreview-drawio-deferred-viewer-ready.md)
- [OnlyPreview format coverage](../../design/onlypreview-format-coverage.md#9--drawio-已定-2026-08-26-已实施)
- [Original Draw.io delivery](onlypreview-drawio-readonly-032.md)

## Paths

- `src/renderer/onlypreview/preview/src/onlyPreviewDrawio.service.ts`
- `src/renderer/onlypreview/preview/src/components/DrawioPreview/DrawioPreview.store.ts`
- `tests/onlypreview/onlyPreviewDrawioViewer.test.mjs`
- focused Draw.io source/lifecycle tests
- `docs/design/onlypreview-format-coverage.md`
- `docs/features/onlypreview.md`
- `docs/issues/onlypreview-drawio-deferred-viewer-ready.md`
- `docs/plan/README.md`

## Contract

1. `GraphViewer.processElements()` may initialize synchronously or defer through its own visibility
   observer. Resolve only from the exact active mount's `viewerInitialized` callback.
2. Use one non-renewing renderer deadline shorter than Main's 30-second watchdog. No polling,
   repeated parsing, repeated viewer construction, or deadline extension is allowed.
3. The Draw.io component store owns an abort controller per mount. A newer mount and component
   disposal abort the old wait before any new viewer is started.
4. Every settlement path restores the previous global callback. Failure/cancellation removes owned
   listeners, attributes, classes, and DOM. A late callback destroys its graph and cannot publish
   ready or error for a stale revision.
5. Keep the existing Worker preflight, local hash-pinned viewer, offline/frame-free policy, limits,
   viewer controls, and Main full-view rebuild fence unchanged.

## Verification

- Add real behavior coverage for synchronous initialization, deferred initialization, abort before
  deferred ready, late callback cleanup, and finite timeout.
- Run focused Draw.io Node tests, `yarn typecheck:node`, `yarn typecheck:web`, renderer i18n, focused
  lint, `yarn build`, and `git diff --check`.
- Do not launch Electron, Playwright, packaged smoke, or E2E. Ral owns live verification with the
  supplied MCU workflow file after installing/running a build that contains Task 032 and Task 099.

## Delivery

The Vue adapter now waits for a non-zero mount through one bounded, cancellable app-owned
visibility gate before any vendor call. It then disables the official viewer's own deferred
visibility path and initializes synchronously inside a short exact-mount callback section. This
removes the stale A→B global-callback race while retaining abort, timeout, graph teardown, and Main's
full-view rebuild fence. [Independent review 1](../reviews/onlypreview-drawio-deferred-viewer-ready-099-1.md)
passed after reproducing and closing the first implementation's callback-identity blocker.
