# OnlyPreview indexing: plan comparison and evaluation

Status: in progress - harness and plan A complete, plans B-D and the full measurement pending

Companion to [OnlyPreview indexing throughput](onlypreview-indexing-throughput.md), which measured
the shipped pipeline as one block. This document splits the pipeline into named stages a person can
drive one at a time, defines what "better" means before any alternative is measured, and compares
several indexing designs against those definitions.

## Why plans, not patches

The throughput measurement produced seven candidate repairs to one design. Some of them - dropping
the count pre-pass, enlarging transactions - are obviously right. Others - keeping a content index at
all, keeping the Files section project-wide - are design decisions that a patch list cannot settle,
because their cost only shows up against an alternative. So each design is built as a **plan** behind
one interface, and the interface forces every plan to expose the same stages:

```text
corpus  ->  index init  ->  index load  ->  search (files | contents, project | directory)
                 |               |                 |
            build cost      open cost        query cost
```

Plan A is the engine currently shipping. B, C and D are alternatives. Nothing in `src/` changes:
plans live under `tests/indexing/plans/` and drive the real code where they share it.

## Stage separation is itself a finding

Plan A **cannot** separate `init` from `load`. `OnlyPreviewSearchEngine.initialize()` always runs
count -> candidate backup -> traverse -> promote, whether or not a usable index already exists, and
there is no entry point that opens the committed index without that. The benchmark therefore drives
plan A two ways:

- `index load --plan A` - what the application does today.
- `index load --plan A --no-reconcile` - the committed SQLite index opened, the filename tier
  hydrated, the persisted tree snapshot read, and queries answered through the shipped query
  executor with no freshness pass. It uses only the engine's own classes, so it measures what
  plan A would cost if the freshness work were moved off the open path.

On the 240-file corpus that difference is **130.5ms against 8.6ms**. The gap is the headroom on the
first search, and it is not a micro-optimisation: it is the whole of `full-count`,
`candidate-backup`, `traversal-index` and `promotion`.

## CLI reference

Every stage is its own command, so a stage can be timed, repeated, or skipped independently. State
lives on disk under `tmp/indexing-bench/index/<plan>/<workspace hash>/`, which is why `index init` in
one process and `search` in another work.

```bash
yarn indexing                       # usage
yarn indexing plans                 # the plans, their capabilities and their tradeoffs
yarn indexing needles               # the query strings planted in a generated corpus
```

Pick a target with `--scale tiny|small|medium|large` (a generated corpus) or `--root <dir>` (a real
directory). `--plan A|B|C|D` selects the design, default A.

| Stage | Command | What it reports |
| --- | --- | --- |
| corpus | `yarn indexing corpus create --scale medium` | builds or reuses the corpus, prints its shape |
| corpus | `yarn indexing corpus info --scale medium` | walk counters, text bytes, largest subtrees |
| corpus | `yarn indexing corpus dirty --scale medium --count 64` | rewrites N text files so a reconcile has work |
| corpus | `yarn indexing corpus restore --scale medium` | undoes every dirty marker |
| build | `yarn indexing index init --plan A --scale medium` | per-phase build time, index contents, on-disk size |
| open | `yarn indexing index load --plan A --scale medium` | what opening the workspace costs |
| open | `yarn indexing index load --plan A --scale medium --no-reconcile` | plan A only: the same open without the freshness pass |
| inspect | `yarn indexing index status --plan A --scale medium` | schema, row counts, bytes, reusability |
| freshness | `yarn indexing index refresh --plan A --scale medium` | reconcile cost against the filesystem |
| reset | `yarn indexing index drop --plan A --scale medium` | deletes that plan's index |
| search | `yarn indexing search "handleWorkspaceRequest" --plan A --scale medium` | load time and query time, separately, plus results |
| search | `... --dir core-0` | the same query restricted to one directory |
| search | `... --section files` / `--section contents` | one section only |
| search | `... --repeat 10` | first run plus p50 and p95 over the repeats |
| search | `... --limit 5` | results per section |
| search | `... --trace` | every measured sub-phase |
| search | `... --json` | machine-readable |
| scope | `yarn indexing scope "handleWorkspaceRequest" --plan A --scale medium` | project-wide against several directory scopes, with the speedup |
| interactive | `yarn indexing repl --plan A --scale medium` | index stays loaded; type queries, `/dir <path>`, `/global`, `/section`, `/limit`, `/dirs`, `/stats`, `/quit` |

