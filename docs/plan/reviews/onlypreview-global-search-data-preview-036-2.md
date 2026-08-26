# onlypreview-global-search-data-preview-036 — Review 2

- Date: 2026-08-26
- Result: **PASS**
- Scope: independent re-review of all four Review 1 blockers and the current dirty-worktree task
  036 boundary. Unrelated worktree changes were preserved and excluded.
- Method: fresh source/contract audit, all five focused Node suites, Node typecheck, scoped
  whitespace check, file-line audit, and independent negative probes for identity, lifecycle,
  priority-section caps, and adapter parity.
- E2E/live app: intentionally not run. Electron, Playwright/E2E, the real application, packaged
  smoke, `yarn build`, and visual acceptance remain excluded by the assigned verification contract.

## Findings

No P0, P1, P2, or P3 finding remains.

## Review 1 blocker closure

### File-backed context/info identity: closed

- `src/preload/onlypreview/search/core/global-search-preview.mjs` now centralizes contained
  realpath/dev/inode/size/mtime verification in `readStableIdentity` and bounded opened-handle
  verification in `readStableFileBuffer`.
- Text heads use the 256KiB buffer limit. Contents context uses the existing 1MiB body boundary,
  then requires the exact accepted original snippet to remain present before returning the bounded
  before/match/after variant.
- Non-text, sensitive text, and over-1MiB text `info` variants now perform the same stable file
  identity check without reading a body. Deleted, replaced, changed, or symlinked files fail closed.
- An independent mutation probe returned `context:REJECTED` after replacing the matched body and
  `info:REJECTED` after replacing the PDF inode. The focused suite separately covers changed
  Contents, replaced PDF, changed sensitive text, changed over-1MiB text, symlink replacement, and
  deletion.

### Failed replacement/refresh and active-to-pending token lifecycle: closed

- `executeOnlyPreviewGlobalSearch` begins the new result session before fallible scope validation,
  and its request-ID-scoped failure cleanup cannot revoke a newer session.
- `OnlyPreviewSearchEngine.initialize` and `refresh` revoke before their fallible path/config work.
  Priority supersession, promotion, watch reconcile, and shutdown retain their existing unconditional
  revocation points.
- `createFileSearchCoordinator.search` cancels preview work and revokes the current session before
  submitting even a queued replacement. Request-specific cancel remains conditional, so a late
  cancel for the old request cannot revoke the pending/new request.
- Independent probes returned `failed-search-token:REVOKED` and
  `failed-refresh-token:REVOKED`. A session fence probe returned
  `late-cancel-preserves-pending true`; the focused coordinator test also proves immediate
  active-to-pending revocation while the active search is still draining.

### Independent 250/250 priority-batch caps: closed

- `OnlyPreviewGlobalSearchSession` now keeps both the absolute 500-token ceiling and independent
  Files/Contents counters capped at 250.
- `executeOnlyPreviewGlobalSearch` additionally tracks emitted paths per section and includes the
  early priority projection in the caller's requested section cap. Duplicate paths retain their
  token without consuming another row.
- Re-running the former outside-terminal priority case with 250 normal filename and body matches
  produced `streamed 250 250 terminal 250 250 registry 500`. Neither section starved the other, and
  the terminal replacement retained the exact independent ceilings.

### `.md` / `.markdown` / `.mdx` adapter parity: closed

- Global Search now selects `markdown` only for exact case-insensitive `.md`, matching the accepted
  Main classifier and Preview adapter routing. HTML/HTM remain the intentional static-HTML search
  adapter; all other admitted text uses `plain`.
- Independent output was `format.md markdown`, `format.markdown plain`, and `format.mdx plain`, and
  the focused preview suite locks the same matrix.

## No-regression audit

- Terminal responses and streamed batches keep strict grouped shapes. Files performs normalized
  literal name matching over metadata only and includes directories; it performs no body I/O.
  Contents still uses bounded eligible SQLite bodies, candidate prefiltering, Unicode-aware exact
  verification, canonical path order, and per-section exact-path deduplication.
- Result tokens remain `randomUUID()` capabilities owned by the exact host runtime and latest
  workspace/generation/request. The registry is bounded to 500 total and 250 per section. Forged,
  stale, cancelled, replaced, refreshed, initialized, promoted, failed, watched, and shutdown
  authorities fail closed.
- Preview accepts only the opaque token envelope. Filesystem and SQLite authority remain in the
  hidden preload; Main only parses, shape-validates, time-bounds, and relays. Public grouped and
  preview variants contain relative metadata only and no absolute path, root path, database path,
  handle, or byte authority.
- Per-selection work remains one latest-only operation: at most a 256KiB text buffer, a bounded
  1MiB context verification buffer, metadata-only file checks, or a 200-entry directory payload.
  Directory enumeration keeps only the naturally smallest 200 entries in memory, yields/checks
  cancellation every 256 accepted children, never recursively scans, and never follows symlink
  children.
- All reviewed production files remain below the task's 800-line ceiling. The largest is
  `src/preload/onlypreview/search/core/sqlite-index.mjs` at 794 lines; search engine is 610, Main
  relay 660, preview service 272, executor 217, coordinator 206, and session 113. New module-level
  functions use arrow consts and class methods retain method shorthand.

## Verification

| Command / evidence | Result |
|---|---|
| `node --test tests/onlypreview/onlyPreviewGlobalSearchContract.test.mjs tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewGlobalSearchPreview.test.mjs tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` | **PASS, 28/28** |
| `yarn typecheck:node` | **PASS** |
| Scoped `git diff --check` for task 036 source/tests | **PASS** |
| Independent changed-context/replaced-info probe | **PASS:** both stale previews rejected |
| Independent failed-search/failed-refresh token probe | **PASS:** both prior tokens revoked |
| Active-to-pending focused test + late-cancel session probe | **PASS:** immediate revoke; pending session preserved |
| Independent priority/full-section probe | **PASS:** streamed 250/250, terminal 250/250, registry 500 |
| Independent `.md` / `.markdown` / `.mdx` probe | **PASS:** `markdown` / `plain` / `plain` |
| Production line-count audit | **PASS:** maximum 794, all below 800 |
| `yarn build` | Not run; explicitly excluded from this independent review |
| Electron / Playwright / E2E / real app / packaged smoke | Not run, as required |

## Conclusion

**PASS.** Review 1's stale-preview, lifecycle-revocation, cumulative-section-cap, and Markdown parity
blockers are closed with exact negative regressions. The current implementation preserves the
token-only no-Main-I/O authority boundary, independent grouped results, bounded preview resources,
latest-only cancellation, and device-safety limits required by task 036.
