---
id: onlypreview-cold-folders-native-search-overlay-043-3
status: blocked
reviewed_task: onlypreview-cold-folders-native-search-overlay-043
target: working-tree
base: dev/next
date: 2026-08-28
review_type: independent-final-acceptance-review
supersedes_review: onlypreview-cold-folders-native-search-overlay-043-2
---

# onlypreview-cold-folders-native-search-overlay-043 — Review 3

- Result: **FAIL (BLOCKED)**
- Scope: final closure review of ordered exclusion/re-inclusion, shared traversal/watch/Browse
  policy, refresh result-capability revocation, and regression safety for the already reviewed
  task-043 native Global Search surface.
- Excluded as unrelated concurrent work: `tests/indexing/`, tmp/benchmark documents,
  `docs/design/onlypreview-indexing-throughput.md`,
  `docs/features/onlypreview-indexing-benchmark.md`, task 069, and unrelated
  `package.json`/`.gitignore` hunks. No such change was reviewed or modified.
- E2E/live app: intentionally not run. Electron, Playwright, packaged smoke, and the real
  application remain excluded by the task contract.

## Findings

### P2 — blocking performance: ordered-glob inheritance multiplies every hot-path predicate by directory depth

Task 043 exists in part because a roughly 63,646-entry workspace sustained expensive repeated
reconciles (`docs/issues/onlypreview-cold-folder-search-and-native-search-overlay.md:10-11,26-32`),
and its accepted repair must prevent excluded-path churn from restoring sustained CPU work
(`docs/issues/onlypreview-cold-folder-search-and-native-search-overlay.md:49-51,66-68`).

The semantic correction at `src/preload/onlypreview/search/core/glob-config.mjs:37-60` constructs a
new array containing the full path and every ancestor on each policy call, then runs
`candidates.some(rule.regex)` for every configured rule. This changes the hot predicate from one
regex test per rule to up to `depth + 1` tests per rule, plus repeated path slicing and allocation.
The public configuration accepts as many as 1,024 rules
(`src/preload/onlypreview/search/core/workspace-config.mjs:38-57`), and count, traversal, watch, and
Browse share this predicate.

A bounded in-process probe using the supported maximum of 1,024 non-matching rules and 2,000
eight-level paths took 424.8ms, 392.1ms, and 383.0ms over three warm passes. Linear projection to
the documented 63,646-entry workspace is about 12 seconds for one policy pass alone; full count and
candidate traversal repeat the work before filesystem and SQLite cost. A valid configuration can
therefore restore prolonged CPU-heavy startup/reconcile behavior even though the watch loop itself
is fixed.

Preserve the corrected ordered semantics while moving ancestor inheritance out of the inner
`rules × ancestors` loop—for example, precompile each rule to match the current path or an inherited
ancestor with one test, or use an equivalent bounded prefix matcher. Add a non-timing structural or
operation-count regression proving one bounded match per rule rather than per rule per ancestor.

### P3 — non-blocking maintainability (TS-1): boundary test exceeds the 800-line workspace limit

`tests/onlypreview/onlyPreviewSearchEngine.boundary.test.mjs:1-879` is now 879 lines. This violates
the workspace code-review rule TS-1 (all TS/JS files must remain at or below 800 lines). Split the
watch recovery and/or ordered exclusion scenarios into a focused sibling test file. This does not
block task behavior by itself, but should be resolved with the performance repair rather than
allowing the boundary suite to keep growing.

No P1 or additional P2/P3 finding was found.

## Review 2 blocker closure

- **Ordered re-inclusion sibling leak: closed.** `orderedGlobState()` at
  `src/preload/onlypreview/search/core/glob-config.mjs:51-65` applies each rule in order to the
  concrete path and its ancestors. With `excluded`, `!excluded/keep/**`, the `keep` branch returns
  normal while `drop` inherits exclusion; a later `excluded/keep/private/**` excludes that concrete
  branch again. Core/fixed exclusions remain non-overridable.
- Full traversal, incremental watch partitioning, SQLite projection, and Browse markers consume the
  same traversal policy. The focused integration proves `drop` causes no traversal/watch body read,
  never enters SQLite, remains orange in Browse, and emits only a bounded non-full watch commit;
  `keep` remains readable and searchable. Symlinks remain leaf-only and unsearchable.
- **Refresh/session lifecycle remains closed.** Public refresh still clears result capabilities via
  `globalSearchSession.revokeResults()` without invalidating the accepted request identity. The
  queued-reader/promotion and candidate-failure lifecycle tests remain green.

## Previously accepted contracts without regression

- Schema-7 provisional directories, schema-8 promotion, exact orphan cleanup, watch reattachment,
  and candidate-failure rollback retain the behavior accepted in Reviews 1 and 2.
- Global Search remains one Main-owned topmost child `WebContentsView` with shared clamped bounds,
  warm detach/reopen, attach-order restoration, strict context/reveal races, crash isolation,
  teardown, and the previously reviewed sandbox/XPC/navigation security boundary.
- The ordered-glob correction introduces no filesystem, SQLite, Main, or Renderer I/O and no
  Renderer-side ancestor scan; the remaining concern is CPU complexity inside the preload policy.

## Verification

| Check | Result |
| --- | --- |
| `node --test` over Search contract, traversal, Browse, boundary, warm lifecycle, and recovery suites | **PASS — 48/48** |
| Ordered-policy matrix: `excluded`, `!excluded/keep/**`, later `excluded/keep/private/**` | **PASS** — `keep` normal, `drop` physical, later `private` physical |
| 1,024-rule × 2,000 eight-level-path in-process predicate probe | **FAIL performance gate** — 424.8ms / 392.1ms / 383.0ms |
| `git diff --check` | **PASS** |
| Node/Renderer type checks and `yarn build` | Not independently rerun in Review 3; the coordinating run reports them green, but the source-level performance blocker remains |
| Electron / Playwright / E2E / packaged smoke / real app | Not run, as required |

## Conclusion

**FAIL / BLOCKED.** Review 2's ordered sibling correctness blocker is closed, and the refresh/session
fix remains sound. Final acceptance is blocked by one new P2: the corrected policy performs
`rules × depth` regex work and allocations for every Search/Browse path, which produces prolonged
CPU cost at the supported 1,024-rule boundary on the same project scale this task is intended to
protect. Restore one bounded match per rule while preserving the now-correct ordered semantics,
then re-run an independent closure review. The 879-line boundary test is also recorded as one
non-blocking TS-1 finding.
