/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createHash } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { createOnlyPreviewSearchDiagnostics } from '../../../src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';
import { createOnlyPreviewBrowseIndex } from '../../../src/preload/onlypreview/search/core/browse-index.mjs';
import { createOnlyPreviewGlobalSearchSession } from '../../../src/preload/onlypreview/search/core/global-search-session.mjs';
import { createOnlyPreviewSearchEngine } from '../../../src/preload/onlypreview/search/core/search-engine.mjs';
import { createOnlyPreviewSelectedFilePriorityLane } from '../../../src/preload/onlypreview/search/core/selected-file-priority-lane.mjs';
import { executeOnlyPreviewGlobalSearch } from '../../../src/preload/onlypreview/search/core/global-search-executor.mjs';
import {
  OnlyPreviewSqliteIndex,
  SEARCH_ENGINE_IDENTITY
} from '../../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import {
  createTraversalPolicy,
  readSingleWorkspaceFile
} from '../../../src/preload/onlypreview/search/core/traversal.mjs';
import { MAX_WATCH_CHANGE_PATHS } from '../../../src/preload/onlypreview/search/core/constants.mjs';
import {
  isIndexedShortQuery,
  normalizeSearchText
} from '../../../src/preload/onlypreview/search/core/normalization.mjs';
import { loadOnlyPreviewWorkspaceConfig } from '../../../src/preload/onlypreview/search/core/workspace-config.mjs';
import { sortOnlyPreviewTreeEntries } from '../../../src/preload/onlypreview/search/core/watch-reconciler.mjs';
import {
  assertSearchOutcome,
  createTimeline,
  definePlan,
  readIndexCompleteness,
  writeIndexMeta
} from './planContract.mjs';

const DATABASE_NAME = 'search.sqlite';
const WORKSPACE_ID = 'plan-a';
const GENERATION = 1;
const engineHash = createHash('sha256').update(SEARCH_ENGINE_IDENTITY).digest('hex');

const databasePathFor = (indexDir) => join(indexDir, DATABASE_NAME);

/** Mirrors `candidateIterator`, so a slow query can be attributed to the branch that served it. */
export const expectedContentEngine = (query) => {
  const normalized = normalizeSearchText(query);
  const length = [...normalized].length;
  if (length > 64) return 'exact-file-fallback';
  if (isIndexedShortQuery(normalized)) return 'cjk-postings';
  if (length <= 2) return 'sqlite-instr-prefilter';
  return 'fts5-trigram';
};

const recordEngineDiagnostics = () => {
  const events = [];
  const diagnostics = createOnlyPreviewSearchDiagnostics({
    write: (line) => {
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
      if (event) events.push({ event, fields });
    }
  });
  return { diagnostics, events };
};

const applyEngineSpans = (timeline, events, prefix) => {
  for (const { event, fields } of events) {
    if (typeof fields.elapsedMs !== 'number') continue;
    const { elapsedMs, tag, ...detail } = fields;
    timeline.record(
      `${prefix}${event}`,
      elapsedMs,
      Object.keys(detail).length > 0 ? detail : undefined
    );
    void tag;
  }
};

const mapFiles = (rows) =>
  rows.map((row) => ({
    relativePath: row.relativePath,
    name: row.name,
    nodeKind: row.nodeKind
  }));

const mapContents = (rows) =>
  rows.map((row) => ({
    relativePath: row.relativePath,
    name: row.fileName,
    snippet: row.contentMatch?.snippetText ?? '',
    highlightStart: row.contentMatch?.highlightStart ?? 0,
    highlightLength: row.contentMatch?.highlightLength ?? 0
  }));

const identityFor = async (rootPath) => {
  const config = await loadOnlyPreviewWorkspaceConfig(rootPath);
  return {
    config,
    identity: {
      workspaceHash: createHash('sha256').update(rootPath).digest('hex'),
      configHash: config.hash,
      engineHash
    }
  };
};

const engineStats = (snapshot) => {
  const entries = snapshot?.index?.entries ?? [];
  return {
    treeEntries: entries.length,
    files: entries.filter((entry) => entry.nodeKind === 'file').length,
    directories: entries.filter((entry) => entry.nodeKind === 'directory').length,
    truncated: snapshot?.index?.truncated === true
  };
};

