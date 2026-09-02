---
task: omni-open-readiness-112
review: 2
status: passed
target: dev-next-working-tree-at-1076f0085503a2351ff8ab5f5dd7897a489c160d
date: 2026-09-02
review_type: independent-source-and-node-no-electron
---

# Omni Open readiness independent review 2

## Result

**PASSED.** No P0-P2 finding remains. Every acquired browser-load resource is now registered for
cleanup independently of diagnostic scope, so initial and non-initial loads release exactly once
before the semaphore is drained/reset. Cleanup-aborted queued callbacks do not release again, while
non-aborted dead-view callbacks still return the permit they actually acquired.

## Final blocker resolution

Every live acquired browser load is inserted into `browserLoadResources`; its first exact-once
cleanup removes itself from that registry and releases its permit
(`src/main/windows/omniWindow.helper.ts:1714-1717`). This applies even when
`deferredNavigation === null`, so browser loads added outside initial restore no longer escape graph
cleanup.

`cleanupAllViews()` closes all registered browser resources before aborting pending acquisitions and
calling `drain()` (`omniWindow.helper.ts:512-526`). Active releases can transfer permits to queued
waiters, but those waiters still retain abort tokens until their callbacks run; cleanup marks them
aborted, and their branch records supersede and returns without releasing
(`omniWindow.helper.ts:1698-1707`). Remaining queued waiters resolved directly by `drain()` take the
same no-release branch. A non-aborted dead view follows the separate branch and releases its genuine
permit (`omniWindow.helper.ts:1709-1712`). Late events, promise rejections, and timeouts call an
already-closed resource and cannot release again. This ordering prevents the next generation from
exceeding the semaphore's capacity of three through cleanup.

## Prior blocker resolution

- The 16ms scheduler crosses an event-loop turn. Its generation registry prevents a ready reopen
  inside the grace period from replacing the first task batch; captured browser/mini-app starts and
  Control construction run once. `cancelAll()` makes cleanup and late callbacks inert.
- Browser and mini-app initial loads emit fixed privacy-safe scheduled/start and once-terminal
  navigation records. Mini-app cleanup clears its timer. Each acquired browser load owns its real
  30-second timer, four listeners, and semaphore permit through one exact-once disposer across
  success, failure, timeout, sync throw, and supersede.
- Renderers do not pre-report receipt success. Main records fixed accepted/rejected receipts without
  identity fields, preserves accepted correlation before fence deletion, and bounds/deduplicates
  rejected records.
- Renderer-stage `outcome` is required by declarations/current callers, and Main rejects missing,
  unknown, or malformed values at runtime.

## Contract evidence

- Cold Open shares one promise and one 30-second deadline. It waits for top and every initial browser
  chrome view to complete both load and post-`nextTick` Vue mount before show/focus/return. Existing
  ready reuse focuses the same graph immediately.
- Saved layout/cell shells remain preserved. Initial remote browser/mini-app loads and nonessential
  Control construction start after first-visible; per-task/Control synchronous exceptions are
  contained, and lazy Control toggle remains available.
- Token, generation, role, cell, and current-view fences remain exact. Top/browser/Control local
  renderers start unthrottled; remote content retains `backgroundThrottling: true`. Renderer
  success, failure, timeout, and cleanup restore normal throttling and remove lifecycle listeners.
- Control Vue mount and asynchronous layout readiness remain distinct post-open stages, and its
  diagnostic timeout does not affect UI.
- Renderer bootstrap/receipt ordering remains correct without unhandled stale-receipt failures.
- `[omni-open]` records retain fixed runtime allowlists, bounded monotonic values, restored counts,
  first-visible/interactive stages, deferred navigation/Control evidence, pending categories, and
  once-only terminals. New/touched records contain no URL, cell ID, token/capability,
  query/content/path, or raw error; diagnostics add no readiness wait.
- Home/Workbench loading feedback and the browser address field's single Enter navigation remain
  unchanged.

## Non-blocking finding

### P3 — semaphore cleanup regression remains source-shape coverage

`tests/omni/omniOpenReadiness.test.mjs:137-152` protects the aborted/dead branch split and active
resource registry/cleanup ordering through source assertions. The exact-once disposer has behavioral
unit coverage, but there is still no integration harness that queues more than three browser loads,
cleans the graph, and measures available permits in the next generation. The directly verified
control flow is correct; an integration regression would make this concurrency invariant more
resistant to future semaphore changes.

## Verification

| Check | Result |
| --- | --- |
| Full focused non-Electron Omni suite (coordinator, diagnostics, readiness, renderer stages, deferred scheduler, exact-once resources, layout lifecycle) | PASS — 41/41 |
| Post-final-fix `node --test tests/omni/omniOpenReadiness.test.mjs tests/omni/omniExactOnceResource.test.mjs` | PASS — 9/9 |
| Post-final-fix `yarn typecheck:node` | PASS |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false` | PASS |
| Task-scoped/repository diff checks | PASS |
| Electron, Playwright/E2E, packaged smoke, build, package, commit, sync | NOT RUN — explicitly excluded |

## Conclusion

**PASSED with one non-blocking P3.** The task is ready for the owner-controlled packaged/Electron
verification already reserved by the task. This review changed no product source, tests, task state,
or other docs.
