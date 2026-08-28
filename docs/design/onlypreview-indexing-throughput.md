# OnlyPreview indexing throughput

Status: proposed - measurement complete, no repair implemented yet

Every number in this document came from `tests/indexing/`. Nothing here is inferred from reading
source alone.

## How to reproduce

```bash
yarn test:indexing                                        # machine-independent guard
yarn bench:indexing --scale small,medium --dirty 64        # phase-resolved pipeline report
yarn bench:indexing:hotspots --scale medium                # per-stage attribution
```

Measured on: Apple Silicon, 8 performance + 2 efficiency cores, macOS Darwin 25.4, APFS,
Node v24.16.0, warm page cache. The shipped engine runs in Electron 40 (Node 22) inside the hidden
`fileSearch` window preload, so absolute milliseconds there differ; the ratios below are what
matters.

Corpus `medium`: 6000 files, 5036 of them text, 45.2MiB of text, 499 directories, 80 files inside
excluded directories, 29622 content chunks, 422509 CJK posting rows. The generator is calibrated
against this repository's own `src/` tree (1269 files, 12.0MB, 9.4KB average file).

## Baseline: open directory -> first search

| Scenario | `medium` open -> ready | first-search perceived wait | second search |
| --- | --- | --- | --- |
| cold (no index yet) | 24.081s | 24.071s | 10ms |
| warm (index reusable, nothing changed) | 2.415s | 2.375s (first row at 42ms) | 9ms |
| warm-dirty (64 files rewritten) | 2.033s | 1.992s | 10ms |

Scaling holds: `small` (1200 files, 8.8MiB) is 4.334s cold / 0.412s warm; `tiny` (240 files,
1.4MiB) is 0.752s / 0.065s. Cold cost tracks text bytes almost linearly at **1.9MiB/s**.

Two facts the table makes plain:

- The warm path is the one users pay on **every** launch, and it costs 2.4s on a 6000-file project
  while changing nothing.
- Task 042's stale-while-revalidate works: the warm first row lands at 42ms. But the *terminal*
  result still waits 2.4s behind the reconcile, so grouped counts and folder rows keep moving under
  the user's cursor for the whole interval.

### Phase split

| Phase | cold | warm | what it is |
| --- | --- | --- | --- |
| `sqlite-open` | 3ms | 16ms | reuse assessment + filename-tier hydration |
| `root-listing` | 10ms | 15ms | first visible directory listing |
| `full-count` | 636ms | 392ms | second full walk, only to get a progress denominator |
| `candidate-backup` | 0ms | 340ms | `node:sqlite` `backup()` of the 231MiB committed index |
| `traversal-index` | 23352ms | 1547ms | walk + read + chunk + FTS/CJK insert |
| `promotion-commit` | 55ms | 44ms | reader drain, file swap, tree snapshot re-read |

Index size is **5.1x the indexed text** (231.0MiB of SQLite for 45.2MiB of text; the same ratio at
every scale, and reproducible to the byte).

Peak RSS is the least reproducible number here, because it depends on GC timing: the two `medium`
runs recorded 616MiB / 803MiB / 782MiB and 396MiB / 548MiB / 584MiB for cold / warm / warm-dirty.
Either way, 256MiB of it is the configured `mmap_size`, and the high end sits close enough to the
engine's own 1GiB warning threshold to matter on a project several times this size.

### Run-to-run variance

Two full `medium` runs on an otherwise idle machine gave 24.081s and 26.197s cold (+9%), and 2.415s
and 1.938s warm (-20%). The warm path is short enough that page-cache state moves it noticeably. The
phase table above and every attribution below come from the first run; the *shares* are what the
repairs are chosen on, and those are stable across runs. Treat any single wall-clock figure in this
document as +/-10% cold and +/-25% warm.

## Where the cold build time goes

Stages measured in isolation on the same corpus, so they sum approximately rather than exactly:

