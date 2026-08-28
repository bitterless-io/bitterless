/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { lstat, readFile, rename, rm, stat } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';

import { splitContentDefinedChunks } from '../../../src/preload/onlypreview/search/core/chunking.mjs';
import {
  classifySearchMediaType,
  decodeSearchText,
  isSensitiveSearchFile
} from '../../../src/preload/onlypreview/search/core/classification.mjs';
import {
  MAX_INDEX_DEPTH,
  MAX_TEXT_BYTES,
  MAX_WATCH_CHANGE_PATHS
} from '../../../src/preload/onlypreview/search/core/constants.mjs';
import {
  createPlainTextSnippet,
  extractCjkPostingTokens,
  isIndexedShortQuery,
  normalizeSearchText,
  projectNormalizedMatchToSource
} from '../../../src/preload/onlypreview/search/core/normalization.mjs';
import { clampSearchResultLimit } from '../../../src/preload/onlypreview/search/core/search-contract.mjs';
import { isWorkspaceSearchPathWithinDepth } from '../../../src/preload/onlypreview/search/core/traversal.mjs';
import { loadOnlyPreviewWorkspaceConfig } from '../../../src/preload/onlypreview/search/core/workspace-config.mjs';
import { createMetadataStore, scopeRange } from './metadataStore.mjs';
import {
  assertSearchOutcome,
  createTimeline,
  definePlan,
  directoryBytes,
  directoryScope,
  readIndexCompleteness,
  requirePlanScope,
  writeIndexMeta
} from './planContract.mjs';
import { createTraversalPolicy, walkWorkspace } from './walker.mjs';

const META_DATABASE_NAME = 'meta.sqlite';
const CONTENT_DATABASE_NAME = 'content.sqlite';
const BUILDING_META_NAME = 'meta.building.sqlite';
const BUILDING_CONTENT_NAME = 'content.building.sqlite';

/** One transaction per this many chunks, instead of the shipped engine's one per ten files. */
const TRANSACTION_CHUNKS = 2000;
const BATCH_FILES = 24;
const BATCH_BYTES = 2 * 1024 * 1024;
const SECTION_CAP = 250;
/** Below this share of the corpus a scope is materialised instead of range-scanned. */
const TEMP_TABLE_SHARE = 0.25;
/** Below this many changed files an incremental commit chunks inline instead of spawning workers. */
const POOL_MIN_FILES = 32;

const CONTENT_EPOCH_KEY = 'buildEpoch';
const META_EPOCH_KEY = 'plan-b:build-epoch';
const FILE_COUNT_KEY = 'plan-b:file-count';
const DIRECTORY_COUNT_KEY = 'plan-b:directory-count';

const CONTENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS content_files (
    id INTEGER PRIMARY KEY,
    relative_path TEXT NOT NULL UNIQUE,
    dir_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_ms INTEGER NOT NULL,
    media_type TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS content_files_dir ON content_files(dir_path, relative_path);
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    core_text TEXT NOT NULL,
    left_context_text TEXT NOT NULL,
    right_overlap_text TEXT NOT NULL,
    normalized_searchable TEXT NOT NULL,
    normalized_core_length INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chunks_file_ordinal ON chunks(file_id, ordinal);
  CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
    searchable,
    content = '',
    contentless_delete = 1,
    tokenize = 'trigram'
  );
  CREATE TABLE IF NOT EXISTS cjk_postings (
    token TEXT NOT NULL,
    chunk_id INTEGER NOT NULL,
    PRIMARY KEY (token, chunk_id)
  ) WITHOUT ROWID;
  CREATE INDEX IF NOT EXISTS cjk_postings_chunk ON cjk_postings(chunk_id);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
