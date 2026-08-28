---
id: onlypreview-cold-folders-native-search-overlay-043-4
status: blocked
reviewed_task: onlypreview-cold-folders-native-search-overlay-043
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-closure-review
supersedes_review: onlypreview-cold-folders-native-search-overlay-043-3
---

# onlypreview-cold-folders-native-search-overlay-043 — Review 4

- Result: **FAIL (BLOCKED)**
- Scope: closure of Review 3's ordered-glob CPU and TS-1 findings, semantic equivalence and
  false-negative review of descendant-aware matching, plus focused regression of the already
  accepted task-043 Search lifecycle and native overlay contracts.
- Excluded as unrelated concurrent work: `tests/indexing/`, tmp/benchmark documents,
  indexing-plan/benchmark documents and tasks, and unrelated `package.json`/`.gitignore` hunks.
  No such change was reviewed or modified.
- E2E/live app: intentionally not run. Electron, Playwright, packaged smoke, and the real
  application remain excluded by the task contract.

## Findings

### P2 — blocking correctness: wildcard re-inclusion descendants are pruned before their rule can match

The feature contract permits a later ordered `!` rule to return an explicitly re-included
descendant to normal (`docs/features/onlypreview.md:421-429`). Task 043 then uses physical exclusion
as a pre-stat/pre-reconcile boundary (`docs/plan/tasks/onlypreview-cold-folders-native-search-overlay-043.md:35-37`),
so `canOrderedGlobReincludeDescendant()` must be conservative: it may return false only when no
later include can match any descendant.

`src/preload/onlypreview/search/core/glob-config.mjs:76-92` currently decides that possibility from
the include rule's literal prefix alone. Lines 84-89 accept only an empty prefix, an exact current
directory, or a literal prefix located below the current directory. They reject patterns whose
first wildcard can consume part of the current directory name or an intermediate directory.

Two bounded probes reproduce the false negative:

```text
rules: ['foo', '!f*/keep/**']
foo/keep/file.txt ordered state: eligible
canOrderedGlobReincludeDescendant('foo'): false
workspace traversal result: []

rules: ['foo', '!foo/*/keep/**']
foo/bar/keep/file.txt ordered state: eligible
foo/bar is pruned as physically excluded before that descendant is reached
```

The first case was also exercised through a real temporary workspace and
`createWorkspaceTraversal()`: although direct ordered evaluation includes the file, traversal
publishes no entry. The false negative flows through the shared policy at
`src/preload/onlypreview/search/core/traversal.mjs:60-82` into full traversal, watch partitioning,
and Browse ancestor capabilities.

The new tests at `tests/onlypreview/onlyPreviewSearchPolicy.test.mjs:74-115,153-289` cover
descendant-aware ordered state and the literal `!excluded/keep/**` branch, but not a wildcard in
the current or intermediate directory segment. Add both regressions and replace the one-way literal
prefix test with a matcher that proves or conservatively admits possible descendant intersection.
It must retain the physical-exclusion fast path when intersection is genuinely impossible.

No P1 or additional P2/P3 finding was found.

## Review 3 finding closure

- **P2 rules-by-depth CPU amplification: closed.** Each compiled rule now owns one
  `inheritedRegex` (`src/preload/onlypreview/search/core/glob-config.mjs:37-52`), and ordered state
  scans rules in reverse so the last matching rule wins with at most one matcher call per visited
  rule (`glob-config.mjs:61-70`). There is no retained path cache. A 9,198-case deterministic
  comparison found the new current-or-ancestor result equivalent to the legacy candidate-array
  algorithm for exact, `*`, `?`, `**`, leading slash/dot, include, and later re-exclude cases.
- The literal-prefix skip at `glob-config.mjs:65` is safe for evaluating the concrete path because
  every generated regex is start-anchored and must consume that literal prefix. The inherited
  matcher adds only one terminal descendant suffix; source inspection and focused cases found no
  new pathological regex shape or ordered-state false negative. The remaining finding is confined
  to the separate descendant-*possibility* predicate above.
- Re-running Review 3's 1,024-rule × 2,000 eight-level-path probe took 13.8ms, 12.2ms, and 10.0ms,
  down from 424.8ms, 392.1ms, and 383.0ms. The rules-by-depth allocation and regex amplification are
  removed.
- **P3 / TS-1: closed.** `tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs` is 738 lines
  and the extracted `tests/onlypreview/onlyPreviewSearchPolicy.test.mjs` is 289 lines. The reviewed
  production policy file is 93 lines; no reviewed closure file exceeds 800 lines or introduces a
  TS-2 function declaration.

## Previously accepted contracts without additional regression

- Exact and literal ordered exclusions/re-inclusions still share one policy across full traversal,
  watch, SQLite projection, and Browse markers. Exact `drop` remains zero-read/unindexed/orange and
  non-full while literal `keep` remains searchable; later literal re-exclusion remains effective.
- Schema-7 provisional directories, schema-8 promotion, exact orphan cleanup, bounded watcher
  recovery, refresh `revokeResults()`, candidate-failure rollback, and queued-reader replacement
  remain green in focused tests.
- Global Search remains one Main-owned topmost child `WebContentsView` with shared clamped bounds,
  warm detach/reopen, correct attach ordering, context/reveal fences, focus restoration, crash
  isolation, exact teardown, and the previously reviewed sandbox/XPC/navigation security boundary.
- No filesystem, SQLite, Main, or Renderer I/O and no retained cache were added by the Review 3
  repair.

## Verification

| Check | Result |
| --- | --- |
| `node --test` over Search policy/contract/traversal/Browse/boundary/recovery/warm lifecycle and native Global Search view/shell/UI suites | **PASS — 72/72** |
| Deterministic new-vs-legacy ordered-state comparison | **PASS — 9,198 comparisons** |
| Matcher operation-count regression | **PASS** — each rule/path matcher is called at most once; safe unrelated literal prefixes call zero regex matchers |
| Review 3 1,024-rule × 2,000-path probe | **PASS performance closure** — 13.8ms / 12.2ms / 10.0ms |
| Wildcard descendant re-inclusion direct + traversal probes | **FAIL as expected** — descendant is eligible by ordered state but its ancestor reports no possible re-inclusion and traversal returns no entries |
| File-size audit | **PASS** — boundary 738 lines; policy test 289; glob policy 93 |
| `git diff --check` | **PASS** |
| Electron / Playwright / E2E / packaged smoke / real app | Not run, as required |

## Conclusion

**FAIL / BLOCKED.** Review 3's performance blocker and non-blocking TS-1 finding are both closed,
and the inherited matcher is equivalent and bounded for concrete ordered-state evaluation. Final
acceptance remains blocked by one P2 false negative in descendant traversal eligibility: a valid
later `!` rule containing `*` or `?` in the current/intermediate directory can make a file eligible,
yet its excluded ancestor is pruned before the rule can ever match. Repair that possibility test,
add wildcard-prefix and wildcard-intermediate integration regressions, and run one more independent
closure review.
