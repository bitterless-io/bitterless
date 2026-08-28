---
id: onlypreview-global-search-file-content-preview-073-1
status: passed
reviewed_task: onlypreview-global-search-file-content-preview-073
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-contract-security-performance-and-ui-review
---

# onlypreview-global-search-file-content-preview-073 — Review 1

- Result: **PASS**
- Scope: Contents row evidence, shared Files/Contents bounded file-head Preview, retired context
  variant, Vue Preview visual reuse, Markdown/static-HTML sanitization, token/path/file-identity
  authority, latest-only fencing, and resource/device-stability risk.
- Unrelated dirty-worktree changes were preserved and excluded. This review changed only this
  review document.
- Electron, Playwright, E2E, packaged smoke, the real application, and live visual automation were
  not run, as required.

## Findings

No P1, P2, or P3 finding exists. No blocking finding exists.

The pre-existing `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs` file remains above the
800-line maintenance limit already recorded by review 048. Task 073 only replaces the old context
payload expectation in that shared suite and does not create the existing size debt, so it is not a
new task-073 finding.

## 文件清单

| #   | 文件                                                                                         | 问题数 |
| --- | -------------------------------------------------------------------------------------------- | ------ |
| 1   | `docs/plan/tasks/onlypreview-global-search-file-content-preview-073.md`                      | 0      |
| 2   | `docs/issues/onlypreview-global-search-context-preview-wrong.md`                             | 0      |
| 3   | `docs/design/onlypreview-global-search.md`                                                   | 0      |
| 4   | `docs/features/onlypreview.md`                                                               | 0      |
| 5   | `src/preload/onlypreview/search/core/global-search-preview.mjs`                              | 0      |
| 6   | `src/shared/onlypreview/onlyPreviewSearch.type.ts`                                           | 0      |
| 7   | `src/main/fileSearch/fileSearchGlobalResult.validator.ts`                                    | 0      |
| 8   | `src/renderer/onlypreview/shell/src/components/GlobalSearch/SearchResultRow.vue`             | 0      |
| 9   | `src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/GlobalSearchPreview.vue`  | 0      |
| 10  | `src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/GlobalSearchPreview.less` | 0      |
| 11  | `src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/RichSearchPreview.vue`    | 0      |
| 12  | `src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/PlainSearchPreview.vue`   | 0      |
| 13  | `tests/onlypreview/onlyPreviewGlobalSearchPreview.test.mjs`                                  | 0      |
| 14  | `tests/onlypreview/onlyPreviewGlobalSearchContract.test.mjs`                                 | 0      |
| 15  | `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`                                       | 0      |
| 16  | `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`                                    | 0      |

## Contract evidence

### Contents keeps row evidence while Preview reads the file head

- `SearchResultRow.vue:38-41,68-71` still renders the Contents-only grapheme-safe
  `contentMatch` split as before/highlight/after. The row therefore continues to explain why the
  file matched.
- `global-search-preview.mjs:224-243` no longer branches on `result.section === 'contents'`.
  Directory and non-text routing remains unchanged; every text authority now reaches the one
  `readTextPreview()` path regardless of whether its opaque token originated in Files or Contents.
- `global-search-preview.mjs:16,140-156` passes the exact 256KiB byte limit to the existing bounded
  descriptor-read helper, decodes only that buffer, derives the same `plain` / `markdown` /
  `html-static` adapter from the file name, and preserves truthful `truncated` state. Files larger
  than the existing 1MiB searchable-text admission limit and sensitive names still fall back to
  `info` without a body read.
- `onlyPreviewGlobalSearchPreview.test.mjs:73-81` proves Files and Contents tokens for the same
  Markdown file return deep-equal file-head payloads. Its 270KiB deep-match fixture at `:92-117`
  proves the row retains a match after the returned head while Preview begins with `# File head`,
  excludes the distant match, reports truncation, and remains at or below 256KiB.

### The retired context surface cannot return through the live contract

- `onlyPreviewSearch.type.ts:217-238` exposes only `text`, `directory`, and `info`; the public
  `context` union member is gone.
- `fileSearchGlobalResult.validator.ts:242-274` exact-key validates only those three variants, and
  `onlyPreviewGlobalSearchContract.test.mjs:147-157` rejects the old context wire shape.
- `GlobalSearchPreview.vue:35-49` lazily maps only plain, Markdown, static HTML, directory, and info.
  `ContextSearchPreview.vue` is deleted, its styles are gone, and a production/source search finds
  no remaining context component or context preview variant.

### Vue Preview visual language and inert rich rendering are preserved

- `RichSearchPreview.vue:14-30` calls the existing `renderOnlyPreviewMarkdown()` service for
  Markdown and the existing `sanitizeOnlyPreviewStaticHtml()` service for HTML. The Markdown
  service escapes raw HTML and runs DOMPurify with a zero-attribute allowlist; the HTML sanitizer
  likewise allows no attributes and forbids scripts, styles, forms, frames, embeds, images, audio,
  video, sources, and active-resource tags.
- `GlobalSearchPreview.less:1,51-53` imports the canonical Vue Preview
  `MarkdownPreview.less`, applies its `onlypreview-markdown__document` reading-column class, and
  keeps the rich canvas white. The renderer logic remains inside the lazy rich component, so
  `marked`/DOMPurify are not added to the eager adapter map.