`;

/**
 * `synchronous = OFF` belongs only on a database a crash is allowed to destroy: the building files
 * are renamed into place or thrown away, so losing them costs nothing. The live pair is mutated in
 * place by refresh and apply, where a power loss must still leave a readable index - and NORMAL is
 * also what plan A's connection uses, which is what makes B's write numbers comparable to A's.
 */
const writePragmas = (durability) => `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = ${durability === 'building' ? 'OFF' : 'NORMAL'};
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -65536;
`;

const contentPathFor = (indexDir) => join(indexDir, CONTENT_DATABASE_NAME);
const metaPathFor = (indexDir) => join(indexDir, META_DATABASE_NAME);

const sidecarPaths = (databasePath) => [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];

const removeDatabase = async (databasePath) => {
  for (const path of sidecarPaths(databasePath)) await rm(path, { force: true });
};

const fileExists = async (path) =>
  await stat(path).then(
    () => true,
    () => false
  );

const isContentEligible = (file) =>
  file.mediaType === 'text' &&
  file.size <= MAX_TEXT_BYTES &&
  !isSensitiveSearchFile(file.relativePath);

const fileNameOf = (relativePath) => relativePath.split('/').at(-1) ?? relativePath;

const pathPartsOf = (relativePath) => {
  const separator = relativePath.lastIndexOf('/');
  return {
    relativePath,
    parentRelativePath: separator < 0 ? '' : relativePath.slice(0, separator),
    name: separator < 0 ? relativePath : relativePath.slice(separator + 1)
  };
};

const ancestorDirectoriesOf = (relativePath) => {
  const segments = relativePath.split('/');
  const ancestors = [];
  for (let index = 1; index < segments.length; index += 1) {
    ancestors.push(segments.slice(0, index).join('/'));
  }
  return ancestors;
};

/**
 * A watcher hands over relative paths, so a path that is absolute, escapes the workspace, or is not
 * a path at all has to be rejected rather than joined onto the root and quietly indexed.
 */
const requireChangePath = (value) => {
  const valid =
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 16_384 &&
    !value.includes('\0') &&
    !value.startsWith('/') &&
    !value.includes('\\') &&
    !/^[a-zA-Z]:/u.test(value) &&
    !value.split('/').some((segment) => !segment || segment === '.' || segment === '..');
  if (!valid) throw new TypeError(`Invalid change path: ${JSON.stringify(value)}`);
  return value;
};

const segmentCount = (relativePath) => relativePath.split('/').length;

/**
 * Enumerates one directory of the workspace the way a root walk would have seen it. `walkWorkspace`
 * reports paths relative to the root it is handed and counts depth from there, so both have to be
 * re-anchored: the traversal policy is asked about the workspace-relative path, and the depth limit
 * is re-applied to it - a directory at exactly MAX_INDEX_DEPTH is indexed but never descended into,
 * which is where the file limit and the directory limit differ by one.
 */
const walkSubtree = async ({ rootPath, relativePath, policy }) => {
  const prefixed = (value) => `${relativePath}/${value}`;
  const scopedPolicy = {
    rules: policy.rules,
    isExcludedFilePath: (value) => policy.isExcludedFilePath(prefixed(value)),
    isExcludedDirectoryPath: (value) => policy.isExcludedDirectoryPath(prefixed(value)),
    canTraverseExcludedDirectoryPath: (value) =>
      policy.canTraverseExcludedDirectoryPath(prefixed(value))
  };
  const dirs = [];
  const files = [];
  await walkWorkspace({
    rootPath: join(rootPath, ...relativePath.split('/')),
    policy: scopedPolicy,
    onDirectory: (entry) => {
      const fullPath = prefixed(entry.relativePath);
      if (segmentCount(fullPath) > MAX_INDEX_DEPTH) return;
      dirs.push(pathPartsOf(fullPath));
    },
    onFile: (entry) => {
      const fullPath = prefixed(entry.relativePath);
      if (!isWorkspaceSearchPathWithinDepth(fullPath)) return;
      files.push({
        ...pathPartsOf(fullPath),
        size: entry.size,
        modifiedMs: entry.modifiedMs,
        mediaType: classifySearchMediaType(fullPath)
      });
    }
  });
  return { dirs, files };
};

/**
 * The two tiers carry the same build epoch, and the value only ever goes up. A mutation stamps the
 * content tier before it touches anything and the metadata tier after it is done, so an interrupted
 * refresh leaves the pair disagreeing - which `load` refuses and `refresh` repairs.
 */
const nextBuildEpoch = (previous) =>
  Math.max(Number.isFinite(previous) ? previous + 1 : 0, Date.now());

const contentEpochOf = (database) =>
  Number(
    database.prepare('SELECT value FROM meta WHERE key = ?').get(CONTENT_EPOCH_KEY)?.value ?? -1
  );

/** Zero-copy handoff to a worker: fs.readFile hands back an exactly sized, unpooled buffer. */
const detachBytes = (buffer) =>
  buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
    ? buffer.buffer
    : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

const createChunkPool = ({ size = Math.max(1, availableParallelism() - 2) } = {}) => {
  const workers = Array.from(
    { length: size },
    () => new Worker(new URL('./planB.chunk.worker.mjs', import.meta.url))
  );
  const idle = [...workers];
  const waiting = [];
  let nextId = 0;

  const acquire = async () =>
    idle.length > 0
      ? idle.pop()
      : await new Promise((resolveWorker) => waiting.push(resolveWorker));

  const release = (worker) => {
    const next = waiting.shift();
    if (next) next(worker);
    else idle.push(worker);
  };

  const roundTrip = async (worker, files) => {
    const id = (nextId += 1);
    return await new Promise((resolveBatch, rejectBatch) => {
      const onMessage = (message) => {
        if (message.id !== id) return;
        worker.off('message', onMessage);
        worker.off('error', onError);
        resolveBatch(message);
      };
      const onError = (error) => {
        worker.off('message', onMessage);
        worker.off('error', onError);
        rejectBatch(error);
      };
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.postMessage(
        { id, files },
        files.map(({ bytes }) => bytes)
      );
    });
  };

  return {
    size,
    /**
     * An empty batch to every worker. Module loading and first-call warm-up are charged to whoever
     * awaits this instead of landing inside the first real batch. Call it while all workers are idle.
     */
    ready: async () => {
      await Promise.all(workers.map(async (worker) => await roundTrip(worker, [])));
    },
    chunk: async (files) => {
      const worker = await acquire();
      try {
        return await roundTrip(worker, files);
      } finally {
        release(worker);
      }
    },
    close: async () => {
      await Promise.all(workers.map(async (worker) => await worker.terminate()));
    }
  };
};

const openWriteDatabase = (databasePath, { durability = 'live' } = {}) => {
  const database = new DatabaseSync(databasePath, {});
  database.exec(writePragmas(durability));
  database.exec(CONTENT_SCHEMA);
  return database;
};

const createContentWriter = (database) => {
  const statements = {
    insertFile: database.prepare(`
      INSERT INTO content_files(relative_path, dir_path, size, modified_ms, media_type)
      VALUES (?, ?, ?, ?, ?)
    `),
    updateFile: database.prepare(
      'UPDATE content_files SET dir_path = ?, size = ?, modified_ms = ?, media_type = ? WHERE id = ?'
    ),
    deleteFile: database.prepare('DELETE FROM content_files WHERE id = ?'),
    selectFileByPath: database.prepare(
      'SELECT id, size, modified_ms FROM content_files WHERE relative_path = ?'
    ),
    selectFilesInRange: database.prepare(
      'SELECT id, relative_path FROM content_files WHERE relative_path >= ? AND relative_path < ?'
    ),
    insertChunk: database.prepare(`
      INSERT INTO chunks(file_id, ordinal, content_hash, core_text, left_context_text,
        right_overlap_text, normalized_searchable, normalized_core_length)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    selectChunkIds: database.prepare('SELECT id FROM chunks WHERE file_id = ?'),
    deleteChunks: database.prepare('DELETE FROM chunks WHERE file_id = ?'),
    insertFts: database.prepare('INSERT INTO chunk_fts(rowid, searchable) VALUES (?, ?)'),
    deleteFts: database.prepare('DELETE FROM chunk_fts WHERE rowid = ?'),
    insertPosting: database.prepare(
      'INSERT OR IGNORE INTO cjk_postings(token, chunk_id) VALUES (?, ?)'
    ),
    deletePostings: database.prepare('DELETE FROM cjk_postings WHERE chunk_id = ?'),
    setMeta: database.prepare(
      'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
  };

  const totals = { chunks: 0, postings: 0, transactions: 0, writeMs: 0 };
  let open = false;
  let pendingChunks = 0;

  const begin = () => {
    if (open) return;
    database.exec('BEGIN IMMEDIATE');
    open = true;
    totals.transactions += 1;
  };

  const commit = () => {
    if (!open) return;
    database.exec('COMMIT');
    open = false;
    pendingChunks = 0;
  };

  const rollback = () => {
    if (!open) return;
    open = false;
    database.exec('ROLLBACK');
  };

  const insertChunks = (fileId, chunks) => {
    for (const chunk of chunks) {
      const inserted = statements.insertChunk.run(
        fileId,
        chunk.ordinal,
        chunk.hash,
        chunk.text,
        chunk.leftContextText,
        chunk.rightOverlapText,
        chunk.normalizedSearchableText,
        chunk.normalizedCoreLength
      );
      const chunkId = Number(inserted.lastInsertRowid);
      statements.insertFts.run(chunkId, chunk.normalizedSearchableText);
      for (const token of extractCjkPostingTokens(chunk.normalizedSearchableText)) {
        statements.insertPosting.run(token, chunkId);
        totals.postings += 1;
      }
    }
    totals.chunks += chunks.length;
    pendingChunks += chunks.length;
  };

  const dropChunks = (fileId) => {
    for (const row of statements.selectChunkIds.iterate(fileId)) {
      const chunkId = Number(row.id);
      statements.deletePostings.run(chunkId);
      statements.deleteFts.run(chunkId);
    }
    statements.deleteChunks.run(fileId);
  };

  /** Every mutation runs inside the current large transaction, timed so writes stay attributable. */
  const write = (run) => {
    const startedAt = performance.now();
    try {
      begin();
      run();
      if (pendingChunks >= TRANSACTION_CHUNKS) commit();
    } catch (error) {
      rollback();
      throw error;
    } finally {
      totals.writeMs += performance.now() - startedAt;
    }
  };

  return {
    totals,

    findFile: (relativePath) => {
      const row = statements.selectFileByPath.get(relativePath);
      return row
        ? {
            id: Number(row.id),
            size: Number(row.size),
            modifiedMs: Number(row.modified_ms)
          }
        : undefined;
    },

    filesUnder: (relativePath) => {
      const [low, high] = scopeRange(relativePath);
      return [...statements.selectFilesInRange.iterate(low, high)].map((row) => ({
        id: Number(row.id),
        relativePath: row.relative_path
      }));
    },

    addFile: (file, chunks) =>
      write(() => {
        const inserted = statements.insertFile.run(
          file.relativePath,
          file.parentRelativePath,
          file.size,
          file.modifiedMs,
          file.mediaType
        );
        insertChunks(Number(inserted.lastInsertRowid), chunks);
      }),
    replaceFile: (fileId, file, chunks) =>
      write(() => {
        dropChunks(fileId);
        statements.updateFile.run(
          file.parentRelativePath,
          file.size,
          file.modifiedMs,
          file.mediaType,
          fileId
        );
        insertChunks(fileId, chunks);
      }),
    removeFile: (fileId) =>
      write(() => {
        dropChunks(fileId);
        statements.deleteFile.run(fileId);
      }),
    setMeta: (entries) =>
      write(() => {
        for (const [key, value] of Object.entries(entries)) {
          statements.setMeta.run(key, String(value));
        }
      }),
    flush: () => {
      const startedAt = performance.now();
      try {
        commit();
      } catch (error) {
        rollback();
        throw error;
      } finally {
        totals.writeMs += performance.now() - startedAt;
      }
    }
  };
};

/**
 * Reads bytes on the main thread, chunks them on the pool, writes the rows back here. Reading runs
 * one lane per worker plus two, so a worker never waits for a `readFile` to finish.
 */
