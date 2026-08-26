---
id: onlypreview-cjs-source-preview-033
scope: CommonJS source preview and search parity with JavaScript
status: implemented; owner verification pending
depends-on: [onlypreview-design-completion-025]
verify: node --test tests/onlypreview/onlyPreviewPreviewGuards.test.mjs tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs && yarn typecheck:node && yarn build && git diff --check
---

# Preview `.cjs` like `.js`

## Objective

Treat `.cjs` as an explicit JavaScript text source everywhere OnlyPreview classifies a file:
read-only Monaco preview, JavaScript syntax language, current-file find, Project Search content
indexing, and packaged operating-system file associations.

## Context

- `docs/features/onlypreview.md`
- `docs/design/onlypreview-format-coverage.md`
- `areas/agent-runtime/preview-roadmap/baseline.md`

## Path

- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/preload/onlypreview/search/core/classification.mjs`
- `electron-builder.tmp.yml`
- `tests/onlypreview/onlyPreviewPreviewGuards.test.mjs`
- `tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs`
- `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs` (existing association parity audit)
- `docs/features/onlypreview.md`
- `docs/design/onlypreview-format-coverage.md`
- `docs/plan/README.md`
- `areas/agent-runtime/preview-roadmap/baseline.md`

## Contract

- Add `.cjs` to the Main text-extension catalog and map it to Monaco language `javascript`.
- Add `.cjs` to the Project Search text-extension catalog so eligible CommonJS source is content
  indexed under the same 1MiB search cap and safety rules as `.js`.
- Add `cjs` to the explicit packaged file-association inventory. The existing package parity audit
  must continue proving that every supported preview extension is associated.
- `.cjs` uses the existing Monaco adapter, 8MiB preview limit, tolerant text decoding, selection,
  and current-file find behavior. It is displayed only and is never executed, compiled, or loaded
  as an Electron/Node module by the preview path.
- Preserve `.js` / `.mjs` behavior, unknown-extension rejection, size-first admission, search
  exclusions, HTML document-resource MIME support, and every non-text adapter.

## Verification

- Focused tests prove case-insensitive `.cjs` classification, `javascript` descriptor language,
  bounded text read, Project Search text classification, and OS association parity.
- Run `yarn typecheck:node`, debug `yarn build`, and `git diff --check`.
- Do not launch Electron, Playwright/E2E, the real application, or packaged smoke. Ral owns final
  runtime acceptance with a representative `.cjs` file.

## Delivery

- Added case-insensitive `.cjs` text classification to Main and Project Search, with Monaco
  language `javascript` and the same bounded read-only/search paths as `.js`.
- Added `cjs` to packaged Viewer file associations; the existing classifier/association parity
  audit remains exact.
- Preserved the existing `.cjs` HTML-resource MIME mapping, size-first admission, tolerant decode,
  non-execution boundary, and every non-text adapter including Draw.io.
- [Independent review 1](../reviews/onlypreview-cjs-source-preview-033-1.md): PASS, no P1/P2/P3
  findings.
- Verification: focused tests 25/25, direct uppercase `.CJS` Project Search content probe,
  `yarn typecheck:node`, debug `yarn build`, and `git diff --check` passed. Electron/E2E/real-app/
  packaged smoke were not run; Ral owns final runtime acceptance.
