---
id: onlypreview-cold-folders-native-search-overlay-043-10
status: passed
reviewed_task: onlypreview-cold-folders-native-search-overlay-043
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-closure-review
supersedes_review: onlypreview-cold-folders-native-search-overlay-043-9
---

# onlypreview-cold-folders-native-search-overlay-043 — Review 10

- Result: **PASS**
- Scope: Review 9 resource-ledger closure, ordered union containment semantics, budget exhaustion,
  maximum configurations, physical-exclusion I/O, differential coverage, cold folder results,
  native Global Search layering, and three-branch search concurrency.
- Excluded as unrelated concurrent work: indexing benchmark/plan/package/`.gitignore` and
  Claude-subscription changes. No production or test code was modified.
- Electron, Playwright, E2E, packaged smoke, and the real app were not run, as required.

## Findings

No P1, P2, or P3 finding remains.

## Review 9 closure: single non-refundable containment ledger

- One `coverageBudget` is created before the reverse ordered-rule scan and passed to every union
  comparison in that `canOrderedGlobReincludeDescendant()` invocation
  (`src/preload/onlypreview/search/core/glob-config.mjs:734,759-766`). It is never reset or refunded.
- The initial language-count reserve precedes the exclude/token-count scan. The subsequent
  language-plus-token reserve precedes creation of `[include, ...excludes]` and funds that array
  plus the constraint scan (`glob-config.mjs:605-617`).
- The conservative constraint-bound upper limit reserves Set entries, spread/flat-map slots, and
  both representative objects per possible retained length before
  `descendantSegmentRepresentatives()` constructs them (`glob-config.mjs:618-620`). The upper bound
  deliberately overcharges duplicates and invalid boundary zeroes; it never undercharges retained
  representatives.
- Prefix transition work, both active/next typed buffers for every language, product objects,
  fixed-width initial key parts/string, queue slot, and visited entry are reserved before initial
  continuation/product construction (`glob-config.mjs:621-637`). This also covers the empty-prefix
  case, where prefix transition cost is zero but buffers/product/key remain charged.
- Each transition reserves matcher work, next typed arrays, maps/scans, and composite state before
  constructing `next`; only states that need serialization then reserve the fixed-width parts,
  joined string, queue slot, and visited entry before key allocation/insertion
  (`glob-config.mjs:638-656`). Duplicate keys remain non-refundable, preserving the hard bound.
- Product keys use a pre-sized array with one constant-width character per active state plus fixed
  separators, followed by one `join('')` (`glob-config.mjs:546-562`). There is no incremental string
  concatenation, rope chain, or quadratic reserialization.
- `spendCoverageBudget()` sets remaining work to zero on an insufficient reservation and returns
  `false` (`glob-config.mjs:537-544`). Union coverage therefore fails open; the outer reachability
  path returns `true` when the include can match, never falsely pruning an uncertain subtree.

No remaining work or allocation proportional to rule/language count, token count, representative
count, product-state count, or state-key width was found outside a preceding reservation. Scalar
property checks and fixed local-object construction are covered by the associated constant/product
reserves.

## Semantics, performance, and I/O evidence

- Strict superset and union cancellation both return `false` for directory `a`; exact union
  coverage from the empty prefix also returns `false`. The bounded descendant oracle finds no
  eligible path.
- Partial coverage returns `true` with witness `a/aaa`; reverse newline ordering returns `true` with
  witness `a/\n/bb`.
- The 1,024-rule fully covered union exhausts the ledger before product expansion and returns the
  required conservative `true`. An independent probe compiled in 12.333 ms and completed 2,000
  calls in 117.219 ms (0.0586 ms/call). The existing 1,024-rule depth-32 line maximum remains
  bounded; no secondary hotspot was found.
- The strict/union traversal regression chmods the excluded directory unreadable and remains
  identical to baseline `['*']`: no content-read candidates, no yielded descendant paths, one
  excluded entry, and zero unreadable entries
  (`tests/onlypreview/onlyPreviewSearchPolicyContainment.test.mjs:96-143`).
- Generated wildcard differential/oracle coverage plus the directed strict, union, empty-prefix,
  partial, ordinary, and newline cases all pass.

## Task-043 regression

- Focused non-Electron tests pass schema-7 provisional folder streaming, schema-8 replacement,
  watcher recovery/exclusion, warm lifecycle, and token replacement.
- Native Global Search remains the Main-owned topmost child `WebContentsView`, sharing Preview
  bounds and attach order above Chrome/PDF, with warm reuse, context/reveal/focus fences, crash
  isolation, teardown, and trusted preload/XPC boundaries intact.
- Priority, Files/Folder, and Contents remain three live sibling promises started before their
  `Promise.allSettled()` join
  (`src/preload/onlypreview/search/core/global-search-executor.mjs:195-263`). Files and Folder remain
  one metadata loop with stable in-memory partitioning
  (`src/preload/onlypreview/search/core/global-search-files.mjs:59-85`).
- Reviewed files remain within the 800-line limit: `glob-config.mjs` 778,
  `onlyPreviewSearchPolicy.test.mjs` 776, and containment test 165.

## Verification

| Check | Result |
| --- | --- |
| Focused policy/containment, engine, recovery, warm lifecycle, native Search view/shell/UI suites | **PASS — 74/74** |
| Strict/union/empty-prefix cancellation | **PASS** |
| Partial and reverse-newline concrete witnesses | **PASS** |
| Single non-refundable 16,384 ledger and pre-allocation reserves | **PASS** |
| Fixed-width product key / no rope or quadratic concatenation | **PASS** |
| 1,024-rule union exhaustion and maximum performance | **PASS** — 0.0586 ms/call |
| Covered-subtree descendant-I/O boundary | **PASS** |
| Differential/oracle | **PASS** |
| Cold folder/native Search/concurrency regression | **PASS** |
| File-size/style audit and `git diff --check` | **PASS** |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**PASS.** Review 9's resource-accounting P2 is closed. Ordered strict/union containment is exact for
the accepted cases, uncertain maximum products fail open inside one shared non-refundable budget,
and every scale-dependent construction is reserved before allocation. Performance, no-descendant-
I/O, cold folder, native topmost Search, and concurrent priority/Files+Folder/Contents contracts
show no regression. Task 043 has no remaining P1, P2, or P3 blocker in the reviewed scope.
