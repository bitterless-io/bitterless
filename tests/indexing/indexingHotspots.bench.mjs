/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createHash } from 'node:crypto';
import { realpath, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { splitContentDefinedChunks } from '../../src/preload/onlypreview/search/core/chunking.mjs';
import {
  extractCjkPostingTokens,
  normalizeSearchText
} from '../../src/preload/onlypreview/search/core/normalization.mjs';
import { OnlyPreviewSqliteIndex } from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import {
  countWorkspaceSearchEntries,
  createWorkspaceTraversal
} from '../../src/preload/onlypreview/search/core/traversal.mjs';
import { createBackgroundWorkSlicer } from '../../src/preload/onlypreview/search/core/work-slicer.mjs';
import { loadOnlyPreviewWorkspaceConfig } from '../../src/preload/onlypreview/search/core/workspace-config.mjs';
import { CORPUS_SCALES, CORPUS_WORK_ROOT, createIndexingCorpus } from './corpus.mjs';

const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

const neverPause = () => createBackgroundWorkSlicer({ sliceMs: Number.POSITIVE_INFINITY });

const parseArguments = (argv) => {
  const options = { scale: 'small', root: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => argv[(index += 1)];
    if (argument === '--scale') options.scale = next();
    else if (argument === '--root') options.root = next();
    else throw new TypeError(`Unknown argument: ${argument}`);
  }
  if (!options.root && !CORPUS_SCALES[options.scale]) {
    throw new TypeError(`Unknown scale: ${options.scale}`);
  }
  return options;
};

const measure = async (label, textBytes, run) => {
  const startedAt = performance.now();
  const detail = await run();
  const elapsedMs = performance.now() - startedAt;
  const throughput =
    textBytes > 0 ? `${(textBytes / 1024 ** 2 / (elapsedMs / 1000)).toFixed(1)} MiB/s` : '';
  console.log(
    `  ${label.padEnd(34)} ${elapsedMs.toFixed(0).padStart(7)}ms  ${throughput.padStart(11)}` +
      (detail ? `  ${detail}` : '')
  );
  return elapsedMs;
};

const drain = async (iterable, onEntry) => {
  let count = 0;
  for await (const entry of iterable) {
    count += 1;
    onEntry?.(entry);
  }
  return count;
};

const memoryEntries = (entries) => ({
  async *[Symbol.asyncIterator]() {
    for (const entry of entries) yield entry;
  }
});

const rebuildInto = async (databasePath, entries, identity, workSlicer) => {
  await rm(databasePath, { force: true });
  await rm(`${databasePath}-wal`, { force: true });
  await rm(`${databasePath}-shm`, { force: true });
  const index = new OnlyPreviewSqliteIndex(databasePath);
  try {
    const outcome = await index.rebuild(memoryEntries(entries), identity, { workSlicer });
    return `files=${outcome.fileCount} chunks=${outcome.chunkCount}`;
  } finally {
    index.close();
  }
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  const corpus = options.root
    ? { rootPath: await realpath(resolve(options.root)), textBytes: 0, fileCount: undefined }
    : await createIndexingCorpus(options.scale);
  const config = await loadOnlyPreviewWorkspaceConfig(corpus.rootPath);
  const identity = {
    workspaceHash: createHash('sha256').update(corpus.rootPath).digest('hex'),
    configHash: config.hash,
    engineHash: 'hotspot-bench'
  };
  const databasePath = join(CORPUS_WORK_ROOT, 'hotspots', 'search.sqlite');
  await rm(join(CORPUS_WORK_ROOT, 'hotspots'), { recursive: true, force: true });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(CORPUS_WORK_ROOT, 'hotspots'), { recursive: true });

  console.log(`node ${process.version} platform=${process.platform} arch=${process.arch}`);
  console.log(
    `\n=== ${options.root ?? options.scale} ===` +
      (corpus.fileCount === undefined
        ? ''
        : `\n  files=${corpus.fileCount} text=${corpus.textFileCount} textBytes=${(corpus.textBytes / 1024 ** 2).toFixed(1)}MiB`)
  );

  console.log('\n  filesystem stages');
  await measure('count-traversal (progress total)', corpus.textBytes, async () => {
    const total = await countWorkspaceSearchEntries({
      rootPath: corpus.rootPath,
      config,
      isCancelled: () => false
    });
    return `entries=${total}`;
  });
  await measure('walk-metadata (no body reads)', corpus.textBytes, async () => {
    const traversal = await createWorkspaceTraversal({
      rootPath: corpus.rootPath,
      config,
      collectTreeEntries: false,
      metadataOnly: true
    });
    return `entries=${await drain(traversal.entries)}`;
  });
  const collected = [];
  await measure('walk-read (bodies, no SQLite)', corpus.textBytes, async () => {
    const traversal = await createWorkspaceTraversal({
      rootPath: corpus.rootPath,
      config,
      collectTreeEntries: false
    });
    return `entries=${await drain(traversal.entries, (entry) => collected.push(entry))}`;
  });
  await measure('walk-read without slicer pauses', corpus.textBytes, async () => {
    const traversal = await createWorkspaceTraversal({
      rootPath: corpus.rootPath,
      config,
      collectTreeEntries: false,
      workSlicer: neverPause()
    });
    return `entries=${await drain(traversal.entries)}`;
  });

  const bodies = collected
    .filter((entry) => entry.contentIndexed && entry.originalContent)
    .map((entry) => entry.originalContent);
  const bodyBytes = bodies.reduce((total, body) => total + Buffer.byteLength(body), 0);

  console.log('\n  content pipeline (in memory, no filesystem)');
  await measure('grapheme materialization only', bodyBytes, async () => {
    let graphemes = 0;
    for (const body of bodies) {
      graphemes += [...graphemeSegmenter.segment(body)].map(({ segment }) => segment).length;
    }
    return `graphemes=${graphemes}`;
  });
  let chunks = [];
  await measure('splitContentDefinedChunks', bodyBytes, async () => {
    chunks = [];
    for (const body of bodies) chunks.push(...splitContentDefinedChunks(body));
    return `chunks=${chunks.length}`;
  });
  await measure('extractCjkPostingTokens', bodyBytes, async () => {
    let tokens = 0;
    for (const chunk of chunks)
      tokens += extractCjkPostingTokens(chunk.normalizedSearchableText).length;
    return `tokens=${tokens}`;
  });
  await measure('normalizeSearchText over bodies', bodyBytes, async () => {
    let length = 0;
    for (const body of bodies) length += normalizeSearchText(body).length;
    return `chars=${length}`;
  });

  console.log('\n  SQLite write stages (entries already in memory)');
  const metadataOnlyEntries = collected.map((entry) => ({
    ...entry,
    contentIndexed: false,
    originalContent: ''
  }));
  await measure(
    'rebuild rows only (no content)',
    corpus.textBytes,
    async () => await rebuildInto(databasePath, metadataOnlyEntries, identity, neverPause())
  );
  await measure(
    'rebuild full (chunks + FTS + CJK)',
    corpus.textBytes,
    async () => await rebuildInto(databasePath, collected, identity, neverPause())
  );
  await measure(
    'rebuild full with slicer pauses',
    corpus.textBytes,
    async () => await rebuildInto(databasePath, collected, identity, createBackgroundWorkSlicer())
  );
  await rm(join(CORPUS_WORK_ROOT, 'hotspots'), { recursive: true, force: true });
};

await main();
