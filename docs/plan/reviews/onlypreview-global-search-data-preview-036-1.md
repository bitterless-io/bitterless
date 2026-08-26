# onlypreview-global-search-data-preview-036 — Review 1

- Date: 2026-08-26
- Result: **BLOCKED**
- Scope: independent review of the current dirty-worktree implementation against task 036 and
  `docs/design/onlypreview-global-search.md`. Unrelated worktree changes were preserved and excluded.
- Method: source/contract/diff audit, the five task-focused Node suites, Node typecheck, scoped
  whitespace validation, and bounded negative probes for stale identity, token lifecycle, section
  caps, and adapter parity.
- E2E/live app: intentionally not run. Electron, Playwright/E2E, the real application, packaged
  smoke, and `yarn build` were excluded by the assigned verification contract.

## Findings

### [P1] Content and info previews bypass the accepted file-identity boundary

`src/preload/onlypreview/search/core/global-search-preview.mjs:103-110` constructs `info` directly
from cached authority metadata. Lines 207-220 construct `context` directly from the cached search
snippet, and lines 237-242 return both variants without calling `readStableIdentity`; only directory
and admitted text-head previews use the containment/realpath/dev/inode/size/mtime checks at lines
84-100. This affects ordinary non-text results, sensitive/over-1MiB text metadata, and every
Contents result.

A bounded engine probe searched `content.txt`, replaced its body, then previewed the original
Contents token. It still returned:

```text
{"kind":"context","name":"content.txt","before":"before ","match":"needle","after":" after","truncated":false}
```

The current file no longer contained `needle`. The same bypass lets a file become a symlink or
change identity while an `info` token continues to return stale metadata. This violates the task's
file-identity/symlink requirement and the design's requirement that context be reverified against
the exact accepted result. Apply the stable contained identity gate to every variant; Contents also
needs a bounded revalidation of the accepted match/context rather than returning the stored snippet
unconditionally. Add mutation/replacement/symlink tests for `context`, non-text `info`, sensitive
text `info`, and over-1MiB text `info`.

### [P1] Failed replacement searches and failed refreshes do not revoke the previous request tokens

`src/preload/onlypreview/search/core/global-search-executor.mjs:97-102` validates directory scope
before `globalSearchSession.begin`, and that validation is outside the `try` beginning at line 108.
An invalid-but-strictly-shaped replacement request therefore fails while the previous session stays
current. `src/preload/fileSearch/fileSearchCoordinator.ts:177-180` cancels preview work when a new
query is submitted but does not synchronously revoke that session. Refresh has the same hole:
`src/preload/onlypreview/search/core/search-engine.mjs:393-404` loads/parses the new config before it
revokes the Global Search session.

Two bounded probes confirmed the externally observable stale authority:

```text
replacement failed Search directory scope does not exist
old token after failed replacement context

refresh failed Preview config must be a YAML mapping
old token after failed refresh info
```

The accepted contract explicitly revokes on query replacement, refresh, and failure. Revoke at the
start of the replacement/refresh lifecycle, before fallible scope/config work, while retaining the
request-ID fence so a late old failure cannot revoke a newer request. Cover invalid directory scope,
config parse/read failure, active-to-pending supersession, and unrelated late cancellation.

### [P1] Priority rows can make a streamed section exceed its independent 250-row cap

`src/preload/onlypreview/search/core/global-search-executor.mjs:109-117` issues the priority Files
row before normal search. Lines 159-169 then issue up to the full 250 normal Files authorities and
exclude only the same path. If the priority path sorts outside the terminal top 250, all 251 distinct
rows are published. `src/preload/onlypreview/search/core/global-search-session.mjs:34-49` enforces
only one combined 500-token limit, not independent Files/Contents limits, so 251 Files can also use
one capability slot that would otherwise carry a Contents batch row.

A bounded reconcile-state probe with 250 earlier filename matches plus one latest priority file
reported:

```text
streamed files 251 terminal files 250 early-in-terminal false
```

