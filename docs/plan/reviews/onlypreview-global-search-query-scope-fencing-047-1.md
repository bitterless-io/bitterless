---
id: onlypreview-global-search-query-scope-fencing-047-1
status: passed
reviewed_task: onlypreview-global-search-query-scope-fencing-047
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-contract-and-performance-review
---

# onlypreview-global-search-query-scope-fencing-047 — Review 1

- Result: **PASS**
- Scope: exact punctuated-query identity, synchronous retirement of prior rows and preview
  capabilities, immediate Current directory / Project redispatch, empty-query and IME fences,
  stale batch/terminal rejection, focused-test truthfulness, and task-scoped resource risk.
- Unrelated dirty-worktree changes were preserved and excluded. This review changed only this
  review document.
- Electron, Playwright, E2E, packaged smoke, and the real application were not run, as required.

## Findings

No P1, P2, or P3 finding remains. There is no blocking or non-blocking delivery finding.

## Contract evidence

### Query identity and stale-result fence

- `onlyPreviewGlobalSearch.store.ts:200-203,557-568` routes every changed input value through one
  identity transition. It increments the input revision, revokes the active request and preview
  revision, clears both sections, truncation flags, selection, preview and errors synchronously,
  then retains the existing 120ms scheduler only for ordinary typing.
- `onlyPreviewGlobalSearch.store.ts:506-517` nulls the accepted request ID before the replacement
  dispatch. Existing request/workspace/generation/revision checks at `:451-503` therefore reject
  both a late batch and a late terminal response from the former prefix query.
- The search engine remains unchanged. `sqlite-index.mjs:548-596` sends the whole normalized query
  through quoted trigram candidate lookup and then verifies the complete literal with
  `normalized_searchable.indexOf(normalizedQuery)` before projecting a snippet. Task 047 neither
  adds token fallback nor weakens punctuation handling.

### Immediate scope and Current-directory reruns

- `onlyPreviewGlobalSearch.store.ts:243-256` changes the selector identity or live directory anchor,
  clears prior-scope capabilities, and invokes `dispatchLatest()` immediately for a non-empty
  query. Both selector directions share the same path; a Project-scoped directory update only
  records the future anchor and performs no redundant request.
- `dispatchLatest()` still constructs exactly one strict `{ kind: 'project' }` or
  `{ kind: 'directory', relativePath }` request and preserves the existing workspace, generation,
  request-ID and input-revision fences. A pending typing timer cannot duplicate the immediate
  request because `dispatchedRevision` already equals the current revision.
- The helper returns before dispatch for an empty/whitespace-only query. During composition it
  retires rows but does not dispatch partial text; `endComposition()` schedules the final value
  through the existing latest-only typing path.

### Tests are behavior-bearing

- `onlyPreviewSearchEngine.shortPosting.test.mjs:89-113` uses the real in-memory
  `OnlyPreviewSqliteIndex`, actual trigram FTS path and actual snippet projection. It proves
  `agent-runtime` rejects `ag`, `agent`, and separated `agent` / `runtime` content while returning
  and highlighting only the 13-grapheme exact literal.
- `onlyPreviewGlobalSearchShell.test.mjs:474-564` accepts real prefix rows through the subscribed
  batch boundary, verifies their synchronous removal on the new query, and resolves a stale
  terminal afterward to prove it cannot restore rows, selection or preview.
- `onlyPreviewGlobalSearchShell.test.mjs:566-674` holds Project and Directory requests independently,
  proves both selector directions call Search immediately without the typing scheduler, proves the
  superseded Project response is inert, accepts only the latest Directory response, and proves
  empty-query switches send no request. The earlier live-directory test also proves an explicit
  Current-directory change immediately submits the updated relative path.

### Performance and I/O boundary

- Clearing uses bounded replacement of at most 250 Files rows, 250 Contents rows, and one preview;
  it introduces no project-size scan, timer, watcher, recursive operation, or retained collection.
- Immediate scope changes reuse the existing single renderer request, XPC relay, latest-only
  coordinator, Files metadata branch, Contents SQLite branch and cancellation path. No process,
  renderer, native view, worker, SQLite connection, traversal implementation, file-body read, or
  Main-process filesystem I/O was added.
- Explicit scope/directory interaction can start the already-required replacement query sooner,
  but rapid supersession remains one-active/one-latest and stale work remains cooperatively
  cancelled. Query typing keeps its prior 120ms bound.

## Verification

| Check                                                                                                                                 | Result                                 |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `node --test tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs tests/onlypreview/onlyPreviewSearchEngine.shortPosting.test.mjs` | **PASS — 17/17**                       |
| Query/scope/IME/stale-fence source audit                                                                                              | **PASS — no contract gap**             |
| Task-scoped performance and I/O audit                                                                                                 | **PASS — no resource-model expansion** |
| `yarn build`                                                                                                                          | **PASS — implementation verification** |
| Electron / Playwright / E2E / packaged smoke / real app                                                                               | Not run, as required                   |

## Conclusion

**PASS — task 047 is ready for Ral's live acceptance.** A query or active Contents-scope identity
change can no longer display or reuse rows and preview capabilities from its predecessor;
punctuated queries retain exact literal semantics, selector and Current-directory changes rerun
immediately, empty and composing input remain fenced, and the fix does not expand the process,
filesystem-I/O, indexing, or memory model.