| Stage | medium | throughput | share of the 23.4s build |
| --- | --- | --- | --- |
| `splitContentDefinedChunks` (JS) | 6928ms | 6.5 MiB/s | 30% |
| - of which grapheme materialization | 3115ms | 14.5 MiB/s | 13% |
| SQLite writes, as the engine batches them | 6554ms | 6.9 MiB/s | 28% |
| - FTS5 trigram index | 3021ms | | 13% |
| - transaction overhead vs one transaction | 2527ms | | 11% |
| - CJK postings (422509 rows) | 578ms | | 2% |
| - `chunks` table rows | 428ms | 105.6 MiB/s | 2% |
| file walk + body reads | 1680ms | 26.9 MiB/s | 7% |
| background work-slicer pauses | 4338ms | | 19% |
| `full-count` pre-pass | 636ms | 109.1 MiB/s | 3% |

Notes behind the rows:

- Writing file rows *without* content costs 117ms for all 6000 files. The entire build cost is
  content: chunking, the trigram index, and commit frequency.
- `BACKGROUND_BUILD_TRANSACTION_FILES = 10` produces roughly 600 `BEGIN IMMEDIATE`/`COMMIT` pairs.
  The same inserts in one transaction take 4027ms instead of 6554ms.
- The work slicer pauses 4ms after every 8ms slice (`BACKGROUND_WORK_SLICE_MS` /
  `BACKGROUND_WORK_PAUSE_MS`), a duty cycle that costs 2073ms during the walk and 2265ms during the
  rebuild. It buys responsiveness for concurrent queries, and it is paid even when no query exists.
- `walk-read` moves 45.2MiB in 1680ms (26.9 MiB/s) while a metadata-only walk of the same tree takes
  391ms. Reads and index writes never overlap: the traversal generator and the SQLite writer are one
  interleaved single-threaded loop, so effective IO concurrency is 1.
- The first build issues **15.8 filesystem operations per indexed file** (94581 for 6000 files:
  1001 `DIRHANDLE`, 6000 `FILEHANDLE`, 6000 close requests, 81580 stat/realpath calls). Each file is
  `lstat`ed, `realpath`ed, opened `O_NOFOLLOW`, `fstat`ed, read, then re-verified with a second
  `fstat`, two more `lstat`s and two more `realpath`s.

## Where the warm reconcile time goes

Of the 2.415s warm path, **732ms (30%) is structurally avoidable work that produces nothing**:

- `full-count` (392ms) walks the whole tree a second time only to compute a progress denominator.
  The previous build already knows its file count.
- `candidate-backup` (340ms) copies the entire committed index so the reconcile can write to an
  isolated candidate. When the reconcile finds nothing changed - the common case - the copy is
  discarded after promotion re-reads the same rows back.

The remaining 1547ms of `traversal-index` is the price of *learning* that nothing changed: a full
metadata walk (391ms measured standalone) plus per-file `metadataForTraversal` comparison, tree
entry construction, sorting, and a `search_tree` snapshot rewrite of 6499 rows.

## Selected repairs

Ranked by measured saving against implementation risk. Every estimate names the measurement it comes
from.

| # | Repair | Measured saving (medium) | Risk |
| --- | --- | --- | --- |
| R1 | Drop the `full-count` pre-pass; take the progress denominator from the previous build's file count in `index_meta`, and report indeterminate progress on a true first build | -636ms cold, -392ms warm | low - progress display only |
| R2 | Replace the `backup()` candidate copy with a copy-on-write clone, falling back to `backup()` when the filesystem refuses | -340ms warm, and it stops scaling with index size | low, with one precondition |
| R3 | Run the work slicer only while a query is in flight (`activeQueryCount > 0`) | -4338ms cold | low - the engine already tracks reader count |
| R4 | Raise the build transaction size during a first build, where nothing is searchable yet | -2527ms cold | low - candidate rows are already unreachable |
| R5 | Move `splitContentDefinedChunks` onto a `worker_threads` pool | -5300ms cold | medium - new pool lifecycle |
| R6 | Overlap body reads with index writes via a bounded read-ahead queue | up to -1680ms cold, more on a cold page cache | medium - changes traversal back-pressure |
| R7 | Skip candidate creation and promotion entirely when the reconcile observed zero mutations | -400ms warm on top of R2 | medium - needs an exact no-change predicate |