The terminal response repairs the array, but the accepted pending UI retains batches, and task 036
requires strict grouped batch shapes with independent 250 + 250 caps. Enforce cumulative
per-section capability/batch limits, including the early projection, and test the exact case where
the priority result falls outside each terminal section's first 250 rows while Contents is also full.

### [P2] `.markdown` and `.mdx` use a different adapter in search preview than in the accepted main preview

`src/preload/onlypreview/search/core/global-search-preview.mjs:36-40` returns the `markdown` adapter
for `.md`, `.markdown`, and `.mdx`. The accepted Main classifier routes only `.md` to
`markdown-dom`; `src/main/onlypreview/onlyPreviewClassifier.service.ts:371-397` and
`src/main/onlypreview/views/onlyPreviewPreviewAdapter.service.ts:45-48` route `.markdown` and `.mdx`
to inert Monaco (with a Markdown language hint). A direct Global Search probe returned `markdown`
for all three extensions.

This makes the same file render differently when opened normally versus selected in Global Search,
and sends MDX markup through an adapter the main format contract did not admit. Align the result
preview adapter decision with the accepted classifier semantics—`.md` is Markdown; `.markdown` and
`.mdx` remain plain/Monaco-equivalent unless the canonical format contract is deliberately changed
everywhere—and add an exact three-extension parity test.

## Confirmed implementation properties

- Terminal responses are strictly shaped and independently capped at 250 Files + 250 Contents;
  Files includes directories, matches normalized literal names without body I/O, and Contents uses
  SQLite candidates followed by Unicode-aware exact verification and per-section path deduplication.
- Result capabilities use `randomUUID()`, are host-isolated by the per-host hidden runtime, accept
  token-only preview requests, and keep an absolute combined registry ceiling of 500. Forged and
  successfully superseded/cancelled/promoted/watch-revoked tokens fail closed.
- Main validates dense exact response/preview shapes and exposes no absolute path, SQLite handle,
  or filesystem authority to the visible side. Main performs no search-result preview filesystem
  I/O.
- Admitted text-head reads are bounded to 256KiB, search-body reads remain bounded to 1MiB, and the
  directory payload is bounded to 200 naturally sorted direct entries. Directory scanning is
  time-sliced and memory-bounded; symlink children are reported as metadata and are not traversed.
- All reviewed/touched production files remain below 800 lines; the largest is
  `sqlite-index.mjs` at 794 lines. New standalone helpers follow the repository's arrow-const style,
  and class methods retain method shorthand.

## Verification

| Command / evidence | Result |
|---|---|
| `node --test tests/onlypreview/onlyPreviewGlobalSearchContract.test.mjs tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs tests/onlypreview/onlyPreviewGlobalSearchPreview.test.mjs tests/onlypreview/onlyPreviewSearchUtilityRpc.test.mjs tests/onlypreview/onlyPreviewSearchWindowIntegration.test.mjs` | **PASS, 24/24** |
| `yarn typecheck:node` | **PASS** |
| Scoped `git diff --check` for task 036 source/tests | **PASS** |
| Mutation probe: Contents token after body replacement | **FAIL as required:** stale context returned |
| Lifecycle probes: invalid replacement and failed refresh | **FAIL as required:** old tokens remained usable |
| Priority + full filename section probe | **FAIL as required:** 251 Files streamed before 250-row terminal replacement |
| `.md` / `.markdown` / `.mdx` adapter parity probe | **FAIL as required:** all three returned `markdown` |
| `yarn build` | Not run; explicitly excluded from this independent review |
| Electron / Playwright / E2E / real app / packaged smoke | Not run, as required |

## Conclusion

**BLOCKED.** The grouped terminal shape, token-only XPC boundary, body-I/O limits, and core search
ordering are sound, but task 036 cannot close while stale files can produce context/info previews,
failed lifecycle transitions preserve old result capabilities, priority batches can exceed the
independent section cap, and result-preview Markdown routing disagrees with the accepted main
classifier.
