---
id: onlypreview-pdf-network-delivery-028
scope: Serve the raw Chromium PDF from Chromium's network service instead of Main-process IO
status: implemented; owner verification pending
depends-on: [onlypreview-chrome-session-persistence-027]
verify: node --test tests/onlypreview/*.test.mjs && yarn build
---

# PDF bytes leave the Main process

## Objective

Owner requirement 2026-08-21: a previewed PDF must not reach the view through Main-process IO. Keep
the token URL, the session-scoped protocol handler and the absence of path disclosure, and let
Chromium's network service read the file instead of `fs.createReadStream` plus a byte-counting
`Transform` in Main.

## Context

- [`../../issues/onlypreview-pdf-blank-in-memory-partition.md`](../../issues/onlypreview-pdf-blank-in-memory-partition.md)
  — byte-path trace and the delivery options measured in the probe (`net.fetch` renders in cases 17;
  every in-memory case stays blank regardless of delivery, which is why this task is separate from
  027).
- Electron `protocol.handle` documentation — returning `net.fetch(pathToFileURL(...))` is the
  documented way to serve a local file from a custom protocol.

## Path

- `src/main/onlypreview/onlyPreviewAsset.registry.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `tests/onlypreview/onlyPreviewDocumentProtocol.test.mjs`
- `tests/onlypreview/onlyPreviewCoreTest.helper.mjs`,
  `tests/onlypreview/onlyPreviewPreviewGuards.test.mjs`,
  `tests/onlypreview/onlyPreviewRecentDirectory.test.mjs`,
  `tests/onlypreview/fixtures/electron.stub.mjs`

## Contract

1. `OnlyPreviewAssetIssueOptions` gains `delivery: 'stream' | 'network'`, defaulting to `'stream'`.
   Only the `chromium-pdf` adapter issues `'network'`.
2. `network` responses come from `net.fetch(pathToFileURL(realPath))` with
   `bypassCustomProtocolHandlers: true`, so the file fetch can never re-enter this scheme's handler.
3. `net.fetch` on a `file:` URL honours `Range` at the byte level but answers `200` with no
   `Content-Range` / `Content-Length` / `Accept-Ranges` (measured on Electron 40.10.6), so the
   `206`/`Content-Range`/`Content-Length` contract is synthesized from the verified file identity.
   Method guard, `413` ceiling and `416` unsatisfiable-range behavior match the stream path.
4. Identity is still resolved and re-verified **per request** in Main — real path, workspace
   containment, `size`/`dev`/`inode`/`mtimeNs`, host liveness, token expiry — before the fetch; the
   handle is closed immediately after, because no byte passes through this process.
5. Accepted losses, recorded deliberately: the byte-counting `Transform` ceiling and the
   post-stream re-`stat` cannot exist when Main does not own the stream, and `revokeSelection` now
   invalidates the token for later requests instead of destroying an in-flight stream. The TOCTOU
   window narrows to between a request's verification and its fetch.
6. The Vue adapters (`image`, `xlsx-grid`, `docx-dom`, `audio`, `video`) and the HTML document
   registry keep `stream` delivery: their byte ceilings and per-resource accounting are load-bearing
   for OOXML archive limits and the 1 MiB HTML budget.

## Verification

1. `node --test tests/onlypreview/*.test.mjs` — 324/324, including a new test that drives a
   `network` asset through full, ranged, `HEAD`, unsatisfiable-range and rejected-method requests,
   asserts the synthesized `206`/`Content-Range`/`Content-Length`, asserts the exact `net.fetch`
   calls (`file://…`, `bytes=start-end`, `bypassCustomProtocolHandlers: true`), asserts the identity
   handle is opened and closed for every request, asserts a revoked token stops answering, and fails
   the test if the file is ever read in-process.
2. A source-contract test pins `stream` as the default and `network` to the PDF adapter only.
3. `npx tsc --noEmit -p tsconfig.node.json --composite false` — 0 errors.
4. Focused error-level ESLint over every touched source and test — 0 errors.
5. `yarn build`.
6. Electron E2E not run. Owner owns live acceptance: open a large PDF, page through it, and confirm
   rendering plus responsive scrolling.