const runChunkPipeline = async ({ rootPath, files, pool, apply }) => {
  const counters = { filesRead: 0, bytesRead: 0, unreadable: 0, readMs: 0, chunkMs: 0, batches: 0 };
  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const file of files) {
    current.push(file);
    currentBytes += file.size;
    if (current.length >= BATCH_FILES || currentBytes >= BATCH_BYTES) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
  }
  if (current.length > 0) batches.push(current);
  counters.batches = batches.length;

  let cursor = 0;
  const lanes = Math.min(batches.length, pool.size + 2);
  const runLane = async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor];
      cursor += 1;
      const readStartedAt = performance.now();
      const payload = [];
      const kept = [];
      for (const [index, buffer] of (
        await Promise.all(
          batch.map(
            async (file) =>
              await readFile(join(rootPath, ...file.relativePath.split('/'))).catch(() => undefined)
          )
        )
      ).entries()) {
        if (!buffer) {
          counters.unreadable += 1;
          continue;
        }
        counters.filesRead += 1;
        counters.bytesRead += buffer.byteLength;
        kept.push(batch[index]);
        payload.push({ relativePath: batch[index].relativePath, bytes: detachBytes(buffer) });
      }
      counters.readMs += performance.now() - readStartedAt;
      if (payload.length === 0) continue;
      const message = await pool.chunk(payload);
      counters.chunkMs += message.counters.chunkMs;
      for (const [index, result] of message.files.entries()) apply(kept[index], result.chunks);
    }
  };
  await Promise.all(Array.from({ length: lanes }, async () => await runLane()));
  return counters;
};

const walkTiers = async ({ rootPath, policy, timeline, denominator }) => {
  const dirs = [];
  const files = [];
  const counters = await timeline.measure('B:walk', async (span) => {
    const walked = await walkWorkspace({
      rootPath,
      policy,
      onDirectory: (entry) => dirs.push(entry),
      onFile: (entry) => files.push(entry)
    });
    span.detail = {
      files: files.length,
      directories: dirs.length,
      progressDenominator: denominator ?? 'unknown'
    };
    return walked;
  });
  return { dirs, files, counters };
};

const ftsPhrase = (query) => `"${query.replaceAll('"', '""')}"`;

const CANDIDATE_COLUMNS = `
  c.ordinal, c.core_text, c.left_context_text, c.right_overlap_text,
  c.normalized_searchable, c.normalized_core_length, f.relative_path, f.media_type
`;

/** Mirrors the shipped engine's branch choice so a query is served by the same retrieval path. */
const contentEngineFor = (normalizedQuery) => {
  const length = [...normalizedQuery].length;
  if (length > 64) return 'exact-file-fallback';
  if (isIndexedShortQuery(normalizedQuery)) return 'cjk-postings';
  if (length <= 2) return 'sqlite-instr-prefilter';
  return 'fts5-trigram';
};

const candidateSql = (engine, strategy) => {
  const join = strategy === 'temp-table' ? ' JOIN scope_files AS t ON t.file_id = c.file_id' : '';
  const where = strategy === 'range' ? ' AND f.relative_path >= ? AND f.relative_path < ?' : '';
  const tail = ` ORDER BY f.relative_path, c.ordinal`;
  if (engine === 'cjk-postings') {
    return (
      `SELECT ${CANDIDATE_COLUMNS} FROM cjk_postings AS p JOIN chunks AS c ON c.id = p.chunk_id` +
      `${join} JOIN content_files AS f ON f.id = c.file_id WHERE p.token = ?${where}${tail}`
    );
  }
  if (engine === 'sqlite-instr-prefilter') {
    return (
      `SELECT ${CANDIDATE_COLUMNS} FROM chunks AS c${join}` +
      ` JOIN content_files AS f ON f.id = c.file_id` +
      ` WHERE instr(c.normalized_searchable, ?) > 0${where}${tail}`
    );
  }
  return (
    `SELECT ${CANDIDATE_COLUMNS} FROM chunk_fts AS x JOIN chunks AS c ON c.id = x.rowid${join}` +
    ` JOIN content_files AS f ON f.id = c.file_id WHERE chunk_fts MATCH ?${where}${tail}`
  );
};

const fallbackFileSql = (strategy) =>
  `SELECT f.id, f.relative_path, f.media_type FROM content_files AS f WHERE 1 = 1` +
  (strategy === 'range' ? ' AND f.relative_path >= ? AND f.relative_path < ?' : '') +
  ' ORDER BY f.relative_path';

const contentMatch = (candidate, normalizedQuery) => {
  const matchIndex = candidate.normalized_searchable.indexOf(normalizedQuery);
  if (matchIndex < 0 || matchIndex >= Number(candidate.normalized_core_length)) return undefined;
  const source = `${candidate.left_context_text}${candidate.core_text}${candidate.right_overlap_text}`;
  const match = projectNormalizedMatchToSource(
    source,
    normalizedQuery,
    normalizeSearchText(candidate.left_context_text).length + matchIndex
  );
  if (!match) return undefined;
  return {
    relativePath: candidate.relative_path,
    name: fileNameOf(candidate.relative_path),
    snippet: match.snippetText,
    highlightStart: match.highlightStart,
    highlightLength: match.highlightLength
  };
};

const createContentReader = (reader) => {
  reader.exec('PRAGMA temp_store = MEMORY');
  reader.exec(
    'CREATE TEMP TABLE IF NOT EXISTS scope_files(file_id INTEGER PRIMARY KEY) WITHOUT ROWID'
  );
  const statements = new Map();
  const prepare = (key, sql) => {
    const existing = statements.get(key);
    if (existing) return existing;
    const prepared = reader.prepare(sql);
    statements.set(key, prepared);
    return prepared;
  };
  const clearScope = reader.prepare('DELETE FROM scope_files');
  const fillScope = reader.prepare(
    'INSERT INTO scope_files(file_id) SELECT id FROM content_files WHERE relative_path >= ? AND relative_path < ?'
  );
  const countScope = reader.prepare(
    'SELECT count(*) AS total FROM content_files WHERE relative_path >= ? AND relative_path < ?'
  );
  const countAll = reader.prepare('SELECT count(*) AS total FROM content_files');
  const coreTextByFile = reader.prepare(
    'SELECT core_text FROM chunks WHERE file_id = ? ORDER BY ordinal'
  );
  const metaValue = reader.prepare('SELECT value FROM meta WHERE key = ?');
  const storedTotal = Number(metaValue.get('contentFiles')?.value ?? Number.NaN);
  const totalContentFiles = Number.isFinite(storedTotal)
    ? storedTotal
    : Number(countAll.get().total);

  return {
    totalContentFiles,
    chunkCount: Number(metaValue.get('chunks')?.value ?? 0),
    postingCount: Number(metaValue.get('postings')?.value ?? 0),
    buildEpoch: Number(metaValue.get(CONTENT_EPOCH_KEY)?.value ?? -1),
    builtAtMs: Number(metaValue.get('builtAtMs')?.value ?? 0),

    /**
     * A narrow scope is worth materialising: the join then drives off a small primary key set
     * instead of asking SQLite to re-range-scan `relative_path` for every candidate chunk.
     */
    plan: (scope) => {
      if (scope?.kind !== 'directory' || !scope.relativePath) {
        return { strategy: 'project', range: [], inScopeFiles: totalContentFiles };
      }
      const range = scopeRange(scope.relativePath);
      const inScopeFiles = Number(countScope.get(...range).total);
      if (totalContentFiles > 0 && inScopeFiles < totalContentFiles * TEMP_TABLE_SHARE) {
        clearScope.run();
        fillScope.run(...range);
        return { strategy: 'temp-table', range, inScopeFiles };
      }
      return { strategy: 'range', range, inScopeFiles };
    },

    candidates: (engine, strategy, params, normalizedQuery) =>
      prepare(`${engine}:${strategy}`, candidateSql(engine, strategy)).iterate(
        engine === 'fts5-trigram' ? ftsPhrase(normalizedQuery) : normalizedQuery,
        ...params
      ),

    fallbackFiles: (strategy, params) =>
      prepare(`fallback:${strategy}`, fallbackFileSql(strategy)).iterate(...params),

    fileSource: (fileId) => [...coreTextByFile.iterate(fileId)].map((row) => row.core_text).join('')
  };
};