const searchThroughEngine = async (
  target,
  { query, scope, maxResults, requestId, sections = ['files', 'contents'] }
) => {
  let firstResultMs;
  const startedAt = performance.now();
  const sectionFirstMs = {};
  const response = await target.search({
    workspaceId: WORKSPACE_ID,
    generation: GENERATION,
    requestId,
    query,
    maxResults,
    scope,
    isCancelled: () => false,
    onResult: (result) => {
      firstResultMs ??= performance.now() - startedAt;
      const section = result?.section;
      if (section && sectionFirstMs[section] === undefined) {
        sectionFirstMs[section] = performance.now() - startedAt;
      }
    }
  });
  const wantFiles = sections.includes('files');
  const wantContents = sections.includes('contents');
  return {
    files: wantFiles ? mapFiles(response.files) : [],
    contents: wantContents ? mapContents(response.contents) : [],
    truncated: {
      files: wantFiles && response.filesTruncated === true,
      contents: wantContents && response.contentsTruncated === true
    },
    engine: expectedContentEngine(query),
    counters: {
      firstResultMs,
      firstFilesMs: sectionFirstMs.files,
      firstContentsMs: sectionFirstMs.contents,
      treeEntriesScanned: target.__treeEntryCount,
      // The engine runs both branches concurrently and cannot be asked for one of them, so a
      // single-section request still pays for both.
      sectionsComputed: 'files+contents'
    }
  };
};

/**
 * Seed-only load: open the committed SQLite index, hydrate the filename tier, read the persisted
 * tree snapshot, and answer queries through the shipped query executor without running the startup
 * reconcile. It measures what Plan A would cost if the freshness pass were removed, which is the
 * headroom figure for the first search.
 */
const loadSeedOnly = async ({ rootPath, indexDir, timeline }) => {
  const databasePath = databasePathFor(indexDir);
  const { config, identity } = await timeline.measure(
    'A:config',
    async () => await identityFor(rootPath)
  );
  const searchPolicy = timeline.measureSync('A:policy', () => createTraversalPolicy(config));
  const index = timeline.measureSync(
    'A:sqlite-open',
    () => new OnlyPreviewSqliteIndex(databasePath)
  );
  timeline.measureSync('A:hydrate-filename-tier', (span) => {
    index.hydrateFilenameTier();
    span.detail = { records: index.filenameTier.records.size };
  });
  const seedTree = timeline.measureSync('A:read-tree-snapshot', (span) => {
    // The engine passes its search policy here, and the snapshot store uses it both to filter
    // excluded entries and to build provisional directory ancestors. Omitting it silently returns
    // rows the engine would not.
    const tree = index.readTreeSnapshot({ searchPolicy });
    span.detail = { entries: tree.entries.length, ready: tree.treeMetadataReady };
    return tree;
  });
  const treeEntries = timeline.measureSync('A:sort-tree', () =>
    sortOnlyPreviewTreeEntries(seedTree.entries)
  );
  const diagnostics = createOnlyPreviewSearchDiagnostics({ write: () => undefined });
  const context = {
    workspaceId: WORKSPACE_ID,
    generation: GENERATION,
    state: 'ready',
    buildEpoch: 0,
    rootPath,
    config,
    identity,
    activeIdentity: identity,
    searchPolicy,
    activeSearchPolicy: searchPolicy,
    index,
    treeEntries,
    maxDepthReached: seedTree.maxDepthReached,
    treeMetadataReady: seedTree.treeMetadataReady,
    browseIndex: createOnlyPreviewBrowseIndex(rootPath, { searchPolicy }),
    globalSearchSession: createOnlyPreviewGlobalSearchSession(),
    diagnostics,
    activeQueryCount: 0,
    promotionPromise: undefined,
    currentBuildPromise: undefined
  };
  context.selectedFilePriority = createOnlyPreviewSelectedFilePriorityLane({
    readWorkspaceFile: readSingleWorkspaceFile,
    resolveContext: () => context
  });
  const target = {
    __treeEntryCount: treeEntries.length,
    search: async (params) => await executeOnlyPreviewGlobalSearch(context, params)
  };
  return {
    handle: {
      mode: 'seed-only',
      treeEntryCount: treeEntries.length,
      directories: () =>
        treeEntries
          .filter((entry) => entry.nodeKind === 'directory')
          .map((entry) => entry.relativePath),
      search: async (query, options) =>
        assertSearchOutcome(await searchThroughEngine(target, { query, ...options }), 'A'),
      indexedFiles: () =>
        treeEntries.filter((entry) => entry.nodeKind === 'file').map((entry) => entry.relativePath),
      close: async () => {
        index.close();
      }
    },
    stats: {
      treeEntries: treeEntries.length,
      files: treeEntries.filter((entry) => entry.nodeKind === 'file').length,
      directories: treeEntries.filter((entry) => entry.nodeKind === 'directory').length,
      treeMetadataReady: seedTree.treeMetadataReady
    }
  };
};

