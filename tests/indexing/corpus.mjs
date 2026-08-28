/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const BENCH_ROOT = resolve(import.meta.dirname, '../../tmp/indexing-bench');

export const CORPUS_CACHE_ROOT = join(BENCH_ROOT, 'corpus');
export const CORPUS_WORK_ROOT = join(BENCH_ROOT, 'work');

export const UNIQUE_NEEDLE = 'zqxjvk-unique-benchmark-needle';
export const COMMON_NEEDLE = 'handleWorkspaceRequest';
export const CJK_NEEDLE = '索引性能探针';

export const CORPUS_SCALES = Object.freeze({
  tiny: Object.freeze({ files: 240, filesPerDirectory: 8, maxDepth: 4, seed: 11 }),
  small: Object.freeze({ files: 1_200, filesPerDirectory: 10, maxDepth: 5, seed: 21 }),
  medium: Object.freeze({ files: 6_000, filesPerDirectory: 12, maxDepth: 6, seed: 31 }),
  large: Object.freeze({ files: 20_000, filesPerDirectory: 14, maxDepth: 7, seed: 41 })
});

const TEXT_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.md', '.json', '.vue', '.less', '.py', '.yml'];
const OPAQUE_EXTENSIONS = ['.png', '.pdf', '.xlsx', '.mp4', '.docx'];

const CODE_LINES = [
  'import { createWorkspaceTraversal } from "../core/traversal.mjs";',
  'export const handleWorkspaceRequest = async (context, options) => {',
  '  const resolved = await context.resolveDescriptor(options.relativePath);',
  '  if (!resolved) throw new TypeError("descriptor is not available");',
  '  return { descriptor: resolved, generation: context.generation };',
  '};',
  'const shouldRetainCandidate = (previous, next) => previous.hash !== next.hash;',
  'export const formatDurationLabel = (milliseconds) => `${Math.round(milliseconds)}ms`;',
  '// The reader lease captures one consistent index and tree pair per query.',
  'const excludedDirectoryNames = new Set(["cache", "temporary", "artifacts"]);'
];

const CJK_LINES = [
  '这一段内容用于验证中文分词与倒排索引的写入开销。',
  '预览窗口打开目录之后，第一次搜索必须尽快返回首批结果。',
  '// 说明：候选库提升之前，读取的是上一次提交的快照。',
  '索引深度限制为三十二层，超过之后只记录截断标记。'
];

const mulberry32 = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = (random, values) => values[Math.floor(random() * values.length)];

const buildTextBody = (random, targetBytes, cjk) => {
  const lines = cjk ? CJK_LINES : CODE_LINES;
  const parts = [];
  let length = 0;
  let ordinal = 0;
  while (length < targetBytes) {
    const line = `${pick(random, lines)} // ${ordinal.toString(36)}`;
    parts.push(line);
    length += line.length + 1;
    ordinal += 1;
  }
  return `${parts.join('\n')}\n`;
};

// Calibrated against this repository's own src/ tree: 1269 files, 12.0MB, 9.4KB average.
const targetTextBytes = (random) => {
  const roll = random();
  if (roll < 0.6) return 300 + Math.floor(random() * 2_700);
  if (roll < 0.92) return 3_000 + Math.floor(random() * 12_000);
  if (roll < 0.992) return 15_000 + Math.floor(random() * 45_000);
  return 120_000 + Math.floor(random() * 280_000);
};

const planDirectories = (random, { files, filesPerDirectory, maxDepth }) => {
  const directories = [''];
  const target = Math.max(1, Math.ceil(files / filesPerDirectory));
  const segmentNames = ['core', 'views', 'store', 'service', 'shared', 'module', 'runtime', 'spec'];
  let ordinal = 0;
  while (directories.length < target) {
    const parent = directories[Math.floor(random() * directories.length)];
    const depth = parent === '' ? 1 : parent.split('/').length + 1;
    if (depth > maxDepth) continue;
    const candidate = parent
      ? `${parent}/${pick(random, segmentNames)}-${ordinal.toString(36)}`
      : `${pick(random, segmentNames)}-${ordinal.toString(36)}`;
    ordinal += 1;
    directories.push(candidate);
  }
  return directories;
};