- `GlobalSearchPreview.less:28-49` gives plain source the Vue Preview editor family, 13px size,
  1.55 line height, ligatures-off behavior, white canvas, selection color, bounded scrolling, and
  preserved whitespace without instantiating Monaco.
- Directory and info components are unchanged. This task does not add image/media/Office/Draw.io
  asset delivery or reinterpret a non-text result as searchable body content.

### Capability, path, and latest-selection boundaries do not regress

- The renderer still sends only host/workspace/generation/request/result tokens
  (`onlyPreviewGlobalSearch.store.ts:404-421`); no relative or absolute preview path, offset, or
  search match enters the request.
- The hidden preload still resolves the token against the current request before this function.
  `global-search-preview.mjs:77-131` retains workspace containment, pre/post `lstat` and `realpath`,
  non-symlink checks, dev/ino/size/mtime identity, `O_NOFOLLOW`, bounded descriptor reads, and
  cancellation before open and after read. The existing changed/replaced/deleted/symlink tests all
  pass.
- `onlyPreviewGlobalSearch.store.ts:423-436` still commits only the exact current preview revision,
  request, and selected result. Forged/revoked query tokens and refresh/initialize replacement are
  rejected by the focused runtime tests.
- Main changes only remove the obsolete validator branch. The Main handler still shape-validates
  and relays the token-only request, and the relay accepts only the bounded response shape; no Main
  filesystem import, traversal, open, or read was added.

## Performance and device-stability evidence

- The removed Contents context path read up to the 1MiB search-text limit. Its replacement reads at
  most one 256KiB buffer, so worst-case per-selection file I/O and transfer memory decrease rather
  than increase.
- The renderer retains one latest Preview payload. Markdown/HTML parsing and the temporary
  `TextEncoder` allocation are bounded by that 256KiB payload; supersession drops the previous
  payload. Plain text is one native `<pre>` surface.
- Directory Preview remains one non-recursive, naturally sorted, 200-entry direct-child listing.
  No new native `WebContentsView`, `BrowserWindow`, iframe, renderer, worker, asset URL, Monaco
  instance, timer, observer, persistent collection, dependency, package-lock change, or
  project-sized allocation appears in the task-scoped diff.

## Verification

| Check                                                                                                                                                                                                                                           | Result                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `node --test tests/onlypreview/onlyPreviewGlobalSearchPreview.test.mjs tests/onlypreview/onlyPreviewGlobalSearchContract.test.mjs tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs` | **PASS — 32/32**                                                                                            |
| `yarn typecheck:node`                                                                                                                                                                                                                           | **PASS**                                                                                                    |
| `yarn vue-tsc --noEmit --noCheck -p tsconfig.web.json --composite false`                                                                                                                                                                        | **PASS**                                                                                                    |
| Focused production ESLint over the changed MJS/TS/Vue files, with only the repository's pre-existing explicit-return rule disabled for untyped `.mjs`                                                                                           | **PASS — 0 remaining errors**                                                                               |
| Task-path `git diff --check`                                                                                                                                                                                                                    | **PASS**                                                                                                    |
| Extra `onlyPreviewSearchWindowIntegration` + `onlyPreviewSearchUtilityRpc` regression run                                                                                                                                                       | **12/13; one unrelated dirty-worktree watch-reconciler source assertion still expects `refreshInternal()`** |
| Build / Electron / Playwright / E2E / packaged smoke / real app                                                                                                                                                                                 | Not run in this independent review                                                                          |

The ordinary whole-file ESLint invocation reports the long-standing explicit-return errors in the
existing untyped `global-search-preview.mjs`; task 073 removes functions from that file and adds no
new occurrence. Whole-file Prettier reports unrelated formatting drift later in the shared
`onlyPreviewGlobalSearchUi.test.mjs`; the task-073 block at lines 5-41 matches Prettier, and the
task-path whitespace check is clean. Neither is a task-073 delivery finding.

The extra regression failure is outside every task-073 path: the shared worktree changed
`watch-reconciler.mjs` to call `refreshFromWatchInternal()`, while an older integration source
assertion still expects `refreshInternal()`. The focused 073 suites and both typechecks remain
green.

## Remaining risks and owner verification

- Ral should live-select a Contents result for Markdown, source, and static HTML and confirm that
  its row still highlights the match while the bottom pane starts from the file beginning with the
  intended Vue Preview visual treatment.
- The live check should include a match beyond 256KiB and confirm Preview remains at the beginning,
  plus a PDF/non-text row and a directory to confirm their existing info/direct-child surfaces did
  not change.
- Native rendering and packaged behavior remain unobserved because Electron/E2E were explicitly
  excluded; the source, runtime, contract, UI, and type boundaries are independently verified.

## Conclusion

**PASS.** Contents keeps its compact match snippet in the result row, while both Files and Contents
now resolve through the same bounded file-head Preview. Markdown reuses the safe Vue Preview
renderer and reading stylesheet, plain source matches its editor visual language without another
Monaco, and static HTML remains zero-attribute/inert. Token authority, stable contained file
identity, cancellation, latest-only commit, directory/info behavior, and Main's zero-filesystem-I/O
relay remain intact. The change lowers the former Contents read bound from 1MiB to 256KiB and adds
no meaningful device-stability risk. Task 073 is ready for the parent full build and Ral's live
visual acceptance.
