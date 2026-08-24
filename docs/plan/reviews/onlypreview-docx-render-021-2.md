# Independent Review Round 2 — onlypreview-docx-render-021

Status: **PASS**

Date: 2026-08-20  
Scope: Task 021 after the bounded review-1 cleanup, including all three prior P2 findings, the
current implementation/tests/docs truth, package/lock changes, focused and full OnlyPreview tests,
type checks, i18n, scoped lint/format, safe source build, and emitted chunk graph.
Electron/Playwright E2E, the real app, packaged smoke, and ordinary `yarn build` were intentionally
not run.

## Summary

All three review-1 P2 findings are closed without weakening the Task 021 contract. The CSS policy is
now a coherent fail-closed sibling service, every Task-021-new TS/JS file is below 800 lines, the
split test suite retains all 11 DOCX engine/Worker/SFC cases and their assertion coverage, and
`DocumentPreview` no longer sends a parameterized business error event. No new P0, P1, or P2
finding was found.

The full contract re-audit remains clean: `.docx`-only admission and the exact 25 MiB capability,
pre-import OOXML gates, the one-shot 10-second Worker boundary, exact `docx-preview@0.4.0` options,
detached strict sanitization, blob ownership, never-settling-render recovery, Main watchdog and
identity fences, connected-DOM readiness, selected-text truth, error mapping, dynamic chunking,
i18n, package/lock, and docs accounting all remain intact. Task 019 still owns find behavior.

## Findings

### P0

None.

### P1

None.

### P2

None.

## Review-1 finding closure

| Review-1 finding                        | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS-1: 830-line sanitizer                | CLOSED | CSS parsing, selector/property/font policy, and URL validation now live in `onlyPreviewDocumentCssSanitizer.service.ts` (601 lines); the DOM/resource/public-result service is 266 lines. The CSS service receives the one typed `fail: () => never` callback (`onlyPreviewDocumentCssSanitizer.service.ts:216-226`), and the DOM service constructs it with `OnlyPreviewDocumentSanitizerError` (`onlyPreviewDocumentSanitizer.service.ts:6-12,79-84`). All parser, selector, declaration, function, and URL rejection paths remain fail-closed. The real rich fixture and eight adversarial sanitizer tests pass.                                              |
| TS-1: 881-line integration test         | CLOSED | Tests are split into Preview/real-engine (185 lines), session/Worker lifecycle (341), and shared helper (402). The two Preview plus nine session tests preserve exactly 11 test cases and 63 assertion calls, including preflight-before-import, timeout, dispose, error/blob, stale, never-settling render, real Worker, rich fixture, and mounted-SFC coverage. Every Task-021-new TS/JS file is below 800 lines.                                                                                                                                                                                                                                              |
| FE-2: parameterized business error emit | CLOSED | `DocumentPreview` declares only zero-argument `ready` (`DocumentPreview.vue:27-29`). Both mount failures call `onlyPreviewPreviewStore.reportSurfaceError(props.reportingRevision, 'DOCUMENT_SANITIZE_FAILED')` directly (`:42-46,55-60`); the post-mount branch removes style and children before reporting (`:56-58`). Ready occurs only after `nextTick`, active/current connected non-empty DOM, and selection reporting setup (`:52-64`). The mounted test proves no false ready, exact revision/error, zero partial children, and no retained style (`onlyPreviewDocumentPreview.test.mjs:99-109,155-180`). `PreviewSurface` has no DOCX error forwarding. |

## Regression contract audit

