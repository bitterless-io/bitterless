# Independent Review Round 2 — onlypreview-media-truthful-state-022

Status: **PASS**

Date: 2026-08-21  
Scope: Review round 1's renderer-error authorization finding, its round-2 implementation/tests,
and fresh non-E2E Task 022 gates. Task status was not advanced. Electron/Playwright E2E, the real
app, packaged smoke, and ordinary `yarn build` were intentionally not run.

## Summary

Review round 1's sole P2 is closed. Main now authorizes renderer terminal errors through an
exhaustive adapter discriminator: image accepts only the image family, audio/video only the media
family, Chrome adapters accept none, and unsupported fallback accepts only the exact effective
Main-authored descriptor error. Invalid reports are rejected before any status, error, broadcast,
watchdog, or asset-revocation mutation.

The new negative Region coverage exercises image/audio/video and unsupported presentations from
both `loading` and `ready`, while retaining positive empty, signature, oversize, and mapped codec
coverage. Fresh focused and full OnlyPreview Node suites pass. No P0, P1, or P2 finding remains.

## Findings

### P0

None.

### P1

None.

### P2

None.

### Non-blocking findings

None.

## Round-1 finding closure

| Requirement                                        | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Image accepts only image errors                    | PASS   | `IMAGE_RENDER_ERRORS` contains only `IMAGE_EMPTY`, `IMAGE_READ_FAILED`, and `IMAGE_DECODE_FAILED`; the exhaustive `image` branch has no fallback (`src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts:98-102,173-174`).                                                                                                                                                                                                                                           |
| Audio/video accept only media errors               | PASS   | `MEDIA_RENDER_ERRORS` contains only the six `MEDIA_*` codes and is the sole result for both media adapters (`onlyPreviewPreviewRegion.service.ts:103-110,175-177`).                                                                                                                                                                                                                                                                                                           |
| Chrome cannot submit a Vue renderer error          | PASS   | Both Chrome adapters return `false`, while `requireCurrentVueRevision()` independently rejects any observation unless the active surface is Vue (`onlyPreviewPreviewRegion.service.ts:180-182,1047-1064`). A fresh in-memory Region probe presented HTML, submitted a current-revision Vue error, and passed 1/1 while proving snapshot, broadcast count, and revocation count unchanged.                                                                                     |
| Unsupported fallback is exact Main truth           | PASS   | One helper derives the effective descriptor code and maps only `UNSUPPORTED_CODEC` to `OPERATION_FAILED`; both initial payload creation and authorization use it, and authorization is strict equality (`onlyPreviewPreviewRegion.service.ts:152-158,178-199`).                                                                                                                                                                                                               |
| Invalid loading/ready reports are side-effect free | PASS   | Authorization runs immediately after current-revision validation and before the status gate, watchdog cleanup, capability revoke, presentation mutation, or publication (`onlyPreviewPreviewRegion.service.ts:556-605`). New tests reject cross-family, document, sheet, and generic codes for image/audio/video in both states, asserting unchanged private snapshot, broadcasts, and selection revocations (`tests/onlypreview/onlyPreviewPreviewRegion.test.mjs:636-682`). |
| Exact classifier-terminal errors remain usable     | PASS   | The unsupported regression accepts exact `IMAGE_EMPTY`, `SIGNATURE_MISMATCH`, `TEXT_TOO_LARGE`, and effective `OPERATION_FAILED` for `UNSUPPORTED_CODEC`, from both loading and ready, while rejecting alternatives (`onlyPreviewPreviewRegion.test.mjs:684-736`).                                                                                                                                                                                                            |

## Code-review rule audit

The round-2 delta introduces no TS-1, TS-2, FE-1, or FE-2 regression. Its implementation helpers
remain arrow functions, and it adds no Vue emit or component business flow. Every Task-022-new
TS/JS file remains below 800 lines; the largest is
`tests/onlypreview/onlyPreviewMediaPreview.test.mjs` at 794 lines.

## Fresh verification

| Command / audit                                                                            | Result                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused Task-022/component plus rendering/core/protocol/Region/guard tests                 | PASS — 110/110                                                                                                                                                                                                       |
| Adversarial Chrome-surface Region probe, without Electron                                  | PASS — 1/1                                                                                                                                                                                                           |
| `node --test tests/onlypreview/*.test.mjs`                                                 | PASS — 299/299                                                                                                                                                                                                       |
| `yarn typecheck:node`                                                                      | PASS                                                                                                                                                                                                                 |
| `yarn typecheck:web`                                                                       | Expected repository baseline failure — 76 diagnostics outside OnlyPreview; 0 OnlyPreview diagnostics                                                                                                                 |
| `yarn check:renderer-i18n`                                                                 | PASS                                                                                                                                                                                                                 |
| Scoped ESLint over exact Task-022 TS/Vue/tests                                             | PASS — 0 errors/warnings                                                                                                                                                                                             |
| Scoped Prettier check over exact Task-022 source/tests/docs                                | PASS                                                                                                                                                                                                                 |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` | PASS                                                                                                                                                                                                                 |
| Safe-build source/chunk audit                                                              | PASS — 1,667-byte Preview bootstrap loads the 392,262-byte App chunk plus emitted image/media CSS; no codec, transcoder, waveform, or player-engine marker; DOCX stays dynamic and both Office workers stay separate |
| Task Path/status/package/new-file/Vue-emit audit                                           | PASS — all 28 paths exist; status remains `implemented; independent review pending`; no Task-022 media engine dependency; no new line-limit or emit regression                                                       |
| `git diff --check`                                                                         | PASS                                                                                                                                                                                                                 |
| Electron/Playwright E2E, real app, packaged smoke, ordinary `yarn build`                   | NOT RUN — explicitly prohibited; Ral retains final runtime/visual verification                                                                                                                                       |

## Conclusion

**PASS.** Review round 1's only blocking defect is fixed without reopening any other Task 022
contract boundary. The task remains at `implemented; independent review pending` because this
reviewer was instructed not to change task or ledger status.
