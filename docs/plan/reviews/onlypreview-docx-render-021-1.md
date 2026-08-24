# Independent Review — onlypreview-docx-render-021

Status: **PASS**

Date: 2026-08-20  
Scope: Task 021 DOCX renderer implementation, its current docs truth, package/lock changes, focused
tests, full OnlyPreview Node suite, type checks, i18n, lint/format, safe source build, and emitted
chunk graph. Electron/Playwright E2E, the real app, and packaged smoke were intentionally not run.

## Summary

No P0, P1, or blocking P2 finding was found. The implementation matches the task's `.docx`-only
admission, bounded one-shot OOXML preflight, exact `docx-preview@0.4.0` API/options, detached strict
sanitization, blob lifecycle, Main watchdog/rebuild, revision/runtime fences, readiness, selected-text,
error, chunk-splitting, package, i18n, and docs-ledger contracts.

The workspace code-review rules do apply to this review. They produce three P2 maintainability
findings below, but they are **non-blocking** under the docs-sprint definition: none contradicts the
product/design contract and none leaves a stub, mock, or fake integration path
(`overmind/.agents/skills/docs-sprint/references/delivery-plan.md:91-101`). In particular, the 830-line
sanitizer is not being silently grandfathered; it is an explicit TS-1 issue with evidence and a bounded
split recommendation.

## Findings

### P0

None.

### P1

None.

### P2

#### 1. [P2][non-blocking][TS-1] The new sanitizer exceeds the workspace 800-line limit

- **Rule:** `overmind/.agents/skills/code-review/SKILL.md:21-26` applies TS-1 to every workspace
  TS/JS file and defines a file over 800 lines as a problem.
- **Code:** `src/renderer/onlypreview/preview/src/onlyPreviewDocumentSanitizer.service.ts:1-830` is
  830 lines (`HEAD` has no copy of this file).
- **Assessment:** The extra 30 lines do not weaken the sanitizer or conflict with Task 021. The
  detached clone, DOM allowlist, CSS parser/allowlist, verified-blob enforcement, and fail-closed
  behavior are complete and covered by real/adversarial tests. This is therefore maintainability
  debt, not a docs-sprint delivery blocker.
- **Recommendation:** Move the CSS parsing/property/font policy into a sibling
  `onlyPreviewDocumentCssSanitizer.service.ts`, leaving DOM/resource cloning and the public result
  assembly in the current service. Preserve the single fail-closed public entry point and update the
  task Path if this cleanup is taken.

#### 2. [P2][non-blocking][TS-1] The new DOCX integration test file also exceeds 800 lines

- **Rule:** the same TS-1 scope includes JavaScript tests.
- **Code:** `tests/onlypreview/onlyPreviewDocumentPreview.test.mjs:1-881` is 881 lines (`HEAD` has no
  copy of this file).
- **Assessment:** The file is executable evidence rather than a missing contract. Its 11 tests pass
  against the real `docx-preview@0.4.0`, the built Worker, generated DOCX fixture, lifecycle failures,
  and mounted SFC. It does not block delivery, but it remains an explicit workspace-rule violation.
- **Recommendation:** Split Worker/session lifecycle tests from real-engine/SFC compatibility tests
  without reducing the current assertions.

#### 3. [P2][non-blocking][FE-2] DocumentPreview sends a business error parameter to its parent

- **Rule:** `overmind/.agents/skills/code-review/SKILL.md:28-35` marks parameterized emits from a
  non-generic Vue business component as FE-2.
- **Code:** `src/renderer/onlypreview/preview/src/components/DocumentPreview/DocumentPreview.vue:27-30,46-47,56-60`
  emits `DOCUMENT_SANITIZE_FAILED`; `src/renderer/onlypreview/preview/src/components/PreviewSurface/PreviewSurface.vue:57-63`
  forwards it into the Store.
- **Assessment:** This is not a product-contract or runtime defect—the error is typed, current-revision
  fenced, and covered by the mounted-component test—but `DocumentPreview` is an OnlyPreview business
  component rather than a reusable generic control.
- **Recommendation:** Call the Store's `reportSurfaceError` directly with the component's reporting
  revision and `DOCUMENT_SANITIZE_FAILED` on the two mount failures. The component already owns both
  inputs and imports the Store. The zero-argument `ready` event is outside FE-2.

## Contract audit

