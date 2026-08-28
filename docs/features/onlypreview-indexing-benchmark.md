# OnlyPreview indexing benchmark

Status: implemented

A repeatable measurement of the interval a user actually feels: **Preview opens a directory ->
the first Global Search returns**. It exists so indexing optimizations are selected from measured
phase cost instead of source-reading intuition, and so a later change cannot silently regress the
phase it was supposed to improve.

## Why the existing tests are not enough

`tests/onlypreview/*` proves correctness (ordering, reader leases, cancellation, privacy) and
`onlyPreviewWarmSearchScale.test.mjs` proves bounded work under adversarial input. Neither reports
how long any phase takes, so the only performance evidence on record is one hand-captured
`[onlypreview-search]` sample from Ral's machine
(`docs/issues/onlypreview-first-search-startup-delay.md`). That sample cannot be re-run, cannot be
sliced by corpus size, and cannot attribute cost inside a phase.

## Measured pipeline

The benchmark drives the real `createOnlyPreviewSearchEngine()` in-process - no Electron, no
window, no XPC - and reads the engine's own `[onlypreview-search]` diagnostic events through an
injected `write` sink, so measured phases are exactly the phases the shipped app logs.

```text
open directory (engine.initialize)
  -> sqlite-open          reuse assessment + filename-tier hydration
  -> root-listing         first visible directory listing
  -> full-count           whole-workspace count for the progress denominator
  -> candidate-backup     SQLite copy of the committed index
  -> traversal-index      walk + read + chunk + FTS insert (rebuild or reconcile)
  -> promotion-*          reader drain, atomic swap, tree snapshot re-read
first Global Search dispatched while that runs
  -> search-gate          priority / promotion / initial-tree waits
  -> first batch          first row the Shell could render
  -> search-terminal      authoritative replace
```

## Probes

- `immediate` - the query is dispatched right after `initialize()` starts. This is the user
  complaint: open a folder, type at once. It measures the gate, not the query.
- `settled` - the query is dispatched after `initialize()` resolves. This is the warm query cost
  with every gate already open, and the floor the `immediate` probe should approach.
- `settled-filename` - a third query using the planted needle file's own basename, so the Files
  branch is measured too and not only Contents.

## Scenarios

| Scenario | Database before the run | What it isolates |
| --- | --- | --- |
| `cold` | absent | true first build: count + full read + chunk + insert |
| `warm` | complete, corpus untouched | pure freshness overhead paid for zero real change |
| `warm-dirty` | complete, a bounded set of files rewritten | incremental reconcile cost |

`warm` is the dominant real case: every launch after the first pays it.

## Corpus

Deterministic and generated, never a real user directory by default. One seeded PRNG decides the
tree shape, file sizes, extensions and bodies, so two machines index identical bytes. Corpora are
cached under `tmp/indexing-bench/corpus/<signature>/` and reused until the signature changes.

Every corpus plants three probes: a unique needle in exactly one file, a common identifier in many
files, and a CJK needle, so query cost can be read separately from gate cost. `--root <path>` runs
the same harness against a real directory when a real-world number is wanted; that mode is opt-in
and its path never enters a committed report.

## Reported numbers

Per scenario and probe: every phase duration, first-batch and terminal search latency, indexed file
and chunk counts, bytes of text read, peak RSS, and the deterministic filesystem-operation count
(`async_hooks` FS resource inits) with its per-indexed-file amplification ratio. The operation
count is machine-independent, so it is the metric a regression guard can assert on.

## Regression guard

`tests/indexing/indexingPipeline.test.mjs` runs under `node --test` on a small corpus and asserts
only machine-independent facts: every phase is captured in order, `warm` publishes a first batch
before the build terminal (stale-while-revalidate is alive), `cold` cannot publish content before
its build completes, and filesystem operations per indexed file stay under a fixed ceiling. Wall
clock is reported, never asserted.

## Commands

```bash
yarn test:indexing                                   # regression guard, tiny corpus
yarn bench:indexing                                  # full report, tiny + small
yarn bench:indexing --scale medium --dirty 64         # bigger corpus
yarn bench:indexing --root /path/to/real/project      # opt-in real directory, no dirty scenario
yarn bench:indexing:hotspots --scale medium           # per-stage attribution inside traversal-index
```

Corpora and reports are written under `tmp/indexing-bench/`, which is git-ignored.

## Results

The first baseline and the repair plan it selected are in
[OnlyPreview indexing throughput](../design/onlypreview-indexing-throughput.md).
