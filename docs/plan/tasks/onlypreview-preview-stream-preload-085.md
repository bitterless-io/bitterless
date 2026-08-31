---
id: onlypreview-preview-stream-preload-085
scope: Move non-Office classification, text, asset/PDF/media and HTML resource I/O to hidden preload
status: implemented
depends-on: [onlypreview-project-authority-preload-084]
verify: protocol/stream/security/adapter tests, typecheck/lint/build; no Electron/Playwright/E2E
---

# Move current-file preview reads and streams into the hidden preload

## Objective

Make the hidden `fileSearch` preload own every non-Office descriptor/signature/text read and every
asset/PDF/media/HTML file session while Main retains only revision/token/protocol routing.

## Context

- [`onlypreview-main-filesystem-io.md`](../../issues/onlypreview-main-filesystem-io.md)
- [`onlypreview-main-filesystem-preload-migration.md`](../analysis/onlypreview-main-filesystem-preload-migration.md)
- [`onlypreview.md`](../../features/onlypreview.md)

## Path

- `src/main/onlypreview/{onlyPreviewWorkspace.registry,onlyPreviewClassifier.service,onlyPreviewAsset.registry,onlyPreviewDocument.registry,onlyPreviewProtocol.service}.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/main/fileSearch/fileSearchWindow.service.ts`
- `src/preload/fileSearch/**`
- `src/preload/onlypreview/onlypreviewContent.preload.ts`
- `src/renderer/onlypreview/common/contextBridge/**`
- `src/shared/onlypreview/**`
- `tests/onlypreview/**`

## Contract

- Preload owns open/read/stat/realpath and complete identity validation for text, Draw.io, image,
  audio/video, PDF and HTML resources. Main never receives an open handle or calls filesystem APIs.
- Use one Preview Read capability distinct from Search, Office and Project. It reuses the active
  Project workspace generation inside the hidden preload but mints an opaque selection grant pinned
  to the exact file identity; HTML also pins the entry-directory identity. Generic Preview Read
  rejects Office formats, which remain on their independent reader.
- A newer selection invalidates an earlier still-pending prepare operation before it can publish a
  grant. Main additionally fences host/runtime/selection/adapter before brokering any frame.
- Preserve every current size/signature/Range/HTML-containment/budget/replacement/revision safeguard.
- Main validates opaque tokens, exact methods and byte ranges, then pulls serial bounded frames from
  each preload session into the response. Frames are at most 512 KiB, offsets are strictly
  continuous, and only one read is pending per session; PDF/media may own multiple concurrent Range
  sessions and are never globally serialized.
- Text and protocol sources share the same byte-frame API. The visible Preview preload assembles
  only the admitted exact-size text buffer (at most 8 MiB) and decodes once so UTF-8 boundaries are
  preserved; Main never retains the complete file.
- Aborts, token revoke, selection replacement, host teardown, timeout and EOF deterministically
  generation-revoke and close the exact preload session. Cancellation cannot queue behind a stuck
  read, and an ordinary slow preview chunk does not kill unrelated search/Office/Project work.
- HTML atomically reserves each accepted body range against the 100 MiB revision budget before
  opening, never refunds aborted/retried bodies, excludes HEAD from the byte budget, and bounds the
  distinct resource-identity table. One document grant creates transient per-request resource
  sessions rather than persistent prepared grants for every resource.

## Verification

- Cover descriptor/text parity, full and ranged assets, PDF, media seek, HTML entry/resources,
  replacement races, cancellation, size budgets and absence of Main filesystem imports.
- Run targeted tests/typechecks/lint/build, then independent review. No Electron/E2E.

## Delivery

Implemented and independently reviewed PASS. Main now brokers only bounded Preview Read frames while
the hidden preload owns classification, file identity, text assembly inputs and asset/document
sessions. Deferred-open abort/revoke fences and strict private readiness envelopes are covered by
focused regression tests.