| Requirement                                                                    | Result | Evidence                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.docx` only; `.doc` unsupported; exact 25 MiB gate/capability                 | PASS   | Extension set and descriptor limit are exact (`onlyPreviewClassifier.service.ts:118-119,306-317,349-374`); Main issues the revision asset at `onlyPreviewPreviewRegion.service.ts:238-245`; shared cap is `onlyPreview.types.ts:9-10`.                                                                                                                                                |
| Required DOCX parts and OOXML hard gates before engine import                  | PASS   | Shared preflight constants are exact (`onlyPreviewOoxmlPreflight.service.ts:1-6`), required parts include `[Content_Types].xml`, `_rels/.rels`, and `word/document.xml` (`:109-111`), and the one-shot Worker calls DOCX preflight (`onlyPreviewDocumentPreflight.worker.ts:46-52`). Focused OOXML tests passed.                                                                      |
| One-shot transfer, outer 10 s timeout, terminate/dispose settlement            | PASS   | Session transfers the exact buffer and terminates on every settlement (`onlyPreviewDocument.service.ts:290-382`); dispose immediately settles a pending preflight (`:235-244,316-326`).                                                                                                                                                                                               |
| Exact stable `docx-preview@0.4.0` API/options after preflight                  | PASS   | Dynamic loader is first reached after preflight (`onlyPreviewDocument.service.ts:158-170`); `renderAsync` uses every required stable option exactly (`:170-181`). `yarn why` resolves exactly 0.4.0.                                                                                                                                                                                  |
| Detached real render, strict DOM/CSS/URL sanitizer, no partial live mount      | PASS   | Renderer targets detached elements (`onlyPreviewDocument.service.ts:162-181`), verifies all detached blob references before sanitization (`:188-220`), and returns only the cloned fragment. Sanitizer allowlists/fails closed (`onlyPreviewDocumentSanitizer.service.ts:33-242,281-443,595-698,728-830`). The real rich fixture and eight adversarial sanitizer tests passed.        |
| Blob lifecycle on success, discard, stale completion, error, and teardown      | PASS   | Ownership/revocation paths are explicit (`onlyPreviewDocument.service.ts:183-232,235-244,400-419`); engine/sanitize/stale tests passed. Main destroys the view for parse/sanitize/timeout failures, covering renderer-owned URLs that cannot be enumerated after an engine failure.                                                                                                   |
| Never-settling render transition and Main 30 s watchdog/rebuild                | PASS   | Leaving a loading DOCX closes the exact old Vue view and rotates runtime (`onlyPreviewPreviewRegion.service.ts:523-541`); watchdog identity includes runtime/view/token/revision and is never renewed for the same identity (`:630-687`). Region tests cover first-bounds creation, non-renewal, stale timer fencing, transition destruction, and rebuild.                            |
| Connected-DOM + `nextTick` readiness and selected text; no Task-021 find claim | PASS   | Component mounts, awaits `nextTick`, verifies `isConnected`, then arms selection/reporting and emits ready (`DocumentPreview.vue:43-65`). Main retains selected text for `docx-dom` (`onlyPreviewPreviewRegion.service.ts:89-90,289-303`). Docs/task correctly leave find ownership to pending 019.                                                                                   |
| Typed errors and exact host/revision/runtime fencing                           | PASS   | Shared error unions/parser and symmetric copy include all DOCX/OOXML states. Store and Main fence the current presentation/session/runtime; parse/sanitize/timeout rebuild, while empty and pre-engine package failures retain truthful unavailable state.                                                                                                                            |
| Engine absent from initial Preview graph                                       | PASS   | Safe build emitted `onlypreview/preview-CpN23Oj7.js` (1,667 B), `App-CSDotBFk.js` (364,507 B), separate `docx-preview-DDDvCLSK.js` (281,311 B), and separate document-preflight Worker (23,897 B). The HTML/bootstrap preload graph contains no DOCX engine chunk; the App chunk contains only the dynamic import, and only the DOCX chunk contains the `renderAsync` implementation. |
| Package/lock, i18n, docs/status/Path accounting                                | PASS   | `docx-preview` is exactly `0.4.0`, Electron remains exactly `40.10.6`, and the lock change adds that package plus its existing JSZip selector. Renderer i18n is symmetric. Every Task Path exists, and all task/plan/design/feature/analysis ledgers remain `implemented; independent review pending`; this review does not advance status.                                           |

## Fresh verification

| Command / audit                                                                                                             | Result                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `node --test tests/onlypreview/onlyPreviewDocumentPreview.test.mjs tests/onlypreview/onlyPreviewDocumentSanitizer.test.mjs` | PASS — 19/19 (11 engine/Worker/SFC + 8 sanitizer)                                                                                       |
| `node --test tests/onlypreview/onlyPreviewPreviewRegion.test.mjs`                                                           | PASS — 25/25                                                                                                                            |
| Focused DOCX/OOXML/Region/rendering/core/protocol command                                                                   | PASS — 121/121                                                                                                                          |
| `node --test tests/onlypreview/*.test.mjs`                                                                                  | PASS — 278/278                                                                                                                          |
| `yarn typecheck:node`                                                                                                       | PASS                                                                                                                                    |
| `yarn typecheck:web`                                                                                                        | Expected repository baseline failure — 76 diagnostics outside OnlyPreview; 0 diagnostics under `src/{main,renderer,shared}/onlypreview` |
| `yarn check:renderer-i18n`                                                                                                  | PASS                                                                                                                                    |
| Focused ESLint over Task-021 TS/Vue/tests                                                                                   | PASS — 0 errors/warnings                                                                                                                |
| Focused `yarn prettier --check` over Task-021 implementation/tests/task                                                     | PASS                                                                                                                                    |
| `node scripts/environment/runWithRuntimeProfile.cjs debug_dev -- yarn electron-vite build`                                  | PASS                                                                                                                                    |
| Emitted Preview/DOCX/Worker chunk audit                                                                                     | PASS — separate dynamic engine and Worker; no initial HTML/bootstrap engine preload                                                     |
| `yarn why docx-preview` plus package/lock audit                                                                             | PASS — exact 0.4.0; Electron 40.10.6 preserved                                                                                          |
| Task Path existence and cross-ledger status audit                                                                           | PASS                                                                                                                                    |
| `git diff --check`                                                                                                          | PASS                                                                                                                                    |
| Electron/Playwright E2E, real app, packaged smoke                                                                           | NOT RUN — explicitly prohibited for this review; Ral owns final runtime/visual verification                                             |

## Conclusion

**PASS.** Task 021 has no blocking finding. The three P2 items above are explicit non-blocking
workspace code-quality debt; they do not change the verified DOCX delivery truth. Task status was not
advanced by this reviewer.