const loadWithReconcile = async ({ rootPath, indexDir, timeline }) => {
  const databasePath = databasePathFor(indexDir);
  const { diagnostics, events } = recordEngineDiagnostics();
  const commits = [];
  const engine = createOnlyPreviewSearchEngine({
    diagnostics,
    onWatchCommit: (commit) => commits.push(commit)
  });
  const snapshot = await timeline.measure(
    'A:engine.initialize',
    async () =>
      await engine.initialize({
        workspaceId: WORKSPACE_ID,
        generation: GENERATION,
        rootPath,
        databasePath
      })
  );
  applyEngineSpans(timeline, events, 'A:phase.');
  const treeEntries = snapshot.index.entries;
  const target = { __treeEntryCount: treeEntries.length, search: engine.search.bind(engine) };
  return {
    handle: {
      mode: 'reconcile',
      treeEntryCount: treeEntries.length,
      directories: () =>
        treeEntries
          .filter((entry) => entry.nodeKind === 'directory')
          .map((entry) => entry.relativePath),
      search: async (query, options) =>
        assertSearchOutcome(await searchThroughEngine(target, { query, ...options }), 'A'),
      indexedFiles: async () => {
        const snapshot = await engine.snapshot();
        return snapshot.index.entries
          .filter((entry) => entry.nodeKind === 'file')
          .map((entry) => entry.relativePath);
      },
      refresh: async () =>
        await engine.refresh({ workspaceId: WORKSPACE_ID, generation: GENERATION }),
      /**
       * The same path a real watcher takes: the engine's own reconciler decides per path whether it
       * is an upsert or a deletion, and silently escalates to a whole-workspace reconcile when the
       * change set exceeds MAX_WATCH_CHANGE_PATHS or touches something that is not a file. The
       * emitted watch commit is what tells us which of those happened.
       */
      apply: async (changes) => {
        const before = commits.length;
        await engine.enqueue(
          async () =>
            await engine.applyWatchChangesInternal({
              full: changes.full === true,
              paths: [...changes.paths]
            })
        );
        const emitted = commits.slice(before);
        const escalated = emitted.some((commit) => commit.full === true);
        const refreshed = engine.index !== undefined ? engineStats(await engine.snapshot()) : {};
        return {
          requestedPaths: changes.paths.length,
          committedPaths: emitted.reduce(
            (total, commit) => total + commit.changedRelativePaths.length,
            0
          ),
          commits: emitted.length,
          escalatedToFullReconcile: escalated,
          treeEntries: refreshed.treeEntries,
          files: refreshed.files
        };
      },
      close: async () => {
        await engine.shutdown();
      }
    },
    stats: engineStats(snapshot)
  };
};