const searchFilesSection = (metaStore, { normalizedQuery, scope, cap }) => {
  const matched = metaStore.searchNames({ query: normalizedQuery, scope, maxResults: cap });
  return { rows: matched.ordered, truncated: matched.truncated, matched };
};

const searchContentsSection = (content, { normalizedQuery, scope, cap }) => {
  const plan = content.plan(scope);
  const engine = contentEngineFor(normalizedQuery);
  // The >64-character fallback reads whole files, so a materialised id set buys it nothing.
  const strategy =
    engine === 'exact-file-fallback' && plan.strategy === 'temp-table' ? 'range' : plan.strategy;
  const params = strategy === 'range' ? plan.range : [];
  const rows = [];
  const seen = new Set();
  let candidates = 0;
  let truncated = false;
  if (engine === 'exact-file-fallback') {
    for (const file of content.fallbackFiles(strategy, params)) {
      candidates += 1;
      const source = content.fileSource(file.id);
      if (!normalizeSearchText(source).includes(normalizedQuery)) continue;
      const match = createPlainTextSnippet(source, normalizedQuery);
      if (!match) continue;
      if (rows.length >= cap) {
        truncated = true;
        break;
      }
      rows.push({
        relativePath: file.relative_path,
        name: fileNameOf(file.relative_path),
        snippet: match.snippetText,
        highlightStart: match.highlightStart,
        highlightLength: match.highlightLength
      });
    }
  } else {
    for (const candidate of content.candidates(engine, strategy, params, normalizedQuery)) {
      candidates += 1;
      if (seen.has(candidate.relative_path)) continue;
      const match = contentMatch(candidate, normalizedQuery);
      if (!match) continue;
      seen.add(match.relativePath);
      if (rows.length >= cap) {
        truncated = true;
        break;
      }
      rows.push(match);
    }
  }
  return {
    rows,
    truncated,
    engine,
    counters: {
      contentStrategy: strategy,
      inScopeContentFiles: plan.inScopeFiles,
      contentFiles: content.totalContentFiles,
      candidateRowsScanned: candidates
    }
  };
};

const planMetadataReconcile = (metaStore, { dirs, files }) => {
  const previousFiles = new Map(metaStore.listFiles().map((file) => [file.relativePath, file]));
  const previousDirs = new Set(metaStore.directories());
  const upsertFiles = [];
  for (const file of files) {
    const previous = previousFiles.get(file.relativePath);
    previousFiles.delete(file.relativePath);
    if (!previous || previous.size !== file.size || previous.modifiedMs !== file.modifiedMs) {
      upsertFiles.push(file);
    }
  }
  const upsertDirs = dirs.filter((dir) => !previousDirs.has(dir.relativePath));
  for (const dir of dirs) previousDirs.delete(dir.relativePath);
  return {
    upsertFiles,
    upsertDirs,
    deleteFiles: [...previousFiles.keys()],
    deleteDirs: [...previousDirs]
  };
};

const commitMetadataUpserts = (metaStore, plan, epoch) =>
  metaStore.transaction(() => {
    metaStore.upsertDirs(plan.upsertDirs);
    metaStore.upsertFiles(plan.upsertFiles);
    const counts = metaStore.stats();
    metaStore.setMeta(FILE_COUNT_KEY, counts.files);
    metaStore.setMeta(DIRECTORY_COUNT_KEY, counts.directories);
    metaStore.setMeta(META_EPOCH_KEY, epoch);
    return counts;
  });

const readContentCounts = (database) => {
  const counts = database
    .prepare(
      'SELECT (SELECT count(*) FROM content_files) AS files, (SELECT count(*) FROM chunks) AS chunks'
    )
    .get();
  return {
    contentFiles: Number(counts.files),
    chunks: Number(counts.chunks),
    postings: Number(database.prepare('SELECT count(*) AS total FROM cjk_postings').get().total)
  };
};

/**
 * The full reconcile, shared by `refresh` and by an `apply` that escalated. Both tiers are derived
 * from one walk, so this is also the repair path for an index whose tiers disagree.
 */
const reconcileWorkspace = async ({
  rootPath,
  indexDir,
  timeline,
  metaStore,
  database,
  config
}) => {
  const policy = timeline.measureSync('B:policy', () => createTraversalPolicy(config));
  const previousCount = Number(metaStore.getMeta(FILE_COUNT_KEY) ?? Number.NaN);
  const walked = await walkTiers({
    rootPath,
    policy,
    timeline,
    denominator: Number.isFinite(previousCount) ? previousCount : undefined
  });
  const metadataPlan = timeline.measureSync('B:meta-diff', (span) => {
    const planned = planMetadataReconcile(metaStore, walked);
    span.detail = {
      upsertFiles: planned.upsertFiles.length,
      upsertDirs: planned.upsertDirs.length,
      deleteFiles: planned.deleteFiles.length,
      deleteDirs: planned.deleteDirs.length
    };
    return planned;
  });
  const eligible = walked.files.filter(isContentEligible);
  const diff = timeline.measureSync('B:diff', (span) => {
    const computed = contentDiff({ database, files: eligible });
    span.detail = {
      added: computed.added.length,
      changed: computed.changed.length,
      removed: computed.removed.length
    };
    return computed;
  });
  const writer = createContentWriter(database);
  const epoch = nextBuildEpoch(contentEpochOf(database));
  timeline.measureSync('B:epoch-open', () => {
    writer.setMeta({ [CONTENT_EPOCH_KEY]: epoch });
    writer.flush();
  });
  // Deletion window: the content rows go, then the metadata rows, with nothing in between, so a
  // concurrent reader can only ever see the pair one transaction apart on a removal.
  timeline.measureSync('B:remove', (span) => {
    for (const [, previous] of diff.removed) writer.removeFile(previous.id);
    writer.flush();
    metaStore.transaction(() => {
      metaStore.deleteFiles(metadataPlan.deleteFiles);
      metaStore.deleteDirs(metadataPlan.deleteDirs);
    });
    span.detail = {
      contentRemoved: diff.removed.length,
      metadataFiles: metadataPlan.deleteFiles.length,
      metadataDirs: metadataPlan.deleteDirs.length
    };
  });
  const toChunk = [...diff.added, ...diff.changed];
  const changedByPath = new Map(diff.changed.map((file) => [file.relativePath, file.fileId]));
  let pipeline = { filesRead: 0, bytesRead: 0, unreadable: 0, readMs: 0, chunkMs: 0, batches: 0 };
  let workers = 0;
  if (toChunk.length > 0) {
    const pool = await timeline.measure('B:pool-spawn', async (span) => {
      const created = createChunkPool();
      await created.ready();
      span.detail = { workers: created.size };
      return created;
    });
    workers = pool.size;
    try {
      pipeline = await timeline.measure('B:read+chunk+write', async (span) => {
        const counters = await runChunkPipeline({
          rootPath,
          files: toChunk,
          pool,
          apply: (file, chunks) => {
            const fileId = changedByPath.get(file.relativePath);
            if (fileId === undefined) writer.addFile(file, chunks);
            else writer.replaceFile(fileId, file, chunks);
          }
        });
        writer.flush();
        span.detail = { workers: pool.size, files: counters.filesRead };
        return counters;
      });
    } finally {
      await timeline.measure('B:pool-terminate', async () => await pool.close());
    }
    timeline.record('B:read', pipeline.readMs, { bytes: pipeline.bytesRead });
    timeline.record('B:chunk', pipeline.chunkMs, { workers });
  }
  const totals = timeline.measureSync('B:content-counts', () => {
    const counts = readContentCounts(database);
    writer.setMeta({
      contentFiles: counts.contentFiles,
      chunks: counts.chunks,
      postings: counts.postings,
      builtAtMs: Date.now(),
      [CONTENT_EPOCH_KEY]: epoch
    });
    writer.flush();
    return counts;
  });
  const metadata = timeline.measureSync('B:meta-commit', (span) => {
    const counts = commitMetadataUpserts(metaStore, metadataPlan, epoch);
    span.detail = {
      upsertFiles: metadataPlan.upsertFiles.length,
      upsertDirs: metadataPlan.upsertDirs.length
    };
    return counts;
  });
  timeline.record('B:write', writer.totals.writeMs, { transactions: writer.totals.transactions });
  timeline.measureSync('B:checkpoint', () => database.exec('PRAGMA wal_checkpoint(TRUNCATE)'));
  // refresh is also the repair path, so it restores the completeness marker an interrupted init or
  // an interrupted refresh may have left missing.
  await timeline.measure(
    'B:marker',
    async () =>
      await writeIndexMeta(indexDir, {
        planId: 'B',
        rootPath,
        metaDatabase: META_DATABASE_NAME,
        contentDatabase: CONTENT_DATABASE_NAME
      })
  );
  return {
    buildEpoch: epoch,
    files: metadata.files,
    directories: metadata.directories,
    added: diff.added.length,
    changed: diff.changed.length,
    removed: diff.removed.length,
    upserted: metadataPlan.upsertFiles.length,
    unchanged: walked.files.length - metadataPlan.upsertFiles.length,
    rechunkedFiles: pipeline.filesRead,
    contentFiles: totals.contentFiles,
    chunks: totals.chunks,
    cjkPostings: totals.postings,
    transactions: writer.totals.transactions,
    metadataUpserts: metadataPlan.upsertFiles.length,
    metadataDeletes: metadataPlan.deleteFiles.length
  };
};