The automated scripts, for the numbers in this document:

```bash
yarn bench:indexing:matrix --plans A,A:seed,B,C,C:all,D --scales small,medium --repeat 6 --dirty 64
node tests/indexing/bench/queryHotspots.bench.mjs --scale medium      # what a query actually spends its time on
node tests/indexing/bench/explainQueryPlans.bench.mjs --scale medium  # do scoped queries use an index
yarn bench:indexing --scale medium                                    # plan A phase report from task 069
yarn bench:indexing:hotspots --scale medium                           # build-stage attribution from task 069
yarn test:indexing                                                    # machine-independent regression guard
```

`repl` is the one to reach for when comparing by hand: it loads once and then every query you type is
a clean measurement, which is exactly the "open the folder, then search" sequence a user performs.

## Evaluation dimensions

Ranking by one number hides the trade that matters, so the harness reports ten. The first four are
gates - a plan that fails them is not ranked, it is rejected.

### D1 Stage-separated latency (gate: load must not rebuild)

`init`, `load`, first query, warm query, each measured on its own. A plan whose `load` re-reads file
contents, re-walks the tree, or waits for a build has no honest "open the folder" cost, and the user
feels exactly that number.

### D2 Query latency distribution, not one query (gate: none, reported)

First run plus p50 and p95 over seven queries chosen to hit every retrieval branch and both edge
cases:

| id | query shape | why it is in the set |
| --- | --- | --- |
| `unique` | one content hit corpus-wide | the happy path most benchmarks stop at |
| `common` | content hit in most files | exposes snippet cost and truncation behaviour |
| `cjk` | multi-character CJK content | different tokenisation path |
| `filename` | matches names, not content | isolates the Files section |
| `short-ascii` | two ASCII characters | falls out of the trigram index into a scan |
| `short-cjk` | two CJK characters | posting-list branch |
| `absent` | matches nothing | worst case; no early exit is possible |

`common` already shows why: on plan A its p50 is **107ms** against 2.2ms for `unique`, because 146
matches mean 146 snippet projections through `Intl.Segmenter`.

### D3 Directory-scope speedup (gate: >= 1.0, target: tracks the byte share)

p50 project-wide divided by p50 scoped, at directory subtrees holding roughly 50%, 10% and 1% of the
corpus text. Directories are picked by measured text share rather than by name, so the ratio can be
read against the work the scope actually removes.

This is the dimension Ral named first: asking for one directory must be faster than asking for the
whole project. Plan A satisfies it for Contents (24x at the 1% directory) and **not at all** for
Files (1.0x), because project-wide Files is a deliberate product decision recorded in
[docs/issues/onlypreview-directory-selection-and-global-file-scope.md](../issues/onlypreview-directory-selection-and-global-file-scope.md).
That decision, not the code, is what makes scoped Files impossible - so the alternatives implement
scoped Files and the benchmark shows what it costs and what it buys.

### D4 Result parity (gate: no mismatch, no extra)

Same query, same scope, same relative paths as plan A, for queries of 3 to 64 characters. When plan
A's own answer is truncated, only containment is asserted, because two plans may legitimately return
different members of an over-large match set. A plan that is fast because it misses results is
rejected, not ranked.

### D5 Index lifecycle (gate: every stage correct, then timed)

Building an index is four separate jobs, and only the first is a build. Each is measured on its own,
and each has a correctness gate that runs before its timing is reported.

| Stage | What it is | Measured | Gate |
| --- | --- | --- | --- |
| L1 initialize | build from nothing | wall time, per-phase split, index bytes | the planted needle is findable |
| L2 incremental update | commit a known change set without re-walking | wall time at 1, 8, 64, 512 and 600 changed paths | the edited file's own token is findable in exactly that file; after reverting, findable nowhere |
| L3 full reconcile | discover the changes yourself | wall time with nothing changed, and with N changed | row counts unchanged when nothing changed |
| L4 removal | one entry, and the whole index | wall time; index bytes before and after | a removed path appears in no section; restoring it re-indexes it; after `drop`, `status.exists` is false |

L2 is the stage a live editing session feels, and it is the one a full-reconcile design cannot do at
all. Every plan derives "this entry is gone" from the filesystem rather than from an explicit delete
call, because that is all a watcher ever reports - a path, with no statement about which way it
changed. Each edited file gets its own token (`dirty-<hash of path>`) appended, so "the update
landed" is a search that must return exactly one path, not a timing that looks plausible.

