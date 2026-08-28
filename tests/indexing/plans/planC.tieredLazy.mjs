/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { lstat, rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { splitContentDefinedChunks } from '../../../src/preload/onlypreview/search/core/chunking.mjs';
import {
  classifySearchMediaType,
  decodeSearchText,
  isSensitiveSearchFile
} from '../../../src/preload/onlypreview/search/core/classification.mjs';
import { MAX_TEXT_BYTES } from '../../../src/preload/onlypreview/search/core/constants.mjs';
import {
  createPlainTextSnippet,
  extractCjkPostingTokens,
  isIndexedShortQuery,
  normalizeSearchText,
  projectNormalizedMatchToSource
} from '../../../src/preload/onlypreview/search/core/normalization.mjs';
import { loadOnlyPreviewWorkspaceConfig } from '../../../src/preload/onlypreview/search/core/workspace-config.mjs';
import { createMetadataStore, scopeRange } from './metadataStore.mjs';
import {
  PROJECT_SCOPE,
  SECTIONS,
  assertSearchOutcome,
  createTimeline,
  definePlan,
  directoryBytes,
  directoryScope,
  readIndexCompleteness,
  readIndexMeta,
  requirePlanScope,
  writeIndexMeta
} from './planContract.mjs';
import { createScanPool } from './scanPool.mjs';
import { createTraversalPolicy, walkWorkspace } from './walker.mjs';

const METADATA_NAME = 'metadata.sqlite';
const CONTENT_NAME = 'content.sqlite';
const DEFAULT_BUDGET_MS = 2000;
const READ_BATCH_FILES = 32;
const READ_BATCH_BYTES = 2 * 1024 * 1024;
const CHANGE_STAT_CONCURRENCY = 32;

const CONTENT_PRAGMAS = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -32768;
  PRAGMA mmap_size = 268435456;
`;

const CONTENT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS content_files (
    id INTEGER PRIMARY KEY,
    relative_path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_ms INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    file_id INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
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
  CREATE INDEX IF NOT EXISTS cjk_postings_chunk_id ON cjk_postings(chunk_id);
  CREATE TABLE IF NOT EXISTS covered (
    dir_path TEXT PRIMARY KEY,
    indexed_at INTEGER NOT NULL,
    file_count INTEGER NOT NULL
  ) WITHOUT ROWID;
`;

const CANDIDATE_COLUMNS = `
  c.core_text, c.left_context_text, c.right_overlap_text, c.normalized_searchable,
  c.normalized_core_length, f.relative_path, f.file_name
`;

const SCOPE_CLAUSES = Object.freeze({
  project: '',
  directory: ' AND f.relative_path >= ? AND f.relative_path < ?'
});

const scopeKeyFor = (scope) =>
  scope?.kind === 'directory' && scope.relativePath ? 'directory' : 'project';

const scopeParamsFor = (scope) =>
  scopeKeyFor(scope) === 'directory' ? scopeRange(scope.relativePath) : [];

const prepareScoped = (database, build) =>
  Object.fromEntries(
    Object.entries(SCOPE_CLAUSES).map(([key, clause]) => [key, database.prepare(build(clause))])
  );

const ftsPhrase = (query) => `"${query.replaceAll('"', '""')}"`;

/**
 * Plan A only accepts a chunk whose match starts inside the chunk core, so a hit that lives purely
 * in the right overlap is reported by the following chunk instead of twice. Copied verbatim because
 * snippet text and highlight offsets are compared across plans.
 */
const contentMatchFor = (candidate, normalizedQuery) => {
  const matchIndex = candidate.normalized_searchable.indexOf(normalizedQuery);
  if (matchIndex < 0 || matchIndex >= Number(candidate.normalized_core_length)) return undefined;
  const source = `${candidate.left_context_text}${candidate.core_text}${candidate.right_overlap_text}`;
  return projectNormalizedMatchToSource(
    source,
    normalizedQuery,
    normalizeSearchText(candidate.left_context_text).length + matchIndex
  );
};

const createContentStore = ({ databasePath }) => {
  const database = new DatabaseSync(databasePath, { readOnly: false });
  database.exec(CONTENT_PRAGMAS);
  database.exec(CONTENT_SCHEMA);

  const statements = {
    selectFileByPath: database.prepare('SELECT id FROM content_files WHERE relative_path = ?'),
    insertFile: database.prepare(
      'INSERT INTO content_files(relative_path, file_name, size, modified_ms) VALUES (?, ?, ?, ?)'
    ),
    updateFile: database.prepare(
      'UPDATE content_files SET file_name = ?, size = ?, modified_ms = ? WHERE id = ?'
    ),
    deleteFile: database.prepare('DELETE FROM content_files WHERE id = ?'),
    selectChunkIds: database.prepare('SELECT id FROM chunks WHERE file_id = ?'),
    deleteChunksByFile: database.prepare('DELETE FROM chunks WHERE file_id = ?'),
    insertChunk: database.prepare(`
      INSERT INTO chunks(file_id, ordinal, core_text, left_context_text, right_overlap_text,
        normalized_searchable, normalized_core_length)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    insertFts: database.prepare('INSERT INTO chunk_fts(rowid, searchable) VALUES (?, ?)'),
    deleteFts: database.prepare('DELETE FROM chunk_fts WHERE rowid = ?'),
    insertPosting: database.prepare(
      'INSERT OR IGNORE INTO cjk_postings(token, chunk_id) VALUES (?, ?)'
    ),
    deletePostings: database.prepare('DELETE FROM cjk_postings WHERE chunk_id = ?'),
    markCovered: database.prepare(
      `INSERT INTO covered(dir_path, indexed_at, file_count) VALUES (?, ?, ?)
       ON CONFLICT(dir_path) DO UPDATE SET indexed_at = excluded.indexed_at,
         file_count = excluded.file_count`
    ),
    deleteCovered: database.prepare('DELETE FROM covered WHERE dir_path = ?'),
    allCovered: database.prepare('SELECT dir_path, file_count FROM covered ORDER BY dir_path'),
    coreTextByFile: database.prepare(
      'SELECT core_text FROM chunks WHERE file_id = ? ORDER BY ordinal'
    ),
    countFiles: database.prepare('SELECT count(*) AS total FROM content_files'),
    countChunks: database.prepare('SELECT count(*) AS total FROM chunks'),
    countPostings: database.prepare('SELECT count(*) AS total FROM cjk_postings'),
    indexedVersions: prepareScoped(
      database,
      (clause) => `
        SELECT f.relative_path, f.size, f.modified_ms FROM content_files AS f
        WHERE 1 = 1${clause} ORDER BY f.relative_path
      `
    ),
    contentFiles: prepareScoped(
      database,
      (clause) => `
        SELECT f.id, f.relative_path, f.file_name FROM content_files AS f
        WHERE 1 = 1${clause} ORDER BY f.relative_path
      `
    ),
    ftsCandidates: prepareScoped(
      database,
      (clause) => `
        SELECT ${CANDIDATE_COLUMNS} FROM chunk_fts AS x
        JOIN chunks AS c ON c.id = x.rowid JOIN content_files AS f ON f.id = c.file_id
        WHERE chunk_fts MATCH ?${clause} ORDER BY f.relative_path, c.ordinal
      `
    ),
    instrCandidates: prepareScoped(
      database,
      (clause) => `
        SELECT ${CANDIDATE_COLUMNS} FROM chunks AS c
        JOIN content_files AS f ON f.id = c.file_id
        WHERE instr(c.normalized_searchable, ?) > 0${clause}
        ORDER BY f.relative_path, c.ordinal
      `
    ),
    postingCandidates: prepareScoped(
      database,
      (clause) => `
        SELECT ${CANDIDATE_COLUMNS} FROM cjk_postings AS p
        JOIN chunks AS c ON c.id = p.chunk_id JOIN content_files AS f ON f.id = c.file_id
        WHERE p.token = ?${clause} ORDER BY f.relative_path, c.ordinal
      `
    )
  };

  const transaction = (run) => {
    database.exec('BEGIN IMMEDIATE');
    try {
      const value = run();
      database.exec('COMMIT');
      return value;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  };

  const dropChunkRows = (fileId) => {
    for (const row of statements.selectChunkIds.all(fileId)) {
      const chunkId = Number(row.id);
      statements.deletePostings.run(chunkId);
      statements.deleteFts.run(chunkId);
    }
    statements.deleteChunksByFile.run(fileId);
  };

  const replaceFileChunks = (file, chunks) => {
    const existing = statements.selectFileByPath.get(file.relativePath);
    let fileId;
    if (existing) {
      fileId = Number(existing.id);
      dropChunkRows(fileId);
      statements.updateFile.run(file.name, file.size, file.modifiedMs, fileId);
    } else {
      fileId = Number(
        statements.insertFile.run(file.relativePath, file.name, file.size, file.modifiedMs)
          .lastInsertRowid
      );
    }
    for (const chunk of chunks) {
      const chunkId = Number(
        statements.insertChunk.run(
          fileId,
          chunk.ordinal,
          chunk.text,
          chunk.leftContextText,
          chunk.rightOverlapText,
          chunk.normalizedSearchableText,
          chunk.normalizedCoreLength
        ).lastInsertRowid
      );
      statements.insertFts.run(chunkId, chunk.normalizedSearchableText);
      for (const token of extractCjkPostingTokens(chunk.normalizedSearchableText)) {
        statements.insertPosting.run(token, chunkId);
      }
    }
  };

  return {
    database,

    writeFiles: (prepared) =>
      transaction(() => {
        for (const entry of prepared) replaceFileChunks(entry.file, entry.chunks);
      }),

    /** Drops every content row for these paths and reports how many actually had rows. */
    removeFiles: (relativePaths) =>
      transaction(() => {
        let removed = 0;
        for (const relativePath of relativePaths) {
          const existing = statements.selectFileByPath.get(relativePath);
          if (!existing) continue;
          const fileId = Number(existing.id);
          dropChunkRows(fileId);
          statements.deleteFile.run(fileId);
          removed += 1;
        }
        return removed;
      }),

    hasFile: (relativePath) => statements.selectFileByPath.get(relativePath) !== undefined,

    markCovered: (dirPath, fileCount) => {
      statements.markCovered.run(dirPath, Date.now(), fileCount);
    },

    dropCovered: (dirPath) => {
      statements.deleteCovered.run(dirPath);
    },

    coveredDirectories: () => new Set(statements.allCovered.all().map((row) => row.dir_path)),

    indexedFileVersions: ({ scope } = {}) =>
      new Map(
        statements.indexedVersions[scopeKeyFor(scope)]
          .all(...scopeParamsFor(scope))
          .map((row) => [
            row.relative_path,
            { size: Number(row.size), modifiedMs: Number(row.modified_ms) }
          ])
      ),

    /**
     * `maxResults + 1` rows are collected so the caller can tell a full page from a truncated one
     * without a second query, exactly as plan A's cap-plus-probe does.
     */
    searchContents: ({ query, scope, maxResults, isAllowed }) => {
      const normalizedQuery = normalizeSearchText(query);
      if (!normalizedQuery || maxResults <= 0) return { matches: [], engine: 'none' };
      const key = scopeKeyFor(scope);
      const params = scopeParamsFor(scope);
      const codePointLength = [...normalizedQuery].length;
      const matches = [];
      const seen = new Set();
      const accept = (relativePath, name, contentMatch) => {
        seen.add(relativePath);
        matches.push({
          relativePath,
          name,
          snippet: contentMatch.snippetText,
          highlightStart: contentMatch.highlightStart,
          highlightLength: contentMatch.highlightLength
        });
      };
      if (codePointLength > 64) {
        for (const file of statements.contentFiles[key].iterate(...params)) {
          if (matches.length > maxResults) break;
          if (!isAllowed(file.relative_path)) continue;
          const source = statements.coreTextByFile
            .all(Number(file.id))
            .map((row) => row.core_text)
            .join('');
          if (!normalizeSearchText(source).includes(normalizedQuery)) continue;
          const contentMatch = createPlainTextSnippet(source, normalizedQuery);
          if (contentMatch) accept(file.relative_path, file.file_name, contentMatch);
        }
        return { matches, engine: 'exact-file-fallback' };
      }
      const [engine, rows] = isIndexedShortQuery(normalizedQuery)
        ? ['cjk-postings', statements.postingCandidates[key].iterate(normalizedQuery, ...params)]
        : codePointLength <= 2
          ? [
              'sqlite-instr-prefilter',
              statements.instrCandidates[key].iterate(normalizedQuery, ...params)
            ]
          : [
              'fts5-trigram',
              statements.ftsCandidates[key].iterate(ftsPhrase(normalizedQuery), ...params)
            ];
      for (const candidate of rows) {
        if (matches.length > maxResults) break;
        if (seen.has(candidate.relative_path) || !isAllowed(candidate.relative_path)) continue;
        const contentMatch = contentMatchFor(candidate, normalizedQuery);
        if (contentMatch) accept(candidate.relative_path, candidate.file_name, contentMatch);
      }
      return { matches, engine };
    },

    stats: () => ({
      contentFiles: Number(statements.countFiles.get().total),
      chunks: Number(statements.countChunks.get().total),
      cjkPostings: Number(statements.countPostings.get().total),
      // Committed rows, not a file total: nested subtrees each claim their own descendants, so the
      // per-directory counts overlap and only `coverageStats` can total files without double counting.
      coveredRows: statements.allCovered.all().length
    }),

    close: () => database.close()
  };
};

/**
 * Both tiers, opened together, so a failure to open the second one cannot leak the first. A leaked
 * SQLite handle is merely untidy; the same mistake around the scan pool in `load` leaks worker
 * threads, which keeps the event loop alive and turns an error into a hang.
 */
const openTiers = ({ indexDir, timeline }) => {
  const metadata = timeline.measureSync('C:metadata-open', (span) => {
    const store = createMetadataStore({ databasePath: join(indexDir, METADATA_NAME) });
    span.detail = store.stats();
    return store;
  });
  try {
    const content = timeline.measureSync('C:content-open', (span) => {
      const store = createContentStore({ databasePath: join(indexDir, CONTENT_NAME) });
      span.detail = store.stats();
      return store;
    });
    return {
      metadata,
      content,
      close: () => {
        try {
          content.close();
        } finally {
          metadata.close();
        }
      }
    };
  } catch (error) {
    metadata.close();
    throw error;
  }
};

const isIndexableTextFile = (file) =>
  file.size <= MAX_TEXT_BYTES && !isSensitiveSearchFile(file.relativePath);

const isFresh = (version, file) =>
  version !== undefined && version.size === file.size && version.modifiedMs === file.modifiedMs;

const parentOf = (relativePath) => {
  const separator = relativePath.lastIndexOf('/');
  return separator < 0 ? '' : relativePath.slice(0, separator);
};

/** True when a strict ancestor directory of `relativePath` claims coverage. */
const hasCoveredAncestor = (relativePath, coveredDirs) => {
  if (coveredDirs.has('')) return true;
  let separator = relativePath.lastIndexOf('/');
  while (separator > 0) {
    if (coveredDirs.has(relativePath.slice(0, separator))) return true;
    separator = relativePath.lastIndexOf('/', separator - 1);
  }
  return false;
};

const isCoveredDirectory = (relativePath, coveredDirs) =>
  coveredDirs.has(relativePath) || hasCoveredAncestor(relativePath, coveredDirs);

const scopeForDirectory = (relativePath) =>
  relativePath ? { kind: 'directory', relativePath } : PROJECT_SCOPE;

const subtreeTextFileCounts = (files) => {
  const counts = new Map();
  for (const file of files) {
    let separator = file.relativePath.lastIndexOf('/');
    while (separator > 0) {
      const directory = file.relativePath.slice(0, separator);
      counts.set(directory, (counts.get(directory) ?? 0) + 1);
      separator = file.relativePath.lastIndexOf('/', separator - 1);
    }
  }
  return counts;
};

/**
 * Largest uncovered subtree first, with the project root appended last: covering '' is only cheap
 * once every directory under it is covered, because then its outstanding work is the root's own
 * files.
 */
const coverageCandidates = ({ directories, textFiles, coveredDirs }) => {
  const counts = subtreeTextFileCounts(textFiles);
  const pending = directories.filter((directory) => !isCoveredDirectory(directory, coveredDirs));
  pending.sort(
    (left, right) =>
      (counts.get(right) ?? 0) - (counts.get(left) ?? 0) ||
      (left < right ? -1 : left > right ? 1 : 0)
  );
  return coveredDirs.has('') ? pending : [...pending, ''];
};

const emptyAccumulator = () => ({
  readMs: 0,
  chunkMs: 0,
  writeMs: 0,
  coverageMs: 0,
  files: 0,
  chunks: 0,
  bytesRead: 0,
  unreadable: 0,
  // Sets, not counters: a nested coverage candidate re-lists the same descendants, so counting
  // listings instead of paths reported more files "skipped as fresh" than the pass had files.
  indexedPaths: new Set(),
  freshPaths: new Set()
});

/** One batch is bounded by both files and bytes, so a budget can overshoot by at most that much. */
const readBatches = (files) => {
  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const file of files) {
    current.push(file);
    currentBytes += file.size ?? 0;
    if (current.length >= READ_BATCH_FILES || currentBytes >= READ_BATCH_BYTES) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
};

const indexFileBatch = async ({ rootPath, content, files, accumulator }) => {
  const readStartedAt = performance.now();
  const buffers = await Promise.all(
    files.map(
      async (file) =>
        await readFile(join(rootPath, ...file.relativePath.split('/'))).catch(() => undefined)
    )
  );
  accumulator.readMs += performance.now() - readStartedAt;
  const chunkStartedAt = performance.now();
  const prepared = [];
  for (const [position, file] of files.entries()) {
    const buffer = buffers[position];
    if (!buffer) {
      accumulator.unreadable += 1;
      continue;
    }
    accumulator.bytesRead += buffer.byteLength;
    prepared.push({ file, chunks: splitContentDefinedChunks(decodeSearchText(buffer)) });
  }
  accumulator.chunkMs += performance.now() - chunkStartedAt;
  const writeStartedAt = performance.now();
  content.writeFiles(prepared);
  accumulator.writeMs += performance.now() - writeStartedAt;
  for (const entry of prepared) {
    accumulator.files += 1;
    accumulator.chunks += entry.chunks.length;
    accumulator.indexedPaths.add(entry.file.relativePath);
  }
};

const indexFiles = async ({ rootPath, content, files, accumulator, deadline }) => {
  for (const batch of readBatches(files)) {
    if (performance.now() >= deadline) return false;
    await indexFileBatch({ rootPath, content, files: batch, accumulator });
  }
  return true;
};

/**
 * Coverage is committed per directory and only after every text file beneath it has been written, so
 * a query that trusts `covered` can never miss a file. Chunks written before the budget ran out stay
 * in the database: the next pass sees them as fresh and skips the read, so progress is monotonic
 * even though the interrupted directory stays uncovered.
 */
const extendCoverage = async ({
  rootPath,
  metadata,
  content,
  coveredDirs,
  candidates,
  accumulator,
  deadline
}) => {
  const finished = [];
  let exhausted = false;
  for (const candidate of candidates) {
    if (performance.now() >= deadline) {
      exhausted = true;
      break;
    }
    if (isCoveredDirectory(candidate, coveredDirs)) continue;
    const scope = scopeForDirectory(candidate);
    const bookkeepingStartedAt = performance.now();
    const pending = metadata.listFiles({ scope, mediaType: 'text' }).filter(isIndexableTextFile);
    const versions = content.indexedFileVersions({ scope });
    const outstanding = [];
    for (const file of pending) {
      if (!isFresh(versions.get(file.relativePath), file)) {
        outstanding.push(file);
        continue;
      }
      if (!accumulator.indexedPaths.has(file.relativePath)) {
        accumulator.freshPaths.add(file.relativePath);
      }
    }
    accumulator.coverageMs += performance.now() - bookkeepingStartedAt;
    const completed = await indexFiles({
      rootPath,
      content,
      files: outstanding,
      accumulator,
      deadline
    });
    if (!completed) {
      exhausted = true;
      break;
    }
    const markStartedAt = performance.now();
    content.markCovered(candidate, pending.length);
    accumulator.coverageMs += performance.now() - markStartedAt;
    coveredDirs.add(candidate);
    finished.push(candidate);
  }
  return { finished, exhausted };
};

const recordContentSpans = (timeline, accumulator) => {
  timeline.record('C:content-read', accumulator.readMs, {
    files: accumulator.files,
    bytes: accumulator.bytesRead,
    skippedFresh: accumulator.freshPaths.size
  });
  timeline.record('C:content-chunk', accumulator.chunkMs, { chunks: accumulator.chunks });
  timeline.record('C:content-write', accumulator.writeMs, { chunks: accumulator.chunks });
  timeline.record('C:coverage-bookkeeping', accumulator.coverageMs, {
    skippedFresh: accumulator.freshPaths.size
  });
};

const walkTier = async ({ rootPath, timeline }) => {
  const config = await timeline.measure(
    'C:config',
    async () => await loadOnlyPreviewWorkspaceConfig(rootPath)
  );
  const policy = timeline.measureSync('C:policy', () => createTraversalPolicy(config));
  const files = [];
  const dirs = [];
  await timeline.measure('C:walk', async (span) => {
    const counters = await walkWorkspace({
      rootPath,
      policy,
      onDirectory: (entry) => dirs.push(entry),
      onFile: (entry) => files.push(entry)
    });
    span.detail = {
      files: counters.files,
      directories: counters.directories,
      readdirCalls: counters.readdirCalls,
      lstatCalls: counters.lstatCalls
    };
  });
  return { files, dirs };
};

const writeMetadataTier = ({ metadata, rootPath, files, dirs, timeline }) => {
  timeline.measureSync('C:metadata-write', (span) => {
    metadata.replaceAll({ files, dirs });
    metadata.setMeta('rootPath', rootPath);
    span.detail = { files: files.length, directories: dirs.length };
  });
};

const coverageStats = ({ content, textFiles, directories }) => {
  const coveredDirs = content.coveredDirectories();
  let coveredFiles = 0;
  for (const file of textFiles) {
    if (hasCoveredAncestor(file.relativePath, coveredDirs)) coveredFiles += 1;
  }
  const coveredDirectories = directories.filter((directory) =>
    isCoveredDirectory(directory, coveredDirs)
  ).length;
  return {
    coveredDirectories,
    uncoveredDirectories: directories.length - coveredDirectories,
    coveredFiles,
    uncoveredFiles: textFiles.length - coveredFiles,
    projectRootCovered: coveredDirs.has('')
  };
};

/**
 * The whole-workspace reconcile, against tiers that are already open. `refresh` runs it on stores it
 * opened itself; `apply` runs it on the live handle's stores when the watcher admits it lost track.
 */
const reconcile = async ({ rootPath, metadata, content, timeline, budgetMs }) => {
  const { files, dirs } = await walkTier({ rootPath, timeline });
  writeMetadataTier({ metadata, rootPath, files, dirs, timeline });
  const textFiles = files.filter((file) => file.mediaType === 'text' && isIndexableTextFile(file));
  const directories = dirs.map((entry) => entry.relativePath);
  const coveredDirs = content.coveredDirectories();
  const accumulator = emptyAccumulator();
  const startedAt = performance.now();
  const deadline = startedAt + budgetMs;
  const versions = content.indexedFileVersions({});
  const stale = textFiles.filter(
    (file) =>
      hasCoveredAncestor(file.relativePath, coveredDirs) &&
      !isFresh(versions.get(file.relativePath), file)
  );
  const staleCompleted = await indexFiles({
    rootPath,
    content,
    files: stale,
    accumulator,
    deadline
  });
  // Counted here, before coverage extension adds to the same accumulator: `stale.length` is the work
  // the walk found, and under a tight budget most of it never happens.
  const staleFilesReindexed = stale.filter((file) =>
    accumulator.indexedPaths.has(file.relativePath)
  ).length;
  const extended = staleCompleted
    ? await extendCoverage({
        rootPath,
        metadata,
        content,
        coveredDirs,
        candidates: coverageCandidates({ directories, textFiles, coveredDirs }),
        accumulator,
        deadline
      })
    : { finished: [], exhausted: true };
  recordContentSpans(timeline, accumulator);
  const spentMs = performance.now() - startedAt;
  return {
    files,
    directories,
    textFiles,
    stats: {
      budgetMs,
      budgetSpentMs: spentMs,
      // A batch is bounded by files and bytes, so this is what one last batch cost beyond the budget.
      budgetOverrunMs: Math.max(0, spentMs - budgetMs),
      budgetExhausted: extended.exhausted || !staleCompleted,
      directoriesCoveredNow: extended.finished.length,
      staleFilesDetected: stale.length,
      staleFilesReindexed,
      indexedFiles: accumulator.files,
      chunks: accumulator.chunks,
      contentBytes: accumulator.bytesRead,
      skippedFresh: accumulator.freshPaths.size,
      ...coverageStats({ content, textFiles, directories })
    }
  };
};

const isValidRelativeFilePath = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 16_384 &&
  !value.includes('\0') &&
  !value.startsWith('/') &&
  !value.includes('\\') &&
  !/^[a-zA-Z]:/u.test(value) &&
  value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');

const statChangePaths = async ({ rootPath, paths }) => {
  const inspected = [];
  for (let offset = 0; offset < paths.length; offset += CHANGE_STAT_CONCURRENCY) {
    const slice = paths.slice(offset, offset + CHANGE_STAT_CONCURRENCY);
    const stats = await Promise.all(
      slice.map(
        async (relativePath) =>
          await lstat(join(rootPath, ...relativePath.split('/'))).catch(() => undefined)
      )
    );
    for (const [position, relativePath] of slice.entries()) {
      const entry = stats[position];
      // A symlink counts as gone: the walker skips symlinks, so the index never holds one.
      inspected.push({
        relativePath,
        file: entry?.isFile() === true ? entry : undefined,
        directory: entry?.isDirectory() === true
      });
    }
  }
  return inspected;
};

const missingAncestorDirs = (relativePath, knownDirs) => {
  const created = [];
  let directory = parentOf(relativePath);
  while (directory && !knownDirs.has(directory)) {
    knownDirs.add(directory);
    created.push({
      relativePath: directory,
      parentRelativePath: parentOf(directory),
      name: directory.slice(directory.lastIndexOf('/') + 1)
    });
    directory = parentOf(directory);
  }
  return created;
};

/**
 * Removing the last file of a directory often removes the directory too, and a directory row that
 * outlives its directory keeps answering the Files section for something that is gone. Whether it is
 * gone is a filesystem question, not an inference from the change set: an emptied directory that
 * still exists must keep its row, or apply would drop rows the next walk immediately puts back.
 * Coverage goes with the row, because a `covered` prefix that no longer exists would let a future
 * file at that path be trusted without ever being indexed.
 */
const prunableDirectories = async ({ rootPath, metadata, knownDirs, startDirs }) => {
  const drop = new Set();
  const hasLiveChildDirectory = (dirPath) => {
    const prefix = `${dirPath}/`;
    for (const known of knownDirs) {
      if (known !== dirPath && !drop.has(known) && known.startsWith(prefix)) return true;
    }
    return false;
  };
  for (const startDir of startDirs) {
    let directory = startDir;
    while (directory && knownDirs.has(directory) && !drop.has(directory)) {
      const onDisk = await lstat(join(rootPath, ...directory.split('/'))).then(
        (entry) => entry.isDirectory(),
        () => false
      );
      if (onDisk) break;
      // Rows the watcher did not report are still in the index; dropping the directory around them
      // would leave file rows nothing can reach.
      if (metadata.listFiles({ scope: directoryScope(directory) }).length > 0) break;
      if (hasLiveChildDirectory(directory)) break;
      drop.add(directory);
      directory = parentOf(directory);
    }
  }
  return [...drop];
};

/**
 * The watcher path: commit a bounded change set against the open index without re-walking. Every
 * path is stat'ed, because a watcher reports that something happened, never what.
 *
 * Returns `{ escalate: true }` when a reported path is, or was, a directory: a subtree appearing or
 * disappearing is not something a per-path commit can get right, and guessing is how an index ends
 * up claiming files it does not have. Plan A escalates on the same condition.
 */
const applyChanges = async ({ rootPath, metadata, content, changes }) => {
  const requestedPaths = changes.paths.length;
  // A watcher repeats itself: the same file arrives twice in one batch when it is written twice
  // before the debounce fires. Applied per occurrence it costs a second read, chunk and write and
  // counts twice in every field below.
  const paths = [...new Set(changes.paths)];
  for (const relativePath of paths) {
    if (!isValidRelativeFilePath(relativePath)) {
      throw new TypeError(`Invalid change path: ${JSON.stringify(relativePath)}`);
    }
  }
  const inspected = await statChangePaths({ rootPath, paths });
  const coveredDirs = content.coveredDirectories();
  const knownDirs = new Set(metadata.directories());
  if (
    inspected.some((entry) => entry.directory || (!entry.file && knownDirs.has(entry.relativePath)))
  ) {
    return { escalate: true };
  }
  const upserts = [];
  const newDirs = [];
  const removals = [];
  const missingParents = new Set();
  let unchanged = 0;
  let ghosts = 0;
  for (const entry of inspected) {
    if (!entry.file) {
      // Whether or not the index still held rows for it, a gone path is a reason to ask whether its
      // directory is gone too - a re-reported path is often how that is learnt.
      missingParents.add(parentOf(entry.relativePath));
      // A missing path the index never held is not a removal - there is nothing to remove.
      if (metadata.fileMetadata(entry.relativePath) || content.hasFile(entry.relativePath)) {
        removals.push(entry.relativePath);
      } else ghosts += 1;
      continue;
    }
    const relativePath = entry.relativePath;
    const file = {
      relativePath,
      parentRelativePath: parentOf(relativePath),
      name: relativePath.slice(relativePath.lastIndexOf('/') + 1),
      mediaType: classifySearchMediaType(relativePath),
      size: Number(entry.file.size),
      modifiedMs: Math.trunc(Number(entry.file.mtimeMs))
    };
    const existing = metadata.fileMetadata(relativePath);
    if (existing && existing.size === file.size && existing.modifiedMs === file.modifiedMs) {
      unchanged += 1;
      continue;
    }
    upserts.push(file);
    newDirs.push(...missingAncestorDirs(relativePath, knownDirs));
  }

  // A changed or new file under a covered directory has to be re-indexed before that coverage may
  // keep claiming it; a file with content rows outside coverage is refreshed so its rows never
  // describe bytes that are gone.
  const contentTargets = upserts.filter(
    (file) =>
      file.mediaType === 'text' &&
      isIndexableTextFile(file) &&
      (hasCoveredAncestor(file.relativePath, coveredDirs) || content.hasFile(file.relativePath))
  );
  const accumulator = emptyAccumulator();
  if (contentTargets.length > 0) {
    await indexFiles({
      rootPath,
      content,
      files: contentTargets,
      accumulator,
      deadline: Number.POSITIVE_INFINITY
    });
  }
  if (removals.length > 0) content.removeFiles(removals);

  metadata.transaction(() => {
    if (newDirs.length > 0) metadata.upsertDirs(newDirs);
    if (upserts.length > 0) metadata.upsertFiles(upserts);
    if (removals.length > 0) metadata.deleteFiles(removals);
  });
  // After the file rows are gone, so "is this directory still holding anything" is asked of the
  // index as it now stands.
  const prunedDirs =
    missingParents.size === 0
      ? []
      : await prunableDirectories({
          rootPath,
          metadata,
          knownDirs,
          startDirs: [...missingParents]
        });
  if (prunedDirs.length > 0) {
    metadata.transaction(() => metadata.deleteDirs(prunedDirs));
    for (const directory of prunedDirs) content.dropCovered(directory);
  }

  // Every reported path lands in exactly one bucket, so
  // requestedPaths = duplicatePaths + upserted + removed + unchanged + ghosts.
  return {
    requestedPaths,
    duplicatePaths: requestedPaths - paths.length,
    upserted: upserts.length,
    removed: removals.length,
    unchanged,
    // Gone from disk and absent from both tiers: not an upsert, not a removal, not unchanged. Left
    // out of the report entirely, a change set of mostly ghosts looked like a change set of nothing.
    ghosts,
    escalatedToFullReconcile: false,
    indexedFiles: accumulator.files,
    directoriesAdded: newDirs.length,
    directoriesRemoved: prunedDirs.length
  };
};

const runSearch = async ({ rootPath, metadata, content, pool, hasDirectory }, query, options) => {
  const { sections = SECTIONS, maxResults = 50 } = options ?? {};
  // A malformed or non-existent directory scope throws here, exactly as the shipped engine does. It
  // used to become an empty key range instead, which answers authoritatively with nothing.
  const scope = requirePlanScope(options?.scope ?? PROJECT_SCOPE, { hasDirectory });
  const wantFiles = sections.includes('files');
  const wantContents = sections.includes('contents');
  const counters = {};
  let files = [];
  let filesTruncated = false;
  if (wantFiles) {
    const startedAt = performance.now();
    const named = metadata.searchNames({ query, scope, maxResults });
    files = named.ordered;
    filesTruncated = named.truncated;
    counters.filesMs = performance.now() - startedAt;
    if (named.ceilingReached) counters.namesCeilingReached = true;
  }
  if (!wantContents) {
    return {
      files,
      contents: [],
      truncated: { files: filesTruncated, contents: false },
      engine: 'metadata',
      counters: { ...counters, servedBy: 'none', coveredFiles: 0, scannedFiles: 0, bytesRead: 0 }
    };
  }
  const contentStartedAt = performance.now();
  const coveredDirs = content.coveredDirectories();
  const candidates = metadata.listFiles({ scope, mediaType: 'text' }).filter(isIndexableTextFile);
  const versions = coveredDirs.size > 0 ? content.indexedFileVersions({ scope }) : new Map();
  const coveredPaths = new Set();
  const uncovered = [];
  for (const file of candidates) {
    // A file inside a covered directory still needs its stored size and mtime to match the metadata
    // tier's. A refresh that walked but ran out of content budget leaves exactly that mismatch, and
    // without this check those files would answer from chunks the walk already knows are stale.
    if (
      hasCoveredAncestor(file.relativePath, coveredDirs) &&
      isFresh(versions.get(file.relativePath), file)
    ) {
      coveredPaths.add(file.relativePath);
    } else uncovered.push(file);
  }
  const scanStartedAt = performance.now();
  const scanning =
    uncovered.length > 0 ? pool.scan({ rootPath, files: uncovered, query, maxResults }) : undefined;
  const indexStartedAt = performance.now();
  const indexed =
    coveredPaths.size > 0
      ? content.searchContents({
          query,
          scope,
          maxResults,
          isAllowed: (relativePath) => coveredPaths.has(relativePath)
        })
      : { matches: [], engine: 'none' };
  const indexMs = performance.now() - indexStartedAt;
  const scanned = scanning ? await scanning : undefined;
  const byPath = new Map();
  for (const match of scanned?.matches ?? []) byPath.set(match.relativePath, match);
  for (const match of indexed.matches) {
    if (!byPath.has(match.relativePath)) byPath.set(match.relativePath, match);
  }
  // Both inputs are already in binary path order - SQLite's ORDER BY and the pool's own ordering -
  // so merging them binary keeps the cap on the same boundary the indexed plans cut at.
  const merged = [...byPath.values()].sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
  );
  const servedBy =
    coveredPaths.size > 0 && uncovered.length > 0
      ? 'mixed'
      : uncovered.length > 0
        ? 'scan'
        : 'indexed';
  const engine =
    servedBy === 'scan'
      ? 'literal-scan'
      : servedBy === 'indexed'
        ? indexed.engine
        : `${indexed.engine}+literal-scan`;
  return {
    files,
    contents: merged.slice(0, maxResults),
    truncated: {
      files: filesTruncated,
      // The pool proves its own truncation - it counts every match and knows whether a batch was
      // never dispatched - so a capped scan-served answer can no longer claim to be complete.
      contents: merged.length > maxResults || scanned?.truncated === true
    },
    engine,
    counters: {
      ...counters,
      servedBy,
      coveredFiles: coveredPaths.size,
      scannedFiles: scanned?.counters.filesRead ?? 0,
      bytesRead: scanned?.counters.bytesRead ?? 0,
      skipped: scanned?.counters.skipped,
      unreadable: scanned?.counters.unreadable,
      matched: scanned?.counters.matched,
      orderedMatches: scanned?.counters.orderedMatches,
      stoppedEarly: scanned?.counters.stoppedEarly,
      batches: scanned?.counters.batches,
      batchesDispatched: scanned?.counters.batchesDispatched,
      candidateFiles: candidates.length,
      uncoveredFiles: uncovered.length,
      indexMs,
      scanMs: scanned ? performance.now() - scanStartedAt : undefined,
      firstScanMatchMs: scanned?.firstMatchAtMs,
      contentsMs: performance.now() - contentStartedAt
    }
  };
};

export const planC = definePlan({
  id: 'C',
  name: 'Two-tier: instant metadata, lazy content',
  summary:
    'Two independent tiers: a filename/directory tier written by one lean walk, and a content tier ' +
    'built later per directory. Init pays for the walk only, load is two SQLite opens plus a scan ' +
    'pool, and a content query answers indexed directories from SQLite while everything still ' +
    'uncovered is read live in workers.',
  tradeoffs: [
    'Init is walk cost only (default --content none), so the first search works before any content ' +
      'byte has been read - but a content query over uncovered directories pays a full live scan.',
    'Coverage is committed per directory and only once every text file beneath it is written, so ' +
      '"covered" never loses a result; the price is that an interrupted directory stays uncovered ' +
      'and gets re-listed on the next refresh.',
    'The Files section is scoped, unlike plan A: a directory scope becomes an index range over the ' +
      "metadata tier, so scoped Files results are a subset of A's deliberately project-wide ones " +
      '(docs/issues/onlypreview-directory-selection-and-global-file-scope.md).',
    'A content query reads the in-scope file list from both tiers before it dispatches, so scoped ' +
      'queries stay cheap but a project-wide query on a large workspace pays two ordered scans.',
    'Load is an open, never a reconcile, so a query sees the workspace as the last init, refresh or ' +
      'apply left it - an edit or deletion nobody reported is invisible exactly as it is to plan A ' +
      'under --no-reconcile. Once a walk has run, a file whose size or mtime no longer matches its ' +
      'indexed chunks is routed back to a live scan until the content tier catches up.',
    'apply accepts any number of paths: per path it costs one lstat plus an indexed row write, ' +
      'which is strictly cheaper than the walk a full reconcile would pay instead, so there is no ' +
      'size at which escalating helps. It escalates on changes.full, and on a reported path that is ' +
      'or was a directory, because a subtree cannot be committed from a file path.',
    'apply prunes deleted files from both tiers and drops a directory row (with its coverage) once ' +
      'the directory is gone from disk and holds nothing in the index. A full refresh still leaves ' +
      'orphan content rows behind - a query filters them out through the metadata tier, so results ' +
      'stay correct while status over-reports contentFiles until the next init.'
  ],
  capabilities: {
    separateLoad: true,
    scopedFiles: true,
    scopedContents: true,
    independentSections: true,
    backgroundBuild: true,
    incrementalApply: true,
    maxChangePaths: undefined,
    entryRemoval: 'derived-from-filesystem'
  },

  init: async ({ rootPath, indexDir, timeline, options = {} }) => {
    const { files, dirs } = await walkTier({ rootPath, timeline });
    const tiers = openTiers({ indexDir, timeline });
    try {
      writeMetadataTier({ metadata: tiers.metadata, rootPath, files, dirs, timeline });
      const textFiles = files.filter(
        (file) => file.mediaType === 'text' && isIndexableTextFile(file)
      );
      const directories = dirs.map((entry) => entry.relativePath);
      const contentMode = String(options.content ?? 'none');
      const accumulator = emptyAccumulator();
      if (contentMode === 'all') {
        await extendCoverage({
          rootPath,
          metadata: tiers.metadata,
          content: tiers.content,
          coveredDirs: tiers.content.coveredDirectories(),
          candidates: [''],
          accumulator,
          deadline: Number.POSITIVE_INFINITY
        });
        recordContentSpans(timeline, accumulator);
      }
      const stats = {
        files: files.length,
        directories: directories.length,
        textFiles: textFiles.length,
        contentMode,
        indexedFiles: accumulator.files,
        chunks: accumulator.chunks,
        contentBytes: accumulator.bytesRead,
        ...coverageStats({ content: tiers.content, textFiles, directories })
      };
      // Last write of a successful build. Without it `load` refuses to open the index and `status`
      // reports it incomplete, so an interrupted init can never pass itself off as a whole one.
      await writeIndexMeta(indexDir, {
        planId: 'C',
        rootPath,
        metadataName: METADATA_NAME,
        contentName: CONTENT_NAME,
        contentMode
      });
      return { stats };
    } finally {
      tiers.close();
    }
  },

  load: async ({ rootPath, indexDir, timeline }) => {
    const completeness = await timeline.measure(
      'C:completeness',
      async () => await readIndexCompleteness(indexDir)
    );
    if (!completeness.complete) {
      throw new TypeError(
        `Plan C index at ${indexDir} has no completeness marker, so its build was interrupted; ` +
          'run "index init" again before loading it'
      );
    }
    if (completeness.meta.rootPath !== rootPath) {
      throw new TypeError(
        `Plan C index at ${indexDir} was built for ${completeness.meta.rootPath}, not ${rootPath}`
      );
    }
    const tiers = openTiers({ indexDir, timeline });
    let pool;
    try {
      const storedRoot = tiers.metadata.getMeta('rootPath');
      if (storedRoot !== rootPath) {
        throw new TypeError(
          `Plan C metadata tier at ${indexDir} was written for ${storedRoot}, not ${rootPath}`
        );
      }
      pool = timeline.measureSync('C:scan-pool', (span) => {
        const created = createScanPool();
        span.detail = { workers: created.size };
        return created;
      });
      // Worker bootstrap belongs to load. Without this round trip the first query paid it - 68ms
      // against a 7ms warm p50 - which is exactly the latency this plan claims to have removed.
      await timeline.measure('C:scan-pool-ready', async () => await pool.ready());
      const coveredDirs = tiers.content.coveredDirectories();
      let directoryNames;
      const hasDirectory = (relativePath) => {
        directoryNames ??= new Set(tiers.metadata.directories());
        return directoryNames.has(relativePath);
      };
      return {
        handle: {
          mode: coveredDirs.size > 0 ? 'metadata+partial-content' : 'metadata-only',
          directories: () => tiers.metadata.directories(),
          // The metadata tier is this plan's inventory of what exists, so it - not the partially
          // built content tier - is what the index believes it holds.
          indexedFiles: () => tiers.metadata.listFiles().map((file) => file.relativePath),
          search: async (query, options) =>
            assertSearchOutcome(
              await runSearch(
                {
                  rootPath,
                  metadata: tiers.metadata,
                  content: tiers.content,
                  pool,
                  hasDirectory
                },
                query,
                options
              ),
              'C'
            ),
          apply: async (changes) => {
            directoryNames = undefined;
            const escalate = async () => {
              // A reconcile replaces both tiers wholesale, so the only way to report what it did is
              // to diff the index as it stood against what the walk found. Reporting a literal
              // `removed: 0` here claimed a deleted subtree had cost nothing.
              const before = new Map(
                tiers.metadata
                  .listFiles()
                  .map((file) => [file.relativePath, `${file.size}:${file.modifiedMs}`])
              );
              const dirsBefore = new Set(tiers.metadata.directories());
              const reconciled = await reconcile({
                rootPath,
                metadata: tiers.metadata,
                content: tiers.content,
                timeline: createTimeline('C:apply-full'),
                budgetMs: DEFAULT_BUDGET_MS
              });
              const survivors = new Set();
              let unchanged = 0;
              for (const file of reconciled.files) {
                survivors.add(file.relativePath);
                if (before.get(file.relativePath) === `${file.size}:${file.modifiedMs}`) {
                  unchanged += 1;
                }
              }
              const dirsAfter = new Set(reconciled.directories);
              return {
                requestedPaths: changes.paths.length,
                // Workspace-wide row verdicts, not per reported path: a reconcile is asked about one
                // path and answers about the whole index.
                upserted: reconciled.files.length - unchanged,
                removed: [...before.keys()].filter((path) => !survivors.has(path)).length,
                unchanged,
                escalatedToFullReconcile: true,
                indexedFiles: reconciled.stats.indexedFiles,
                directoriesAdded: [...dirsAfter].filter((path) => !dirsBefore.has(path)).length,
                directoriesRemoved: [...dirsBefore].filter((path) => !dirsAfter.has(path)).length
              };
            };
            if (changes.full === true) return await escalate();
            const applied = await applyChanges({
              rootPath,
              metadata: tiers.metadata,
              content: tiers.content,
              changes
            });
            return applied.escalate === true ? await escalate() : applied;
          },
          close: async () => {
            try {
              await pool.close();
            } finally {
              tiers.close();
            }
          }
        },
        stats: {
          ...tiers.metadata.stats(),
          ...tiers.content.stats(),
          scanWorkers: pool.size
        }
      };
    } catch (error) {
      if (pool) await pool.close();
      tiers.close();
      throw error;
    }
  },

  status: async ({ rootPath, indexDir }) => {
    void rootPath;
    const exists = await stat(join(indexDir, METADATA_NAME)).then(
      () => true,
      () => false
    );
    if (!exists) return { exists: false };
    const completeness = await readIndexCompleteness(indexDir);
    const tiers = openTiers({ indexDir, timeline: createTimeline('C:status') });
    try {
      const textFiles = tiers.metadata.listFiles({ mediaType: 'text' }).filter(isIndexableTextFile);
      const directories = tiers.metadata.directories();
      return {
        exists: true,
        complete: completeness.complete,
        ...tiers.metadata.stats(),
        ...tiers.content.stats(),
        ...coverageStats({ content: tiers.content, textFiles, directories }),
        bytes: await directoryBytes(indexDir)
      };
    } finally {
      tiers.close();
    }
  },

  apply: async ({ rootPath, indexDir, timeline, changes }) => {
    const loaded = await timeline.measure(
      'C:load-for-apply',
      async () => await planC.load({ rootPath, indexDir, timeline: createTimeline('inner') })
    );
    try {
      const stats = await timeline.measure('C:apply', async (span) => {
        const applied = await loaded.handle.apply(changes);
        span.detail = {
          requested: applied.requestedPaths,
          upserted: applied.upserted,
          removed: applied.removed,
          escalated: applied.escalatedToFullReconcile
        };
        return applied;
      });
      return { stats };
    } finally {
      await loaded.handle.close();
    }
  },

  refresh: async ({ rootPath, indexDir, timeline, options = {} }) => {
    const budgetMs = Number(options.budgetMs ?? DEFAULT_BUDGET_MS);
    const previous = await readIndexMeta(indexDir);
    const tiers = openTiers({ indexDir, timeline });
    try {
      const reconciled = await reconcile({
        rootPath,
        metadata: tiers.metadata,
        content: tiers.content,
        timeline,
        budgetMs
      });
      // Written last, and written even when the previous marker was missing: a refresh that walked
      // the whole workspace is exactly what repairs an interrupted init.
      await writeIndexMeta(indexDir, {
        planId: 'C',
        rootPath,
        metadataName: METADATA_NAME,
        contentName: CONTENT_NAME,
        contentMode: previous?.contentMode ?? 'none'
      });
      return { stats: reconciled.stats };
    } finally {
      tiers.close();
    }
  },

  drop: async ({ indexDir }) => {
    await rm(indexDir, { recursive: true, force: true });
  }
});