export const planA = definePlan({
  id: 'A',
  name: 'OnlyPreview as shipped',
  summary:
    'The engine currently in Bitterless: content-defined chunks in SQLite with an FTS5 trigram ' +
    'index and CJK postings, a persisted tree snapshot, and a startup reconcile into an isolated ' +
    'candidate database before promotion.',
  tradeoffs: [
    'Init and load are fused: opening a workspace always runs a full freshness reconcile.',
    'The Files section is project-wide by product decision (docs/issues/onlypreview-directory-' +
      'selection-and-global-file-scope.md), so a directory scope does not reduce its work: every ' +
      'tree entry is scanned in memory and re-normalised on every query.',
    'Content queries are index-only and fast once the build has completed.',
    'An incremental commit accepts at most 512 paths; beyond that, or if a changed path is not a ' +
      'file, the engine silently escalates to a whole-workspace reconcile.'
  ],
  capabilities: {
    separateLoad: false,
    scopedFiles: false,
    scopedContents: true,
    independentSections: false,
    backgroundBuild: false,
    incrementalApply: true,
    maxChangePaths: MAX_WATCH_CHANGE_PATHS,
    entryRemoval: 'derived-from-filesystem'
  },
  loadModes: ['reconcile', 'seed-only'],

  init: async ({ rootPath, indexDir, timeline }) => {
    const databasePath = databasePathFor(indexDir);
    const { diagnostics, events } = recordEngineDiagnostics();
    const engine = createOnlyPreviewSearchEngine({ diagnostics });
    try {
      const snapshot = await timeline.measure(
        'A:engine.initialize',
        async () =>
          await engine.initialize({
            workspaceId: WORKSPACE_ID,
            generation: GENERATION,
            rootPath,
            databasePath
          })
      );
      applyEngineSpans(timeline, events, 'A:phase.');
      await writeIndexMeta(indexDir, { planId: 'A', rootPath, databaseName: DATABASE_NAME });
      return { stats: engineStats(snapshot) };
    } finally {
      await timeline.measure('A:engine.shutdown', async () => await engine.shutdown());
    }
  },

  load: async ({ rootPath, indexDir, timeline, options = {} }) =>
    options.reconcile === false
      ? await loadSeedOnly({ rootPath, indexDir, timeline })
      : await loadWithReconcile({ rootPath, indexDir, timeline }),

  status: async ({ rootPath, indexDir }) => {
    const databasePath = databasePathFor(indexDir);
    const exists = await stat(databasePath).then(
      () => true,
      () => false
    );
    if (!exists) return { exists: false, complete: false };
    const provenance = await readIndexCompleteness(indexDir);
    const { identity } = await identityFor(rootPath);
    const index = new OnlyPreviewSqliteIndex(databasePath);
    try {
      const scalar = (sql) =>
        Number(Object.values(index.database.prepare(sql).get() ?? {})[0] ?? 0);
      const bytes = await index.diskBytes();
      return {
        exists: true,
        complete: provenance.complete,
        builtByEngine: provenance.builtByEngine,
        engineMatches: provenance.engineMatches,
        reusable: index.isReusable(identity),
        schemaVersion: Number(index.database.prepare('PRAGMA user_version').get().user_version),
        files: scalar('SELECT count(*) FROM files'),
        contentFiles: scalar('SELECT count(*) FROM files WHERE content_indexed = 1'),
        chunks: scalar('SELECT count(*) FROM chunks'),
        cjkPostings: scalar('SELECT count(*) FROM cjk_postings'),
        treeDirectories: scalar('SELECT count(*) FROM search_tree'),
        bytes
      };
    } finally {
      index.close();
    }
  },

  apply: async ({ rootPath, indexDir, timeline, changes }) => {
    const loaded = await timeline.measure(
      'A:load-for-apply',
      async () => await loadWithReconcile({ rootPath, indexDir, timeline: createTimeline('inner') })
    );
    try {
      const stats = await timeline.measure('A:apply', async (span) => {
        const applied = await loaded.handle.apply(changes);
        span.detail = {
          requested: applied.requestedPaths,
          committed: applied.committedPaths,
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
    const loaded = await loadWithReconcile({ rootPath, indexDir, timeline });
    try {
      const snapshot = await timeline.measure(
        'A:engine.refresh',
        async () => await loaded.handle.refresh()
      );
      return { stats: engineStats(snapshot) };
    } finally {
      await loaded.handle.close();
    }
  },

  drop: async ({ indexDir }) => {
    await rm(indexDir, { recursive: true, force: true });
  }
});