/**
 * The watcher path: a bounded list of paths, each stat'ed and committed against the databases that
 * are already open. No walk, so a change set costs work proportional to the change, not to the
 * workspace - which is also why it has to fix directory rows itself, since nothing else will.
 */
const applyChangeSet = async ({ rootPath, changes, policy, metaStore, database, writer }) => {
  // Two watcher events for one file are one unit of work, not two: without this a repeated path is
  // read, chunked and written once per occurrence. The depth filter keeps apply and refresh talking
  // about the same workspace - refresh's walk cannot reach an over-deep path, so apply must not
  // index one either. `handle.apply` escalates rather than arriving here with one.
  const requestedPaths = [...new Set(changes.paths.map(requireChangePath))];
  const paths = requestedPaths.filter((relativePath) =>
    isWorkspaceSearchPathWithinDepth(relativePath)
  );
  const stats = {
    requestedPaths: changes.paths.length,
    upserted: 0,
    removed: 0,
    unchanged: 0,
    skipped: requestedPaths.length - paths.length,
    escalatedToFullReconcile: false,
    contentUpserted: 0,
    contentRemoved: 0,
    directoriesAdded: 0,
    directoriesRemoved: 0,
    filesRemoved: 0,
    expandedDirectories: 0,
    bytesRead: 0,
    chunks: 0,
    chunkedBy: 'inline'
  };
  const absoluteOf = (relativePath) => join(rootPath, ...relativePath.split('/'));
  const knownDirs = new Set(metaStore.directories());
  const removalRoots = new Set();
  const staleFiles = new Set();
  const staleDirs = new Set();
  const dirUpserts = new Map();
  const fileUpserts = new Map();
  const directoryTargets = [];

  const noteAncestors = (relativePath) => {
    for (const ancestor of ancestorDirectoriesOf(relativePath)) {
      if (knownDirs.has(ancestor) || dirUpserts.has(ancestor)) continue;
      if (policy.isExcludedDirectoryPath(ancestor)) continue;
      dirUpserts.set(ancestor, pathPartsOf(ancestor));
    }
  };

  // A removal reported for one file may really be a removed directory, so the shallowest ancestor
  // that no longer exists becomes the removal root and takes its whole subtree with it.
  const noteRemoval = async (relativePath) => {
    let root = relativePath;
    for (const ancestor of ancestorDirectoriesOf(relativePath)) {
      if (!(await fileExists(absoluteOf(ancestor)))) {
        root = ancestor;
        break;
      }
    }
    removalRoots.add(root);
  };

  const queueFile = (file) => {
    if (fileUpserts.has(file.relativePath)) return;
    const previous = metaStore.fileMetadata(file.relativePath);
    if (previous && previous.size === file.size && previous.modifiedMs === file.modifiedMs) {
      stats.unchanged += 1;
      return;
    }
    fileUpserts.set(file.relativePath, file);
  };

  for (const relativePath of paths) {
    const entry = await lstat(absoluteOf(relativePath)).catch(() => undefined);
    if (!entry || entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      await noteRemoval(relativePath);
      stats.removed += 1;
      continue;
    }
    const excluded = entry.isDirectory()
      ? policy.isExcludedDirectoryPath(relativePath)
      : policy.isExcludedFilePath(relativePath);
    if (excluded) {
      removalRoots.add(relativePath);
      stats.skipped += 1;
      continue;
    }
    noteAncestors(relativePath);
    if (entry.isDirectory()) {
      if (knownDirs.has(relativePath)) stats.unchanged += 1;
      else dirUpserts.set(relativePath, pathPartsOf(relativePath));
      // A directory now stands where a file used to, so that file's rows are dead.
      if (metaStore.fileMetadata(relativePath) || writer.findFile(relativePath)) {
        staleFiles.add(relativePath);
      }
      directoryTargets.push(relativePath);
      continue;
    }
    // The mirror image: a file now stands where a directory used to, so everything the index holds
    // beneath that path is dead, the directory row included.
    if (knownDirs.has(relativePath)) removalRoots.add(relativePath);
    queueFile({
      ...pathPartsOf(relativePath),
      size: Number(entry.size),
      modifiedMs: Math.trunc(Number(entry.mtimeMs)),
      mediaType: classifySearchMediaType(relativePath)
    });
  }

  // A watcher on macOS routinely reports the containing directory instead of each file inside it, so
  // a directory-typed change path is expanded into its subtree: whatever is live under it is indexed,
  // whatever the index still holds under it and is no longer there is dropped. Nested targets are
  // dropped because the shallowest one already walks them.
  for (const target of [...directoryTargets].sort()) {
    if (directoryTargets.some((other) => target.startsWith(`${other}/`))) continue;
    stats.expandedDirectories += 1;
    const subtree = await walkSubtree({ rootPath, relativePath: target, policy });
    const liveFiles = new Set(subtree.files.map((file) => file.relativePath));
    const liveDirs = new Set(subtree.dirs.map((dir) => dir.relativePath));
    for (const dir of subtree.dirs) {
      if (knownDirs.has(dir.relativePath) || dirUpserts.has(dir.relativePath)) continue;
      dirUpserts.set(dir.relativePath, dir);
    }
    for (const file of subtree.files) queueFile(file);
    for (const file of metaStore.listFiles({ scope: directoryScope(target) })) {
      if (!liveFiles.has(file.relativePath)) staleFiles.add(file.relativePath);
    }
    for (const file of writer.filesUnder(target)) {
      if (!liveFiles.has(file.relativePath)) staleFiles.add(file.relativePath);
    }
    for (const directory of knownDirs) {
      if (directory.startsWith(`${target}/`) && !liveDirs.has(directory)) staleDirs.add(directory);
    }
  }

  const epoch = nextBuildEpoch(contentEpochOf(database));
  writer.setMeta({ [CONTENT_EPOCH_KEY]: epoch });
  writer.flush();

  const contentIds = new Set();
  const metaFileDeletes = new Set();
  const metaDirDeletes = new Set();
  for (const root of removalRoots) {
    const own = writer.findFile(root);
    if (own) contentIds.add(own.id);
    for (const file of writer.filesUnder(root)) contentIds.add(file.id);
    if (metaStore.fileMetadata(root)) metaFileDeletes.add(root);
    for (const file of metaStore.listFiles({ scope: directoryScope(root) })) {
      metaFileDeletes.add(file.relativePath);
    }
    if (knownDirs.has(root)) metaDirDeletes.add(root);
    for (const directory of knownDirs) {
      if (directory.startsWith(`${root}/`)) metaDirDeletes.add(directory);
    }
  }
  for (const relativePath of staleFiles) {
    const own = writer.findFile(relativePath);
    if (own) contentIds.add(own.id);
    if (metaStore.fileMetadata(relativePath)) metaFileDeletes.add(relativePath);
  }
  for (const relativePath of staleDirs) metaDirDeletes.add(relativePath);
  if (contentIds.size > 0 || metaFileDeletes.size > 0 || metaDirDeletes.size > 0) {
    for (const id of contentIds) writer.removeFile(id);
    writer.flush();
    metaStore.transaction(() => {
      metaStore.deleteFiles([...metaFileDeletes]);
      metaStore.deleteDirs([...metaDirDeletes]);
    });
    for (const directory of metaDirDeletes) knownDirs.delete(directory);
    stats.contentRemoved += contentIds.size;
    stats.filesRemoved = metaFileDeletes.size;
    stats.directoriesRemoved = metaDirDeletes.size;
  }

  const applyChunks = (file, chunks) => {
    const previous = writer.findFile(file.relativePath);
    if (previous) writer.replaceFile(previous.id, file, chunks);
    else writer.addFile(file, chunks);
    stats.contentUpserted += 1;
    stats.chunks += chunks.length;
  };
  const upsertFiles = [...fileUpserts.values()];
  const contentTargets = upsertFiles.filter(isContentEligible);
  for (const file of upsertFiles) {
    if (isContentEligible(file)) continue;
    // A file that is no longer content-eligible keeps its name but must lose its chunks.
    const previous = writer.findFile(file.relativePath);
    if (!previous) continue;
    writer.removeFile(previous.id);
    stats.contentRemoved += 1;
  }
  if (contentTargets.length >= POOL_MIN_FILES) {
    stats.chunkedBy = 'pool';
    const pool = createChunkPool();
    try {
      await pool.ready();
      const counters = await runChunkPipeline({
        rootPath,
        files: contentTargets,
        pool,
        apply: applyChunks
      });
      stats.bytesRead += counters.bytesRead;
    } finally {
      await pool.close();
    }
  } else {
    for (const file of contentTargets) {
      const buffer = await readFile(absoluteOf(file.relativePath)).catch(() => undefined);
      if (!buffer) continue;
      stats.bytesRead += buffer.byteLength;
      applyChunks(file, splitContentDefinedChunks(decodeSearchText(buffer)));
    }
  }
  writer.flush();

  const counts = readContentCounts(database);
  writer.setMeta({
    contentFiles: counts.contentFiles,
    chunks: counts.chunks,
    postings: counts.postings,
    builtAtMs: Date.now(),
    [CONTENT_EPOCH_KEY]: epoch
  });
  writer.flush();
  const metadata = commitMetadataUpserts(
    metaStore,
    { upsertDirs: [...dirUpserts.values()], upsertFiles },
    epoch
  );
  // Directory rows are counted on their own line: folding them into `upserted` made a change set
  // that indexed no file at all look like it had indexed one.
  stats.upserted = upsertFiles.length;
  stats.directoriesAdded = dirUpserts.size;
  stats.buildEpoch = epoch;
  stats.files = metadata.files;
  stats.directories = metadata.directories;
  stats.contentFiles = counts.contentFiles;
  return stats;
};

