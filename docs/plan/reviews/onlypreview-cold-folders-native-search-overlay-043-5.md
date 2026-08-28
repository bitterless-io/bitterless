---
id: onlypreview-cold-folders-native-search-overlay-043-5
status: blocked
reviewed_task: onlypreview-cold-folders-native-search-overlay-043
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-closure-review
supersedes_review: onlypreview-cold-folders-native-search-overlay-043-4
---

# onlypreview-cold-folders-native-search-overlay-043 — Review 5

- Result: **FAIL (BLOCKED)**
- Scope: Review 4 wildcard-reinclusion closure, the ordered-glob token automaton's semantic and
  operation bounds, real traversal/watch/Browse/SQLite policy integration, and focused regression
  of task 043's already accepted cold-directory and topmost native Global Search contracts.
- Excluded as unrelated concurrent work: `tests/indexing/`, tmp/benchmark documents,
  indexing-plan/benchmark documents and tasks, and unrelated `package.json`/`.gitignore` hunks.
  No such change was reviewed or modified.
- E2E/live app: intentionally not run. Electron, Playwright, packaged smoke, and the real
  application remain excluded by the task contract.

## Findings

### P2 — blocking performance: the finite matcher still exceeds the supported rules × workspace budget

The token automaton removes the old exponential regex backtracking, but the production predicate is
still linear in every non-skipped rule, every active token state, and every path character:
`compileGlobMatcher()` advances all active states per character
(`src/preload/onlypreview/search/core/glob-config.mjs:127-217`), while `orderedGlobState()` scans up
to every rule for every candidate path (`glob-config.mjs:249-257`). The public config accepts 1,024
globs and 256 KiB (`src/preload/onlypreview/search/core/workspace-config.mjs:11,38-52`), so this is
not an out-of-contract input.

A bounded production-path probe, with compilation excluded from timing, measured:

```text
1,024 rules `**/never-N`, 100 evaluations: 212.278 ms (2.123 ms/path)
900 rules with 20 repeated `**/`, 10 evaluations: 107.436 ms (10.744 ms/path)
```

At the issue's observed roughly 63,646-entry workspace scale
(`docs/issues/onlypreview-cold-folder-search-and-native-search-overlay.md:26-32`), even the first
case linearly projects to about 135 seconds for one policy pass before filesystem and SQLite work.
Search startup performs policy checks across the traversal, so this does not satisfy the accepted
repair's requirement to stop sustained CPU/rebuild pressure (`...native-search-overlay.md:49-51,66-68`).

The regressions at `tests/onlypreview/onlyPreviewSearchPolicy.test.mjs:136-194` prove at most one
matcher call per rule and a finite bound for one adversarial rule, but they do not cover the supported
1,024-rule × large-workspace product. Acceptance needs a bounded aggregate strategy (for example,
shared rule-prefix/state dispatch) or a validated supported-input budget that keeps a full policy
pass within the indexing slice/CPU contract.

### P2 — blocking performance: a later re-exclude can cancel an include while the whole excluded subtree remains traversable

`canOrderedGlobReincludeDescendant()` returns on the first later include whose language can reach a
descendant (`src/preload/onlypreview/search/core/glob-config.mjs:264-282`); it does not account for a
subsequent exclude that completely covers that include. For example:

```text
exclude: ['foo', '!foo/**/keep/**', 'foo/**/keep/**']
```

The last rule means no descendant under `foo` is finally eligible, yet the predicate returns `true`
for `foo`, `foo/a`, and deeper ancestors until a `keep` segment is reached. A bounded temporary-tree
probe over `foo/a/b/c/file.txt` emitted no eligible file, but `excludedEntryCount` rose from 1 with
the exact `foo` exclusion to 5 with the canceled include pair. Source inspection shows why: full
traversal recursively performs `opendir`, then directory `lstat` and `realpath` whenever that
predicate says traversal is possible (`src/preload/onlypreview/search/core/traversal.mjs:189-268`).

