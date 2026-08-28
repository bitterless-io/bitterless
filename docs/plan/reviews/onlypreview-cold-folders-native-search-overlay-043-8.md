---
id: onlypreview-cold-folders-native-search-overlay-043-8
status: blocked
reviewed_task: onlypreview-cold-folders-native-search-overlay-043
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-closure-review
supersedes_review: onlypreview-cold-folders-native-search-overlay-043-7
---

# onlypreview-cold-folders-native-search-overlay-043 — Review 8

- Result: **FAIL (BLOCKED)**
- Scope: Review 7 closure, ordered descendant-language containment and its global operation budget,
  maximum legal line-sensitive configuration, physically excluded traversal, cold folder results,
  native Global Search layering, and three-branch Global Search concurrency.
- Excluded as unrelated concurrent work: `tests/indexing/`, indexing benchmark/plan work,
  package/`.gitignore` changes, and Claude-subscription work. None was modified or reviewed.
- Electron, Playwright, E2E, packaged smoke, and the real application were not run, as required.

## Findings

### P2 — blocking performance: later excludes that cover a different full-segment language do not prune the subtree

`canOrderedGlobReincludeDescendant()` stores later excludes by exact `ordinaryKey` and compares an
include only with excludes in that same bucket
(`src/preload/onlypreview/search/core/glob-config.mjs:707-733`). This correctly closes Review 7's
canonical-equivalent raw-different examples, but it is not equivalent to the final ordered
include-minus-all-later-excludes language. A later exclude can strictly contain the include while
having a different key, or several later excludes can cover the include as a union.

Two independent exact probes from directory `a` reproduced the false capability:

```text
patterns: ['*', '!**/*/??', '**/*/?*']
canOrderedGlobReincludeDescendant('a'): true
bounded descendant oracle witness: false

patterns: ['*', '!**/??*', '**/??', '**/???*']
canOrderedGlobReincludeDescendant('a'): true
bounded descendant oracle witness: false
```

In the first case `**/*/?*` contains every descendant matched by `**/*/??`. In the second, the
later exact-length-two and minimum-length-three languages jointly cover the earlier
minimum-length-two include. The oracle enumerated one- and two-level descendants over ordinary
lengths 1/2/3 and newline lengths 1/2; every candidate remained finally excluded. These examples
do not depend on budget exhaustion.

Returning `true` prevents the shared physical-exclusion policy from pruning `a` before descendant
filesystem work. That violates the task's pre-stat excluded-path contract
(`docs/plan/tasks/onlypreview-cold-folders-native-search-overlay-043.md:35-37`). The existing
zero-I/O regression proves only identical/canonical cancellation
(`tests/onlypreview/onlyPreviewSearchPolicy.test.mjs:300-384`) and does not cover strict language
containment or union coverage. Descendant reachability must account for coverage by later ordered
languages without losing the global bounded-work/fail-open behavior.

No P1 or P3 finding was found.

## Review 7 closure and bounded-language evidence

- **Canonical-equivalent cancellation: closed.** Both raw-different cases now return `false`, and
  their final ordered state excludes all probes. The reverse ordering still returns `true` and has
  the concrete witness `a/\n/bb` (`onlyPreviewSearchPolicy.test.mjs:300-336`).
- **Global containment budget: correct shape.** One `{ remaining: 16_384 }` object is created per
  `canOrderedGlobReincludeDescendant()` invocation before the reverse rule scan and is shared by
  every containment comparison (`glob-config.mjs:694,719-728`). Exhaustion breaks comparison and
  leaves the include uncovered, conservatively allowing traversal rather than falsely pruning it.
- **Semantic differential/oracle:** the focused policy suite's generated wildcard descendant
  oracle passed, and direct ordinary/newline forward/reverse probes agreed for the Review 7 cases.
  The new finding above is the additional strict-containment/union differential that failed.
- **Depth-32 legal maximum: closed.** An independent probe compiled 1,024 patterns totaling 70,656
  bytes, using 31 prefix segments and newline-only path segments. Compile took 33.364 ms; 2,000
  production predicate evaluations took 70.992 ms (0.0355 ms/path), versus Review 7's
  1.265 ms/path. The bounded child regression also passes.
- The hot ordered predicate uses the bounded segment matcher, not regex evaluation; reviewed files
  retain no unbounded per-path cache. The policy implementation and relevant test files remain
  within the 800-line limit (`glob-config.mjs` 744; policy test 776).

## Task-043 regression and concurrency

- The focused non-Electron suites pass the schema-7 provisional folder upgrade, schema-8
  replacement, recovery/watch behavior, and warm lifecycle. The canonical canceled-exclude test
  also proves zero descendant reads for the cases it covers. The finding shows that guarantee is
  incomplete for other valid ordered languages.
- Native Global Search remains a Main-owned child `WebContentsView` with shared Preview bounds,
  re-raise ordering above PDF/Chrome Preview, warm reuse, focus/context/reveal fences, teardown,
  and the existing trusted preload/XPC boundary; its view/shell/UI focused tests passed.
- Priority, Files/Folder, and Contents are constructed as three live sibling promises before one
  `Promise.allSettled()` join
  (`src/preload/onlypreview/search/core/global-search-executor.mjs:195-263`). The focused engine
  tests prove cooperative start and that a slow priority lane does not serialize ordinary results.
- Files and Folder correctly share one metadata pass: one loop partitions directory and file
  authorities in memory (`src/preload/onlypreview/search/core/global-search-files.mjs:59-85`). A
  second tree pass would duplicate work without improving concurrency because Contents already
  owns the independent SQLite branch.

## Verification

| Check | Result |
| --- | --- |
| Focused policy, Global Search engine, recovery, warm lifecycle, native Search view/shell/UI suites | **PASS — 70/70** |
| Review 7 canonical forward cancellation and reverse witness | **PASS** |
| Strict-containment and union ordered-language differential | **FAIL** — no eligible descendant, capability returned `true` |
| Shared 16,384-operation containment budget source audit | **PASS** — per invocation, conservative on exhaustion |
| 1,024-rule depth-32 newline maximum | **PASS** — 33.364 ms compile; 70.992 ms/2,000 evaluations |
| Cold provisional folders and Search-over-PDF contracts | **PASS** |
| Priority + Files/Folder + Contents concurrency; single metadata pass | **PASS** |
| File-size/style audit | **PASS** — reviewed source/test files ≤800 lines |
| `git diff --check` | **PASS** |
| Electron / Playwright / E2E / real app | Not run, as required |

## Conclusion

**FAIL / BLOCKED.** Review 7's two reported blockers are closed: canonical-equivalent ordering is
correct and the legal depth-32 maximum is fast. The containment budget is global per reachability
call and fails open safely; cold folders, native Search layering, and three-way search concurrency
remain intact. Acceptance is nevertheless blocked because valid later excludes with a different
full-segment language key—or a union of later languages—can cover an include completely while the
production reachability predicate still authorizes descendant traversal and I/O.
