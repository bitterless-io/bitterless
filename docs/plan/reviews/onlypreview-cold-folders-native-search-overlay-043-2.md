---
id: onlypreview-cold-folders-native-search-overlay-043-2
status: blocked
reviewed_task: onlypreview-cold-folders-native-search-overlay-043
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-blocker-closure-review
supersedes_review: onlypreview-cold-folders-native-search-overlay-043-1
---

# onlypreview-cold-folders-native-search-overlay-043 — Review 2

- Result: **FAIL (BLOCKED)**
- Scope: closure of the two Review 1 blockers, plus regression review of the task-043 provisional
  tree and native Global Search overlay contracts.
- Excluded as unrelated concurrent work: `tests/indexing/`, tmp/benchmark documents,
  `docs/design/onlypreview-indexing-throughput.md`,
  `docs/features/onlypreview-indexing-benchmark.md`, task 069, and unrelated
  `package.json`/`.gitignore` hunks. No such change was reviewed or modified.
- E2E/live app: intentionally not run. Electron, Playwright, packaged smoke, and the real
  application remain excluded by the task contract.

## Findings

### P2 — blocking correctness/security/performance: one ordered re-inclusion branch opens excluded sibling paths

Task 043 requires physically excluded watch paths to be partitioned before stat/reconcile and never
to invalidate Search or trigger a candidate build
(`docs/plan/tasks/onlypreview-cold-folders-native-search-overlay-043.md:35-37`). The Browse policy
also says a traversable excluded directory permits a **later explicitly re-included descendant** to
return to normal (`docs/features/onlypreview.md:421-429`); it does not make every sibling below that
ancestor Search-eligible.

The new ancestor check at
`src/preload/onlypreview/search/core/traversal.mjs:60-75,88-93` asks whether an excluded ancestor has
*any possible* later re-inclusion. Once `canOrderedGlobReincludeDescendant(ancestorPath, rules)` is
true, the ancestor stops blocking every emitted path below it. With ordered rules
`['excluded', '!excluded/keep/**']`, this correctly permits `excluded/keep/file.txt`, but it also
reports `excluded/drop/file.txt` as not physically excluded even though that sibling is not matched
by the negation. A direct policy probe returned:

```text
excluded/keep/file.txt  -> physically excluded: false
excluded/drop/file.txt  -> physically excluded: false
```

The second result must be `true`. Otherwise watch events in `excluded/drop/**` can enter ordinary
stat/body reconciliation and be persisted in the plaintext Search SQLite tier, while also restoring
the disk/CPU churn that physical partitioning is intended to prevent.

The new regression at
`tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs:465-503` proves only the `keep` branch.
Extend the same ordered-rule fixture with a `drop` sibling and prove: the explicitly re-included
`keep` path gets its single incremental read and remains searchable; the `drop` path causes zero
Search reads, no full reconcile, and appears in neither Files nor Contents nor the committed index.
The production predicate must evaluate whether the concrete emitted path lies on an actually
re-included branch, rather than treating existence of any possible descendant negation as permission
for all siblings.

No additional P1, P2, or P3 finding was found in the reviewed task-043 implementation.

## Review 1 blocker closure

- **Exact excluded ancestor without negation: closed.** The ancestor-aware gate now treats
  `exclude: ['excluded']` plus `excluded/deep/file.txt` as physical. The focused regression at
  `tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs:423-463` proves zero Search file read,
  a bounded non-full commit, and no indexed descendant. The ordered-negation extension remains
  incomplete only for the sibling case described above.
- **Refresh/session lifecycle: closed.** Public refresh now calls
  `globalSearchSession.revokeResults()` at
  `src/preload/onlypreview/search/core/search-engine.mjs:557-567`. The method at
  `src/preload/onlypreview/search/core/global-search-session.mjs:99-114` clears result capabilities
  while preserving the accepted request identity; full revocation remains available for promotion
  and lifecycle replacement. The formerly failing queued-reader race now passes within the focused
  suite, so refresh no longer turns a valid in-flight request into `Global search request is stale`.

## Reviewed contracts without additional findings

- Schema-7 provisional directories remain derived only from eligible committed file ancestors,
  without filesystem traversal, body reads, synthetic empty directories, or symlink publication;
  schema-8 promotion still replaces the provisional tier under the reader/writer and generation
  fences. Exact candidate/previous orphan cleanup remains basename-scoped.
- Watch recovery remains completion-aware with capped reattachment backoff. Core/fixed exclusions,
  the exact excluded-ancestor case, ordinary visible incremental events, loaded-Browse refresh, and
  symlink exclusion retain their focused coverage. No additional filesystem, SQLite, Renderer scan,
  or Main I/O was introduced by the reviewed fixes.
- Global Search remains a Main-owned, topmost child `WebContentsView` with shared clamped bounds,
  warm detach/reopen, correct attach order over Vue/Chrome Preview, strict context/reveal fences,
  bounded directory completion, opener/focus restoration, crash isolation, and exact teardown.
- The Search child retains sandbox, context isolation, web security, CSP, navigation/window-open
  fences, strict XPC validation, and no direct Renderer filesystem/SQLite access. Raw Chrome
  HTML/PDF remains preload-free.

## Verification

| Check | Result |
| --- | --- |
| `node --test tests/onlypreview/onlyPreviewSearchEngine.recovery.test.mjs tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs tests/onlypreview/onlyPreviewWarmSearchLifecycle.test.mjs tests/onlypreview/onlyPreviewGlobalSearchView.test.mjs tests/onlypreview/onlyPreviewGlobalSearchShell.test.mjs tests/onlypreview/onlyPreviewGlobalSearchUi.test.mjs` | **PASS — 53/53**; includes the formerly failing refresh/queued-reader lifecycle and both newly added exclusion cases |
| Ordered-rule direct policy probe (`excluded`, `!excluded/keep/**`) | **FAIL as expected** — both `keep` and unrelated `drop` report `physically excluded: false`; `drop` must remain physical |
| `git diff --check` | **PASS** |
| Node/Renderer type checks and `yarn build` | Not rerun in Review 2; focused source/tests are sufficient to reproduce the remaining blocker |
| Electron / Playwright / E2E / packaged smoke / real app | Not run, as required |

## Conclusion

**FAIL / BLOCKED.** Review 1's refresh/session blocker is closed, and the exact excluded-directory
case without negation is fixed. Acceptance remains blocked by one P2: the ordered-negation ancestor
gate allows unrelated sibling descendants below an excluded directory to enter Search reconciliation
and plaintext indexing. Constrain physical eligibility to the concrete re-included branch and add
the sibling regression before the next independent review.
