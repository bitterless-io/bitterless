---
id: onlypreview-chrome-session-persistence-027
scope: Persistent Chrome preview session so PDFs render, with shared-session isolation bookkeeping
status: implemented; owner verification pending
depends-on: [onlypreview-dual-preview-region-024]
verify: node --test tests/onlypreview/*.test.mjs && yarn check:renderer-i18n && yarn build
---

# Persistent Chrome preview session

## Objective

Fix [the blank PDF preview](../../issues/onlypreview-pdf-blank-in-memory-partition.md): the raw
Chromium content view used a per-selection **in-memory** session partition, and Chromium's PDF viewer
never creates its document frame in an off-the-record session. Move that view to one constant
persistent partition and adjust the isolation bookkeeping that a shared session requires, without
weakening any security property of the view.

## Context

- [`../../issues/onlypreview-pdf-blank-in-memory-partition.md`](../../issues/onlypreview-pdf-blank-in-memory-partition.md)
  — root cause and the 18-case Electron 40.10.6 probe matrix.
- [`../../features/onlypreview.md`](../../features/onlypreview.md) — Preview Region contract.
- [`onlypreview-dual-preview-region-024`](onlypreview-dual-preview-region-024.md) — the raw Chromium
  and Vue content views.

## Path

- `src/main/onlypreview/views/onlyPreviewPreviewView.service.ts`
- `src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts`
- `src/main/onlypreview/onlyPreviewProtocol.service.ts`
- `src/shared/onlypreview/onlyPreview.types.ts`
- `src/shared/onlypreview/onlyPreview.contract.ts`
- `src/renderer/onlypreview/common/onlyPreviewI18n.ts`
- `tests/onlypreview/onlyPreviewPreviewView.test.mjs`
- `tests/onlypreview/onlyPreviewDocumentProtocol.test.mjs`
- `tests/onlypreview/onlyPreviewPreviewRegionTest.helper.mjs`
- `tests/onlypreview/fixtures/electron.stub.mjs`

## Contract

1. The raw Chromium view uses the constant partition `persist:onlypreview-chrome`. The name must stay
   constant: every distinct `persist:` name creates a `userData/Partitions/<name>` directory that
   nothing deletes, so a per-selection name would leak disk for the life of the installation.
2. Session hardening — denied permission check/request, cancelled `http`/`https`/`ws`/`wss`/`ftp`/
   `file` requests, the dead proxy, and the download refusal — is installed **once** per session and
   is never removed by a per-selection teardown. An out-of-order cleanup must not be able to leave a
   later view running unhardened.
3. Per-selection isolation is unchanged in force and comes from: the one-shot 64-hex asset/document
   token, the session protocol handler scoped to one hostname + token, `revokeSelection`, view
   destruction, and `closeAllConnections` + `clearStorageData` + `clearCache` — the last three
   running only while no Chrome view is mounted on the session. Accepted behavior change: a raw HTML
   page's storage/cache now reaches disk for the life of that selection instead of never, and an
   abnormal host termination (crash or kill) leaves it there until the next teardown clears it.
4. `installOnlyPreviewSessionProtocol` claims a generation per session; a cleanup unhandles only
   while it still owns the current generation, so a late teardown cannot unhandle a newer selection's
   handler.
5. Readiness for `chromium-pdf` requires the viewer's own document frame — a non-main frame at the
   navigation URL — polled to a bounded deadline; on timeout the presentation becomes `unavailable`
   with the new truthful code `PDF_VIEWER_UNAVAILABLE`. `html-page` readiness stays on
   `did-finish-load`.
6. No change to sandbox, context isolation, Node integration, web security, denied popups, the
   navigation fence, or the Vue surface.

## Verification

1. `node --test tests/onlypreview/*.test.mjs` — 324/324, including: the partition is one constant
   `persist:` string with no template interpolation; all Chrome views share one session whose
   `will-download` listener count stays 1 and whose proxy is configured once; each teardown clears
   that session once; a superseded mount cannot clear the session under a newer view; a stale
   protocol cleanup cannot unhandle the current handler; PDF readiness needs the document frame and
   times out into `PDF_VIEWER_UNAVAILABLE`; HTML readiness does not.
2. `node --test tests/omni/*.mjs tests/motto/*.test.mjs` — 43/43.
3. `npx tsc --noEmit -p tsconfig.node.json --composite false` — 0 errors (the packaged
   `typecheck:node` script passes `--noCheck`, so it does not type-check).
4. `yarn check:renderer-i18n` — ok; `PDF_VIEWER_UNAVAILABLE` has `en` + `zh` entries.
5. Focused error-level ESLint over every touched source and test — 0 errors.
6. `yarn build`.
7. Electron E2E not run. Owner owns live acceptance: open a PDF and an HTML file, switch between
   selections, and confirm `userData/Partitions/` gains exactly one directory.