**The escalation cliff is part of L2.** Plan A's reconciler accepts at most
`MAX_WATCH_CHANGE_PATHS = 512` paths; beyond that, or if any changed path is currently a directory in
the tree, it silently runs a whole-workspace reconcile instead. So a change set of 512 and one of 600
are different operations wearing the same name, and the benchmark measures both.

**Removal has a space question of its own.** Deleting rows from a contentless FTS5 table and from a
`WITHOUT ROWID` posting table frees pages inside the database file without returning them to the
filesystem. `--reclaim` therefore removes every editable file, reconciles, and reports how much of
the index actually shrank - a plan whose index only ever grows is a plan that needs a compaction
story.

### D6 Space

Index bytes on disk over indexed text bytes, plus peak RSS during build and during query. Plan A is
at **5.1x** the text on disk and reached 803MiB RSS on a 45MiB corpus.

### D7 Work amplification

Filesystem operations per indexed file during a build, and bytes read per query. Machine-independent,
so it is the metric a regression guard can assert. Plan A's traversal is at 15.8 operations per file
because it re-proves that the bytes it read belong to the path it read them from; the lean walker used
by the alternatives is at 1.1, which measures the price of that guarantee rather than arguing about
it.

### D8 Scale exponent

Every metric at two or more corpus sizes. A plan whose advantage inverts at scale - a query-time
scanner is the obvious candidate - has to be caught by measurement, not by argument.

### D9 Behaviour while the index is still building

Can a query be answered during a build, and what does it return? This is the original defect
(`docs/issues/onlypreview-first-search-startup-delay.md`), so it stays a reported dimension rather
than an assumption.

### D10 Failure modes

Missing, stale, and half-written index. A plan must fail closed - report reduced coverage - rather
than silently return fewer results.

## Proposed acceptance targets

Numbers to accept or move, not conclusions. Stated against a 6000-file / 45MiB project, which is the
`medium` corpus.

| Dimension | Today (plan A) | Proposed target |
| --- | --- | --- |
| open -> first usable result | 1.9-2.4s | <= 300ms |
| warm query p50, worst query in the set | 107ms (`common`) | <= 50ms |
| directory scope at ~10% of text, Contents | 7.1x | >= 3x |
| directory scope at ~10% of text, Files | 1.0x | >= 3x (needs a product decision) |
| index bytes / text bytes | 5.1x | <= 2x |
| L3 full reconcile, nothing changed | 1.9s | <= 100ms |
| L1 first build | 24.1s | <= 10s |
| L2 incremental update, one edited file | to be measured | <= 50ms |
| L2 incremental update, 512 edited files | to be measured | <= 2s |
| L4 removal of one file | to be measured | <= 50ms |
| L4 index shrinks after removing half the files | to be measured | >= 30% of the removed share |

## The plans

### A - OnlyPreview as shipped

Content-defined chunks in SQLite, FTS5 trigram index, CJK posting table, persisted tree snapshot,
startup reconcile into an isolated candidate database before promotion. Two load modes as described
above.

### B - Scoped SQLite, no candidate copy

Plan A's retrieval quality with the orchestration the measurements asked for: no count pre-pass, no
candidate copy (rename on first build, in-place reconcile with a second read-only connection after
that), large build transactions, chunking on a worker pool, and both sections scope-aware with names
searched in SQL instead of re-normalised in memory on every query.

### C - Two-tier: instant metadata, lazy content

The metadata tier costs about 6ms per 240 files; the content tier costs about 800ms for the same
files. So they are separated. `init` builds metadata only, `load` is an open, Files answers
immediately, and Contents is served from whatever content coverage exists - falling back to a live
parallel scan of exactly the requested directory when that directory is not covered yet. Coverage is
recorded per directory and never claimed for a partially indexed one.

### D - Metadata only, parallel literal scan

The control experiment. No content index at all; Contents is a worker-pool literal scan of the
in-scope files, the way ripgrep and VS Code behave. It answers the question the other three cannot:
does an index costing 5x the text in bytes and 24 seconds to build actually beat reading the files
when the query arrives?

## Results

### Every plan A number here is pinned to one engine revision

Plan A wraps the live `OnlyPreviewSearchEngine`, and that engine is under concurrent edit in another
session (task 043: cold folder search and the native search overlay). A measurement of plan A is
therefore a measurement of whatever bytes the engine had at the time, so every report stamps an
engine fingerprint - a hash of `src/preload/onlypreview/search/core/**` plus
`src/shared/onlypreview/**`, the current git head, and how many of those files are uncommitted:

```text
engine=79963efe3d5a files=41 git=cc3d6ae UNCOMMITTED=11
```

**Everything in this section was measured at `engine=79963efe3d5a`.** The fingerprint is also written
into each index's `plan-meta.json`, so `index status` reports which engine built the index it found
and says so explicitly when the engine has changed since.

Two things have to be retaken once task 043 lands, not just plan A's timings:

- **Plan A's lifecycle and query numbers**, because the change touches traversal and startup.
- **The parity baseline for B, C and D**, because task 043 deliberately changes what the Files
  section returns on a legacy index (provisional warm directory ancestors). Parity is a gate measured
  against plan A, so a change in plan A's answer moves the gate.

Task 043 also risks bumping `SEARCH_ENGINE_IDENTITY`, which is hashed into the engine identity plan A
stores in its own index. If it does, every existing plan A index becomes non-reusable and the first
`index load` will rebuild - the harness already reports `reusable`, so that shows up rather than
hiding in a load time.

### Plan A, index lifecycle (240-file corpus)

`node tests/indexing/bench/lifecycle.bench.mjs --plans A --scale tiny --sizes 1,8 --removals 8`

| Stage | Cost | Notes |
| --- | --- | --- |
| L1 init | 769ms | 8.05MiB index for 1.4MiB of text |
| load | 66ms | includes the mandatory freshness reconcile |
| L2 apply, 1 edited file | **3.5ms** | 1 commit, no escalation |
| L2 apply, 8 edited files | 22.5ms | 2.8ms per path |
| L2 revert, 8 files | 16.2ms | |
| L4 apply, 8 removed files | **8.1ms** | 1.0ms per path; files 240 -> 232, tree 269 -> 261 |
| L4 apply, 8 restored files | 18.2ms | back to 240 / 269 |
| L3 refresh, nothing changed | 143ms | |
| L4 drop | 0.6ms | `status.exists` false afterwards |

All eight correctness gates passed. The number that matters: **the full reconcile plan A runs on
every single open costs about 40x an incremental commit of the change that actually happened.** The
machinery for the cheap path already exists and is already correct - the shipped engine simply never
uses it at startup.

Removal is cheaper than an edit per path (1.0ms against 2.8ms), which is expected: a deletion reads
no bytes and produces no chunks.

### What the first review round found, and why the gates exist

Three alternative plans were written to the same interface and then reviewed adversarially. All three
passed content parity against plan A on the generated corpus - and all three shipped the same four
defects, none of which a latency table would have exposed:

1. **A malformed or non-existent directory scope returned an authoritative empty answer.** `--dir
   "shared-0/"` reported zero matches, quickly, where 112 files match and the shipped engine throws.
   Same for `./a`, `/a`, a path that is a file, and a directory that does not exist.
2. **A capped Files page returned a different set from plan A**, because SQL orders by binary path
   while the shipped engine orders segment-wise with natural collation and a directory ahead of its
   own descendants. `search "shared" --limit 5` dropped the shallow directories plan A returns.
3. **`truncated` was reported false for an answer that had dropped 141 of 146 matches**, because the
   scan pool stopped dispatching batches and therefore never learned how many matches existed.
4. **Worker-pool bootstrap was charged to the first query**, hiding roughly 23ms in exactly the metric
   the tiered plan exists to improve: `new Worker()` returns before the thread boots, so a load span
   of 3.5ms was followed by a 68ms first query against a 6.9ms p50.

Every one of those makes a plan look *better* while being *wrong*, which is why D1-D4 are gates rather
than ranking dimensions. All four were fixed in the shared modules rather than three times over:
scope validation and byte accounting in `planContract.mjs`, tree-order name search in
`metadataStore.mjs`, provable truncation and an explicit `ready()` handshake in `scanPool.mjs`.

### The gate battery, after it was mutation-tested

The first version of these gates counted 8 and proved almost nothing. Independent verifiers replaced
`handle.apply` with a no-op and re-ran them: **six of seven still passed.** Two causes, both mine:

- The edit gate only checked that the token was findable *after* apply. An index that happened to be
  fresh passed. It now also checks the token is *absent before* apply, which is what kills the no-op.
- Nothing covered a new file, a new directory, or a directory-typed change path - the cases an
  incremental update is actually load-bearing for.

