---
id: onlypreview-indexing-plan-comparison-070
scope: Stage-separated indexing CLI, four competing indexing plans, and the evaluation that ranks them
status: in progress
depends-on: [onlypreview-indexing-benchmark-069]
verify: node --test tests/indexing/indexingPipeline.test.mjs && node tests/indexing/cli.mjs plans && node tests/indexing/bench/lifecycle.bench.mjs --plans A,B,C,D --scale tiny --copy verify --sizes 1,8 --removals 4 && node tests/indexing/bench/planMatrix.bench.mjs --plans A,A:seed,B,C,D --scales tiny --repeat 3 --dirty 8 && yarn eslint tests/indexing --no-cache && yarn typecheck:node && git diff --check
---

# Split the indexing pipeline into drivable stages, then compare designs

## Objective

Task 069 measured the shipped pipeline as one block and produced a repair list. This task makes the
pipeline drivable one stage at a time from a CLI a person can use by hand, defines what "better"
means before any alternative exists, implements alternative indexing designs behind one interface,
and ranks them on those definitions.

## Evidence

Task 069 measured, on a 6000-file / 45.2MiB corpus: 24.1s first build, 2.4s on every later open with
nothing changed, 30% of that warm path spent on a redundant count plus a candidate copy, an index
5.1x the size of the indexed text, and 15.8 filesystem operations per indexed file. What it could not
answer is whether the design is right, because there was nothing to compare it against.

## Context

- `docs/design/onlypreview-indexing-plan-evaluation.md` - the ten evaluation dimensions and the plan
  catalogue
- `docs/design/onlypreview-indexing-throughput.md` - the single-design measurement this builds on
- `docs/features/onlypreview-indexing-benchmark.md` - the harness contract
- `docs/issues/onlypreview-directory-selection-and-global-file-scope.md` - why plan A's Files section
  is project-wide

## Path

- `tests/indexing/cli.mjs`
- `tests/indexing/plans/planContract.mjs`
- `tests/indexing/plans/walker.mjs`
- `tests/indexing/plans/scanPool.mjs`
- `tests/indexing/plans/scan.worker.mjs`
- `tests/indexing/plans/metadataStore.mjs`
- `tests/indexing/plans/registry.mjs`
- `tests/indexing/plans/planA.onlypreview.mjs`
- `tests/indexing/plans/planB.scopedSqlite.mjs`
- `tests/indexing/plans/planB.chunk.worker.mjs`
- `tests/indexing/plans/planC.tieredLazy.mjs`
- `tests/indexing/plans/planD.scanOnly.mjs`
- `tests/indexing/bench/planMatrix.bench.mjs`
- `tests/indexing/bench/queries.mjs`
- `tests/indexing/bench/parity.mjs`
- `tests/indexing/bench/scopeSamples.mjs`
- `tests/indexing/bench/queryHotspots.bench.mjs`
- `tests/indexing/bench/explainQueryPlans.bench.mjs`
- `tests/indexing/bench/lifecycle.bench.mjs`
- `docs/design/onlypreview-indexing-plan-evaluation.md`
- `package.json`
- `docs/INDEX.md`

## Steps

1. Fix the plan interface: `init` / `load` / `status` / `refresh` / `drop`, one uniform search
   outcome, and a timeline that any stage can hang counters off.
2. Build the CLI so every stage is a separate command and a person can search by hand, globally or
   inside one directory, over files or over content.
3. Wrap the shipped engine as plan A, including a seed-only load that isolates the freshness cost.
4. Implement plans B, C and D against the same interface without touching `src/`.
5. Automate the comparison: build, load, a seven-query latency distribution, a directory-scope curve
   picked by measured text share, freshness cost, space, and result parity as a gate.
6. Cover the whole index lifecycle, not just the build: initialize, incremental update from a known
   change set, full reconcile, entry removal, whole-index removal, and space reclamation - each with
   a correctness gate that runs before its timing is reported.
7. Read the results, instrument whatever the numbers cannot explain, and record the ranking.

## Acceptance

- Every stage has its own command, and `index load` cannot silently rebuild.
- Result parity against plan A is checked before any latency is compared; a plan that loses results
  is rejected rather than ranked.
- The directory-scope speedup is reported against the measured text share of the scoped directory,
  not against a directory name.
- Every claim in the results section names the command that produced it.