const openReaders = (indexDir) => {
  const metaStore = createMetadataStore({ databasePath: metaPathFor(indexDir), readOnly: true });
  // A second, read-only connection: under WAL it reads the last committed snapshot, so an in-place
  // refresh on the writer connection stays invisible until it commits.
  const reader = new DatabaseSync(contentPathFor(indexDir), { readOnly: true });
  const content = createContentReader(reader);
  const metaEpoch = Number(metaStore.getMeta(META_EPOCH_KEY) ?? -1);
  if (metaEpoch !== content.buildEpoch) {
    metaStore.close();
    reader.close();
    throw new TypeError(
      `Plan B tiers disagree (metadata epoch ${metaEpoch}, content epoch ${content.buildEpoch}) - ` +
        'the build that wrote them was interrupted; run "index refresh --plan B" to repair it'
    );
  }
  return { metaStore, reader, content };
};

const openHandle = ({ rootPath, indexDir, mode }) => {
  let readers = openReaders(indexDir);
  let directoryList;
  let directorySet;
  let writers;
  let policyPromise;

  const directories = () => {
    directoryList ??= readers.metaStore.directories();
    return directoryList;
  };
  const hasDirectory = (relativePath) => {
    directorySet ??= new Set(directories());
    return directorySet.has(relativePath);
  };
  // The query connections hold their own snapshot and their own cached counts, so an apply that
  // committed is only visible to them once they are reopened.
  const reopenReaders = () => {
    readers.metaStore.close();
    readers.reader.close();
    readers = openReaders(indexDir);
    directoryList = undefined;
    directorySet = undefined;
  };
  const ensureWriters = () => {
    if (!writers) {
      const database = openWriteDatabase(contentPathFor(indexDir));
      writers = {
        database,
        writer: createContentWriter(database),
        metaStore: createMetadataStore({ databasePath: metaPathFor(indexDir) })
      };
    }
    return writers;
  };
  const ensurePolicy = async () => {
    policyPromise ??= (async () => {
      const config = await loadOnlyPreviewWorkspaceConfig(rootPath);
      return { config, policy: createTraversalPolicy(config) };
    })();
    return await policyPromise;
  };

  return {
    tierStats: () => {
      const metadata = readers.metaStore.stats();
      return {
        files: metadata.files,
        directories: metadata.directories,
        contentFiles: readers.content.totalContentFiles,
        chunks: readers.content.chunkCount,
        cjkPostings: readers.content.postingCount,
        buildEpoch: readers.content.buildEpoch
      };
    },
    handle: {
      mode,
      directories,
      /** The metadata tier is the register of which paths exist, so drift is read straight off it. */
      indexedFiles: () => readers.metaStore.listFiles().map((file) => file.relativePath),
      search: async (query, { scope, sections = ['files', 'contents'], maxResults = 50 } = {}) => {
        const resolvedScope = requirePlanScope(scope, { hasDirectory });
        const normalizedQuery = normalizeSearchText(query);
        const cap = Math.min(SECTION_CAP, clampSearchResultLimit(Number(maxResults)));
        const wantFiles = sections.includes('files');
        const wantContents = sections.includes('contents');
        const outcome = {
          files: [],
          contents: [],
          truncated: { files: false, contents: false },
          engine: contentEngineFor(normalizedQuery),
          counters: { sectionsComputed: sections.join('+') }
        };
        if (!normalizedQuery || cap === 0) return assertSearchOutcome(outcome, 'B');
        if (wantFiles) {
          const startedAt = performance.now();
          const files = searchFilesSection(readers.metaStore, {
            normalizedQuery,
            scope: resolvedScope,
            cap
          });
          outcome.files = files.rows;
          outcome.truncated.files = files.truncated;
          outcome.counters.filesMs = performance.now() - startedAt;
          outcome.counters.nameMatches = files.matched.matched;
          if (files.matched.ceilingReached) outcome.counters.nameCeilingReached = true;
        }
        if (wantContents) {
          const startedAt = performance.now();
          const contents = searchContentsSection(readers.content, {
            normalizedQuery,
            scope: resolvedScope,
            cap
          });
          outcome.contents = contents.rows;
          outcome.truncated.contents = contents.truncated;
          outcome.engine = contents.engine;
          outcome.counters = { ...outcome.counters, ...contents.counters };
          outcome.counters.contentsMs = performance.now() - startedAt;
        }
        return assertSearchOutcome(outcome, 'B');
      },

      apply: async (changes) => {
        const { config, policy } = await ensurePolicy();
        const active = ensureWriters();
        // An over-deep path escalates rather than being committed, the way plan A's reconciler does
        // it: a path refresh's walk can never reach must not be indexed by apply either.
        const overDeepPath = changes.paths.find(
          (relativePath) =>
            typeof relativePath === 'string' && !isWorkspaceSearchPathWithinDepth(relativePath)
        );
        const escalate =
          changes.full === true ||
          changes.paths.length > MAX_WATCH_CHANGE_PATHS ||
          overDeepPath !== undefined;
        if (escalate) {
          const reconciled = await reconcileWorkspace({
            rootPath,
            indexDir,
            timeline: createTimeline('apply-escalation'),
            metaStore: active.metaStore,
            database: active.database,
            config
          });
          reopenReaders();
          return {
            requestedPaths: changes.paths.length,
            upserted: reconciled.upserted,
            removed: reconciled.metadataDeletes,
            unchanged: reconciled.unchanged,
            escalatedToFullReconcile: true,
            reason:
              changes.full === true
                ? 'watcher lost track'
                : overDeepPath !== undefined
                  ? `change path deeper than MAX_INDEX_DEPTH: ${overDeepPath}`
                  : 'change set above maxChangePaths',
            reconciledFiles: reconciled.files
          };
        }
        const stats = await applyChangeSet({
          rootPath,
          changes,
          policy,
          metaStore: active.metaStore,
          database: active.database,
          writer: active.writer
        });
        reopenReaders();
        return stats;
      },

      close: async () => {
        readers.metaStore.close();
        readers.reader.close();
        if (!writers) return;
        writers.writer.flush();
        writers.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        writers.database.close();
        writers.metaStore.close();
        writers = undefined;
      }
    }
  };
};

