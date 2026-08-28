/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createHook } from 'node:async_hooks';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createOnlyPreviewSearchDiagnostics } from '../../src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';
import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import { CORPUS_WORK_ROOT } from './corpus.mjs';

const FS_RESOURCE_TYPES = new Set([
  'FSREQCALLBACK',
  'FSREQPROMISE',
  'DIRHANDLE',
  'FILEHANDLE',
  'FILEHANDLECLOSEREQ',
  'STATWATCHER'
]);

const WORKSPACE_ID = 'indexing-bench';

const nextTurn = async () => await new Promise((resolve) => setImmediate(resolve));

const parseDiagnosticLine = (line) => {
  const fields = {};
  let event;
  for (const token of line.split(' ')) {
    const separator = token.indexOf('=');
    if (separator <= 0) continue;
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (key === 'event') event = value;
    else if (value === 'true' || value === 'false') fields[key] = value === 'true';
    else fields[key] = /^\d+$/.test(value) ? Number(value) : value;
  }
  return { event, fields };
};

export const createPhaseRecorder = () => {
  const origin = performance.now();
  const events = [];
  const diagnostics = createOnlyPreviewSearchDiagnostics({
    clock: () => performance.now(),
    write: (line) => {
      const parsed = parseDiagnosticLine(line);
      if (parsed.event) events.push({ ...parsed, atMs: performance.now() - origin });
    }
  });
  const phase = (event, key = 'elapsedMs') => {
    const record = events.find((entry) => entry.event === event);
    return record ? record.fields[key] : undefined;
  };
  return { diagnostics, events, origin, phase };
};

const createRssSampler = () => {
  let peak = process.memoryUsage.rss();
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage.rss());
  }, 25);
  timer.unref();
  return {
    stop: () => {
      clearInterval(timer);
      peak = Math.max(peak, process.memoryUsage.rss());
      return peak;
    }
  };
};

