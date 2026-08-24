# OnlyPreview PDF preview paints a blank page while HTML renders

Status: implemented; owner verification pending

Implementation: [onlypreview-chrome-session-persistence-027](../plan/tasks/onlypreview-chrome-session-persistence-027.md)
(the render fix) and [onlypreview-pdf-network-delivery-028](../plan/tasks/onlypreview-pdf-network-delivery-028.md)
(the owner's no-Main-IO requirement). The owner-recorded fallback — rendering PDFs with a JS engine in
the Vue surface — was not needed: the probe proved the native viewer renders once the session is
persistent.

## Report

Selecting a PDF in the standalone OnlyPreview window shows the Preview toolbar, the file name, the
`PDF` chip and the `PDF · 229 KB` status, and a pure white content area — no page, no Chromium PDF
toolbar, no error. `.html` files in the same raw Chromium content view render normally.

The reported file (`%PDF-1.7`, 234,887 bytes, unencrypted, three pages) is not the cause; the same
file renders correctly in the probe below whenever the session is persistent.

## Root Cause

The raw Chromium content view is created with an **in-memory** session partition
(`src/main/onlypreview/views/onlyPreviewPreviewView.service.ts:451`):

```ts
partition: `onlypreview-chrome-${runtime.host.hostId}-${revision}-${randomUUID()}`
```

No `persist:` prefix means an off-the-record session. Chromium does not render PDFs in the page
renderer; it hands the response to the PDF viewer component extension, which then creates a separate
content frame for the document. In an in-memory Electron session the extension shell loads but that
document frame is never created, so the viewer has nothing to paint.

Frame trees from the probe make the missing frame explicit:

| session | frames in the content view | painted |
| --- | --- | --- |
| persistent / default | PDF url → `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html` → **PDF url (document frame)** | yes |
| in-memory partition | PDF url → `chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html` | no |

HTML is unaffected because it needs no extension and no guest frame — it renders directly in the
view's own renderer, which is why the same code path works for `.html` and fails for `.pdf`.

Two secondary observations:

- The navigation *succeeds*. `did-finish-load` fires, so `handleChromeReady` publishes
  `status: 'ready'` for a blank viewer; nothing in the contract can currently tell a painted PDF from
  an empty one.
- `plugins: true`, `sandbox: true`, `webSecurity: true`, the permission handlers, the
  `http/https/ws/file` request block, the dead proxy and the download refusal are all innocent — see
  cases 5, 7 and 8 below.

## How the PDF bytes reach the view today

Every byte is read and streamed by the **main process**:

1. `OnlyPreviewPreviewRegionService.present()`
   (`src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:176`) resolves the selection.
2. `onlyPreviewWorkspaceRegistry.openFile()` resolves the real path, enforces workspace containment,
   and holds an open `FileHandle` plus its `dev`/`inode`/`size`/`mtimeNs` identity.
3. `onlyPreviewClassifierService.describe()` reads a head sample in main and requires the `%PDF-`
   signature (`onlyPreviewClassifier.service.ts:284`).
4. `onlyPreviewAssetRegistry.issue()` mints a one-shot URL
   `bitterless-preview://asset/<64-hex>/<basename>` bound to that identity
   (`onlyPreviewAsset.registry.ts:271`).
5. The raw `WebContentsView` is created with the in-memory partition (`:451`), a **session-scoped**
   protocol handler is installed for exactly that hostname + token
   (`onlyPreviewProtocol.service.ts:63`), and the view navigates to the token URL (`:420`).
6. On request, `createOnlyPreviewFileResponse` (`onlyPreviewAsset.registry.ts:91`) re-verifies the
   file identity, then `fileHandle.createReadStream()` → byte-counting `Transform` →
   `Readable.toWeb()` becomes the `Response` body (`:163-212`), with Range support, the 100 MB PDF
   ceiling, a post-stream re-`stat`, and revoke-on-selection-change destroying live streams.

So the current design deliberately routes the bytes through main-process JS to keep the token,
the identity re-verification and the byte ceiling. HTML takes the same shape through
`onlyPreviewDocument.registry.ts`, which is why the delivery path cannot be what separates the two.

## Evidence

Throwaway probe (`tmp/pdf-probe/`, not part of the app) driving the project's own Electron 40.10.6
binary with the app's exact `WebContentsView` webPreferences, protocol privileges, response headers,
session hardening and navigation fence. `pixels` = fraction of non-white pixels in `capturePage()`;
`frames` = frames in the content view's subtree.

| # | session | byte source | fence | frames | pixels |
| --- | --- | --- | --- | --- | --- |
| 1 | default | `file://` | none | 3 | 0.5152 |
| 2 | default | main `fs` stream over custom scheme | none | 3 | 0.5152 |
| 3 | in-memory | `file://` | none | 2 | **0** |
| 4 | in-memory | main `fs` stream | none | 2 | **0** |
| 5 | in-memory + full hardening | main `fs` stream | none | 2 | **0** |
| 6 | `persist:` | main `fs` stream | none | 3 | 0.5152 |
| 7 | default + full hardening | main `fs` stream | none | 3 | 0.5304 |
| 8 | `persist:` + full hardening | main `fs` stream | none | 3 | 0.5152 |
| 9 | case 8's partition reused after `closeAllConnections` + `clearStorageData` + `clearCache` | main `fs` stream | none | 3 | 0.5323 |
| 10 | `persist:` + hardening | main `fs` stream | app fence verbatim | 3 | 0.5343 |
| 11 | default + hardening | main `fs` stream | app fence verbatim | 3 | 0.5152 |
| 12 | in-memory + hardening | main `fs` stream | app fence verbatim | 2 | **0** |
| 13 | `persist:` + hardening | main `fs` stream | subframes allowed | 3 | 0.5152 |
| 14 | in-memory + hardening | main `fs` stream | subframes allowed | 2 | **0** |
| 15 | `persist:` + hardening | `file://` + one-file allowlist | subframes allowed | 3 | 0.5152 |
| 16 | `persist:` + hardening | `file://` + one-file allowlist | app fence verbatim | 3 | 0.5152 |
| 17 | `persist:` + hardening | `net.fetch('file://…')` piped into the token URL | app fence verbatim | 3 | 0.5152 |
| 18 | in-memory + hardening | `net.fetch('file://…')` piped into the token URL | none | 2 | **0** |

What the matrix rules out and rules in:

- **Delivery path is innocent.** `file://`, a main-process `fs` stream over the custom scheme, and
  `net.fetch` piped into the custom scheme all render in a persistent session (1, 6, 15, 17) and all
  stay blank in an in-memory one (3, 4, 18).
- **The navigation fence is innocent.** Cases 10-16 install `will-navigate` / `will-redirect` /
  `will-frame-navigate` exactly as `onlyPreviewPreviewView.service.ts:493-502` does. Not one
  navigation event fired for the PDF flow in any case — the viewer's extension and document frames
  are not created by frame navigations this fence can observe — and case 10 renders with the fence on.
- **Session hardening is innocent** (5 vs 8, 7, 11).
- **The session partition is the whole difference.** Every in-memory case is blank with 2 frames;
  every default or `persist:` case renders with 3.

## Fix Contract (proposed, not implemented)

1. Give the raw Chromium content view a **persistent** session partition.
2. Use a **stable** partition name, not a per-selection UUID: every distinct `persist:` name creates
   a `userData/Partitions/<name>` directory that nothing deletes (~1.9 MB each in the probe), so a
   fresh name per selection would leak disk for the lifetime of the installation.
3. Keep per-selection isolation with the mechanisms that already exist and do not depend on a fresh
   partition: the one-shot 64-hex asset/document token, the per-session protocol handler scoped to
   one hostname + token, `revokeSelection`, and the existing teardown
   (`closeAllConnections` + `clearStorageData` + `clearCache`). Probe case 9 proves a cleared, reused
   persistent partition still renders.
4. Keep every current security property of that view unchanged: sandbox, context isolation, no Node
   integration, web security, denied permissions, cancelled `http/https/ws/wss/ftp/file` requests,
   dead proxy, denied popups, fenced navigation/redirects, refused downloads.
5. Decide whether `chromium-pdf` readiness should require the document frame instead of trusting
   `did-finish-load`, so a blank viewer can never be published as `ready`.
6. Owner requirement 2026-08-21: the PDF should not reach the view through main-process IO. That is
   a separate change from the partition fix — the probe renders with all three delivery paths, so it
   can be decided independently:
   - **`net.fetch('file://<realPath>')` piped into the existing token response** (probe case 17):
     main JS stops touching the bytes, the `bitterless-preview://asset/<token>` URL, the session
     scoping and the absence of path disclosure all survive. Lost: the byte-counting `Transform`
     ceiling and mid-stream revocation, since the body is no longer a stream main owns —
     `revokeSelection` then only invalidates the token for later requests.
   - **Direct `file://` navigation plus a session `webRequest` allowlist admitting exactly the one
     resolved real path** (probe cases 15, 16): nothing at all passes through main after the initial
     resolve. Lost: the one-shot token, the streaming identity re-verification, the byte ceiling, and
     it puts the absolute filesystem path in the view's URL — which contradicts the renderer
     path-disclosure closure delivered in
     [`onlypreview-design-completion-025`](../plan/tasks/onlypreview-design-completion-025.md).
   Recommendation: `net.fetch`, because it is the only option that removes main-process byte IO
   without reopening path disclosure.

Open question for the owner: a stable persistent partition means the raw view's cache/storage lives
on disk between selections until it is cleared. If that is unacceptable, the alternative is dropping
Chromium's viewer for PDFs and rendering them in the Vue surface with a bundled engine — much larger
work, and it loses the native PDF toolbar, search, zoom and print.

## Acceptance

1. Select the reported PDF: the Chromium PDF viewer chrome and the first page are visible.
2. Select an `.html` file: unchanged behavior.
3. Switch selections repeatedly: each selection destroys its previous view and revokes its token; no
   stale document is reachable and `userData/Partitions/` does not grow per selection.
4. The raw view still cannot navigate away, open a popup, download, or reach the network.
5. Owner runtime verification on macOS; Electron E2E only if the owner asks for it.
