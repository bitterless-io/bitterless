---
id: onlypreview-drawio-deferred-viewer-ready-099-1
status: passed
reviewed_task: onlypreview-drawio-deferred-viewer-ready-099
target: working-tree
base: dev/next
date: 2026-09-01
review_type: independent-final-lifecycle-review
---

# OnlyPreview Draw.io deferred viewer ready 099 · Review 1

- Result: **PASS** after one blocking remediation round.
- Scope: zero-width visibility wait, official viewer invocation, callback restoration, cancellation,
  timeout, same-mount A→B, independent mounts, teardown, and focused source/behavior tests.
- Electron, Playwright, packaged smoke, E2E, and the real app were not run.

## Finding and remediation

The first implementation waited on the official viewer's global `viewerInitialized` callback.
Independent review reproduced a stale A→B candidate reaching B because upstream resolves that
global dynamically after its own visibility observer fires. Container identity was insufficient
when the same mount element was reused.

The final implementation removes that state entirely: a bounded, cancellable app-owned visibility
gate waits while the mount is zero-width, invokes no vendor code during that wait, then sets
`check-visible-state: false` and initializes the official viewer synchronously inside one short
callback install/restore section. Abort, timeout, and replacement therefore leave no upstream
deferred viewer that can call back later.

## Verification

- Focused Draw.io behavior tests: **22/22 passed**.
- Draw.io source guards: **5/5 passed**.
- Same-mount A→B, independent visible mounts, abort, timeout, listener/observer cleanup, and graph
  disposal: **passed** with dynamic upstream callback lookup semantics.
- `git diff --check`: **passed**.
- No polling, repeated parse/viewer construction, unbounded observer, or device-freeze risk found.

No remaining P1/P2/P3 finding exists.
