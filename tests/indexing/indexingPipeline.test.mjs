/* eslint-disable @typescript-eslint/explicit-function-return-type */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import ExcelJS from 'exceljs';

import {
  UNIQUE_NEEDLE,
  CORPUS_REVISION,
  buildIndexingXlsxFixture,
  createIndexingCorpus,
  dirtyCorpusFiles
} from './corpus.mjs';
import { createBenchWorkspace, runOpenDirectoryProbe } from './indexingBench.harness.mjs';

// Wall clock is reported by the benchmark CLI and never asserted here: only facts that hold on any
// machine belong in a regression guard.
const MAX_FS_OPERATIONS_PER_INDEXED_FILE = 20;

const ORDERED_COLD_PHASES = [
  'initialize-start',
  'sqlite-open',
  'root-listing',
  'full-count',
  'candidate-backup',
  'traversal-index',
  'promotion-commit',
  'initialize-terminal'
];

const probeCorpus = async (label) => {
  const corpus = await createIndexingCorpus('tiny');
  const workspace = await createBenchWorkspace(label);
  return {
    corpus,
    run: async (extra = {}) =>
      await runOpenDirectoryProbe({
        rootPath: corpus.rootPath,
        databasePath: workspace.databasePath,
        query: UNIQUE_NEEDLE,
        ...extra
      })
  };
};

test('the deterministic benchmark XLSX is built once and reused as valid OOXML', async () => {
  const fixtureModuleUrl = new URL('./corpus.mjs', import.meta.url).href;
  const fixtureHashScript = `
    import { createHash } from 'node:crypto';
    import { buildIndexingXlsxFixture } from ${JSON.stringify(fixtureModuleUrl)};
    const bytes = await buildIndexingXlsxFixture();
    process.stdout.write(createHash('sha256').update(bytes).digest('hex'));
  `;
  const timezoneHashes = ['UTC', 'Asia/Shanghai', 'America/Los_Angeles'].map((timezone) => {
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', fixtureHashScript],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, TZ: timezone }
      }
    );
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /^[a-f0-9]{64}$/u);
    return child.stdout;
  });
  assert.equal(new Set(timezoneHashes).size, 1, 'XLSX fixture bytes must not depend on timezone');

  const [firstFixture, secondFixture] = await Promise.all([
    buildIndexingXlsxFixture(),
    buildIndexingXlsxFixture()
  ]);
  assert.deepEqual(firstFixture, secondFixture);
  assert.deepEqual([...firstFixture.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);

  const corpus = await createIndexingCorpus('tiny');
  assert.equal(CORPUS_REVISION, 4);
  assert.equal(corpus.xlsxFixtureBuildCount, 1);
  const xlsxPaths = (await readdir(corpus.rootPath, { recursive: true })).filter((path) =>
    path.endsWith('.xlsx')
  );
  assert.ok(xlsxPaths.length > 1, 'the tiny corpus must exercise XLSX fixture reuse');
  const xlsxBodies = await Promise.all(
    xlsxPaths.map(async (path) => await readFile(join(corpus.rootPath, path)))
  );
  for (const body of xlsxBodies) assert.deepEqual(body, firstFixture);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(firstFixture);
  assert.equal(workbook.worksheets.length, 1);
  assert.equal(workbook.worksheets[0].getCell('A1').value, 'OnlyPreview indexing benchmark');
});

test('opening a directory the first time emits every build phase in order', async () => {
  const { corpus, run } = await probeCorpus('guard-cold');
  const cold = await run();
  const observed = cold.events.map(({ event }) => event);
  let cursor = -1;
  for (const event of ORDERED_COLD_PHASES) {
    const position = observed.indexOf(event, cursor + 1);
    assert.ok(position > cursor, `expected ${event} after position ${cursor}`);
    cursor = position;
  }
  for (const [index, entry] of cold.events.entries()) {
    if (index === 0) continue;
    assert.ok(
      entry.atMs >= cold.events[index - 1].atMs,
      'diagnostic events must be recorded in monotonic order'
    );
  }
  assert.equal(cold.phases.sqliteReusable, false);
  assert.equal(cold.phases.traversalIndexMode, 'rebuild');
  assert.equal(cold.phases.candidateBackupMode, 'fresh');
  assert.equal(cold.indexedFileCount, corpus.fileCount);
  assert.equal(cold.phases.fullCount, corpus.fileCount);
});

test('a first-build search cannot publish content before its build completes', async () => {
  const { run } = await probeCorpus('guard-cold-gate');
  const cold = await run();
  assert.ok(
    cold.gates.some(({ gate }) => gate === 'initial-tree'),
    'the first search on an empty index must wait behind the build'
  );
  assert.equal(cold.immediate.contentsCount, 1);
  assert.ok(
    cold.immediate.firstContentsMs === undefined ||
      cold.immediate.firstContentsMs >= cold.phases.traversalIndexMs,
    'no content result may precede the first build'
  );
});

test('a reusable index publishes a warm result before the reconcile terminal', async () => {
  const { run } = await probeCorpus('guard-warm');
  await run();
  const warm = await run();
  assert.equal(warm.phases.sqliteReusable, true);
  assert.equal(warm.phases.traversalIndexMode, 'reconcile');
  assert.equal(warm.phases.candidateBackupMode, 'backup');
  assert.equal(warm.immediate.contentsCount, 1);
  assert.ok(
    warm.immediate.firstContentsMs !== undefined,
    'a warm snapshot must publish at least one early batch'
  );
  assert.ok(
    warm.immediate.firstContentsMs <= warm.initializeCompleteMs,
    'the warm batch must be published no later than the reconcile terminal'
  );
  assert.ok(
    warm.gates.some(({ gate }) => gate === 'initial-tree'),
    'the warm request must still terminal-replace against the promoted snapshot'
  );
});

test('reconciling an unchanged workspace is stable and finds the same rows', async () => {
  const { corpus, run } = await probeCorpus('guard-stable');
  await run();
  const first = await run();
  const second = await run();
  assert.equal(first.indexedFileCount, corpus.fileCount);
  assert.equal(second.indexedFileCount, first.indexedFileCount);
  assert.equal(second.treeEntryCount, first.treeEntryCount);
  assert.equal(second.settled.contentsCount, first.settled.contentsCount);
});

test('a bounded rewrite is reconciled without changing the indexed row count', async () => {
  const { corpus, run } = await probeCorpus('guard-dirty');
  await run();
  const dirty = await dirtyCorpusFiles(corpus, 8);
  try {
    const reconciled = await run();
    assert.equal(reconciled.phases.traversalIndexMode, 'reconcile');
    assert.equal(reconciled.indexedFileCount, corpus.fileCount);
    assert.equal(reconciled.settled.contentsCount, 1);
  } finally {
    await dirty.restore();
  }
});

test('a first build stays under the filesystem-operation ceiling per indexed file', async () => {
  const { run } = await probeCorpus('guard-fs-ops');
  const cold = await run({ countFsOperations: true, sampleRss: false });
  const perFile = cold.fsOperations.total / cold.indexedFileCount;
  assert.ok(
    perFile <= MAX_FS_OPERATIONS_PER_INDEXED_FILE,
    `first build used ${perFile.toFixed(1)} filesystem operations per indexed file, ceiling is ${MAX_FS_OPERATIONS_PER_INDEXED_FILE}`
  );
});