The same shared policy makes such paths not *definitely* physically excluded for watch partitioning
(`src/preload/onlypreview/search/core/watch-reconciler.mjs:49-51`) and prevents Browse from carrying
the ancestor-blocked fast path (`src/preload/onlypreview/search/core/browse-index.mjs:153-169`). Thus
a fully canceled re-inclusion can restore excluded-tree stat/reconcile churn, contrary to task 043's
pre-stat physical-exclusion boundary
(`docs/plan/tasks/onlypreview-cold-folders-native-search-overlay-043.md:35-37`). The current partial
later-reexclude regression (`tests/onlypreview/onlyPreviewSearchPolicy.test.mjs:242-263,265-390`)
keeps other eligible branches, so it does not exercise complete language cancellation.

No P1 or P3 finding was found.

## Review 4 finding closure

- **P2 wildcard descendant false negatives: closed.** `couldMatchDescendant()` now evaluates the
  compiled token language rather than a one-way literal-prefix heuristic. Generated and targeted
  comparisons cover `*`, `?`, embedded `**`, `**/`, terminal `/**`, non-empty descendant suffixes,
  line terminators, and Unicode without a mismatch against the existing regex semantics.
- Production ordered state now uses `matchesPathOrAncestor()`; `rule.regex` remains an oracle/test
  reference and is not called from the hot policy path. The old repeated-`**/` regex probe that grew
  from about 0.8 ms at four globstars to about 790 ms at eight and exceeded 10 seconds at twelve is
  therefore no longer reachable in production. The replacement stays within its explicit finite
  state-operation bound and retains no path cache.
- Real traversal, watch, Browse orange-marker inheritance, and SQLite Search regressions prove the
  wildcard-reincluded `keep` branches remain readable/searchable while siblings and a later partial
  `private/**` re-exclude remain excluded. The second finding above is the distinct complete-
  cancellation case.
- **Review 3 TS-1 closure remains valid.** The reviewed source and policy/boundary test files are all
  below 800 lines; no reviewed closure file introduces a TS-2 function declaration.

## Previously accepted task-043 contracts without additional regression

- Schema-7 provisional ancestors, schema-8 promotion, exact orphan cleanup, bounded watcher
  recovery, refresh `revokeResults()`, candidate-failure rollback, and queued-reader replacement
  remain green in focused tests.
- Global Search remains one Main-owned topmost child `WebContentsView` with shared clamped bounds,
  warm detach/reopen, correct attach ordering, context/reveal fences, focus restoration, crash
  isolation, exact teardown, and the previously reviewed sandbox/XPC/navigation security boundary.
- The automaton repair adds no filesystem, SQLite, Main, or Renderer I/O and retains no unbounded
  cache. The two findings concern aggregate CPU and avoidable traversal under supported policy input.

## Verification

| Check | Result |
| --- | --- |
| `node --test` over policy/contract/traversal/Browse/boundary/recovery/warm lifecycle and native Global Search view/shell/UI suites | **PASS — 77/77** |
| Generated automaton-vs-regex oracle | **PASS** — 240 targeted comparisons / 4,680 suffix candidates plus 605,120 exhaustive bounded comparisons |
| Repeated-globstar operation bound and child timeout | **PASS** — finite automaton; no old hot-path ReDoS |
| Wildcard traversal/watch/Browse/SQLite, sibling, and partial later re-exclude integration | **PASS** |
| Supported aggregate-rule benchmark | **FAIL budget** — 2.123 ms/path at 1,024 simple rules; 10.744 ms/path at 900 deep-globstar rules |
| Complete include/re-exclude cancellation probe | **FAIL boundary** — no eligible descendant, but the excluded subtree is still recursively traversed |
| File-size/style audit | **PASS** — glob policy 283; policy test 536; boundary test 738; traversal test 414; Browse test 303; warm lifecycle 771; all ≤800 |
| `git diff --check` | **PASS** |
| Electron / Playwright / E2E / packaged smoke / real app | Not run, as required |

## Conclusion

**FAIL / BLOCKED.** Review 4's wildcard false negative and the prior hot-regex ReDoS are closed,
and the automaton is semantically equivalent, finite, cache-free, and integrated across the shared
policy. Final task-043 acceptance remains blocked by two supported-input performance failures: the
rules × workspace product remains large enough for sustained CPU, and a completely canceled later
re-inclusion still opens/stat-walks an otherwise wholly excluded subtree. Repair both cases and add
aggregate-budget plus complete-cancellation regressions before final acceptance.
