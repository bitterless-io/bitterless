---
id: onlypreview-indexing-benchmark-069
scope: Repeatable open-directory-to-first-search indexing benchmark plus the optimization it selects
status: measurement delivered; repairs proposed, not implemented
depends-on: [onlypreview-warm-search-before-reconcile-042]
verify: node --test tests/indexing/indexingPipeline.test.mjs && node tests/indexing/indexingPipeline.bench.mjs --scale small && node tests/indexing/indexingHotspots.bench.mjs && yarn typecheck:node && git diff --check
---

# Measure open-directory to first-search, then select the repair

## Objective

Turn OnlyPreview indexing performance into measured evidence. Add `tests/indexing/` - a
deterministic corpus, an in-process harness over the real search engine, a phase-resolved benchmark
CLI, per-stage micro benchmarks, and a machine-independent regression guard - then read the numbers
and write the optimization plan they support.

## Evidence

Only one non-reproducible sample exists today
(`docs/issues/onlypreview-first-search-startup-delay.md`): 1.203s SQLite open, 9.07s full count,
12.09s candidate backup, 16.94s traversal/reconcile, 0.714s promotion, 33.024s behind the gate. It
cannot be re-run, scaled, or attributed inside a phase, so no further optimization can be selected
from it.

## Context

- `docs/features/onlypreview-indexing-benchmark.md`
- `docs/design/onlypreview-search-architecture.md`
- `docs/issues/onlypreview-first-search-startup-delay.md`

## Path

- `tests/indexing/corpus.mjs`
- `tests/indexing/indexingBench.harness.mjs`
- `tests/indexing/indexingPipeline.bench.mjs`
- `tests/indexing/indexingHotspots.bench.mjs`
- `tests/indexing/indexingPipeline.test.mjs`
- `package.json`
- `docs/features/onlypreview-indexing-benchmark.md`
- `docs/design/onlypreview-indexing-throughput.md`
- `docs/INDEX.md`

## Steps

1. Deterministic cached corpus generator with planted unique/common/CJK needles.
2. Harness that drives `createOnlyPreviewSearchEngine()`, captures every `[onlypreview-search]`
   phase, both search probes, filesystem-operation counts, and peak RSS.
3. Benchmark CLI over `cold` / `warm` / `warm-dirty` at several scales, with `--root` for a real
   directory.
4. Micro benchmarks that split `traversal-index` into walk, read, chunk, and SQLite insert.
5. `node --test` guard on machine-independent invariants only.
6. Read the measurements and write `docs/design/onlypreview-indexing-throughput.md`, including
   whether a Rust native module is justified and how it would be packaged for Electron.

## Acceptance

- The benchmark runs from a clean checkout with no Electron and no network.
- Two consecutive `warm` runs on an untouched corpus report the same indexed file count and the same
  filesystem-operation count.
- The guard fails if warm first-batch publication regresses behind the build terminal.
- The optimization plan cites benchmark output, not source reading, for every claim it makes.

## Result

`tests/indexing/` is in place and green (`yarn test:indexing`, 6/6). The measured baseline and the
ranked repair plan are in
[docs/design/onlypreview-indexing-throughput.md](../../design/onlypreview-indexing-throughput.md).

Headline numbers on the `medium` corpus (6000 files, 45.2MiB of text):

- cold open -> first search: **24.081s**; warm (nothing changed): **2.415s**; second search: 10ms.
- 30% of the warm path is the redundant `full-count` (392ms) plus the `backup()` candidate copy
  (340ms) - both produce nothing.
- The cold build is 30% JS chunking, 28% SQLite writes (13% of that FTS5 trigram, 11% commit
  frequency), 19% work-slicer pauses, 7% reads, 3% counting.
- 15.8 filesystem operations per indexed file; index on disk is 5.1x the indexed text; 803MiB peak
  RSS.

Rust decision: a standalone Rust port of the chunker is 6.0x single-threaded JavaScript, while a
pool of 8 `worker_threads` is 4.8x. The worker pool wins on risk, so no Rust module is proposed for
chunking; the design doc records the exact conditions that would flip that and the full napi-rs
packaging design if they do. The copy-on-write candidate clone needs no new native code -
`@reflink/reflink` is already shipped inside `Bitterless.app` and clones the 231MiB index in 0.3ms
against `backup()`'s 391ms.

No engine source was changed by this task. Repairs R1-R7 need their own tasks.