const buildContent = async ({ rootPath, files, database, timeline, epoch }) => {
  const writer = createContentWriter(database);
  let pipeline = { filesRead: 0, bytesRead: 0, unreadable: 0, readMs: 0, chunkMs: 0, batches: 0 };
  let workers = 0;
  if (files.length > 0) {
    const pool = await timeline.measure('B:pool-spawn', async (span) => {
      const created = createChunkPool();
      await created.ready();
      span.detail = { workers: created.size };
      return created;
    });
    workers = pool.size;
    try {
      pipeline = await timeline.measure('B:read+chunk+write', async (span) => {
        const counters = await runChunkPipeline({
          rootPath,
          files,
          pool,
          apply: (file, chunks) => writer.addFile(file, chunks)
        });
        writer.flush();
        span.detail = { workers: pool.size, batches: counters.batches, files: counters.filesRead };
        return counters;
      });
    } finally {
      await timeline.measure('B:pool-terminate', async () => await pool.close());
    }
    timeline.record('B:read', pipeline.readMs, { bytes: pipeline.bytesRead });
    timeline.record('B:chunk', pipeline.chunkMs, { workers });
  }
  timeline.record('B:write', writer.totals.writeMs, {
    transactions: writer.totals.transactions,
    chunks: writer.totals.chunks
  });
  writer.setMeta({
    contentFiles: pipeline.filesRead,
    chunks: writer.totals.chunks,
    postings: writer.totals.postings,
    builtAtMs: Date.now(),
    [CONTENT_EPOCH_KEY]: epoch
  });
  writer.flush();
  return { pipeline, writer };
};

const contentDiff = ({ database, files }) => {
  const existing = new Map();
  for (const row of database
    .prepare('SELECT id, relative_path, size, modified_ms FROM content_files')
    .iterate()) {
    existing.set(row.relative_path, {
      id: Number(row.id),
      size: Number(row.size),
      modifiedMs: Number(row.modified_ms)
    });
  }
  const added = [];
  const changed = [];
  for (const file of files) {
    const previous = existing.get(file.relativePath);
    if (!previous) {
      added.push(file);
      continue;
    }
    existing.delete(file.relativePath);
    if (previous.size !== file.size || previous.modifiedMs !== file.modifiedMs) {
      changed.push({ ...file, fileId: previous.id });
    }
  }
  return { added, changed, removed: [...existing.entries()] };
};

const readPreviousFileCount = async (indexDir) => {
  if (!(await fileExists(metaPathFor(indexDir)))) return undefined;
  const metaStore = createMetadataStore({ databasePath: metaPathFor(indexDir), readOnly: true });
  try {
    const value = Number(metaStore.getMeta(FILE_COUNT_KEY) ?? Number.NaN);
    return Number.isFinite(value) ? value : undefined;
  } finally {
    metaStore.close();
  }
};

const loadIndex = async ({ rootPath, indexDir, timeline }) => {
  await requireLoadableIndex(indexDir);
  const opened = timeline.measureSync('B:open', () =>
    openHandle({ rootPath, indexDir, mode: 'seeded' })
  );
  const stats = timeline.measureSync('B:stats', () => opened.tierStats());
  timeline.measureSync('B:directories', (span) => {
    span.detail = { directories: opened.handle.directories().length };
  });
  return { handle: opened.handle, stats };
};

const requireLoadableIndex = async (indexDir) => {
  for (const databasePath of [metaPathFor(indexDir), contentPathFor(indexDir)]) {
    if (await fileExists(databasePath)) continue;
    throw new TypeError('Plan B index is missing - run "index init --plan B" first');
  }
  const { complete } = await readIndexCompleteness(indexDir);
  if (complete) return;
  throw new TypeError(
    'Plan B index has no completeness marker - the build that wrote it was interrupted; ' +
      'run "index init --plan B" again, or "index refresh --plan B" to repair it'
  );
};