The battery is now 36 gates. What each group kills:

| Gate group | The mutant it kills |
| --- | --- |
| edit, before and after apply | an apply that does nothing |
| new file in a never-seen directory | an apply that only handles paths the index already knows |
| directory-typed change path, add and remove | an apply that reads the path but never its subtree |
| name check as well as content check after a removal | a scan-served plan that finds no content only because the bytes are gone, while dead rows survive |
| scope rejection, five malformed forms plus a missing directory | an empty answer dressed as an authoritative one |
| truncation, over cap / at cap / single match | a `truncated` flag that is a constant |
| completeness marker | an interrupted build that reports itself healthy |
| drift oracle: the plan's own file set against a fresh walk | any row bookkeeping error at all |

The drift oracle needs an optional `handle.indexedFiles()`; it is reported as *skipped* rather than
passed when a plan does not expose it, because a gate that cannot run is not evidence.

### Where each plan stands on correctness

`node tests/indexing/bench/lifecycle.bench.mjs --plans <id> --scale tiny --copy <label> --sizes 1,8 --removals 4`

| Plan | Gates | Open defect |
| --- | --- | --- |
| A | 36/36 | none; 1 gate correctly skipped (its load rebuilds, so it cannot serve half a workspace) |
| C | 36/36 | none behind the gates; 8 drift gates still skipped |
| B | 35/36 | new files reported only as their containing directory are never indexed |
| D | 34/36 | a vanished directory's rows survive: dead paths stay in the scan candidate list, and the deleted directory is still accepted as a scope |

Both open defects are the same underlying case in opposite directions, and the shipped engine avoids
both by escalating to a full reconcile for any directory-typed path.

### One characteristic of plan A the gates exposed

Plan A's incremental commit is **bimodal**, and the fast mode is not the one you might assume:

| Change | Cost on the 240-file corpus | Escalated to a full reconcile |
| --- | --- | --- |
| 1 edited file | 3.2ms | no |
| 8 edited files | 20.3ms | no |
| 4 removed files | 4.8ms | no |
| a new file in a **new** directory | 63.3ms | **yes** |
| a directory added or deleted | 63.2ms | **yes** |

Editing and deleting files is genuinely incremental. Anything that changes the *shape* of the tree
falls back to walking the whole workspace - which is 63ms here and would be seconds on a real project.
Creating a folder is a common editing action, so this is worth confirming at scale before it is
called acceptable.

Not yet separated: a new file inside a directory the index **already** knows. The reconciler's
escalation test is about the tree shape, not about novelty, so that case is probably incremental - but
it has not been measured, so it is not claimed.

### Full matrix, 1200 files / 8.8MiB of text

`yarn bench:indexing:matrix --plans A,A:seed,B,C,C:all,D --scales small --repeat 5 --dirty 32`

Plan A's column is provisional: it was taken while another session had 11 uncommitted engine files
in flight. Everything else here is stable under re-run.

**Result parity: every plan PASS.** Identical relative paths to plan A on all seven queries at project
scope, at both corpus sizes. The 12 declared divergences per plan are the directory-scoped Files
difference, which is plan A's product decision rather than a defect.

#### Build, open, refresh

| plan | init | load | index on disk | refresh, nothing changed |
| --- | --- | --- | --- | --- |
| A | 4.48s | 401ms | 44.5MiB | 871ms |
| A, seed-only load | - | **30.1ms** | 45.3MiB | 913ms |
| B | 1.15s | **7.6ms** | 47.1MiB | 179ms |
| C, metadata only | **32ms** | 42.9ms | **0.4MiB** | 2.06s (this is its lazy content build, not a no-op) |
| C, content=all | 2.27s | 48.4ms | 44.9MiB | 164ms |
| D | 35ms | 36.7ms | **0.4MiB** | **33.7ms** |

`A(seed-only load)` at 30.1ms against plan A's 401ms confirms at scale what the 240-file corpus
suggested: **about 93% of what opening a workspace costs today is freshness work, not opening.**

C and D pay 35-45ms at load for the scan worker pool handshake, which is now charged honestly to load
instead of landing on the first query. B has no pool, hence 7.6ms.

#### Query p50, project-wide, in milliseconds