const createFsOperationCounter = () => {
  const counts = new Map();
  const hook = createHook({
    init: (_id, type) => {
      if (!FS_RESOURCE_TYPES.has(type)) return;
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
  });
  hook.enable();
  return {
    stop: () => {
      hook.disable();
      let total = 0;
      for (const value of counts.values()) total += value;
      return { total, byType: Object.fromEntries([...counts.entries()].sort()) };
    }
  };
};

export const createBenchWorkspace = async (label) => {
  const directoryPath = join(CORPUS_WORK_ROOT, label);
  await rm(directoryPath, { recursive: true, force: true });
  await mkdir(directoryPath, { recursive: true });
  return { directoryPath, databasePath: join(directoryPath, 'search.sqlite') };
};

const fileBytes = async (path) => (await stat(path).catch(() => undefined))?.size ?? 0;

const databaseBytes = async (databasePath) =>
  (await fileBytes(databasePath)) +
  (await fileBytes(`${databasePath}-wal`)) +
  (await fileBytes(`${databasePath}-shm`));

const dispatchSearch = ({ engine, generation, requestId, query, origin, maxResults }) => {
  const sections = { files: undefined, contents: undefined };
  const dispatchedAtMs = performance.now() - origin;
  let batchCount = 0;
  const pending = engine
    .search({
      workspaceId: WORKSPACE_ID,
      generation,
      requestId,
      query,
      maxResults,
      scope: { kind: 'project' },
      isCancelled: () => false,
      onResult: (result) => {
        batchCount += 1;
        const section = result?.section ?? result?.result?.section;
        if (section && sections[section] === undefined) {
          sections[section] = performance.now() - origin;
        }
      }
    })
    .then((response) => ({
      dispatchedAtMs,
      firstFilesMs: sections.files,
      firstContentsMs: sections.contents,
      terminalMs: performance.now() - origin,
      batchCount,
      filesCount: response.files.length,
      contentsCount: response.contents.length
    }));
  return pending;
};

/**
 * Drives the real search engine through the interval a user feels: open a directory, then run the
 * first Global Search while startup work is still in flight, then run a second search once every
 * gate is open.
 */
export const runOpenDirectoryProbe = async ({
  rootPath,
  databasePath,
  query,
  filenameQuery,
  maxResults = 100,
  generation = 1,
  countFsOperations = false,
  sampleRss = true
}) => {
  const recorder = createPhaseRecorder();
  const rss = sampleRss ? createRssSampler() : undefined;
  const fsCounter = countFsOperations ? createFsOperationCounter() : undefined;
  const progress = { ticks: 0, phases: new Set() };
  const engine = createOnlyPreviewSearchEngine({
    diagnostics: recorder.diagnostics,
    onProgress: (tick) => {
      progress.ticks += 1;
      if (tick?.phase) progress.phases.add(tick.phase);
    }
  });
  try {
    const initializing = engine.initialize({
      workspaceId: WORKSPACE_ID,
      generation,
      rootPath,
      databasePath
    });
    let acceptedAtMs;
    while (engine.browseIndex === undefined || engine.workspaceId !== WORKSPACE_ID) {
      if (await Promise.race([initializing.then(() => true), nextTurn().then(() => false)])) break;
    }
    acceptedAtMs = performance.now() - recorder.origin;
    const immediate = dispatchSearch({
      engine,
      generation,
      requestId: 'immediate',
      query,
      origin: recorder.origin,
      maxResults
    });
    const [initializeResult, immediateResult] = await Promise.all([initializing, immediate]);
    const initializeCompleteMs = performance.now() - recorder.origin;
    const settledResult = await dispatchSearch({
      engine,
      generation,
      requestId: 'settled',
      query,
      origin: recorder.origin,
      maxResults
    });
    const filenameResult = filenameQuery
      ? await dispatchSearch({
          engine,
          generation,
          requestId: 'settled-filename',
          query: filenameQuery,
          origin: recorder.origin,
          maxResults
        })
      : undefined;
    const fsOperations = fsCounter?.stop();
    return {
      acceptedAtMs,
      initializeCompleteMs,
      immediate: immediateResult,
      settled: settledResult,
      settledFilename: filenameResult,
      indexedFileCount: initializeResult.index.entries.filter((entry) => entry.nodeKind === 'file')
        .length,
      treeEntryCount: initializeResult.index.entries.length,
      progressTicks: progress.ticks,
      progressPhases: [...progress.phases],
      databaseBytes: await databaseBytes(databasePath),
      peakRssBytes: rss?.stop(),
      fsOperations,
      phases: {
        sqliteOpenMs: recorder.phase('sqlite-open'),
        sqliteReusable: recorder.events.find((entry) => entry.event === 'sqlite-open')?.fields
          .reusable,
        rootListingMs: recorder.phase('root-listing'),
        fullCountMs: recorder.phase('full-count'),
        fullCount: recorder.phase('full-count', 'count'),
        candidateBackupMs: recorder.phase('candidate-backup'),
        candidateBackupMode: recorder.events.find((entry) => entry.event === 'candidate-backup')
          ?.fields.mode,
        traversalIndexMs: recorder.phase('traversal-index'),
        traversalIndexMode: recorder.events.find((entry) => entry.event === 'traversal-index')
          ?.fields.mode,
        traversalIndexCount: recorder.phase('traversal-index', 'count'),
        promotionWaitMs: recorder.phase('promotion-wait'),
        promotionCommitMs: recorder.phase('promotion-commit'),
        initializeTerminalMs: recorder.phase('initialize-terminal')
      },
      gates: recorder.events
        .filter((entry) => entry.event === 'search-gate')
        .map((entry) => ({ gate: entry.fields.gate, elapsedMs: entry.fields.elapsedMs })),
      events: recorder.events
    };
  } finally {
    if (rss) rss.stop();
    await engine.shutdown();
  }
};
