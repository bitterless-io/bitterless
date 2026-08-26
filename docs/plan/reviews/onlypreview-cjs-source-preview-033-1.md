# onlypreview-cjs-source-preview-033 — Review 1

- Date: 2026-08-26
- Result: **PASS**
- Scope: independent review of task 033's `.cjs` Main classification, Monaco language/reading
  route, Project Search classification, packaged file association, focused tests, and documented
  boundary. Existing Draw.io and unrelated working-tree changes were preserved and excluded except
  for an interference audit.
- Method: task/feature/design/source inspection, focused Node tests, one direct Project Search
  content-read probe, Node typecheck, and whitespace check.
- E2E/live app: intentionally not run. The assigned review scope forbids Electron, Playwright/E2E,
  the real application, and packaged smoke; Ral owns runtime acceptance with a representative
  `.cjs` file.

## Code Review 报告

Review rules: `TS-1` and `TS-2`; no task-scoped Vue or backend implementation was changed, so
`FE-*` and `BE-*` have no applicable authored source.

### 文件清单

| # | 文件 | 问题数 |
|---|---|---:|
| 1 | `src/main/onlypreview/onlyPreviewClassifier.service.ts` | 0 |
| 2 | `src/preload/onlypreview/search/core/classification.mjs` | 0 |
| 3 | `electron-builder.tmp.yml` | 0 |
| 4 | `tests/onlypreview/onlyPreviewPreviewGuards.test.mjs` | 0 |
| 5 | `tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs` | 0 |
| 6 | `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs` | 0 |
| 7 | `src/main/onlypreview/onlyPreviewDocument.registry.ts` (audit only) | 0 |
| 8 | `src/main/onlypreview/views/onlyPreviewPreviewAdapter.service.ts` (audit only) | 0 |
| 9 | `src/shared/onlypreview/onlyPreviewFind.registry.ts` (audit only) | 0 |
| 10 | `docs/features/onlypreview.md` | 0 |
| 11 | `docs/design/onlypreview-format-coverage.md` | 0 |
| 12 | `docs/plan/tasks/onlypreview-cjs-source-preview-033.md` | 0 |

### 问题清单

None. No P1, P2, or P3 findings. Every reviewed authored TS/JS file is below 800 lines, and the
task-scoped implementation adds no replaceable `function` declaration or expression.

## Task-contract audit

| Requirement | Evidence | Result |
|---|---|---|
| Main classifies `.cjs` as text, case-insensitively | `onlyPreviewClassifier.service.ts:22-73` adds `.cjs` to the explicit text catalog. `extensionOf()` lowercases the basename before `extname()`, and the focused assertions cover `module.CJS`. | pass |
| Monaco uses JavaScript syntax | `onlyPreviewClassifier.service.ts:149-190` maps `.cjs` to `javascript`. The real descriptor/read test at `onlyPreviewWorkspaceCore.test.mjs:508-550` proves `kind: text`, `language: javascript`, and exact bounded text output. | pass |
| Read-only Preview and current-file Find match `.js` | Every non-Markdown/non-HTML text descriptor selects `monaco` in `onlyPreviewPreviewAdapter.service.ts`; the unchanged adapter registry assigns Monaco's `content-adapter` Find. The existing Monaco component remains `readOnly`/`domReadOnly` and owns the current model-backed Find adapter. No `.cjs` path executes or imports the selected file. | pass |
| Preview size/decode boundary is unchanged | `.cjs` reaches the unchanged Monaco `readText()` branch: verified metadata is rejected above 8 MiB, the handle is read to at most limit + 1, and UTF-8/BOM UTF-16 decoding remains tolerant. Unknown extensions remain unsupported and renamed binary content remains inert decoded text. | pass |
| Project Search eligibility matches `.js` | `classification.mjs:8-59` adds `.cjs` to the same text catalog used by `readClassifiedSearchContent()`. The shared path retains the 1 MiB cap, sensitive-file exclusion, opened-file identity recheck, tolerant decoding, and metadata-only fallback. Focused parity assertions cover uppercase `.CJS`; an independent direct content-read probe also returned `contentIndexed: true` with the exact CommonJS source. | pass |
| Packaged file association includes `cjs` | `electron-builder.tmp.yml:64-139` includes `cjs` in the explicit Viewer association. The existing YAML-backed parity audit reads the Main text catalog and compares it with the association set; it passes with `.cjs` present on both sides. | pass |
| Existing HTML resource MIME remains intact | `onlyPreviewDocument.registry.ts:52` still maps `.cjs` to `text/javascript; charset=utf-8`. That pre-existing HTML subresource mapping is a separate containment concern and did not previously make `.cjs` a Main Preview/Search candidate; task 033 correctly adds the missing classifier catalogs without changing document behavior. | pass |
| Draw.io and other formats are not regressed | The task-scoped additions are confined to the text catalogs/language map, one association entry, tests, and docs. Existing Draw.io classification/limits/tests and every other adapter entry remain present. The focused suite exercises the mixed current worktree and passes. | pass |

## Verification

| Command / audit | Result |
|---|---|
| `node --test tests/onlypreview/onlyPreviewPreviewGuards.test.mjs tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs` | **PASS, 25/25** |
| Direct `readClassifiedSearchContent()` uppercase `.CJS` probe | **PASS**, exact source indexed as text |
| `yarn typecheck:node` | **PASS** |
| Authored TS/JS line-count and `function` audit | **PASS** |
| `git diff --check` | **PASS** |
| `yarn build` | Not repeated by this independent reviewer; developer/root build evidence remains the delivery gate |
| Electron / Playwright / E2E / real app / packaged smoke | Not run, as required |

## Conclusion

**PASS — no P1/P2/P3 findings.**

`.cjs` now follows the same inert source path as `.js`: case-insensitive text classification,
JavaScript Monaco language, complete bounded read-only preview, model-backed current-file Find,
bounded Project Search content indexing, and explicit packaged file association. The change does
not loosen unknown-extension, size, decoding, execution, HTML containment, or non-text adapter
boundaries.