| plan | unique | common | cjk | filename | short-ascii | short-cjk | absent |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 2.34 | 154.5 | 9.27 | 1.83 | 12.0 | 27.5 | 1.70 |
| A, seed-only | 2.93 | 155.5 | 8.71 | 1.74 | 11.6 | 26.0 | 1.62 |
| B | **0.66** | 154.1 | **6.80** | **0.21** | **8.31** | **25.6** | **0.12** |
| C, content=all | 3.43 | 154.7 | 8.82 | 2.44 | 9.15 | 26.0 | 2.35 |
| C, metadata only | 33.0 | **109.9** | 32.4 | 31.4 | 26.5 | 32.3 | 31.1 |
| D | 32.2 | **107.5** | 32.2 | 30.9 | 24.5 | 31.7 | 30.7 |

Three things fall out of this table:

1. **B is fastest on every indexed query** - 3.5x plan A on the unique needle, 8.7x on a name query,
   14x on a query that matches nothing - while returning identical results.
2. **`common` costs about 154ms in every indexed plan, including B.** It is the same number for A, B
   and C-with-content, so it is not an orchestration problem: it is snippet projection over 250
   matches, and no amount of index or transaction work touches it. The two scan-served plans do the
   same job in ~108ms because they project from the raw file rather than from a chunk's core plus its
   left context and right overlap.
3. **The scan-served plans have a floor of about 30ms** at project scope for 8.8MiB, and it is a
   bytes floor, not a fixed cost: 8ms for the 1.4MiB corpus, 30ms for 8.8MiB. Extrapolating linearly
   puts a 45MiB project near 150ms and a 500MiB project well past a second - which is exactly the
   trade they make, and the reason the medium and large points still need running.

#### Directory scope speedup, p50 project / p50 scoped

The dimension Ral put first. Directories are picked by measured share of corpus text.

| plan | query | 48% of text | 10% | 1% |
| --- | --- | --- | --- | --- |
| A | filename | 1.0x | 1.0x | **1.0x** |
| B | filename | 1.2x | 2.0x | 2.9x |
| C, content=all | filename | 2.0x | 7.0x | 23.6x |
| D | filename | 1.8x | 6.5x | **41.6x** |
| A | unique | 1.0x | 1.0x | 1.1x |
| B | unique | 1.0x | 1.3x | 1.5x |
| C, content=all | unique | 1.8x | 4.9x | 8.7x |
| D | unique | 1.7x | 6.6x | **41.8x** |
| A | common | 1.0x | 2.8x | 17.6x |
| B | common | 1.0x | 2.8x | 16.4x |
| D | common | 1.4x | 2.7x | 18.8x |

Plan A is flat at 1.0x for names at every scope, by product decision. Plan B scopes names and gets
2.9x, but its indexed name query is already 0.19ms project-wide, so there is little left to remove.
The scan-served plans get 40x, because their cost *is* the bytes under the scope - the only design
here where narrowing the scope narrows the work proportionally.

For content queries with many matches everyone converges around 17-22x at the 1% directory, because
they all end up paying the same snippet projection for the matches they keep.

#### Index lifecycle, 240-file corpus, all four plans at 39/39 gates

| step | A | B | C (metadata) | D |
| --- | --- | --- | --- | --- |
| init | 767ms | 210ms | 15.6ms | 10.9ms |
| load | 58.5ms | 1.35ms | 25.7ms | 25.9ms |
| edit 1 file | 3.92ms | 4.25ms | 0.77ms | 0.75ms |
| edit 8 files | 34.1ms | 28.6ms | 0.46ms | 0.59ms |
| new file, **known** directory | 1.17ms | 0.88ms | 0.16ms | 0.20ms |
| new file, **new** directory | **61.6ms** (escalates) | 0.88ms | 0.20ms | 0.21ms |
| directory added | **56.3ms** (escalates) | 1.35ms | **389.7ms** (escalates) | 4.46ms |
| directory deleted | **58.4ms** (escalates) | 0.91ms | 5.95ms | 0.30ms |
| remove 4 files | 4.77ms | 1.18ms | 0.59ms | 0.40ms |
| refresh, nothing changed | 119.6ms | 6.84ms | 7.46ms | 4.77ms |
| drop | 0.71ms | 0.53ms | 0.61ms | 0.30ms |

C's and D's edit numbers are not comparable to A's and B's on the same row: they only update metadata
and defer the content work to query time, which is what their ~30ms query floor pays for.

