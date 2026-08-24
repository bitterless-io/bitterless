# Independent Review — onlypreview-media-truthful-state-022

Status: **BLOCKED**

Date: 2026-08-20  
Scope: Task 022 implementation, tests, current task/design/feature/analysis/plan truth, adjacent
020/021/023/024 contracts, asset protocol, package/lock state, and emitted Preview chunks.
Electron/Playwright E2E, the real app, packaged smoke, and ordinary `yarn build` were intentionally
not run.

## Summary

The image viewer, native media lifecycle, bounded capability handling, typed image/media failures,
and docs accounting are substantially implemented and their focused/full Node gates pass. One P2
contract finding blocks approval: Main does not actually enforce an exact renderer-error allowlist
for the current adapter. A current image/audio/video renderer can submit an unrelated DOCX, XLSX,
text, protocol, or generic error code; Main accepts it from `loading` or `ready` and publishes that
code as authoritative terminal truth.

This contradicts Task 022's typed truthful-state requirement and the Main-authoritative Region
boundary. Passing happy-path mappings do not close this negative boundary. Task status was not
advanced.

## Findings

### P0

None.

### P1

None.

### P2

#### 1. [P2][blocking] Main accepts renderer error codes that do not belong to the active adapter

- **Contract:** Task 022 requires distinct truthful image/media terminal states and permits an exact
  current image/media runtime error to demote `loading` or `ready`
  (`docs/plan/tasks/onlypreview-media-truthful-state-022.md:81-115`). The format design likewise
  freezes image/media error categories and the one-way Main transition
  (`docs/design/onlypreview-format-coverage.md:236-261,263-281`). Task 024 makes Main the authority
  that accepts ready/error only for the exact current Region revision
  (`docs/plan/tasks/onlypreview-dual-preview-region-024.md:164-181`).
- **Code:** `presentationAllowsRendererError()` checks whether an incoming image code belongs to an
  image descriptor and whether an incoming media code belongs to an audio/video descriptor, then
  returns unconditional `true` for every other `OnlyPreviewErrorCode`
  (`src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:98-128`). Consequently,
  `reportVueError()` accepts, for example, `DOCUMENT_PARSE_FAILED`, `SHEET_PARSE_FAILED`,
  `SIGNATURE_MISMATCH`, or `OPERATION_FAILED` from a current image/audio/video adapter, then revokes
  its asset and publishes the unrelated code as `unavailable`
  (`src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:497-545`). The shared union shows
  these unrelated families are valid transport values, so parsing the XPC envelope does not make
  them valid for the active adapter (`src/shared/onlypreview/onlyPreview.types.ts:53-77`).
- **Impact:** Main can record false failure truth even though host, selection revision, and runtime
  token are current. The renderer is supposed to report an observation, not choose an arbitrary
  authoritative error family. This is also reachable from an unexpected component/session failure
  because the Store maps an untyped exception to `OPERATION_FAILED` before reporting it
  (`src/renderer/onlypreview/preview/src/onlyPreviewPreview.store.ts:38-46,482-489`).
- **Test gap:** Region coverage proves the three intended image/media mappings, ready-to-error
  demotion, asset deletion, and late-ready rejection, but never submits an error from a different
  adapter family (`tests/onlypreview/onlyPreviewPreviewRegion.test.mjs:679-714`).
- **Minimum fix:** make adapter validation the outer discriminator. Image must accept only the image
  set; audio/video only the media set. Preserve classifier-terminal relay for `unsupported` only when
  the submitted code exactly equals the presentation's already-authoritative error. Keep the
  existing XLSX/DOCX/text behavior through explicit adapter sets rather than a default-allow branch.
  Add negative Region tests for wrong-family reports in both `loading` and `ready`; assert rejection,
  unchanged status/error, and no capability revocation. Retain a positive test for classifier-terminal
  empty/signature errors.

### Non-blocking findings

None.

## Contract audit

