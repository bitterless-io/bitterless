---
id: onlypreview-cold-folders-native-search-overlay-043-6
status: blocked
reviewed_task: onlypreview-cold-folders-native-search-overlay-043
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-closure-review
supersedes_review: onlypreview-cold-folders-native-search-overlay-043-5
---

# onlypreview-cold-folders-native-search-overlay-043 — Review 6

- Result: **FAIL (BLOCKED)**
- Scope: closure of Review 5's anchored-rule and canceled-reinclude findings, plus the required
  legal maximum-config audit for rules with no mandatory literal anchor and focused task-043
  cold-directory/native Global Search regression.
- Excluded as unrelated concurrent work: `tests/indexing/`, tmp/benchmark documents,
  indexing-plan/benchmark documents and tasks, and unrelated `package.json`/`.gitignore` hunks.
  No such change was reviewed or modified.
- E2E/live app: intentionally not run. Electron, Playwright, packaged smoke, and the real
  application remain excluded by the task contract.

## Findings

### P2 — blocking performance: a legal 1,024-rule anchorless config still costs about 18 ms per path

The new mandatory-literal fast path skips anchored nonmatches, but it cannot help legal patterns
made only from wildcard and separator tokens. `orderedGlobState()` still invokes every such rule
(`src/preload/onlypreview/search/core/glob-config.mjs:277-289`), and each invocation advances all
active automaton states per path character (`glob-config.mjs:141-232`). The workspace contract
accepts 1,024 globs and a 256 KiB config
(`src/preload/onlypreview/search/core/workspace-config.mjs:11,38-52`).

A bounded child-process probe generated 1,024 distinct patterns as follows:

```js
Array.from({ length: 1_024 }, (_, value) =>
  Array.from({ length: 10 }, (_, bit) => ((value >> bit) & 1 ? '**/' : '*/')).join('') + '??'
)
```

The patterns total 27,648 bytes before YAML indentation/newlines, every
`mandatoryLiteralAnchor` is empty, and all are valid under the existing config limits. The probe
evaluated the 59-character path produced by 30 one-character `a` segments; every rule reaches the
final nonmatching `??`, so there is no early ordered match. Under a 5-second child timeout it
reported:

```text
rules: 1024
anchors: 0
compile: 10.786 ms
10 production predicate evaluations: 181.024 ms
per path: 18.102 ms
state operations in the last path evaluation: 1,790,567
```

This is finite and non-exponential, but at the issue's observed roughly 63,646-entry workspace
(`docs/issues/onlypreview-cold-folder-search-and-native-search-overlay.md:26-32`) it linearly
projects to about 19.2 minutes for one policy pass before filesystem and SQLite work. It therefore
still violates the accepted repair's goal of preventing sustained Search CPU/rebuild pressure
(`...native-search-overlay.md:49-51,66-68`).

The new maximum-rule regressions cover only anchored patterns and explicitly expect zero matcher
calls (`tests/onlypreview/onlyPreviewSearchPolicy.test.mjs:136-188`). Add this anchorless maximum
case under a child timeout/operation budget, then provide aggregate rule dispatch/shared-state
evaluation (or an equivalent contract-backed bound) that avoids rules × states × path work for a
supported configuration.

No P1 or P3 finding was found.

## Review 5 finding closure

- **P2 anchored maximum-rule cost: closed for the reported fixtures.** The longest mandatory
  literal anchor is compiled once (`glob-config.mjs:22-34,236-267`) and checked before the matcher
  (`glob-config.mjs:277-285`). Independent production-path probes recorded zero matcher calls:
  1,024 `**/never-N` rules took 2.088 ms for 100 paths (0.0209 ms/path), and 900 rules with twenty
  repeated `**/` segments took 0.983 ms for 100 paths (0.0098 ms/path). The remaining finding is the
  distinct no-anchor supported boundary above.
- **P2 identical include/re-exclude traversal: closed.** Compilation keeps only the last rule for
  each normalized-identical pattern while preserving the order of retained rules
  (`glob-config.mjs:236-268`). This is semantically valid across interleaving: an earlier identical
  language matches exactly the same current/ancestor candidates, so a later identical rule always
  supersedes it when it could affect ordered state; when it does not match, neither does the removed
  rule. Normalization covers leading `/`, `./`, and separator conversion before the identity key.
- The exact sequence `foo`, `!foo/**/keep/**`, `foo/**/keep/**` now compiles away the canceled
  include. Its traversal result is byte-for-byte equivalent to the single `foo` exclusion while the
  directory is mode `000`: no content candidate, no published path, one excluded root entry, zero
  unreadable entries, and no descendant `opendir`/`lstat`/`realpath`
  (`tests/onlypreview/onlyPreviewSearchPolicy.test.mjs:190-254`). A non-identical partial
  `foo/**/keep/private/**` re-exclude still leaves the ordinary `keep` branch reachable and its
  private descendant excluded; traversal/watch/Browse/SQLite integration remains green
  (`onlyPreviewSearchPolicy.test.mjs:202-210,330-486`).

## Retained semantic and task-043 regression evidence

- Production ordered state calls only the bounded token matcher; `rule.regex` is retained solely
  for test/oracle comparisons. Source search found no production `.regex.test()` hot path and no
  retained path cache.
- Focused policy tests retain automaton-vs-regex coverage for `*`, `?`, embedded `**`, `**/`,
  terminal `/**`, ordered include/re-exclude, newline/line-separator behavior, Unicode, and valid
  non-empty descendant suffixes. The finite repeated-globstar operation bound and child timeout
  remain green.
- Schema-7 provisional directory ancestors, schema-8 promotion, exact orphan cleanup, bounded watch
  recovery, refresh token revocation, candidate-failure rollback, and queued-reader replacement
  remain green.
- Global Search remains one Main-owned topmost child `WebContentsView` with shared bounds, attach
  ordering, warm detach/reopen, context/reveal fences, focus restoration, crash isolation, teardown,
  and the previously accepted sandbox/XPC/navigation boundary.
- No reviewed source or focused test file exceeds 800 lines, and no reviewed closure file adds a
  TS-2 function declaration.

## Verification

| Check | Result |
| --- | --- |
| Focused non-Electron task-043 policy/engine/Browse/recovery/warm lifecycle and native Search view/shell/UI suites | **PASS — 80/80** |
| Review 5 anchored 1,024/900-rule fixtures | **PASS** — zero matcher calls; 0.0209 / 0.0098 ms per path |
| Normalized-identical last-wins and exact canceled traversal | **PASS** — ordered semantics retained; descendant traversal I/O pruned |
| Partial later re-exclude traversal/watch/Browse/SQLite | **PASS** |
| Legal 1,024-rule no-anchor child probe | **FAIL budget** — 18.102 ms/path; 1,790,567 state operations/path |
| Regex hot-path/cache audit | **PASS** — bounded automaton only; no retained path cache |
| File-size/style audit | **PASS** — glob policy 314; policy test 624; boundary 738; traversal 414; Browse 303; warm lifecycle 771; all ≤800 |
| `git diff --check` | **PASS** |
| Electron / Playwright / E2E / packaged smoke / real app | Not run, as required |

## Conclusion

**FAIL / BLOCKED.** Both concrete Review 5 findings are closed: anchored maximum-rule fixtures now
skip every matcher, and an identical later re-exclude removes the canceled include before any
descendant traversal. Final task-043 acceptance remains blocked by one P2 supported-boundary case:
1,024 distinct wildcard-only rules contain no mandatory anchor and still multiply rule count,
automaton states, and path length into sustained CPU at the documented workspace scale. Repair and
regress that legal maximum configuration before the next closure review.