export const planB = definePlan({
  id: 'B',
  name: 'Scoped SQLite, no candidate copy',
  summary:
    'The same retrieval tiers as the shipped engine - FTS5 trigram chunks, CJK postings, an instr ' +
    'prefilter - split into a metadata database and a content database, built by a worker pool in ' +
    '2000-chunk transactions, promoted by rename, and refreshed in place behind a read-only reader.',
  tradeoffs: [
    'The Files section is scope-aware, so a directory scope returns fewer names than plan A, whose ' +
      'Files section is project-wide by product decision (docs/issues/onlypreview-directory-' +
      'selection-and-global-file-scope.md). Project-scope results match plan A exactly.',
    'No full-workspace count pre-pass: the progress denominator comes from the previous build. A ' +
      'build from scratch therefore reports progress against an unknown total, which is the honest ' +
      'answer - "index init" deletes the index directory first, so there is no previous count to ' +
      'read. Only a re-init over a surviving index gets a denominator.',
    'init builds meta.building.sqlite and content.building.sqlite and renames both into place, so ' +
      'a crashed build leaves the previous index intact without copying a candidate database.',
    'Both tiers carry the same build epoch, stamped into the content tier before a mutation starts ' +
      'and into the metadata tier when it finishes, and plan-meta.json is written last. load ' +
      'refuses an index with no marker or with disagreeing epochs; refresh repairs both. The cost ' +
      'is that an interrupted refresh needs one refresh to become loadable again, even when its ' +
      'data happened to be fine.',
    'Refresh and apply mutate the live databases in place behind a read-only reader, so a partial ' +
      'write is invisible only per transaction - not for the whole operation. The order is fixed: ' +
      'content deletions commit, then metadata deletions immediately after (so a removed path is ' +
      'gone from both tiers within one transaction), then content additions, then all metadata ' +
      'upserts in one transaction. A concurrent query can therefore find content in a file whose ' +
      'name the Files section does not list yet, for as long as the content build runs; it can ' +
      'never list a name whose content is missing.',
    'apply commits a change set against the open databases without walking, chunking inline below ' +
      `${POOL_MIN_FILES} changed files and borrowing the build pool above it; beyond ` +
      `${MAX_WATCH_CHANGE_PATHS} paths, when a path is deeper than MAX_INDEX_DEPTH (${MAX_INDEX_DEPTH}) ` +
      'and so unreachable by refresh, or when the watcher lost track, it escalates to the full ' +
      'reconcile. After an apply commits, the query connections are reopened, because a read-only ' +
      'connection keeps its own snapshot and its own cached counts.',
    'A change path that is a directory is expanded, not escalated: its subtree is walked, live files ' +
      'are diffed against the rows the index holds under it, and the leftovers are dropped - which ' +
      'is also how a directory standing where a file used to, or a subtree emptied while its ' +
      'directory survived, gets cleaned. The cost is one scoped walk per reported directory instead ' +
      "of plan A's whole-workspace reconcile, and the risk is that the scope has to be re-anchored " +
      'by hand: the walker counts depth and applies exclusions relative to the root it is handed.',
    'refresh re-chunks a changed file whole instead of retaining matching prefix and suffix chunks ' +
      'the way plan A does - fewer moving parts, more chunk writes per edited file.',
    'The walker skips plan A per-file realpath and post-read identity re-verification, so a file ' +
      'swapped during the build can be indexed under the wrong path.',
    'Queries run to completion without cooperative yielding, so a long query blocks the loop that ' +
      'plan A would have released between candidate batches.'
  ],
  capabilities: {
    separateLoad: true,
    scopedFiles: true,
    scopedContents: true,
    independentSections: true,
    backgroundBuild: false,
    incrementalApply: true,
    maxChangePaths: MAX_WATCH_CHANGE_PATHS,
    entryRemoval: 'derived-from-filesystem'
  },

  init: async ({ rootPath, indexDir, timeline }) => {
    const buildingMetaPath = join(indexDir, BUILDING_META_NAME);
    const buildingContentPath = join(indexDir, BUILDING_CONTENT_NAME);
    await removeDatabase(buildingMetaPath);
    await removeDatabase(buildingContentPath);
    const config = await timeline.measure(
      'B:config',
      async () => await loadOnlyPreviewWorkspaceConfig(rootPath)
    );
    const policy = timeline.measureSync('B:policy', () => createTraversalPolicy(config));
    const progressDenominator = await timeline.measure(
      'B:previous-count',
      async () => await readPreviousFileCount(indexDir)
    );
    const epoch = nextBuildEpoch(Number.NaN);
    const metaStore = createMetadataStore({ databasePath: buildingMetaPath });
    let metaClosed = false;
    const closeMeta = () => {
      if (metaClosed) return;
      metaClosed = true;
      metaStore.close();
    };
    try {
      const walked = await walkTiers({
        rootPath,
        policy,
        timeline,
        denominator: progressDenominator
      });
      timeline.measureSync('B:meta-write', (span) => {
        metaStore.replaceAll({ files: walked.files, dirs: walked.dirs });
        metaStore.setMeta(FILE_COUNT_KEY, walked.files.length);
        metaStore.setMeta(DIRECTORY_COUNT_KEY, walked.dirs.length);
        metaStore.setMeta(META_EPOCH_KEY, epoch);
        metaStore.database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        span.detail = { files: walked.files.length, directories: walked.dirs.length };
      });
      closeMeta();
      const eligible = walked.files.filter(isContentEligible);
      const database = timeline.measureSync('B:content-open', () =>
        openWriteDatabase(buildingContentPath, { durability: 'building' })
      );
      let built;
      try {
        built = await buildContent({ rootPath, files: eligible, database, timeline, epoch });
        timeline.measureSync('B:optimize', () => {
          database.exec('PRAGMA optimize');
          database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        });
      } finally {
        database.close();
      }
      await timeline.measure('B:promote', async () => {
        await removeDatabase(metaPathFor(indexDir));
        await removeDatabase(contentPathFor(indexDir));
        await rename(buildingMetaPath, metaPathFor(indexDir));
        await rename(buildingContentPath, contentPathFor(indexDir));
        for (const buildingPath of [buildingMetaPath, buildingContentPath]) {
          await rm(`${buildingPath}-wal`, { force: true });
          await rm(`${buildingPath}-shm`, { force: true });
        }
      });
      // Last, so an index without this marker is provably an interrupted build.
      await writeIndexMeta(indexDir, {
        planId: 'B',
        rootPath,
        metaDatabase: META_DATABASE_NAME,
        contentDatabase: CONTENT_DATABASE_NAME
      });
      return {
        stats: {
          files: walked.files.length,
          directories: walked.dirs.length,
          contentFiles: built.pipeline.filesRead,
          skippedFiles: walked.files.length - eligible.length,
          unreadable: built.pipeline.unreadable,
          chunks: built.writer.totals.chunks,
          cjkPostings: built.writer.totals.postings,
          transactions: built.writer.totals.transactions,
          bytesRead: built.pipeline.bytesRead,
          buildEpoch: epoch,
          progressDenominator: progressDenominator ?? 'unknown'
        }
      };
    } finally {
      closeMeta();
    }
  },

  load: async ({ rootPath, indexDir, timeline }) =>
    await loadIndex({ rootPath, indexDir, timeline }),

  status: async ({ indexDir }) => {
    const metaPath = metaPathFor(indexDir);
    const contentPath = contentPathFor(indexDir);
    const metaExists = await fileExists(metaPath);
    const contentExists = await fileExists(contentPath);
    if (!metaExists && !contentExists) return { exists: false };
    const { complete } = await readIndexCompleteness(indexDir);
    const bytes = await directoryBytes(indexDir);
    if (!metaExists || !contentExists) {
      return {
        exists: true,
        complete: false,
        tiersAgree: false,
        missingTier: metaExists ? CONTENT_DATABASE_NAME : META_DATABASE_NAME,
        bytes
      };
    }
    const metaStore = createMetadataStore({ databasePath: metaPath, readOnly: true });
    const reader = new DatabaseSync(contentPath, { readOnly: true });
    try {
      const metadata = metaStore.stats();
      const content = createContentReader(reader);
      const metaEpoch = Number(metaStore.getMeta(META_EPOCH_KEY) ?? -1);
      return {
        exists: true,
        complete,
        tiersAgree: metaEpoch === content.buildEpoch,
        buildEpoch: content.buildEpoch,
        metaEpoch,
        files: metadata.files,
        directories: metadata.directories,
        contentFiles: content.totalContentFiles,
        chunks: content.chunkCount,
        cjkPostings: content.postingCount,
        builtAtMs: content.builtAtMs,
        bytes
      };
    } finally {
      metaStore.close();
      reader.close();
    }
  },

  apply: async ({ rootPath, indexDir, timeline, changes }) => {
    const loaded = await timeline.measure(
      'B:load-for-apply',
      async () => await loadIndex({ rootPath, indexDir, timeline: createTimeline('inner') })
    );
    try {
      const stats = await timeline.measure('B:apply', async (span) => {
        const applied = await loaded.handle.apply(changes);
        span.detail = {
          requested: applied.requestedPaths,
          upserted: applied.upserted,
          removed: applied.removed,
          unchanged: applied.unchanged,
          escalated: applied.escalatedToFullReconcile
        };
        return applied;
      });
      return { stats };
    } finally {
      await loaded.handle.close();
    }
  },

  refresh: async ({ rootPath, indexDir, timeline }) => {
    for (const databasePath of [metaPathFor(indexDir), contentPathFor(indexDir)]) {
      if (await fileExists(databasePath)) continue;
      throw new TypeError('Plan B index is missing - run "index init --plan B" first');
    }
    const config = await timeline.measure(
      'B:config',
      async () => await loadOnlyPreviewWorkspaceConfig(rootPath)
    );
    const connections = timeline.measureSync('B:open-write', () => ({
      metaStore: createMetadataStore({ databasePath: metaPathFor(indexDir) }),
      database: openWriteDatabase(contentPathFor(indexDir))
    }));
    try {
      const stats = await reconcileWorkspace({
        rootPath,
        indexDir,
        timeline,
        metaStore: connections.metaStore,
        database: connections.database,
        config
      });
      return { stats };
    } finally {
      timeline.measureSync('B:close-write', () => {
        connections.database.close();
        connections.metaStore.close();
      });
    }
  },

  drop: async ({ indexDir }) => {
    await rm(indexDir, { recursive: true, force: true });
  }
});