const planFiles = (random, options) => {
  const directories = planDirectories(random, options);
  const planned = [];
  for (let index = 0; index < options.files; index += 1) {
    const directory = directories[index % directories.length];
    const opaque = random() < 0.16;
    const extension = opaque ? pick(random, OPAQUE_EXTENSIONS) : pick(random, TEXT_EXTENSIONS);
    const relativePath = `${directory ? `${directory}/` : ''}entry-${index.toString(36)}${extension}`;
    planned.push({
      relativePath,
      opaque,
      cjk: !opaque && random() < 0.12,
      bytes: opaque ? 2_048 + Math.floor(random() * 30_000) : targetTextBytes(random)
    });
  }
  return { directories, planned };
};

const excludedNoise = (random) => {
  const paths = [];
  for (let index = 0; index < 80; index += 1) {
    const bucket = pick(random, ['node_modules/left', 'node_modules/right/deep', 'dist', '.cache']);
    paths.push(`${bucket}/noise-${index.toString(36)}.js`);
  }
  return paths;
};

const corpusSignature = (options) =>
  createHash('sha256')
    .update(JSON.stringify({ ...options, revision: 3 }))
    .digest('hex')
    .slice(0, 16);

const writeBatched = async (entries, limit = 64) => {
  for (let index = 0; index < entries.length; index += limit) {
    await Promise.all(
      entries.slice(index, index + limit).map(async ({ absolutePath, body }) => {
        await writeFile(absolutePath, body);
      })
    );
  }
};

/**
 * Builds - or reuses - a deterministic workspace so two machines index identical bytes. The cache
 * key covers every generator input, so tuning the generator produces a new corpus instead of a
 * silently mixed one.
 */
