---
id: onlypreview-global-search-file-content-preview-073
scope: Replace Contents match-context bottom preview with bounded VuePreview-style file content
status: implemented; owner verification pending
depends-on:
  - onlypreview-global-search-data-preview-036
  - onlypreview-global-search-floating-surface-048
verify: focused non-Electron Global Search preview/contract/UI/store tests, relevant Node and Renderer typecheck/lint/format, yarn build, git diff --check; no Electron/Playwright/E2E
---

# Global Search file-content bottom Preview

## Objective

Make the bottom Preview render the selected file's bounded content, regardless of whether the file
was selected from Files or Contents. Keep the Contents row's highlighted match snippet as row
evidence, but remove the enlarged context-only Preview.

## Context

- [Global Search context Preview issue](../../issues/onlypreview-global-search-context-preview-wrong.md)
- [OnlyPreview Global Search and result preview](../../design/onlypreview-global-search.md)
- [OnlyPreview feature contract](../../features/onlypreview.md)
- [Historical task 036](onlypreview-global-search-data-preview-036.md)
- [Historical task 037](onlypreview-global-search-workspace-037.md)

Tasks 036/037 remain historical delivery records. This follow-up supersedes only their
Contents-specific context Preview behavior.

## Path

- `src/preload/onlypreview/search/core/global-search-preview.mjs`
- `src/shared/onlypreview/onlyPreviewSearch.type.ts`
- `src/main/fileSearch/fileSearchGlobalResult.validator.ts`
- `src/renderer/onlypreview/shell/src/components/GlobalSearchPreview/`
- `tests/onlypreview/onlyPreviewGlobalSearchPreview.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchContract.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs`
- `tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs`
- canonical docs listed above plus `docs/INDEX.md` and `docs/plan/README.md`

## Contract

- Keep the result-row `contentMatch` snippet/highlight unchanged. It is not a Preview payload.
- Resolve both Files and Contents text tokens through the existing stable file-read path. Return at
  most the first 256KiB as `kind: 'text'`, using the same adapter derived from the file name:
  `plain`, `markdown`, or `html-static`.
- Remove the public `kind: 'context'` preview variant, reject its old wire shape, remove its lazy
  component mapping, and delete the now-unused context-only component/styles.
- Markdown reuses the safe Vue Preview Markdown renderer and reading-column stylesheet. Plain text
  keeps a lightweight DOM source surface but matches Vue Preview's editor font, line height, white
  canvas, selection, and spacing. Static HTML reuses the reading surface only after the existing
  zero-attribute sanitizer; it never executes scripts, styles, resources, forms, embeds, or
  navigation.
- Preserve `truncated`; when the match is after the returned head, do not synthesize or jump to
  context. The row still displays the match while the bottom pane starts at the file beginning.
- Preserve opaque result tokens, query/request/workspace/generation identity, latest-only Preview,
  stable opened-file identity, `O_NOFOLLOW`, realpath containment, exclusions, sensitive-file and
  size fallback, one 256KiB payload, directory direct-child cap, and Main's zero-filesystem-I/O
  relay.
- Do not add a native view, iframe, renderer, worker, asset URL, Monaco instance, body read, or
  persistent collection. Non-text files remain `info`; directories remain bounded direct children.

```text
┌─ CONTENTS result row ───────────────────────────────────────┐
│ README.md  docs                                               │
│ …before [matched query] after…                              │
├─ Bottom Preview ─────────────────────────────────────────┤
│ # File title                                                 │
│ rendered/read-only content from the beginning of README.md   │
│ …                                                           │
└──────────────────────────────────────────────────────────────┘
```

## Verification

- Runtime tests prove a Contents token returns the same adapter/file head as a Files token, a match
  after 256KiB does not become a context Preview, and identity/revocation/cancellation remain exact.
- Contract tests accept bounded text/directory/info only and reject the retired context wire shape.
- UI source tests prove lazy adapter selection, Vue Preview style reuse, unchanged row snippet, and
  retained static-HTML sanitization.
- Store tests retain latest-only/stale-result fencing with a text payload. Do not grow the already
  oversized store test file beyond the smallest expectation replacement needed by this contract.
- Run focused non-Electron tests, relevant Node/Renderer typecheck, focused lint/format,
  `yarn build`, and task-path `git diff --check`.
- Do not run Electron, Playwright, packaged smoke, or E2E. Owner performs the live visual check.

## Delivery

- Files and Contents text tokens now share the same stable, bounded file-head read. The bottom
  Preview starts at the beginning of the selected file and returns at most 256KiB.
- The Contents result row still owns and renders its highlighted match snippet. The retired
  `context` preview wire variant, validator branch, lazy component, and styles were removed.
- Markdown uses the existing safe Vue Preview renderer and reading-column stylesheet. Plain source
  uses the same editor typography without another Monaco instance; static HTML remains
  zero-attribute sanitized and inert.
- Directory and non-text Preview behavior, opaque-token authority, stable file identity,
  containment, cancellation, and Main's zero-filesystem-I/O relay remain unchanged.

## Verification Results

- [Independent review 1](../reviews/onlypreview-global-search-file-content-preview-073-1.md):
  **PASS**, no blocking or P1–P3 finding.
- Focused Global Search preview/contract/UI/store tests: **32/32 PASS**.
- Node typecheck and directed Renderer typecheck: **PASS**.
- Focused production lint with the repository's pre-existing explicit-return rule disabled for the
  untyped `.mjs` file: **PASS**, zero remaining errors.
- `yarn build`: **PASS**. The build script's temporary package-name mutation was restored.
- Task-path `git diff --check`: **PASS**.
- An additional SearchWindowIntegration/UtilityRpc run was **12/13**. Its only failure is outside
  task 073: the shared dirty worktree's watch reconciler now calls `refreshFromWatchInternal()`,
  while an older source assertion still expects `refreshInternal()`.
- Electron, Playwright, packaged smoke, and E2E were not run, as required.

## Owner Verification

- Select Markdown, source, and static HTML results from Contents. Confirm the row still highlights
  the match while the bottom Preview renders from the beginning of the file with the Vue Preview
  visual treatment.
- Include a match beyond 256KiB and confirm the row shows the distant match while Preview remains
  at the file head.
- Select a PDF/non-text file and a directory and confirm their existing information/direct-child
  surfaces remain unchanged.