| Requirement                                                          | Result      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact supported and recognized-unsupported catalogs                  | PASS        | Classifier sets are exact for image/audio/video and HEIC/HEIF/TIF/TIFF/RAW plus MKV/AVI/WMV/FLV (`onlyPreviewClassifier.service.ts:105-119,405-413`); focused catalog tests pass and unsupported cases issue no asset/player.                                                                                                                                                                                                                                                                        |
| Empty, size, and signature admission                                 | PASS        | Image 100 MiB is centralized; empty image/media terminate before signature reads; SVG XML/comment/DOCTYPE, AAC ADTS/ADIF/`ftyp`, and plausible MOV first atoms are bounded and covered (`onlyPreviewClassifier.service.ts:223-324,370,415-447`).                                                                                                                                                                                                                                                     |
| Image GET, exact Blob, off-DOM decode, live readiness, typed cleanup | PASS        | The session requires exact 200/length/body, creates one typed Blob URL, decodes off-DOM, and revokes through one owned slot (`onlyPreviewImage.service.ts:32-145`). The component waits for `nextTick`, connected exact live image/revision/URL, removes failed images, and fences stale load/error (`ImagePreview.vue:222-284`). Focused service/SFC tests pass.                                                                                                                                    |
| Huge-image fit, zoom/reset, clamps, resize, input, and accessibility | PASS        | Pure viewport math implements no-upscale fit, effective `min(0.1, fit)`, 8x/1.25, exact 100% reset, centered per-axis clamps, fit/manual resize behavior, and one-axis clamping (`onlyPreviewImageViewport.service.ts:45-163`). The focusable viewport, localized/disabled buttons, primary pointer capture/cancel/lost-capture, control bubbling guard, and arrow keys are explicit (`ImagePreview.vue:1-84,138-220`). Styles remain inside the content surface rather than the 43px Shell toolbar. |
| Media HEAD/CORS/Range/native player and error mapping                | PASS        | HEAD requires exact 200, `Content-Length`, and exposed `Accept-Ranges: bytes`; codes 1-4 map to aborted/network/decode/source unsupported and missing errors map to read failure (`onlyPreviewMedia.service.ts:8-78`). Asset responses expose `Accept-Ranges`, support HEAD/full/single Range, and stay bounded (`onlyPreviewAsset.registry.ts:17-20,91-213`).                                                                                                                                       |
| Media readiness, timeout, demotion, stale fences, and teardown       | PASS        | Native audio/video use controls and metadata preload. Activation is post-`nextTick`; metadata/error/30-second timeout are generation/revision/source fenced. Teardown removes listeners, pauses, removes `src`, calls `load()`, and late events cannot revive a failed/unmounted selection (`MediaPreview.vue:68-178`). Focused rapid-switch, ready-error, timeout, and unmount tests pass.                                                                                                          |
| Selection-lifetime media authority and protocol identity             | PASS        | Only `ttl` assets expire; media is issued as `selection`, while registry capacity, host/workspace/selection revoke, exact URL/name/file identity, bounded stream, and post-stream identity checks remain enforced (`onlyPreviewAsset.registry.ts:22-47,226-394,396-437`; Region `:282-300`). The TTL-survival test passes.                                                                                                                                                                           |
| Main one-shot image vs retained media URL and one-way state          | **BLOCKED** | Image is one-shot while audio/video retain their exact asset through ready; any image/media terminal error strips/revokes the asset and late ready cannot revive it (`onlyPreviewPreviewRegion.service.ts:89-96,480-545`). Status/revision/runtime gates pass, but the adapter/error-code gate is not exact as finding 1 details.                                                                                                                                                                    |
| No premature find/selected-text claim                                | PASS        | All image/audio/video states keep `selectedTextAvailable: false`; no Task-022 `find`, fake `0/0`, or character metadata was added. Docs consistently leave `find: none` derivation and common feedback to pending Task 019.                                                                                                                                                                                                                                                                          |
| Error UI, i18n, and Shell isolation                                  | PASS        | En/zh labels and nine image/media error messages are symmetric (`onlyPreviewI18n.ts:62-72,148-156,219-227,300-308`). Failure renders one compact alert with no broken player/image and no duplicate FileActions; metadata/actions remain in the Shell toolbar.                                                                                                                                                                                                                                       |
| Code-review rules                                                    | PASS        | Every Task-022-new TS/JS file is below 800 lines (largest: `onlyPreviewMediaPreview.test.mjs`, 794). New ImagePreview/MediaPreview use no parameterized emit and keep session/business authority in services/Store; their DOM lifecycle and viewport interaction remain component-local. No applicable TS-2 issue was found.                                                                                                                                                                         |
| Path, status, package, and chunk truth                               | PASS        | All 28 Task Path entries exist. Task/plan/design/feature/analysis consistently remain `implemented; independent review pending`. Task 022 adds no codec/transcoder/player dependency; package/lock changes are the exact Task-021 `docx-preview@0.4.0` addition. Safe build emits a 1,667-byte Preview bootstrap and 392,262-byte App chunk containing image/native-media code, with no media engine reference; ExcelJS Worker and dynamic DOCX engine remain separate.                              |

## Fresh verification

| Command / audit                                                                            | Result                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused Task-022/component plus core/protocol/Region/guard/rendering tests                 | PASS — 108/108                                                                                                                                     |
| `node --test tests/onlypreview/*.test.mjs`                                                 | PASS — 297/297                                                                                                                                     |
| `yarn typecheck:node`                                                                      | PASS                                                                                                                                               |
| `yarn typecheck:web`                                                                       | Expected repository baseline failure — 76 diagnostics outside OnlyPreview; 0 OnlyPreview diagnostics                                               |
| `yarn check:renderer-i18n`                                                                 | PASS                                                                                                                                               |
| Scoped ESLint over exact Task-022 TS/Vue/tests                                             | PASS — 0 errors/warnings                                                                                                                           |
| Scoped `yarn prettier --check` over Task-022 implementation/tests/docs                     | PASS                                                                                                                                               |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` | PASS                                                                                                                                               |
| Emitted Preview/source/chunk audit                                                         | PASS — image/media remain in the Vue App chunk; no codec, transcoder, waveform, or player-engine dependency; existing Office engines stay isolated |
| Task Path, status ledger, package/lock, new-file line count, Vue emit, and i18n audits     | PASS                                                                                                                                               |
| `git diff --check`                                                                         | PASS                                                                                                                                               |
| Electron/Playwright E2E, real app, packaged smoke, ordinary `yarn build`                   | NOT RUN — explicitly prohibited; Ral owns final runtime/visual verification after a passing review                                                 |

## Conclusion

**BLOCKED.** The renderer-error adapter allowlist must fail closed, with negative Region regression
coverage, before Task 022 can pass independent review. All other audited Task 022 boundaries and
fresh non-E2E gates pass. Task status was not advanced by this reviewer.
