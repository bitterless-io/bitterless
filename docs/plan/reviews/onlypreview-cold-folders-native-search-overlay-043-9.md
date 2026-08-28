---
id: onlypreview-cold-folders-native-search-overlay-043-9
status: blocked
reviewed_task: onlypreview-cold-folders-native-search-overlay-043
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-closure-review
supersedes_review: onlypreview-cold-folders-native-search-overlay-043-8
---

# onlypreview-cold-folders-native-search-overlay-043 — Review 9

- Result: **FAIL (BLOCKED)**
- Scope: Review 8 union-containment closure, global bounded-work accounting, maximum legal
  configurations, physical-exclusion I/O, semantic differential, cold folder results, native
  Global Search layering, and three-branch search concurrency.
- Excluded as unrelated concurrent work: indexing benchmark/plan/package/`.gitignore` and
  Claude-subscription changes. No production or test code was modified.
- Electron, Playwright, E2E, packaged smoke, and the real app were not run, as required.

## Findings

### P2 — blocking resource bound: union containment allocates uncharged representative and initial-state memory

The new product search shares one `coverageBudget` across the whole
`canOrderedGlobReincludeDescendant()` call
(`src/preload/onlypreview/search/core/glob-config.mjs:718,743-750`), but the budget does not account
for every operation/allocation required by the Review 9 contract:

- `descendantSegmentRepresentatives()` builds a `Set`, iterates every language/token constraint,
  then materializes two representative objects per retained length before any budget debit
  (`glob-config.mjs:557-575,588-600`). The later `transitionCost` check bounds future transitions;
  it does not charge the already-created set/array/objects.
- `initializationCost` charges only `existingSegmentCount * tokenCount`. The guard additionally
  compares `tokenCount * 2`, but only `initializationCost` is subtracted
  (`glob-config.mjs:593-605`). The include/exclude continuation arrays are then allocated by
  `beginFullSegmentContinuation()` and `excludes.map()` without charging their initial state size
  (`glob-config.mjs:606-612`). With an empty path, initialization is charged as zero.
- The initial queue entry, initial composite state-key string, and initial `visited` entry are
  allocated without a debit (`glob-config.mjs:613-618`). Each later transition charges
  `tokenCount`, but composite state-key construction and insertion into `visited` are not separately
  represented in the budget (`glob-config.mjs:625-640`).

The algorithm is finite under the configuration limits and current maximum probes are fast, but
the asserted 16,384 ceiling is not a complete operation/memory bound. A legal call can allocate
data proportional to all later languages and their distinct constraint boundaries before it
discovers that the transition product exceeds the remaining budget. This directly fails the
Review 9 acceptance requirement that initialization, representatives, transitions, visited-state
keys, and their memory scale all consume the single global budget. Debit or preflight these costs
before allocation; on insufficient budget return the existing conservative `false` coverage result
without constructing the product.

No P1 or P3 finding was found.

## Review 8 closure and semantic evidence

- **Strict and union containment: closed.** `['*','!**/*/??','**/*/?*']` and
  `['*','!**/??*','**/??','**/???*']` both return `false` for directory `a`; the bounded descendant
  oracle finds no eligible path.
- **Partial and reverse witnesses preserved.** `['*','!**/??*','**/??']` returns `true` with witness
  `a/aaa`; `['*','!**/*/??','*/**/??']` returns `true` with newline witness `a/\n/bb`.
- **No descendant I/O for covered cases.** The new containment test chmods the excluded directory
  unreadable and proves strict/union configurations are identical to baseline `['*']`: no content
  candidates, no yielded paths, one excluded entry, and zero unreadable entries
  (`tests/onlypreview/onlyPreviewSearchPolicyContainment.test.mjs:69-116`).
- **Differential/oracle:** the generated policy oracle and the new exact containment oracle pass.
  The production matcher agrees on strict cancellation, union cancellation, partial coverage, and
  ordinary/newline witnesses.

## Performance and task-043 regression

- The 1,024-rule depth-32 newline maximum remains within its bounded child test. Review 8's
  0.0355 ms/path result remains representative; no second hotspot was introduced there.
- An independent 1,024-rule later-union probe (1 include plus 1,022 excludes) compiled in
  28.675 ms and completed 2,000 reachability calls in 218.633 ms (0.1093 ms/call), returning the
  required conservative `true` after bounded exhaustion. This is not a sustained CPU regression;
  the blocker is incomplete accounting of pre-transition allocations.
- Focused non-Electron tests pass schema-7 provisional folder streaming, schema-8 replacement,
  watcher/recovery, warm lifecycle, and native topmost Search view bounds/attach order above raw
  PDF/Chrome Preview.
- Priority, Files/Folder, and Contents remain three live sibling promises joined only after all
  start (`src/preload/onlypreview/search/core/global-search-executor.mjs:195-263`). Files and Folder
  remain one stable-partition metadata loop
  (`src/preload/onlypreview/search/core/global-search-files.mjs:59-85`), avoiding duplicate scans.
- Reviewed policy files remain within the 800-line limit: `glob-config.mjs` 762,
  `onlyPreviewSearchPolicy.test.mjs` 776, and the new containment test 138.

## Verification

| Check | Result |
| --- | --- |
| Focused policy/containment, engine, recovery, warm lifecycle, native Search view/shell/UI suites | **PASS — 73/73** |
| Strict superset and later-exclude union cancellation | **PASS** |
| Partial union and reverse-newline concrete witnesses | **PASS** |
| Covered-subtree descendant-I/O boundary | **PASS** |
| Generated and directed semantic oracle | **PASS** |
| 1,024-rule line maximum | **PASS** |
| 1,024-rule union maximum | **PASS** — 0.1093 ms/call across 2,000 calls |
| Complete 16,384 operation/memory accounting | **FAIL** — representatives and initial product state allocate before debit |
| Cold folder/native Search/concurrency regression | **PASS** |
| File-size/style audit and `git diff --check` | **PASS** |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**FAIL / BLOCKED.** Review 8's semantic P2 is closed: strict and union-covered reincludes prune
exactly, partial/reverse witnesses remain reachable, and covered directories perform no descendant
I/O. Maximum probes are fast, while cold folders, topmost native Search, and three-way concurrent
search remain intact. Final acceptance is still blocked because the advertised single-call 16,384
budget omits representative construction and initial queue/continuation/visited/state-key memory,
so it is not yet the complete bounded resource contract required by Review 9.
