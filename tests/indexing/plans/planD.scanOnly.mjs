/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { lstat, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { classifySearchMediaType } from '../../../src/preload/onlypreview/search/core/classification.mjs';
import { MAX_INDEX_DEPTH } from '../../../src/preload/onlypreview/search/core/constants.mjs';
import { isWorkspaceSearchPathWithinDepth } from '../../../src/preload/onlypreview/search/core/traversal.mjs';
import { loadOnlyPreviewWorkspaceConfig } from '../../../src/preload/onlypreview/search/core/workspace-config.mjs';
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
import { createMetadataStore } from './metadataStore.mjs';
import { createScanPool } from './scanPool.mjs';
import { createTraversalPolicy, walkWorkspace } from './walker.mjs';

const DATABASE_NAME = 'metadata.sqlite';

/**
 * The config that produced this index. A `.bitterless/preview-config.yml` change moves the exclusion
 * boundary, so an index built under the old rules answers with the wrong candidate set; storing the
 * hash next to the rows lets status and load say so instead of silently serving it.
 */
const CONFIG_HASH_META_KEY = 'workspaceConfigHash';

const MAX_RELATIVE_PATH_LENGTH = 16_384;

const databasePathFor = (indexDir) => join(indexDir, DATABASE_NAME);

const databaseExists = async (databasePath) =>
  await stat(databasePath).then(
    () => true,
    () => false
  );

const resolvePoolSize = (value) => {
  const size = Number(value);
  return Number.isFinite(size) && size > 0 ? Math.trunc(size) : undefined;
};

const summarizeFiles = (files) => {
  let textFileCount = 0;
  let textBytes = 0;
  for (const file of files) {
    if (file.mediaType !== 'text') continue;
    textFileCount += 1;
    textBytes += file.size;
  }
  return { fileCount: files.length, textFileCount, textBytes };
};

const writeSummaryMeta = (store, summary) => {
  store.setMeta('fileCount', Math.max(0, summary.fileCount));
  store.setMeta('textFileCount', Math.max(0, summary.textFileCount));
  store.setMeta('textBytes', Math.max(0, summary.textBytes));
};

const readSummaryMeta = (store) => ({
  fileCount: Number(store.getMeta('fileCount') ?? 0),
  textFileCount: Number(store.getMeta('textFileCount') ?? 0),
  textBytes: Number(store.getMeta('textBytes') ?? 0)
});

/**
 * The whole plan: one walk, no file reads. The traversal policy comes from the workspace config so
 * the candidate set matches plan A's - result parity is a benchmark gate, and an exclusion rule that
 * only one plan honours would silently break it.
 */
const collectWorkspace = async ({ rootPath, timeline = createTimeline('collect') }) => {
  const config = await timeline.measure(
    'D:config',
    async () => await loadOnlyPreviewWorkspaceConfig(rootPath)
  );
  const policy = timeline.measureSync('D:policy', () => createTraversalPolicy(config));
  const files = [];
  const dirs = [];
  await timeline.measure('D:walk', async (span) => {
    const counters = await walkWorkspace({
      rootPath,
      policy,
      onDirectory: (entry) => dirs.push(entry),
      onFile: (entry) => files.push(entry)
    });
    span.detail = { ...counters };
  });
  return { files, dirs, config, policy };
};

/** Rows, summary counters and the config hash in ONE transaction: a half-written index cannot exist. */
const writeWholeIndex = (store, { files, dirs, configHash }) => {
  const summary = summarizeFiles(files);
  store.transaction(() => {
    store.database.exec('DELETE FROM files; DELETE FROM dirs;');
    store.upsertDirs(dirs);
    store.upsertFiles(files);
    writeSummaryMeta(store, summary);
    store.setMeta(CONFIG_HASH_META_KEY, configHash);
  });
  return { ...summary, directories: dirs.length };
};

/** Full reconcile against a fresh walk: the difference is computed, then committed in one go. */
const reconcileAll = ({ store, files, dirs, configHash }) => {
  const staleFiles = new Map(store.listFiles().map((row) => [row.relativePath, row]));
  const staleDirs = new Set(store.directories());
  const addedFiles = [];
  const changedFiles = [];
  for (const file of files) {
    const previous = staleFiles.get(file.relativePath);
    if (!previous) {
      addedFiles.push(file);
      continue;
    }
    staleFiles.delete(file.relativePath);
    if (previous.size !== file.size || previous.modifiedMs !== file.modifiedMs) {
      changedFiles.push(file);
    }
  }
  const addedDirs = [];
  for (const dir of dirs) {
    if (!staleDirs.delete(dir.relativePath)) addedDirs.push(dir);
  }
  const removedFiles = [...staleFiles.keys()];
  const removedDirs = [...staleDirs];
  const summary = summarizeFiles(files);
  store.transaction(() => {
    store.upsertFiles(addedFiles);
    store.upsertFiles(changedFiles);
    store.deleteFiles(removedFiles);
    store.upsertDirs(addedDirs);
    store.deleteDirs(removedDirs);
    writeSummaryMeta(store, summary);
    store.setMeta(CONFIG_HASH_META_KEY, configHash);
  });
  return {
    ...summary,
    directories: dirs.length,
    addedFiles: addedFiles.length,
    changedFiles: changedFiles.length,
    removedFiles: removedFiles.length,
    addedDirs: addedDirs.length,
    removedDirs: removedDirs.length
  };
};

const isIndexableRelativePath = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_RELATIVE_PATH_LENGTH &&
  !value.includes('\0') &&
  !value.includes('\\') &&
  !value.startsWith('/') &&
  !/^[a-zA-Z]:/u.test(value) &&
  value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');

const absolutePathFor = (rootPath, relativePath) => join(rootPath, ...relativePath.split('/'));

const fileEntryFrom = (relativePath, fileStat) => {
  const separator = relativePath.lastIndexOf('/');
  return {
    relativePath,
    parentRelativePath: separator < 0 ? '' : relativePath.slice(0, separator),
    name: relativePath.slice(separator + 1),
    size: Number(fileStat.size),
    modifiedMs: Math.trunc(Number(fileStat.mtimeMs)),
    mediaType: classifySearchMediaType(relativePath)
  };
};

/** `a/b/c.ts` -> the `a` and `a/b` directory rows the walker would have produced. */
const ancestorDirectories = (relativePath) => {
  const segments = relativePath.split('/');
  const ancestors = [];
  // walkWorkspace emits a row for a directory at depth MAX_INDEX_DEPTH and then stops descending,
  // so that depth is the deepest directory row an index can hold. Apply has to stop at the same
  // depth or the two disagree and a legitimate row shows up only after the next full refresh.
  const deepest = Math.min(segments.length - 1, MAX_INDEX_DEPTH);
  for (let index = 0; index < deepest; index += 1) {
    ancestors.push({
      relativePath: segments.slice(0, index + 1).join('/'),
      parentRelativePath: index === 0 ? '' : segments.slice(0, index).join('/'),
      name: segments[index]
    });
  }
  return ancestors;
};

const escalateToFullReconcile = async (context, requestedPaths) => {
  const { files, dirs, config } = await collectWorkspace({ rootPath: context.rootPath });
  const reconciled = reconcileAll({
    store: context.store,
    files,
    dirs,
    configHash: config.hash
  });
  context.invalidateDirectories();
  const upserted = reconciled.addedFiles + reconciled.changedFiles;
  return {
    requestedPaths,
    upserted,
    removed: reconciled.removedFiles,
    unchanged: Math.max(0, reconciled.fileCount - upserted),
    ignored: 0,
    directoryRowsAdded: reconciled.addedDirs,
    directoryRowsRemoved: reconciled.removedDirs,
    escalatedToFullReconcile: true
  };
};

/**
 * The watcher path: commit a bounded change set against the open index without re-walking. Plan D
 * has no content tier, so this only maintains the metadata rows - but they are what both the Files
 * section and the scanner's candidate list are built from, so a lingering row is a file the scanner
 * re-reads on every query and a missing row is a file no query can ever see.
 */
const applyChanges = async (context, changes) => {
  const { rootPath, store, policy } = context;
  const requestedPaths = changes.paths.length;
  for (const relativePath of changes.paths) {
    if (!isIndexableRelativePath(relativePath)) {
      throw new TypeError(
        `Change set path is not a workspace-relative path: ${JSON.stringify(relativePath)}`
      );
    }
  }
  if (changes.full) return await escalateToFullReconcile(context, requestedPaths);

  // Every counter below is a delta against the stored summary, so the same path twice would move it
  // twice. A watcher legitimately reports one path several times in one window.
  const uniquePaths = [...new Set(changes.paths)];
  const previousByPath = new Map();
  const upserts = [];
  const missingPaths = [];
  const absentPaths = [];
  const presentFilePaths = [];
  let unchanged = 0;
  let ignored = 0;
  for (const relativePath of uniquePaths) {
    const previous = store.fileMetadata(relativePath);
    previousByPath.set(relativePath, previous);
    const entryStat = await lstat(absolutePathFor(rootPath, relativePath)).catch(() => undefined);
    if (entryStat && !entryStat.isFile() && !entryStat.isSymbolicLink()) {
      // A directory now occupies the path: only a walk can describe what is underneath it.
      return await escalateToFullReconcile(context, requestedPaths);
    }
    if (!entryStat) absentPaths.push(relativePath);
    // The walker gives a directory a row because it exists, not because an indexable file sits in
    // it, so an excluded or too-deep file still contributes its ancestor rows.
    else if (entryStat.isFile()) presentFilePaths.push(relativePath);
    const indexable =
      entryStat?.isFile() === true &&
      !policy.isExcludedFilePath(relativePath) &&
      isWorkspaceSearchPathWithinDepth(relativePath);
    if (!indexable) {
      if (previous) missingPaths.push(relativePath);
      else ignored += 1;
      continue;
    }
    const entry = fileEntryFrom(relativePath, entryStat);
    if (previous && previous.size === entry.size && previous.modifiedMs === entry.modifiedMs) {
      unchanged += 1;
      continue;
    }
    upserts.push(entry);
  }

  const indexedDirs = context.directorySet();
  const knownDirs = new Set(indexedDirs);
  const addedDirs = [];
  for (const relativePath of presentFilePaths) {
    for (const ancestor of ancestorDirectories(relativePath)) {
      if (knownDirs.has(ancestor.relativePath)) continue;
      if (policy.isExcludedDirectoryPath(ancestor.relativePath)) continue;
      knownDirs.add(ancestor.relativePath);
      addedDirs.push(ancestor);
    }
  }

  // A watcher reports a path, never a kind, so a path that is gone from disk may have been the
  // directory itself - and then everything the store holds at or beneath it is dead. The store is
  // the authority on what that subtree contained, so no walk is needed to enumerate it.
  const vanishedDirs = new Set();
  const checkedDirs = new Set();
  for (const relativePath of absentPaths) {
    if (indexedDirs.has(relativePath)) vanishedDirs.add(relativePath);
    // A removal can take its whole directory with it, and the filesystem is the only authority on
    // which of the two happened - an empty directory that still exists keeps its row.
    for (const ancestor of ancestorDirectories(relativePath).reverse()) {
      if (checkedDirs.has(ancestor.relativePath)) break;
      checkedDirs.add(ancestor.relativePath);
      const dirStat = await lstat(absolutePathFor(rootPath, ancestor.relativePath)).catch(
        () => undefined
      );
      if (dirStat?.isDirectory() === true) break;
      vanishedDirs.add(ancestor.relativePath);
    }
  }
  const removedRows = new Map();
  for (const relativePath of missingPaths) {
    const previous = previousByPath.get(relativePath);
    if (previous) removedRows.set(relativePath, previous);
  }
  const removedDirs = [];
  if (vanishedDirs.size > 0) {
    const vanished = [...vanishedDirs];
    for (const dirPath of store.directories()) {
      if (
        vanishedDirs.has(dirPath) ||
        vanished.some((prefix) => dirPath.startsWith(`${prefix}/`))
      ) {
        removedDirs.push(dirPath);
      }
    }
    for (const prefix of vanished) {
      for (const row of store.listFiles({ scope: directoryScope(prefix) })) {
        removedRows.set(row.relativePath, row);
      }
    }
  }

  const summary = readSummaryMeta(store);
  for (const entry of upserts) {
    const previous = previousByPath.get(entry.relativePath);
    if (!previous) summary.fileCount += 1;
    else if (previous.mediaType === 'text') {
      summary.textFileCount -= 1;
      summary.textBytes -= previous.size;
    }
    if (entry.mediaType === 'text') {
      summary.textFileCount += 1;
      summary.textBytes += entry.size;
    }
  }
  for (const row of removedRows.values()) {
    summary.fileCount -= 1;
    if (row.mediaType !== 'text') continue;
    summary.textFileCount -= 1;
    summary.textBytes -= row.size;
  }

  try {
    store.transaction(() => {
      store.upsertDirs(addedDirs);
      store.upsertFiles(upserts);
      store.deleteFiles([...removedRows.keys()]);
      store.deleteDirs(removedDirs);
      writeSummaryMeta(store, summary);
    });
  } finally {
    context.invalidateDirectories();
  }

  return {
    requestedPaths,
    upserted: upserts.length,
    removed: removedRows.size,
    unchanged,
    ignored,
    directoryRowsAdded: addedDirs.length,
    directoryRowsRemoved: removedDirs.length,
    escalatedToFullReconcile: false
  };
};

const filesOutcome = (store, { query, scope, maxResults }) => {
  const named = store.searchNames({ query, scope, maxResults });
  return {
    rows: named.ordered ?? [],
    truncated: named.truncated === true,
    counters: {
      nameMatches: named.matched,
      ...(named.ceilingReached === true ? { nameCeilingReached: true } : {})
    }
  };
};

const contentsOutcome = async ({ store, pool, rootPath }, { query, scope, maxResults }) => {
  const candidates = store.listFiles({ scope, mediaType: 'text' });
  const scanned = await pool.scan({ rootPath, files: candidates, query, maxResults });
  return {
    rows: scanned.matches,
    truncated: scanned.truncated,
    counters: { ...scanned.counters, firstMatchMs: scanned.firstMatchAtMs }
  };
};

const search = async (context, query, { scope, sections = ['files', 'contents'], maxResults }) => {
  const wantFiles = sections.includes('files');
  const wantContents = sections.includes('contents');
  const files = wantFiles
    ? filesOutcome(context.store, { query, scope, maxResults })
    : { rows: [], truncated: false, counters: {} };
  const contents = wantContents
    ? await contentsOutcome(context, { query, scope, maxResults })
    : { rows: [], truncated: false, counters: {} };
  return {
    files: files.rows,
    contents: contents.rows,
    truncated: { files: files.truncated, contents: contents.truncated },
    engine: wantContents ? 'parallel-scan' : 'metadata-names',
    counters: { ...files.counters, ...contents.counters, poolSize: context.pool.size }
  };
};

/**
 * Opens the committed index. The database is opened read-write because `handle.apply` commits the
 * watcher's change set through this same connection.
 */
const loadIndex = async ({ rootPath, indexDir, timeline, options = {} }) => {
  const completeness = await timeline.measure(
    'D:read-marker',
    async () => await readIndexCompleteness(indexDir)
  );
  if (!completeness.complete) {
    throw new TypeError(
      'Plan D index is incomplete: plan-meta.json is missing, so a previous build never finished. ' +
        'Run "index init" again before loading it.'
    );
  }
  const config = await timeline.measure(
    'D:config',
    async () => await loadOnlyPreviewWorkspaceConfig(rootPath)
  );
  const policy = timeline.measureSync('D:policy', () => createTraversalPolicy(config));
  let store;
  let pool;
  try {
    store = timeline.measureSync('D:sqlite-open', () =>
      createMetadataStore({ databasePath: databasePathFor(indexDir) })
    );
    const requestedSize = resolvePoolSize(options.poolSize);
    pool = timeline.measureSync('D:scan-pool-start', (span) => {
      const created = createScanPool(requestedSize ? { size: requestedSize } : {});
      span.detail = { poolSize: created.size, requested: requestedSize ?? 'default' };
      return created;
    });
    // `new Worker` returns before the thread has booted, so without this round trip the warmup is
    // charged to whichever query happens to be first.
    await timeline.measure('D:scan-pool-ready', async () => await pool.ready());
    const counted = timeline.measureSync('D:read-meta', () => store.stats());
    const summary = readSummaryMeta(store);
    const indexedConfigHash = store.getMeta(CONFIG_HASH_META_KEY);
    let directoryCache;
    const context = {
      rootPath,
      store,
      pool,
      policy,
      directorySet: () => {
        directoryCache ??= new Set(store.directories());
        return directoryCache;
      },
      invalidateDirectories: () => {
        directoryCache = undefined;
      }
    };
    return {
      handle: {
        mode: 'scan-only',
        directories: () => store.directories(),
        indexedFiles: () => store.listFiles().map((row) => row.relativePath),
        search: async (query, searchOptions = {}) => {
          const scope = requirePlanScope(searchOptions.scope, {
            hasDirectory: (relativePath) => context.directorySet().has(relativePath)
          });
          return assertSearchOutcome(
            await search(context, query, { ...searchOptions, scope }),
            'D'
          );
        },
        apply: async (changes) => await applyChanges(context, changes),
        close: async () => {
          await pool.close();
          store.close();
        }
      },
      stats: {
        files: counted.files,
        directories: counted.directories,
        textFiles: summary.textFileCount,
        textBytes: summary.textBytes,
        poolSize: pool.size,
        configHash: indexedConfigHash?.slice(0, 12) ?? 'unknown',
        stale: indexedConfigHash !== config.hash
      }
    };
  } catch (error) {
    // A throw after the open would otherwise leak the database handle and the worker threads, and a
    // leaked worker keeps the event loop alive - the error would surface as a hang.
    if (pool) await pool.close();
    if (store) store.close();
    throw error;
  }
};

export const planD = definePlan({
  id: 'D',
  name: 'Metadata only, parallel literal scan',
  summary:
    'No content index at all: init stores only file and directory metadata in SQLite, and a content ' +
    'query reads the candidate files at query time through a worker pool that literal-scans them, ' +
    'roughly how ripgrep and VS Code answer a project search.',
  tradeoffs: [
    'Init is a single walk with no file reads, so building the index costs a fraction of plan A ' +
      'and the index stores no copy of the text.',
    'Every content query pays the read: latency scales with the bytes under the scope, and the same ' +
      'query twice costs the same twice apart from the OS page cache.',
    'The Files section is directory-scoped, unlike plan A, whose Files section is project-wide by ' +
      'product decision (docs/issues/onlypreview-directory-selection-and-global-file-scope.md), so ' +
      'a directory-scoped Files result is deliberately narrower than A returns.',
    'Dispatch stops once maxResults matches have accumulated in the completed batch prefix, so a ' +
      'capped answer is the same first-N the indexed plans return and truncation is provable.',
    'An incremental apply costs one lstat per path and no file reads - the same operation a walk ' +
      'spends per file - so there is no change-set size at which a full reconcile is cheaper, and ' +
      'no bound is declared. Nothing but metadata is maintained, because nothing else is stored.'
  ],
  capabilities: {
    separateLoad: true,
    scopedFiles: true,
    scopedContents: true,
    independentSections: true,
    backgroundBuild: false,
    incrementalApply: true,
    maxChangePaths: undefined,
    entryRemoval: 'derived-from-filesystem'
  },

  init: async ({ rootPath, indexDir, timeline }) => {
    const { files, dirs, config } = await collectWorkspace({ rootPath, timeline });
    const stats = timeline.measureSync('D:write', (span) => {
      const store = createMetadataStore({ databasePath: databasePathFor(indexDir) });
      try {
        span.detail = { files: files.length, directories: dirs.length };
        return writeWholeIndex(store, { files, dirs, configHash: config.hash });
      } finally {
        store.close();
      }
    });
    // Last, always: an index without this marker was interrupted, and load refuses to open it.
    await writeIndexMeta(indexDir, {
      planId: 'D',
      rootPath,
      databaseName: DATABASE_NAME,
      builtAtMs: Date.now()
    });
    return { stats };
  },

  load: async (input) => await loadIndex(input),

  status: async ({ rootPath, indexDir }) => {
    const databasePath = databasePathFor(indexDir);
    if (!(await databaseExists(databasePath))) return { exists: false };
    const bytes = await directoryBytes(indexDir);
    const { complete } = await readIndexCompleteness(indexDir);
    const currentConfigHash = (await loadOnlyPreviewWorkspaceConfig(rootPath)).hash;
    const store = createMetadataStore({ databasePath, readOnly: true });
    try {
      const counted = store.stats();
      const summary = readSummaryMeta(store);
      const indexedConfigHash = store.getMeta(CONFIG_HASH_META_KEY);
      return {
        exists: true,
        complete,
        files: counted.files,
        directories: counted.directories,
        textFiles: summary.textFileCount,
        textBytes: summary.textBytes,
        configHash: indexedConfigHash?.slice(0, 12) ?? 'unknown',
        configMatches: indexedConfigHash === currentConfigHash,
        bytes
      };
    } finally {
      store.close();
    }
  },

  apply: async ({ rootPath, indexDir, timeline, changes, options = {} }) => {
    const loaded = await timeline.measure(
      'D:load-for-apply',
      async () =>
        await loadIndex({
          rootPath,
          indexDir,
          timeline: createTimeline('load-for-apply'),
          options
        })
    );
    try {
      const stats = await timeline.measure('D:apply', async (span) => {
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

  refresh: async ({ rootPath, indexDir, timeline }) => {
    const { files, dirs, config } = await collectWorkspace({ rootPath, timeline });
    const stats = timeline.measureSync('D:apply-difference', (span) => {
      const store = createMetadataStore({ databasePath: databasePathFor(indexDir) });
      try {
        const reconciled = reconcileAll({ store, files, dirs, configHash: config.hash });
        span.detail = {
          addedFiles: reconciled.addedFiles,
          changedFiles: reconciled.changedFiles,
          removedFiles: reconciled.removedFiles
        };
        return reconciled;
      } finally {
        store.close();
      }
    });
    // A full reconcile rebuilds every row, so it is also how an interrupted build is repaired.
    await writeIndexMeta(indexDir, {
      planId: 'D',
      rootPath,
      databaseName: DATABASE_NAME,
      builtAtMs: Date.now()
    });
    return { stats };
  },

  drop: async ({ indexDir }) => {
    await rm(indexDir, { recursive: true, force: true });
  }
});