R1 through R4 are small, local, and together take the cold build from 24.1s to roughly **16.6s** and
the warm reconcile from 2.415s to roughly **1.6s**. Adding R5 and R6 lands the cold build near
**9-10s**. R7 takes the warm path under **1.2s**, and its remaining cost is the freshness walk
itself.

### R2 precondition

A file-level clone copies bytes, not SQLite's logical database, so uncommitted WAL frames would be
lost. The seed database must be checkpointed (`PRAGMA wal_checkpoint(TRUNCATE)`) before the clone,
after which the main database file is complete on its own. Measured on this machine:

| Candidate copy method | 231.5MiB index |
| --- | --- |
| `node:sqlite` `backup()` (current) | 391ms |
| `fs.copyFileSync` | 120ms |
| `fs.copyFileSync` with `COPYFILE_FICLONE` | 160ms - Node does not clone on macOS |
| `@reflink/reflink` `reflinkFileSync` | **0.3ms** |

The clone was opened read-only afterwards and reported all 6000 `files` rows, so it is a valid
database. Note that Node's own `COPYFILE_FICLONE_FORCE` fails with `ENOSYS` on this APFS volume
while `cp -c` clones the same file in 4ms - the capability is in the filesystem, not in Node.

`@reflink/reflink` is **already in this repository's dependency tree and already shipped** inside
`Bitterless.app` (`app.asar.unpacked/node_modules/@reflink/reflink-darwin-arm64/reflink.darwin-arm64.node`),
pulled in transitively by `node-llama-cpp` -> `ipull`. Using it deliberately means promoting it to a
direct dependency; it needs no new native build. `reflinkFileSync` throws on filesystems without
copy-on-write (ext4, exFAT, NTFS), which is the fallback trigger.

## The Rust question

The request asked whether Rust should do this work, and if so how it would reach Electron. The
measurement answers the first part, and the repository already answers the second.

### Is Rust justified?

The only genuinely CPU-bound JavaScript stage is content chunking. A standalone Rust port of
`splitContentDefinedChunks` - same grapheme boundaries, same rolling anchor window, same SHA-256 per
chunk, same NFKC + lowercase - was built and run against the same 45.2MiB corpus
(`unicode-segmentation`, `unicode-normalization`, `sha2`, release + LTO, single thread):

| Stage | JavaScript | Rust, 1 thread | JS on 8 `worker_threads` |
| --- | --- | --- | --- |
| grapheme materialization | 3115ms (14.5 MiB/s) | **354ms (127.8 MiB/s)** | - |
| full chunk split | 6928ms (6.5 MiB/s) | **1154ms (39.2 MiB/s)** | **1396ms (32.4 MiB/s)** |

Rust is 6.0x faster than single-threaded JavaScript. A pool of 8 JavaScript workers is 4.8x faster.
**They are the same order of magnitude**, and returning the produced chunk objects across the worker
boundary cost nothing measurable (1333ms with full chunk transfer versus 1396ms returning counts
only).

So the recommendation is: **take R5 with `worker_threads` first, and do not build a Rust module for
chunking.** A native module here would buy roughly 200ms over the worker pool on a 45MiB project
while adding a Rust toolchain, three prebuilt binaries, and a second implementation of a
security-relevant text pipeline that must stay byte-identical to the JS one or the persisted
`content_hash` and `normalized_searchable` columns diverge.

Rust becomes the right answer only if one of these turns out to be true, and each is testable with
the benchmark already in place:

- After R5, chunking is still the top stage - meaning worker startup, back-pressure, or transfer
  dominates on a real project rather than on this corpus.
- We decide to move the SQLite write path itself into a native thread pool (`rusqlite`), which is
  where the remaining irreducible 3021ms of trigram indexing lives. That is the only way to
  parallelise the FTS insert, and it is a much larger change than chunking.
