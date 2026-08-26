---
id: onlypreview-small-unknown-text-fallback-035
scope: Default text preview and content indexing for small unknown or compound-extension files
status: implemented; owner verification pending
depends-on: [onlypreview-selected-file-index-priority-034]
verify: node --test tests/onlypreview/onlyPreviewPreviewGuards.test.mjs tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs tests/onlypreview/onlyPreviewSearchEngine.traversal.test.mjs tests/onlypreview/onlyPreviewSourceIntegration.test.mjs && yarn typecheck:node && yarn build && git diff --check
---

# Default small unknown files to text

## Objective

Treat an otherwise unknown file such as `AGENTS.md.bak` as read-only plain text when it stays within
the existing text-size limit, while preserving every known specialized Preview adapter and the
smaller Project/Global Search body-index limit.

## Context

- `docs/features/onlypreview.md`
- `docs/design/onlypreview-format-coverage.md`
- `docs/design/onlypreview-global-search.md`

## Path

- `src/main/onlypreview/onlyPreviewClassifier.service.ts`
- `src/preload/onlypreview/search/core/classification.mjs`
- `tests/onlypreview/onlyPreviewPreviewGuards.test.mjs`
- `tests/onlypreview/onlyPreviewWorkspaceCore.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs`
- `tests/onlypreview/onlyPreviewSearchEngine.traversal.test.mjs`
- `tests/onlypreview/onlyPreviewSourceIntegration.test.mjs`
- `docs/features/onlypreview.md`
- `docs/design/onlypreview-format-coverage.md`
- `docs/design/onlypreview-global-search.md`
- `docs/plan/README.md`

## Contract

- Classification remains extension-first. Known HTML, PDF, Markdown, image, audio, video, Office,
  Draw.io, and explicit unsupported media formats retain their current adapters and validation.
- Any remaining regular file uses the text adapter with Monaco language `plaintext`. This includes
  unknown, extensionless, backup, and compound-extension names such as `AGENTS.md.bak`.
- Main Preview reads at most the existing 8MiB text limit. Project/Global Search indexes at most the
  existing 1MiB body limit. Admission is size-first and performs no header/magic/binary sniff.
- A small unknown binary may display replacement characters or unreadable text. It is never
  executed, imported, compiled, interpreted, or passed to the HTML/Markdown renderer.
- An unknown file above 8MiB returns the truthful text-too-large metadata state without reading its
  body. Between 1MiB and 8MiB it remains previewable but title-only in Project/Global Search.
- Preserve sensitive-file body exclusions, hidden/fixed/config/depth policy, opened identity and
  post-read verification, specialized signature checks, and all file associations.

## Verification

- Prove case-insensitive known adapters still win and `AGENTS.md.bak`, `.bak`, arbitrary unknown,
  and extensionless files use plaintext.
- Prove 8MiB Preview and 1MiB Search cap boundaries without overread, no magic-byte branching, and
  no binary execution path.
- Run the listed focused tests, `yarn typecheck:node`, debug `yarn build`, and `git diff --check`.
- Do not run Electron/Playwright/E2E/real-app/packaged smoke; Ral owns runtime acceptance.

## Owner Verification

- Open a small `AGENTS.md.bak` and an arbitrary small unknown extension; confirm readable plaintext.
- Open a small binary with an unknown extension; confirm bounded乱码 is possible but the app stays
  responsive and executes nothing.
- Check a file just above 8MiB and confirm metadata-only too-large state with no UI freeze.

## Delivery

- Main Preview and hidden Search classifiers preserve known specialized/explicit-unsupported
  adapters, then route every remaining regular file to inert `plaintext`.
- Preview/Search reads are size-first and request at most exactly 8MiB/1MiB; over-limit candidates
  perform zero body reads and post-read identity fences remain authoritative.
- Focused classification/traversal coverage passes 46/46, `yarn typecheck:node`, `yarn build`, and
  `git diff --check` pass. The build emitted only existing Vite dynamic/static import advisories.
- [Independent review 1](../reviews/onlypreview-small-unknown-text-fallback-035-1.md) blocked on stale
  feature/design truth; those contradictions were corrected. [Independent review 2](../reviews/onlypreview-small-unknown-text-fallback-035-2.md)
  records **PASS** with no P0–P2 finding.
- Electron/Playwright/E2E/real-app/packaged smoke were not run; Ral owns the checks above.
