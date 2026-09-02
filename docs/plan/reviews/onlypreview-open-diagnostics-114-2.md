---
task: onlypreview-open-diagnostics-114
review: 2
status: passed
---

# OnlyPreview open diagnostics independent review 2

## Findings

No P1, P2, or P3 blocking or non-blocking finding.

## Result

Pass. The repair restores the Main bootstrap's named-export contract while retaining one explicit-
open implementation, one shared mutation FIFO, and one registry registration.

## Evidence

- `src/main/onlypreview/onlyPreviewExplicitOpen.service.ts` remains the sole implementation and
  exports both `openOnlyPreviewAbsoluteTarget` and `onlyPreviewTargetMutations`.
- `src/main/xpc/onlyPreview.handler.ts` imports only the shared mutation FIFO for folder selection
  and directly re-exports `openOnlyPreviewAbsoluteTarget` from that same service. It adds no wrapper,
  duplicate queue, or duplicate implementation, so `src/main/app.main.ts` receives the same function
  identity for its OS-open queue and MCP Preview opener.
- `registerOnlyPreviewExplicitTarget(openOnlyPreviewAbsoluteTarget)` occurs once, in the explicit-open
  service. The handler re-export does not register a second callback.
- The only Main-process importers of the handler are `app.main.ts` and `auth.handler.ts`; the
  explicit-open service and its dependencies do not import the handler. The repair therefore adds
  no circular dependency.
- The serialization regression now requires the exact handler re-export, while also checking the
  service-owned serialized implementation, shared FIFO, single registry registration, and the Main
  queue/MCP consumers. Removing the re-export that caused the owner build failure makes this test
  fail before packaging.

## Verification

- `node --test --test-reporter=spec tests/onlypreview/onlyPreviewExplicitOpenSerialization.test.mjs tests/onlypreview/onlyPreviewAppWiring.test.mjs`: 15/15 passed.
- Build, Electron, E2E, packaged smoke, and the real application were not run in this independent
  review. The task's Preview-profile Electron-Vite build remains the outer delivery gate for the
  actual Rollup module graph.