export const createIndexingCorpus = async (scaleOrOptions = 'small') => {
  const options =
    typeof scaleOrOptions === 'string' ? CORPUS_SCALES[scaleOrOptions] : scaleOrOptions;
  if (!options) throw new TypeError(`Unknown corpus scale: ${String(scaleOrOptions)}`);
  const signature = corpusSignature(options);
  const cachePath = join(CORPUS_CACHE_ROOT, signature);
  const manifestPath = join(cachePath, 'manifest.json');
  const rootPath = join(cachePath, 'root');
  const existing = await readFile(manifestPath, 'utf8').catch(() => undefined);
  if (existing) {
    const manifest = JSON.parse(existing);
    return { ...manifest, rootPath: await realpath(rootPath) };
  }
  await rm(cachePath, { recursive: true, force: true });
  const random = mulberry32(options.seed);
  const { directories, planned } = planFiles(random, options);
  const noise = excludedNoise(random);
  const uniqueIndex = Math.floor(planned.length * 0.61);
  await mkdir(rootPath, { recursive: true });
  await Promise.all(
    directories
      .filter(Boolean)
      .map(async (directory) => await mkdir(join(rootPath, directory), { recursive: true }))
  );
  let textFileCount = 0;
  let textBytes = 0;
  let cjkFileCount = 0;
  const entries = [];
  const dirtyCandidates = [];
  for (const [index, file] of planned.entries()) {
    const absolutePath = join(rootPath, file.relativePath);
    if (file.opaque) {
      entries.push({ absolutePath, body: Buffer.alloc(file.bytes, index % 251) });
      continue;
    }
    let body = buildTextBody(random, file.bytes, file.cjk);
    if (index === uniqueIndex) body = `${UNIQUE_NEEDLE}\n${body}`;
    if (file.cjk) {
      body = `${CJK_NEEDLE}\n${body}`;
      cjkFileCount += 1;
    }
    textFileCount += 1;
    textBytes += Buffer.byteLength(body);
    if (dirtyCandidates.length < 512 && textFileCount % 7 === 0) {
      dirtyCandidates.push(file.relativePath);
    }
    entries.push({ absolutePath, body });
  }
  for (const relativePath of noise) {
    const absolutePath = join(rootPath, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    entries.push({ absolutePath, body: 'excluded noise payload\n' });
  }
  await writeBatched(entries);
  const manifest = {
    signature,
    options,
    fileCount: planned.length,
    directoryCount: directories.filter(Boolean).length,
    textFileCount,
    cjkFileCount,
    textBytes,
    excludedFileCount: noise.length,
    uniqueNeedlePath: planned[uniqueIndex].relativePath,
    dirtyCandidates
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { ...manifest, rootPath: await realpath(rootPath) };
};

export const DIRTY_MARKER_PREFIX = '// indexing benchmark rewrite ';

const CORPUS_STATE_ROOT = join(BENCH_ROOT, 'state');
const CORPUS_HOLDING_ROOT = join(BENCH_ROOT, 'holding');

/** A per-file token so a test can prove that exactly the edited file became findable. */
export const dirtyTokenFor = (relativePath) =>
  `dirty-${createHash('sha256').update(relativePath).digest('hex').slice(0, 10)}`;

const markerLineFor = (relativePath) => `${DIRTY_MARKER_PREFIX}${dirtyTokenFor(relativePath)}\n`;

const statePathFor = (corpus) => join(CORPUS_STATE_ROOT, `${corpus.signature}.json`);

const holdingPathFor = (corpus, relativePath) =>
  join(CORPUS_HOLDING_ROOT, corpus.signature, relativePath.replaceAll('/', '__'));

// `pending` is what a watcher would have reported since the last incremental commit; `dirtied` and
// `removed` are the deviations that currently exist on disk, which is what verification checks
// against. Keeping both means a restore is itself a change set that has to be committed.
const emptyState = () => ({ dirtied: [], removed: [], pending: [] });

/**
 * The CLI runs each lifecycle stage in its own process, so which files are currently edited or
 * removed has to live on disk rather than in a closure.
 */
export const readCorpusChangeState = async (corpus) => {
  const source = await readFile(statePathFor(corpus), 'utf8').catch(() => undefined);
  return source ? { ...emptyState(), ...JSON.parse(source) } : emptyState();
};

const writeCorpusChangeState = async (corpus, state) => {
  await mkdir(CORPUS_STATE_ROOT, { recursive: true });
  await writeFile(statePathFor(corpus), `${JSON.stringify(state, null, 2)}\n`);
};

const stripMarkers = (body) => {
  let result = body;
  while (true) {
    const lastNewline = result.lastIndexOf('\n', result.length - 2);
    const lastLine = result.slice(lastNewline + 1);
    if (!lastLine.startsWith(DIRTY_MARKER_PREFIX)) return result;
    result = result.slice(0, lastNewline + 1);
  }
};

/**
 * Appends a uniquely tokenised marker line to `count` text files, so an incremental index update can
 * be verified by searching for the token rather than by trusting a timing.
 * Takes candidates from the head of the list; removals take from the tail, so the two never overlap.
 */
export const dirtyCorpusFilesOnDisk = async (corpus, count) => {
  const selected = corpus.dirtyCandidates.slice(0, count);
  const stamp = new Date();
  const changed = [];
  for (const relativePath of selected) {
    const absolutePath = join(corpus.rootPath, relativePath);
    const body = await readFile(absolutePath, 'utf8').catch(() => undefined);
    if (body === undefined) continue;
    const marker = markerLineFor(relativePath);
    if (!body.endsWith(marker)) {
      await writeFile(absolutePath, `${stripMarkers(body)}${marker}`);
    }
    await utimes(absolutePath, stamp, stamp);
    changed.push(relativePath);
  }
  const state = await readCorpusChangeState(corpus);
  state.dirtied = [...new Set([...state.dirtied, ...changed])];
  state.pending = [...new Set([...state.pending, ...changed])];
  await writeCorpusChangeState(corpus, state);
  return changed;
};

/**
 * Moves `count` text files out of the corpus into a holding directory outside it. Removal has to be
 * a real filesystem deletion - every plan derives "this entry is gone" from the filesystem, not from
 * an explicit delete call - and it has to be reversible so the cached corpus survives.
 */
export const removeCorpusFilesOnDisk = async (corpus, count) => {
  const selected = corpus.dirtyCandidates.slice(-Math.max(0, count));
  const removed = [];
  for (const relativePath of selected) {
    const absolutePath = join(corpus.rootPath, relativePath);
    const holdingPath = holdingPathFor(corpus, relativePath);
    const body = await readFile(absolutePath).catch(() => undefined);
    if (body === undefined) continue;
    await mkdir(dirname(holdingPath), { recursive: true });
    await writeFile(holdingPath, body);
    await rm(absolutePath, { force: true });
    removed.push(relativePath);
  }
  const state = await readCorpusChangeState(corpus);
  state.removed = [...new Set([...state.removed, ...removed])];
  state.dirtied = state.dirtied.filter((path) => !state.removed.includes(path));
  state.pending = [...new Set([...state.pending, ...removed])];
  await writeCorpusChangeState(corpus, state);
  return removed;
};

/** Undoes every recorded edit and removal, and reports what it had to touch. */
export const restoreCorpusOnDisk = async (corpus) => {
  const state = await readCorpusChangeState(corpus);
  const stamp = new Date();
  const restoredEdits = [];
  for (const relativePath of corpus.dirtyCandidates) {
    const absolutePath = join(corpus.rootPath, relativePath);
    const body = await readFile(absolutePath, 'utf8').catch(() => undefined);
    if (body === undefined) continue;
    const stripped = stripMarkers(body);
    if (stripped === body) continue;
    await writeFile(absolutePath, stripped);
    await utimes(absolutePath, stamp, stamp);
    restoredEdits.push(relativePath);
  }
  const restoredRemovals = [];
  for (const relativePath of state.removed) {
    const holdingPath = holdingPathFor(corpus, relativePath);
    const body = await readFile(holdingPath).catch(() => undefined);
    if (body === undefined) continue;
    const absolutePath = join(corpus.rootPath, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, body);
    await utimes(absolutePath, stamp, stamp);
    await rm(holdingPath, { force: true });
    restoredRemovals.push(relativePath);
  }
  const touched = [...new Set([...restoredEdits, ...restoredRemovals])];
  await writeCorpusChangeState(corpus, {
    dirtied: [],
    removed: [],
    pending: [...new Set([...state.pending, ...touched])]
  });
  return { restoredEdits, restoredRemovals };
};

export const clearCorpusPendingChanges = async (corpus) => {
  const state = await readCorpusChangeState(corpus);
  await writeCorpusChangeState(corpus, { ...state, pending: [] });
};

/**
 * Reads the current on-disk truth for every editable candidate, so verification never depends on a
 * recorded history: a file either carries its marker, or does not, or is gone.
 */
export const inspectCorpusCandidates = async (corpus, { sample = 8 } = {}) => {
  const edited = [];
  const pristine = [];
  const missing = [];
  for (const relativePath of corpus.dirtyCandidates) {
    const body = await readFile(join(corpus.rootPath, relativePath), 'utf8').catch(() => undefined);
    if (body === undefined) {
      missing.push(relativePath);
      continue;
    }
    if (body.endsWith(markerLineFor(relativePath))) edited.push(relativePath);
    else pristine.push(relativePath);
  }
  return {
    edited,
    pristine,
    missing,
    sampled: {
      edited: edited.slice(0, sample),
      pristine: pristine.slice(0, sample),
      missing: missing.slice(0, sample)
    }
  };
};

/**
 * In-memory variant used by the automated benchmarks, which need the exact original bytes back
 * without leaving CLI-visible state behind.
 */
export const dirtyCorpusFiles = async (corpus, count) => {
  const selected = corpus.dirtyCandidates.slice(0, count);
  const originals = [];
  for (const relativePath of selected) {
    const absolutePath = join(corpus.rootPath, relativePath);
    const body = await readFile(absolutePath);
    originals.push({ absolutePath, body });
    await writeFile(absolutePath, `${body.toString('utf8')}${markerLineFor(relativePath)}`);
  }
  return {
    changedPaths: selected,
    restore: async () => {
      const stamp = new Date();
      for (const { absolutePath, body } of originals) {
        await writeFile(absolutePath, body);
        await utimes(absolutePath, stamp, stamp);
      }
    }
  };
};

/** Removes files and hands back an exact restore, for the automated lifecycle benchmark. */
export const removeCorpusFiles = async (corpus, count) => {
  const selected = corpus.dirtyCandidates.slice(-Math.max(0, count));
  const originals = [];
  for (const relativePath of selected) {
    const absolutePath = join(corpus.rootPath, relativePath);
    const body = await readFile(absolutePath).catch(() => undefined);
    if (body === undefined) continue;
    originals.push({ absolutePath, body });
    await rm(absolutePath, { force: true });
  }
  return {
    removedPaths: originals.map(({ absolutePath }) =>
      absolutePath.slice(corpus.rootPath.length + 1).replaceAll('\\', '/')
    ),
    restore: async () => {
      const stamp = new Date();
      for (const { absolutePath, body } of originals) {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, body);
        await utimes(absolutePath, stamp, stamp);
      }
    }
  };
};

/**
 * Clones a generated corpus into a private root. Lifecycle testing mutates the corpus - edits and
 * deletions - so two processes exercising it at once would read each other's state; a private copy
 * removes that coupling entirely.
 */
export const createPrivateCorpusCopy = async (scaleOrOptions, label) => {
  const source = await createIndexingCorpus(scaleOrOptions);
  const privateRoot = join(BENCH_ROOT, 'private', label);
  const rootPath = join(privateRoot, 'root');
  await rm(privateRoot, { recursive: true, force: true });
  await mkdir(privateRoot, { recursive: true });
  await cp(source.rootPath, rootPath, { recursive: true });
  return {
    ...source,
    signature: `${source.signature}-${label}`,
    rootPath: await realpath(rootPath)
  };
};