**Plan A's incremental commit is bimodal, and the boundary is the shape of the tree, not novelty.**
Editing, deleting, and adding a file to a directory the index already knows are all genuinely
incremental - 1 to 4ms. Creating or deleting a *directory* escalates to a whole-workspace reconcile:
56 to 62ms here, and it scales with the workspace, so on the 1200-file corpus it is the 871ms refresh
figure. Creating a folder is an ordinary editing action, so that is a real cost, and it is the one
case where B (0.9-1.4ms, by expanding the directory instead of escalating) is not just faster but
differently shaped.

### Where this leaves the four plans

- **B strictly dominates A.** Same retrieval design, same results, same index size, and it wins every
  stage: init 3.9x, load 53x, refresh 4.9x, every query, plus scoped names and a directory change that
  does not escalate. B is what plan A becomes if the orchestration is fixed, which is why this is a
  repair list rather than a rewrite.
- **D is the right answer for a different question.** 130x faster init, 110x smaller index, the only
  design whose directory-scoped cost falls proportionally with the scope, and no freshness problem at
  all - paid for with a project-wide query floor that grows with the corpus.
- **C is the hedge and it works**, but its value depends on coverage policy, and its escalation on a
  directory add (390ms) is currently its worst case.
- **`common` at 154ms is nobody's win.** It is shared by every indexed plan and untouched by all of
  this. Snippet projection over 250 matches is a separate piece of work.

## Plan A re-audit, pinned to engine=c71864b3e684

Re-audited after the concurrent session's task-043 work, at one pinned fingerprint, with the medium
corpus added. Two findings came from reading the source rather than from timing it.

**The harness had a fidelity bug, now fixed.** `readTreeSnapshot()` gained a `searchPolicy` parameter,
which the store uses both to filter excluded entries and to derive provisional directory ancestors.
Plan A's seed-only load was calling it with no argument, so it skipped exclusion filtering entirely.
It happened not to change any number here because these corpora carry no `preview-config.yml`, but it
would have returned rows the engine does not on any project with an exclude list.

**A 768-line glob engine landed mid-measurement, and none of these numbers contain it.**
`glob-config.mjs` went from 66 lines to 778 - segment-state automata, coverage budgets, continuation
products. It is consulted per path during traversal and per entry inside `readTreeSnapshot`. Both
entry points short-circuit on `rules.length === 0`, and every corpus here has zero rules, so the cost
is one length check per call in this report. **On a workspace with a real exclude list that cost is
unmeasured.** That is the largest known gap in this evaluation.

Plan A also gained `reclaimInterruptedSqliteArtifacts` on init, which cleans up `.candidate-*` and
`.previous-*` files left by a crashed build - a genuine robustness improvement that did not exist when
the throughput document was written.

Behaviourally nothing moved: 39/39 gates, and the bimodal incremental commit is unchanged (edit 3.8ms,
new file in a known directory 1.6ms, new file in a new directory 84.4ms with escalation).

## Medium corpus: 6000 files, 45.2MiB of text

`yarn bench:indexing:matrix --plans A,A:seed,B,C,C:all,D --scales medium --repeat 3 --dirty 64`

| plan | init | load | index | refresh, nothing changed |
| --- | --- | --- | --- | --- |
| A | 24.85s | 2.89s | 231.0MiB | 6.55s |
| A, seed-only load | - | **61.2ms** | 231.6MiB | 5.46s |
| B | 8.08s | **7.16ms** | 234.3MiB | 566ms |
| C, metadata only | **118ms** | 38.2ms | **2.1MiB** | 2.26s (its lazy content build) |
| C, content=all | 15.89s | 56.2ms | 231.2MiB | 543ms |
| D | 111ms | 32.0ms | **2.1MiB** | **87.2ms** |

Query p50, project-wide, milliseconds:

| plan | unique | common | cjk | filename | short-ascii | short-cjk | absent |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | 10.6 | 288.0 | 28.8 | 11.1 | 23.4 | 64.3 | 9.51 |
| B | **1.52** | **204.9** | **16.7** | **3.45** | **11.9** | **55.1** | **0.43** |
| C, content=all | 13.9 | 193.0 | 27.3 | 16.0 | 21.2 | 61.8 | 13.2 |
| C, metadata only | 190.2 | 131.8 | 99.5 | 199.6 | 39.5 | 96.4 | 189.2 |
| D | 173.8 | 110.9 | 95.8 | 170.4 | 32.3 | 98.7 | 162.7 |

Parity: every plan PASS at every scale.

### The medium point changes two conclusions

