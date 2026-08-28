---
id: onlypreview-cold-folders-native-search-overlay-043-7
status: blocked
reviewed_task: onlypreview-cold-folders-native-search-overlay-043
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-closure-review
supersedes_review: onlypreview-cold-folders-native-search-overlay-043-6
---

# onlypreview-cold-folders-native-search-overlay-043 — Review 7

- Result: **FAIL (BLOCKED)**
- Scope: Review 6 closure through the full-segment matcher/canonical language dispatch,
  line-terminator semantics, required-sequence cache, descendant reachability, residual-state
  fail-fast, legal maximum configurations, and the new Global Search concurrency note. Cold
  schema-7 directories and the native topmost Search view were rechecked for regression.
- Excluded as unrelated concurrent work: `tests/indexing/`, indexing benchmark/plan documents and
  tasks, unrelated package/config changes, and concurrent Claude-subscription work. None was
  reviewed or modified.
- E2E/live app: intentionally not run. Electron, Playwright, packaged smoke, and the real
  application remain excluded by the task contract.

## Findings

### P2 — blocking performance: canonical-equivalent later excludes do not cancel descendant traversal

`compileOrderedGlobRules()` removes only normalized-text duplicates
(`src/preload/onlypreview/search/core/glob-config.mjs:354-397`). The concrete ordered matcher can
skip an earlier canonical-equivalent language while scanning in reverse
(`glob-config.mjs:513-555`), but `canOrderedGlobReincludeDescendant()` scans only later include
rules and never lets a later canonical-equivalent exclude cancel them
(`glob-config.mjs:562-595`). It therefore reports a possible descendant after the final ordered
language has excluded every such descendant.

Two direct examples reproduce the false-positive traversal capability from the ordinary directory
`a`:

```text
['*', '!**/**/??', '**/??']
include/exclude ordinary key: g>e2 / g>e2
include/exclude line key:     g>e2 / g>e2
canOrderedGlobReincludeDescendant('a'): true

['*', '!*/**/??', '**/*/??']
include/exclude ordinary key: m0,g>e2 / m0,g>e2
include/exclude line key:     m0,g>e2 / g,m0>e2
canOrderedGlobReincludeDescendant('a'): true
```

In both cases `a/bb`, `a/x/bb`, `a/x/y/bb`, `a/\n/bb`, and `a/\nX` remain finally excluded. In
the first case the two raw patterns are exactly the same canonical language; in the second, the
later rule covers the include language below the already ordinary `a` prefix even though their
line-terminator keys differ globally. Returning `true` makes the shared traversal policy recurse
into `a` and perform descendant `opendir`/`lstat`/`realpath`, and prevents watch from treating that
subtree as definitely physically excluded. This violates task 043's pre-stat exclusion boundary
(`docs/plan/tasks/onlypreview-cold-folders-native-search-overlay-043.md:35-37`).

The existing cancellation regression covers only normalized-identical raw text
(`tests/onlypreview/onlyPreviewSearchPolicy.test.mjs:294-358`). Add both canonical cases and make
descendant reachability account for the final ordered include-minus-later-exclude language, without
reintroducing an unbounded language-subtraction or subtree scan.

### P2 — blocking performance: the legal depth-32 line-terminator maximum still costs 1.265 ms per path

The ordinary maximum family from Review 6 is now fast, but line terminators select the uncollapsed
operator-order language (`glob-config.mjs:406-432,472-497`). A legal family can therefore keep
1,024 distinct full-segment languages alive through the reverse ordered scan
(`glob-config.mjs:513-545`) even though the required-sequence cache is shared.

A 5-second child-process probe used 1,024 distinct patterns with 31 prefix segments: the first ten
segments select `**/` or `*/` from the rule number, the remaining twenty-one are `*/`, and every
rule ends in `??`. The patterns total 70,656 bytes before small YAML overhead, below the 256 KiB and
1,024-rule limits. The path contains 31 newline-only directory segments plus the two-character
terminal `aa`: 32 segments and 64 characters, within the file projection's depth-32 boundary.

```text
compile: 25.143 ms
100 production predicate evaluations: 126.533 ms
per path: 1.265 ms
```

Only the first raw rule (all `*/`) matches; reverse last-wins evaluation therefore visits all 1,024
line-sensitive languages. At the issue's observed roughly 63,646 entries
(`docs/issues/onlypreview-cold-folder-search-and-native-search-overlay.md:26-32`), the measured
rate linearly projects to about 80.5 seconds for one policy pass before filesystem/SQLite work.
The workload is bounded and cooperative, but it remains sustained CPU under a fully legal config
and filesystem shape, contrary to the accepted repair
(`...native-search-overlay.md:49-51,66-68`).

