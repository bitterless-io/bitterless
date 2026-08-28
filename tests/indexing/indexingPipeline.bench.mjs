/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { CORPUS_SCALES, UNIQUE_NEEDLE, createIndexingCorpus, dirtyCorpusFiles } from './corpus.mjs';
import { createBenchWorkspace, runOpenDirectoryProbe } from './indexingBench.harness.mjs';

const parseArguments = (argv) => {
  const options = {
    scales: ['tiny', 'small'],
    root: undefined,
    dirty: 32,
    fsOps: true,
    json: undefined,
    query: UNIQUE_NEEDLE
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => argv[(index += 1)];
    if (argument === '--scale') options.scales = next().split(',').filter(Boolean);
    else if (argument === '--root') options.root = next();
    else if (argument === '--dirty') options.dirty = Number(next());
    else if (argument === '--query') options.query = next();
    else if (argument === '--json') options.json = next();
    else if (argument === '--no-fs-ops') options.fsOps = false;
    else throw new TypeError(`Unknown argument: ${argument}`);
  }
  for (const scale of options.scales) {
    if (!options.root && !CORPUS_SCALES[scale]) throw new TypeError(`Unknown scale: ${scale}`);
  }
  return options;
};

const ms = (value) => (value === undefined ? '     -' : `${value.toFixed(0).padStart(6)}`);
const mib = (value) => (value === undefined ? '-' : `${(value / 1024 ** 2).toFixed(1)}MiB`);

const PHASE_ROWS = [
  ['sqlite-open', 'sqliteOpenMs'],
  ['root-listing', 'rootListingMs'],
  ['full-count', 'fullCountMs'],
  ['candidate-backup', 'candidateBackupMs'],
  ['traversal-index', 'traversalIndexMs'],
  ['promotion-wait', 'promotionWaitMs'],
  ['promotion-commit', 'promotionCommitMs']
];

const printRun = (label, run) => {
  const phases = run.phases;
  const accounted = PHASE_ROWS.reduce((total, [, key]) => total + (phases[key] ?? 0), 0);
  console.log(`\n  ${label}`);
  console.log(
    `    mode=${phases.traversalIndexMode ?? '-'} reusable=${String(phases.sqliteReusable)}` +
      ` backup=${phases.candidateBackupMode ?? '-'}` +
      ` indexedFiles=${run.indexedFileCount} treeEntries=${run.treeEntryCount}` +
      ` progressTicks=${run.progressTicks}`
  );
  for (const [name, key] of PHASE_ROWS) {
    const value = phases[key];
    const share =
      value === undefined
        ? ''
        : ` ${((value / run.initializeCompleteMs) * 100).toFixed(0).padStart(3)}%`;
    console.log(`    ${name.padEnd(18)} ${ms(value)}ms${share}`);
  }
  console.log(
    `    ${'unaccounted'.padEnd(18)} ${ms(run.initializeCompleteMs - accounted)}ms` +
      ` ${(((run.initializeCompleteMs - accounted) / run.initializeCompleteMs) * 100).toFixed(0).padStart(3)}%`
  );
  console.log(`    ${'open -> ready'.padEnd(18)} ${ms(run.initializeCompleteMs)}ms`);
  console.log(
    `    first search  dispatched@${ms(run.immediate.dispatchedAtMs)}ms` +
      ` firstFiles=${ms(run.immediate.firstFilesMs)}ms` +
      ` firstContents=${ms(run.immediate.firstContentsMs)}ms` +
      ` terminal@${ms(run.immediate.terminalMs)}ms` +
      ` hits=${run.immediate.filesCount}/${run.immediate.contentsCount}`
  );
  const waitedMs = run.immediate.terminalMs - run.immediate.dispatchedAtMs;
  console.log(`    first search  perceived wait ${ms(waitedMs)}ms`);
  console.log(
    `    second search  ${ms(run.settled.terminalMs - run.settled.dispatchedAtMs)}ms` +
      ` hits=${run.settled.filesCount}/${run.settled.contentsCount}`
  );
  if (run.settledFilename) {
    console.log(
      `    filename query  ${ms(run.settledFilename.terminalMs - run.settledFilename.dispatchedAtMs)}ms` +
        ` hits=${run.settledFilename.filesCount}/${run.settledFilename.contentsCount}`
    );
  }
  console.log(
    `    gates ${run.gates.map(({ gate, elapsedMs }) => `${gate}=${elapsedMs}ms`).join(' ') || '-'}`
  );
  console.log(`    database ${mib(run.databaseBytes)} peakRss ${mib(run.peakRssBytes)}`);
  if (run.fsOperations) {
    const perFile = run.fsOperations.total / Math.max(1, run.indexedFileCount);
    console.log(
      `    fs operations ${run.fsOperations.total} (${perFile.toFixed(1)} per indexed file)`
    );
  }
};