- Rust's own headroom is claimed: the port spends 800ms of its 1154ms outside segmentation, mostly
  in NFKC. Skipping normalization for ASCII-only chunks (an `is_ascii()` test) should approach
  100 MiB/s, at which point native chunking would be roughly 7x the worker pool.

### If Rust is built: packaging for Electron

The pattern is already proven inside this repository - `@mariozechner/clipboard-*` and
`@reflink/reflink-*` are both napi-rs crates shipped as platform-suffixed prebuilt `.node` files:

- **Node-API, not node-gyp.** napi-rs targets Node-API, which is ABI-stable across Node and Electron
  versions. A prebuilt binary keeps working across Electron upgrades, so `npmRebuild: false` in
  `electron-builder.tmp.yml` stays correct and `electron-builder install-app-deps` has nothing to do.
- **Crate location.** `packages/onlypreview-indexer-native/` alongside the existing
  `packages/micromeet-cli`, `crate-type = ["cdylib"]`, built with `napi build --platform --release`
  into `onlypreview-indexer.darwin-arm64.node`, `.darwin-x64.node`, `.win32-x64-msvc.node` -
  matching the platforms `package.json` already builds (`build:mac_arm`, `build:mac_x64`,
  `build:win`). Linux targets exist in the build scripts and would need the same two triples.
- **asar.** No configuration is required: electron-builder already unpacks `**/*.node` into
  `app.asar.unpacked`, confirmed by the five native modules present in the shipped
  `dist/mac-arm64/Bitterless.app`.
- **Load site.** The engine lives in the `fileSearch` hidden window's preload, which runs with
  `sandbox: false`, so a preload `require()` of a `.node` works. `contextIsolation: true` does not
  block it.
- **Mandatory JS fallback.** A thin resolver must try the platform binary and fall back to the
  existing `chunking.mjs` when it is missing, so `node --test`, CI, and a developer without the Rust
  toolchain all still run. The two implementations need a differential test asserting identical
  chunk boundaries, `content_hash`, and `normalized_searchable` on the benchmark corpus, because a
  divergence silently invalidates every persisted index.
- **Toolchain prerequisite.** The local toolchain is rustc 1.76 (Homebrew, Feb 2024). Current
  `unicode-segmentation` needs rustc 1.85+, and napi-rs v3 needs 1.80+, so this starts with a
  toolchain upgrade.

## Deliberately not doing

- **Removing the FTS5 trigram index.** 3021ms of the cold build is SQLite tokenising trigrams, and
  no amount of JavaScript or Rust changes that. The trigram tokenizer is what makes substring and
  CJK search work at all; replacing it is a search-semantics decision, not a performance one.
- **Removing candidate isolation.** R2 and R7 make the candidate cheap or unnecessary; they do not
  make candidate rows searchable.
- **Weakening the per-file re-verification.** The 15.8 filesystem operations per file exist to prove
  the bytes we indexed belong to the path we indexed them under. Four of them (`readCurrentStableFile`
  re-resolving the path twice after the read) look reducible to two, but that is a security-boundary
  change and belongs in its own reviewed task, not in a throughput sweep. The benchmark's
  filesystem-operation guard exists so any such change is measured rather than assumed.
- **Trusting the filesystem watcher instead of reconciling at startup.** Out of scope here; the
  warm-path repairs above make the reconcile cheap enough that the question can wait.

## Follow-up measurements this benchmark cannot answer yet

- All numbers come from a warm page cache. A cold-cache run (`purge` on macOS) would show whether
  R6's read overlap is worth more than the 1680ms measured here.
- `traversal-index` on the warm path has roughly 1.1s that the standalone stages do not explain;
  `replaceTreeSnapshot` writing 6499 rows plus `sortOnlyPreviewTreeEntries` is the suspect and needs
  its own probe before R7 is scoped.
- Numbers under Electron 40's Node 22 in the real preload, rather than Node 24 in-process.