The current maximum-topology test exercises an early nonmatch
(`tests/onlypreview/onlyPreviewSearchPolicy.test.mjs:224-240`); it does not force all line-sensitive
languages to the final matching rule. Add this exact bounded child probe and cap/share the
line-sensitive dispatch so evaluation does not return to rules × segments × language work.

No P1 or P3 finding was found.

## Review 6 closure and semantic evidence

- **Ordinary legal maximum: closed.** The prior 1,024-rule, 27,648-byte wildcard-only family now
  rejects through the terminal segment constraint with zero generic matcher calls
  (`glob-config.mjs:39-53,548-550`; policy test `:196-222`). An independent 100-path probe measured
  0.0291 ms/path. The second finding is specifically the legal line-terminator/operator-order path.
- **Full-segment semantic equivalence: passed.** A generated differential oracle compared 1,295
  patterns across 584 ordinary/newline/CR/U+2028/Unicode paths: 756,280 single-rule comparisons,
  64,000 ordered interleaving comparisons, and 262,537 descendant comparisons. The optimized
  matcher agreed with both the retained regex and generic token automaton in all 1,082,817 checks.
- Required constraint sequences remain a necessary-only prefilter and are cached once per sequence
  per path (`glob-config.mjs:443-449,525-535`). Path-dependent ordinary versus line-terminator keys
  preserve globstar/operator order; targeted source tests at
  `tests/onlypreview/onlyPreviewSearchPolicy.test.mjs:242-275` also pass.
- Anchorless patterns that cannot use full-segment dispatch have an aggregate 64-state compile-time
  fail-fast (`glob-config.mjs:372-383`), verified by
  `tests/onlypreview/onlyPreviewSearchPolicy.test.mjs:277-292`. Production ordered evaluation still
  has no regex hot path and retains no per-path cache.
- Normalized-identical include/re-exclude cancellation and its zero-descendant-I/O traversal proof
  remain green. The first finding is the distinct canonical-equivalent, raw-different case.

## Global Search concurrency and task-043 regression

- Priority, Files/Folder, and Contents are all started before the phase awaits completion:
  `global-search-executor.mjs:195-263` constructs the three live promises and then joins them with
  `Promise.allSettled()`. Files yields before scanning, Contents yields cooperatively, and a slow or
  retired priority lane does not serialize ordinary results. Focused tests at
  `tests/onlypreview/onlyPreviewGlobalSearchEngine.test.mjs:78-167` prove cooperative start,
  streaming, terminal join, and sibling cancellation.
- Files and Folder intentionally remain one metadata pass. The single loop in
  `src/preload/onlypreview/search/core/global-search-files.mjs:59-85` partitions directory and file
  matches in memory, then emits folder-first order. No second tree scan or duplicated metadata
  query was introduced.
- Schema-7 provisional directory ancestors, schema-8 promotion, exact orphan cleanup, watcher
  recovery/exclusion, refresh token revocation, and candidate-failure rollback remain green.
- Global Search remains one Main-owned topmost child `WebContentsView` with shared bounds, attach
  ordering, warm reuse, context/reveal fences, focus restoration, crash isolation, teardown, and
  the previously accepted sandbox/XPC/navigation boundary.
- All reviewed JS/MJS files remain below the 800-line TS-1 limit and introduce no TS-2 function
  declaration issue.

## Verification

| Check | Result |
| --- | --- |
| Focused non-Electron policy/engine/Browse/recovery/warm lifecycle and native Search view/shell/UI suites | **PASS — 97/97** |
| Full-segment/regex/token differential oracle | **PASS — 1,082,817 comparisons, zero mismatch** |
| Ordinary 1,024-rule maximum | **PASS** — 0.0291 ms/path; zero generic matcher calls |
| Residual anchorless 64-state fail-fast | **PASS** |
| Canonical-equivalent canceled descendant probes | **FAIL boundary** — final state excludes every probe, but traversal capability remains `true` |
| Depth-32 line-terminator maximum child probe | **FAIL budget** — 1.265 ms/path; about 80.5 seconds projected per 63,646-entry pass |
| Global Search three-branch concurrency and one Files/Folder metadata pass | **PASS** |
| File-size/style audit | **PASS** — glob policy 596; executor 501; Files 91; policy test 728; Global Search engine test 755; boundary 738; warm lifecycle 771; all ≤800 |
| `git diff --check` | **PASS** |
| Electron / Playwright / E2E / packaged smoke / real app | Not run, as required |

## Conclusion

**FAIL / BLOCKED.** Review 6's ordinary wildcard-only maximum is closed, the optimized matcher is
equivalent to the existing language contract, residual complexity fails fast, and task 043's cold
directory/native Search plus three-way Search concurrency remain intact. Final acceptance is still
blocked by two P2 cases: canonical-equivalent later excludes do not cancel descendant traversal,
and the legal maximum line-sensitive family sustains about 1.265 ms of policy CPU per path. Repair
and regress both before the next closure review.