const runScale = async (scale, options) => {
  const corpus = options.root
    ? {
        rootPath: await realpath(resolve(options.root)),
        fileCount: undefined,
        textBytes: undefined,
        dirtyCandidates: []
      }
    : await createIndexingCorpus(scale);
  const label = options.root ? `root:${corpus.rootPath}` : scale;
  console.log(`\n=== ${label} ===`);
  if (corpus.fileCount !== undefined) {
    console.log(
      `  corpus files=${corpus.fileCount} text=${corpus.textFileCount}` +
        ` cjk=${corpus.cjkFileCount} textBytes=${mib(corpus.textBytes)}` +
        ` directories=${corpus.directoryCount} excluded=${corpus.excludedFileCount}`
    );
  }
  const workspace = await createBenchWorkspace(`bench-${scale}`);
  const filenameQuery = corpus.uniqueNeedlePath?.split('/').at(-1);
  const probe = async (extra = {}) =>
    await runOpenDirectoryProbe({
      rootPath: corpus.rootPath,
      databasePath: workspace.databasePath,
      query: options.query,
      filenameQuery,
      ...extra
    });
  const cold = await probe();
  printRun('cold (no database)', cold);
  const warm = await probe();
  printRun('warm (reusable database, nothing changed)', warm);
  let warmDirty;
  if (!options.root && options.dirty > 0) {
    const dirty = await dirtyCorpusFiles(corpus, options.dirty);
    try {
      warmDirty = await probe();
      printRun(`warm-dirty (${dirty.changedPaths.length} files rewritten)`, warmDirty);
    } finally {
      await dirty.restore();
    }
  }
  let coldFsOps;
  if (options.fsOps) {
    const counted = await createBenchWorkspace(`bench-${scale}-fsops`);
    coldFsOps = await runOpenDirectoryProbe({
      rootPath: corpus.rootPath,
      databasePath: counted.databasePath,
      query: options.query,
      countFsOperations: true,
      sampleRss: false
    });
    console.log(
      `\n  cold filesystem operations (timings distorted by async_hooks, ignore them)` +
        `\n    total=${coldFsOps.fsOperations.total}` +
        ` perIndexedFile=${(coldFsOps.fsOperations.total / Math.max(1, coldFsOps.indexedFileCount)).toFixed(1)}` +
        `\n    ${JSON.stringify(coldFsOps.fsOperations.byType)}`
    );
  }
  return {
    scale: label,
    corpus: { ...corpus, dirtyCandidates: undefined },
    cold,
    warm,
    warmDirty,
    coldFsOps
  };
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  console.log(`node ${process.version} platform=${process.platform} arch=${process.arch}`);
  const runs = [];
  for (const scale of options.scales) runs.push(await runScale(scale, options));
  if (options.json) {
    const target = resolve(options.json);
    await mkdir(join(target, '..'), { recursive: true });
    const serializable = runs.map((run) => ({
      ...run,
      cold: { ...run.cold, events: undefined },
      warm: { ...run.warm, events: undefined },
      warmDirty: run.warmDirty ? { ...run.warmDirty, events: undefined } : undefined,
      coldFsOps: run.coldFsOps ? { ...run.coldFsOps, events: undefined } : undefined
    }));
    await writeFile(target, `${JSON.stringify(serializable, null, 2)}\n`);
    console.log(`\nwrote ${target}`);
  }
};

await main();