| Requirement                                                                      | Result | Evidence                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.docx` only, exact 25 MiB asset; legacy/other Office formats excluded           | PASS   | Classifier, shared cap, Main revision asset, core/protocol tests, and docs truth are unchanged from the passing review-1 audit.                                                                                                                                                                                                            |
| Required DOCX parts and all OOXML hard gates before dynamic import               | PASS   | The one-shot module Worker still calls the shared pure preflight; the preflight-before-import test passes, and the built Worker accepts the valid fixture while rejecting invalid required parts.                                                                                                                                          |
| Exact one-shot transfer, 10-second outer timeout, terminate/dispose settlement   | PASS   | Session tests preserve exact buffer transfer, exact `10_000` delay, termination, immediate stale settlement, and real built-Worker coverage.                                                                                                                                                                                               |
| Exact stable `docx-preview@0.4.0` options and detached real rendering            | PASS   | The real rich fixture passes and asserts the stable option object. `yarn why docx-preview` resolves exactly 0.4.0.                                                                                                                                                                                                                         |
| Strict DOM/CSS/URL sanitizer; no partial live mount                              | PASS   | The extracted CSS service is reached only through the typed fail-closed sanitizer. The real fixture and eight security tests pass; component failure cleanup is directly asserted.                                                                                                                                                         |
| Blob cleanup and stale/never-settling transition behavior                        | PASS   | Engine failure, sanitize failure, stale completion, success/dispose, and never-settling-render tests pass; the Main Region transition/watchdog tests remain green.                                                                                                                                                                         |
| Main 30-second watchdog, no renewal, stale fence, exact rebuild                  | PASS   | Focused Region suite passes 25/25, including first-bounds arm, non-renewal, stale-timer fencing, loading-DOCX view destruction/runtime rotation, and rebuild.                                                                                                                                                                              |
| Connected DOM + `nextTick` readiness and selected-text only; find stays with 019 | PASS   | `DocumentPreview.vue:52-64`, mounted test, Main selected-text route, task/design/feature/analysis truth. No Task-021 find capability was introduced.                                                                                                                                                                                       |
| Current host/revision/runtime fencing and typed error mapping                    | PASS   | Focused core/protocol/rendering/Region/session tests pass; no identity or error-union regression was introduced by the bounded cleanup.                                                                                                                                                                                                    |
| DOCX engine excluded from initial Preview graph                                  | PASS   | Safe build emits `onlypreview/preview-Dfc3x7wX.js` (1,667 B), `App-cnU8BGqk.js` (365,676 B), separate `docx-preview-DDDvCLSK.js` (281,311 B), and separate document-preflight Worker (23,897 B). AST audit finds the engine chunk in exactly one dynamic import from the App chunk; it is absent from Preview HTML and bootstrap preloads. |
| Package/lock, i18n, Path, and cross-ledger status accounting                     | PASS   | `docx-preview` remains exact 0.4.0, Electron remains 40.10.6, renderer i18n passes, all 31 Task Path entries exist, and task/plan/design/feature/analysis truth consistently remains `implemented; independent review pending`.                                                                                                            |

## Fresh verification

| Command / audit                                                                            | Result                                                                                                     |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Focused DOCX Preview/session/sanitizer tests                                               | PASS — 19/19                                                                                               |
| `node --test tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`                          | PASS — 25/25                                                                                               |
| Focused DOCX/OOXML/Region/rendering/core/protocol command                                  | PASS — 121/121                                                                                             |
| `node --test tests/onlypreview/*.test.mjs`                                                 | PASS — 278/278                                                                                             |
| `yarn typecheck:node`                                                                      | PASS                                                                                                       |
| `yarn typecheck:web`                                                                       | Expected repository baseline failure — 76 diagnostics outside OnlyPreview; 0 diagnostics under OnlyPreview |
| `yarn check:renderer-i18n`                                                                 | PASS                                                                                                       |
| Scoped ESLint over Task-021 TS/Vue/tests                                                   | PASS — 0 errors/warnings                                                                                   |
| Scoped `yarn prettier --check` over implementation/tests/docs                              | PASS                                                                                                       |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build` | PASS                                                                                                       |
| Emitted Preview/DOCX/Worker chunk audit                                                    | PASS — engine only in its dynamically imported chunk; no initial HTML/bootstrap preload                    |
| `yarn why docx-preview` plus package/lock audit                                            | PASS — exact 0.4.0; Electron 40.10.6 preserved                                                             |
| New-file line-count, 11-test/63-assertion, Task Path, and cross-ledger audits              | PASS                                                                                                       |
| `git diff --check`                                                                         | PASS                                                                                                       |
| Electron/Playwright E2E, real app, packaged smoke, ordinary `yarn build`                   | NOT RUN — explicitly prohibited; Ral owns final runtime/visual verification                                |

## Conclusion

**PASS.** Review-1's three P2 findings are genuinely closed, and no new P0, P1, P2, or docs-sprint
blocker was found. Task status was not advanced by this reviewer.