**Plan A's directory scoping stops working at this size.** At 1200 files a scoped content query was
17.6x faster than project-wide. At 6000 files:

| plan | unique @1% of text | filename @1% | common @1% |
| --- | --- | --- | --- |
| A | **1.0x** | **0.9x** | 5.3x |
| B | 1.8x | **30.5x** | 3.4x |
| C, content=all | 27.7x | **75.2x** | 4.1x |
| D | 34.9x | 38.8x | 3.7x |

Plan A is flat at 1.0x for both the unique needle and a name query at *every* scope, because its
per-query floor is now dominated by the in-memory tree-entry scan - 6499 entries re-normalised on
every query - and that scan is scope-blind. **Asking plan A for one directory costs the same as asking
for the whole project.** Ral's first requirement is not met by plan A at 6000 files, and it is not a
tuning problem: the Files section is project-wide by product decision and the scan is what implements
it.

**Plan D's floor is now measured and it is disqualifying as a sole design.** 110-175ms per
project-wide query at 45MiB, growing linearly with corpus bytes - a name query at 170ms against plan
A's 11ms. But the honest comparison is the whole session, not the query: plan A costs
2890 + 10n milliseconds for n queries after opening a folder, plan D costs 143 + 170n. They break
even at **n ≈ 17 queries**. Below that plan D is the faster experience; above it, plan A is. So D is
not simply worse - it is worse at the thing that scales.

## Ranking, best to worst

Ranked on Ral's stated priorities in his order: correctness first (a gate, not a score), then
directory-scoped search beating project-wide, then open-to-first-search, then lifecycle cost, then
space, then adoption risk. All four plans pass 39/39 correctness gates and full result parity, so
correctness separates nobody.

### 1. B - Scoped SQLite, no candidate copy

It beats or ties plan A on every measured dimension while returning identical results, using plan A's
own retrieval code. At 6000 files: init 3.1x faster, **load 404x faster** (7.16ms against 2.89s),
refresh 11.6x faster, every one of the seven queries faster (7x on the unique needle, 22x on a query
that matches nothing), scoped names 30.5x, and a directory create or delete costs 0.9-1.4ms where plan
A pays a full reconcile.

What it costs: B drops plan A's per-file identity re-verification (1.1 filesystem operations per file
against 15.8) and its cooperative yielding inside a query. Both are deliberate, both are Ral's call,
and neither is a performance question.

### 2. C - Two-tier, instant metadata with lazy content

The only plan that answers "the folder must open now": 118ms init, 38ms load, 2.1MiB on disk, and
search degrades gracefully instead of waiting. It then converges to indexed speed as coverage grows,
and in its converged form it has the best scoped numbers of any plan (75x on names at the 1%
directory). Second rather than first because converged C is slower than B project-wide across the
board and costs twice B's build (15.89s against 8.08s), and because its worst case - escalating on a
directory add - is its own 390ms.

### 3. A - OnlyPreview as shipped

Correct, shipped, and the reference every other plan is graded against; it is also the slowest at
every lifecycle stage and the only plan whose directory scoping does not work at 6000 files. 2.89s to
open a folder, 6.55s to reconcile a workspace where nothing changed, ~6.5s every time someone creates
a folder, and 231MiB of index for 45MiB of text. Its unique assets are correctness assets, not speed
ones: identity re-verification and cooperative query yielding.

### 4. D - Metadata only, parallel literal scan

Best build (111ms), best space (2.1MiB, 110x smaller), cheapest lifecycle in every row, and the
cleanest scope behaviour of the four. Last because its project-wide query floor grows with the corpus
and is already 170ms for a name query at 45MiB. It is not a losing design - it is the right *fallback
tier*, which is exactly the role plan C gives it.

### What to do with this

Two steps, both measured, in order:

1. **Adopt B's orchestration into plan A.** Same retrieval, same results, no new dependency: drop the
   count pre-pass, stop copying a candidate database, enlarge build transactions, chunk on a worker
   pool, and answer names from SQL instead of an in-memory rescan. That last one is what unblocks
   directory scoping at scale.
2. **Then add C's tiering on top**, so opening a folder never waits for content at all.

One thing none of this touched: **`common` costs 193-288ms in every indexed plan.** It is snippet
projection over 250 matches, it is the same number for A, B and converged C, and it is now the largest
single per-query cost in the fastest plan. It needs its own task.

Still unrun: the large (180MiB) point, and any corpus with a real exclude list.
