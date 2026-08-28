import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import { executeOnlyPreviewGlobalSearch } from '../../src/preload/onlypreview/search/core/global-search-executor.mjs';
import { searchOnlyPreviewGlobalFiles } from '../../src/preload/onlypreview/search/core/global-search-files.mjs';
import { createOnlyPreviewGlobalSearchSession } from '../../src/preload/onlypreview/search/core/global-search-session.mjs';

const createWorkspace = () => {
  const base = mkdtempSync(join(tmpdir(), 'onlypreview-global-engine-'));
  const rootPath = join(base, 'workspace');
  mkdirSync(rootPath);
  return { base, rootPath, databasePath: join(base, 'search.sqlite') };
};

const deferred = () => {
  let resolve;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
};

test('snapshot search reuses the hydrated tree without a per-query full-tree copy', () => {
  const executorSource = readFileSync(
    new URL(
      '../../src/preload/onlypreview/search/core/global-search-executor.mjs',
      import.meta.url
    ),
    'utf8'
  );
  assert.match(executorSource, /entries: lease\.treeEntries/u);
  assert.doesNotMatch(executorSource, /lease\.treeEntries\s*\.filter/u);
});

test('warm startup rows terminal-replace offline add delete and rename with fresh tokens', async () => {
  const workspace = createWorkspace();
  writeFileSync(join(workspace.rootPath, 'offline-delete.txt'), 'offline body needle');
  writeFileSync(join(workspace.rootPath, 'offline-rename-old.txt'), 'offline body needle');
  const seededEngine = createOnlyPreviewSearchEngine();
  const engine = createOnlyPreviewSearchEngine();
  const candidateReady = deferred();
  const allowPromotion = deferred();
  let initialize;
  let searching;
  try {
    await seededEngine.initialize({
      workspaceId: 'seed-workspace',
      generation: 1,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await seededEngine.shutdown();
    unlinkSync(join(workspace.rootPath, 'offline-delete.txt'));
    renameSync(
      join(workspace.rootPath, 'offline-rename-old.txt'),
      join(workspace.rootPath, 'offline-rename-new.txt')
    );
    writeFileSync(join(workspace.rootPath, 'offline-add.txt'), 'offline body needle');

    const promote = engine.promoteCandidate.bind(engine);
    engine.promoteCandidate = async (...args) => {
      candidateReady.resolve();
      await allowPromotion.promise;
      return await promote(...args);
    };
    initialize = engine.initialize({
      workspaceId: 'workspace',
      generation: 35,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await candidateReady.promise;
    const firstWarmFiles = deferred();
    const firstWarmContents = deferred();
    const warmResults = [];
    let settled = false;
    searching = engine
      .search({
        workspaceId: 'workspace',
        generation: 35,
        requestId: 'offline-replacement',
        query: 'offline',
        maxResults: 500,
        scope: { kind: 'project' },
        isCancelled: () => false,
        onResult: (result) => {
          warmResults.push(result);
          if (result.section === 'files') firstWarmFiles.resolve();
          if (result.section === 'contents') firstWarmContents.resolve();
        }
      })
      .finally(() => {
        settled = true;
      });
    await Promise.all([firstWarmFiles.promise, firstWarmContents.promise]);
    assert.equal(settled, false);
    assert.deepEqual(
      warmResults
        .filter(({ section }) => section === 'files')
        .map(({ relativePath }) => relativePath),
      ['offline-delete.txt', 'offline-rename-old.txt']
    );
    const warmToken = warmResults.find(
      ({ section, relativePath }) =>
        section === 'files' && relativePath === 'offline-rename-old.txt'
    ).resultToken;

    allowPromotion.resolve();
    await initialize;
    const response = await searching;
    assert.deepEqual(
      response.files.map(({ relativePath }) => relativePath),
      ['offline-add.txt', 'offline-rename-new.txt']
    );
    assert.deepEqual(
      response.contents.map(({ relativePath }) => relativePath),
      ['offline-add.txt', 'offline-rename-new.txt']
    );
    await assert.rejects(() =>
      engine.preview({
        workspaceId: 'workspace',
        generation: 35,
        requestId: 'offline-replacement',
        resultToken: warmToken,
        isCancelled: () => false
      })
    );
    const preview = await engine.preview({
      workspaceId: 'workspace',
      generation: 35,
      requestId: 'offline-replacement',
      resultToken: response.files[0].resultToken,
      isCancelled: () => false
    });
    assert.equal(preview.name, 'offline-add.txt');
  } finally {
    allowPromotion.resolve();
    await Promise.allSettled([initialize, searching].filter(Boolean));
    await seededEngine.shutdown();
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('schema-8 warm snapshot restores empty directories symlinks and maximum depth', async () => {
  const workspace = createWorkspace();
  mkdirSync(join(workspace.rootPath, 'warm-folder-only'));
  writeFileSync(join(workspace.rootPath, 'target.txt'), 'plain target');
  symlinkSync('target.txt', join(workspace.rootPath, 'target-link'));
  let depthPath = workspace.rootPath;
  for (let index = 0; index < 32; index += 1) {
    depthPath = join(depthPath, `depth-${String(index).padStart(2, '0')}`);
    mkdirSync(depthPath);
  }
  const seededEngine = createOnlyPreviewSearchEngine();
  const engine = createOnlyPreviewSearchEngine();
  const candidateReady = deferred();
  const allowPromotion = deferred();
  let initialize;
  let searching;
  try {
    await seededEngine.initialize({
      workspaceId: 'seed-workspace',
      generation: 1,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await seededEngine.shutdown();
    const promote = engine.promoteCandidate.bind(engine);
    engine.promoteCandidate = async (...args) => {
      candidateReady.resolve();
      await allowPromotion.promise;
      return await promote(...args);
    };
    initialize = engine.initialize({
      workspaceId: 'workspace',
      generation: 36,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await candidateReady.promise;
    assert.equal(engine.treeMetadataReady, true);
    assert.equal(engine.maxDepthReached, true);
    assert.equal(
      engine.treeEntries.some(
        ({ relativePath, nodeKind }) =>
          relativePath === 'warm-folder-only' && nodeKind === 'directory'
      ),
      true
    );
    assert.equal(
      engine.treeEntries.some(
        ({ relativePath, nodeKind }) => relativePath === 'target-link' && nodeKind === 'symlink'
      ),
      true
    );
    const firstWarmResult = deferred();
    let settled = false;
    searching = engine
      .search({
        workspaceId: 'workspace',
        generation: 36,
        requestId: 'folder-warm-snapshot',
        query: 'warm-folder',
        maxResults: 500,
        scope: { kind: 'project' },
        isCancelled: () => false,
        onResult: firstWarmResult.resolve
      })
      .finally(() => {
        settled = true;
      });
    const warm = await firstWarmResult.promise;
    assert.equal(warm.nodeKind, 'directory');
    assert.equal(warm.relativePath, 'warm-folder-only');
    assert.equal(settled, false);
    allowPromotion.resolve();
    await initialize;
    const response = await searching;
    assert.deepEqual(response.files.map(({ relativePath }) => relativePath), ['warm-folder-only']);
  } finally {
    allowPromotion.resolve();
    await Promise.allSettled([initialize, searching].filter(Boolean));
    await seededEngine.shutdown();
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('an active index streams warm rows while refresh stays pending for terminal replacement', async () => {
  const workspace = createWorkspace();
  mkdirSync(join(workspace.rootPath, 'current'));
  mkdirSync(join(workspace.rootPath, 'network'));
  writeFileSync(join(workspace.rootPath, 'current', 'local.txt'), 'network local');
  const engine = createOnlyPreviewSearchEngine();
  const candidateReady = deferred();
  const releasePromotion = deferred();
  try {
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 31,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    const promote = engine.promoteCandidate.bind(engine);
    engine.promoteCandidate = async (...args) => {
      candidateReady.resolve();
      await releasePromotion.promise;
      return await promote(...args);
    };
    const refreshing = engine.refresh({ workspaceId: 'workspace', generation: 31 });
    await candidateReady.promise;
    const firstWarmResult = deferred();
    const warmResults = [];
    let settled = false;
    const searching = engine
      .search({
        workspaceId: 'workspace',
        generation: 31,
        requestId: 'search-during-refresh',
        query: 'network',
        maxResults: 500,
        scope: { kind: 'directory', relativePath: 'current' },
        isCancelled: () => false,
        onResult: (result) => {
          warmResults.push(result);
          firstWarmResult.resolve();
        }
      })
      .finally(() => {
        settled = true;
      });
    await firstWarmResult.promise;
    assert.equal(settled, false);
    assert.equal(warmResults.length > 0, true);
    releasePromotion.resolve();
    await refreshing;
    const response = await searching;
    assert.deepEqual(
      response.files.map(({ relativePath }) => relativePath),
      ['network']
    );
    assert.deepEqual(
      response.contents.map(({ relativePath }) => relativePath),
      ['current/local.txt']
    );
  } finally {
    releasePromotion.resolve();
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('a watch full reconcile keeps warm search pending until a fresh terminal replaces it', async () => {
  const workspace = createWorkspace();
  writeFileSync(join(workspace.rootPath, 'watch-old.txt'), 'watch body');
  const engine = createOnlyPreviewSearchEngine();
  const candidateReady = deferred();
  const allowPromotion = deferred();
  let applyingWatch;
  let searching;
  try {
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 46,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;
    renameSync(
      join(workspace.rootPath, 'watch-old.txt'),
      join(workspace.rootPath, 'watch-new.txt')
    );
    const promote = engine.promoteCandidate.bind(engine);
    engine.promoteCandidate = async (...args) => {
      candidateReady.resolve();
      await allowPromotion.promise;
      return await promote(...args);
    };
    applyingWatch = engine.enqueue(
      async () => await engine.applyWatchChangesInternal({ full: true, paths: [] })
    );
    await candidateReady.promise;
    assert.ok(engine.currentBuildPromise, 'watch reconcile must be visible to warm search');

    const firstWarmFiles = deferred();
    const firstWarmContents = deferred();
    const warmResults = [];
    let settled = false;
    searching = engine
      .search({
        workspaceId: 'workspace',
        generation: 46,
        requestId: 'watch-full-warm',
        query: 'watch',
        maxResults: 10,
        scope: { kind: 'project' },
        isCancelled: () => false,
        onResult: (result) => {
          warmResults.push(result);
          if (result.section === 'files') firstWarmFiles.resolve();
          if (result.section === 'contents') firstWarmContents.resolve();
        }
      })
      .finally(() => {
        settled = true;
      });
    await Promise.all([firstWarmFiles.promise, firstWarmContents.promise]);
    assert.equal(settled, false);
    assert.equal(warmResults.some(({ relativePath }) => relativePath === 'watch-old.txt'), true);
    const warmToken = warmResults.find(
      ({ section, relativePath }) =>
        section === 'files' && relativePath === 'watch-old.txt'
    ).resultToken;

    allowPromotion.resolve();
    await applyingWatch;
    const response = await searching;
    assert.deepEqual(response.files.map(({ relativePath }) => relativePath), ['watch-new.txt']);
    assert.deepEqual(response.contents.map(({ relativePath }) => relativePath), ['watch-new.txt']);
    await assert.rejects(() =>
      engine.preview({
        workspaceId: 'workspace',
        generation: 46,
        requestId: 'watch-full-warm',
        resultToken: warmToken,
        isCancelled: () => false
      })
    );
  } finally {
    allowPromotion.resolve();
    await Promise.allSettled([applyingWatch, searching].filter(Boolean));
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('candidate failure terminalizes an accepted warm search from the committed snapshot', async () => {
  const workspace = createWorkspace();
  writeFileSync(join(workspace.rootPath, 'stable-failure.txt'), 'stable failure body');
  const engine = createOnlyPreviewSearchEngine();
  const candidateStarted = deferred();
  const releaseFailure = deferred();
  let refreshing;
  let searching;
  try {
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 38,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    engine.runTraversal = async () => {
      candidateStarted.resolve();
      await releaseFailure.promise;
      throw new Error('forced warm candidate failure');
    };
    refreshing = engine.refresh({ workspaceId: 'workspace', generation: 38 });
    await candidateStarted.promise;
    const firstWarmFiles = deferred();
    const firstWarmContents = deferred();
    const warmResults = [];
    searching = engine.search({
      workspaceId: 'workspace',
      generation: 38,
      requestId: 'candidate-failure-warm',
      query: 'failure',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false,
      onResult: (result) => {
        warmResults.push(result);
        if (result.section === 'files') firstWarmFiles.resolve();
        if (result.section === 'contents') firstWarmContents.resolve();
      }
    });
    await Promise.all([firstWarmFiles.promise, firstWarmContents.promise]);
    releaseFailure.resolve();
    await assert.rejects(refreshing, /forced warm candidate failure/u);
    const terminal = await searching;
    assert.deepEqual(terminal.files.map(({ relativePath }) => relativePath), [
      'stable-failure.txt'
    ]);
    assert.deepEqual(terminal.contents.map(({ relativePath }) => relativePath), [
      'stable-failure.txt'
    ]);
    assert.equal(warmResults.length, 2);
  } finally {
    releaseFailure.resolve();
    await Promise.allSettled([refreshing, searching].filter(Boolean));
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('a queued search waits for active candidate promotion before acquiring a replacement reader', async () => {
  const workspace = createWorkspace();
  mkdirSync(join(workspace.rootPath, 'network'));
  writeFileSync(join(workspace.rootPath, 'network', 'guide.txt'), 'network body');
  const engine = createOnlyPreviewSearchEngine();
  const firstReaderEntered = deferred();
  const releaseFirstReader = deferred();
  let firstReaderCancelled = false;
  let firstSearch;
  let refreshing;
  let queuedSearch;
  try {
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 32,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    const previousIndex = engine.index;
    const searchPriority = engine.selectedFilePriority.searchGlobal.bind(
      engine.selectedFilePriority
    );
    let prioritySearchCount = 0;
    let queuedReaderUsedReplacement = false;
    engine.selectedFilePriority.searchGlobal = async (...args) => {
      prioritySearchCount += 1;
      if (prioritySearchCount === 1) {
        firstReaderEntered.resolve();
        await releaseFirstReader.promise;
      } else if (prioritySearchCount === 2) {
        queuedReaderUsedReplacement = engine.index !== previousIndex;
      }
      return await searchPriority(...args);
    };

    firstSearch = engine.search({
      workspaceId: 'workspace',
      generation: 32,
      requestId: 'promotion-reader-one',
      query: 'network',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => firstReaderCancelled
    });
    const firstSearchRejection = assert.rejects(
      firstSearch,
      (error) => error?.code === 'CANCELLED'
    );
    await firstReaderEntered.promise;
    assert.equal(engine.activeQueryCount, 1);

    refreshing = engine.refresh({ workspaceId: 'workspace', generation: 32 });
    for (let turn = 0; turn < 200 && !engine.promotionPromise; turn += 1) {
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
    }
    assert.ok(engine.promotionPromise, 'refresh must enter real candidate promotion');

    queuedSearch = engine.search({
      workspaceId: 'workspace',
      generation: 32,
      requestId: 'promotion-reader-two',
      query: 'network',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false
    });
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    assert.equal(prioritySearchCount, 1, 'queued reader must wait behind the announced writer');
    assert.equal(engine.activeQueryCount, 1);

    firstReaderCancelled = true;
    releaseFirstReader.resolve();
    await firstSearchRejection;
    await refreshing;
    const response = await queuedSearch;
    assert.equal(queuedReaderUsedReplacement, true);
    assert.notEqual(engine.index, previousIndex);
    assert.deepEqual(
      response.files.map(({ relativePath }) => relativePath),
      ['network']
    );
  } finally {
    firstReaderCancelled = true;
    releaseFirstReader.resolve();
    await Promise.allSettled([firstSearch, refreshing, queuedSearch].filter(Boolean));
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('snapshot reader leases are consistent idempotent and cancellable behind a writer gate', async () => {
  const workspace = createWorkspace();
  writeFileSync(join(workspace.rootPath, 'lease.txt'), 'lease body');
  const engine = createOnlyPreviewSearchEngine();
  try {
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 37,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    const activeIndex = engine.index;
    const activeEntries = engine.treeEntries;
    const reader = await engine.acquireSearchSnapshot();
    assert.equal(reader.index, activeIndex);
    assert.equal(reader.treeEntries, activeEntries);
    assert.equal(reader.searchPolicy, engine.activeSearchPolicy);
    assert.equal(reader.identity, engine.activeIdentity);
    assert.equal(engine.activeQueryCount, 1);

    const writerPending = engine.acquireSearchSnapshotWriter();
    assert.ok(engine.promotionPromise);
    const writerGate = engine.promotionPromise;
    const then = writerGate.then.bind(writerGate);
    let writerGateThenCount = 0;
    writerGate.then = (...args) => {
      writerGateThenCount += 1;
      return then(...args);
    };
    let cancelled = false;
    const blockedReader = engine.acquireSearchSnapshot({ isCancelled: () => cancelled });
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    cancelled = true;
    await assert.rejects(blockedReader, ({ code }) => code === 'CANCELLED');
    assert.equal(engine.activeQueryCount, 1);
    assert.equal(writerGateThenCount, 1, 'one blocked reader retains one writer-gate handler');

    reader.release();
    reader.release();
    assert.equal(engine.activeQueryCount, 0);
    const writer = await writerPending;
    writer.release();
    const replacementReader = await engine.acquireSearchSnapshot();
    assert.equal(replacementReader.index, activeIndex);
    assert.equal(replacementReader.treeEntries, activeEntries);
    replacementReader.release();
  } finally {
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('shutdown announces a writer gate and waits for an active snapshot reader before close', async () => {
  const workspace = createWorkspace();
  writeFileSync(join(workspace.rootPath, 'shutdown.txt'), 'shutdown body');
  const engine = createOnlyPreviewSearchEngine();
  let reader;
  let shuttingDown;
  try {
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 39,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    const activeIndex = engine.index;
    reader = await engine.acquireSearchSnapshot();
    let settled = false;
    shuttingDown = engine.shutdown().finally(() => {
      settled = true;
    });
    for (let turn = 0; turn < 50 && !engine.promotionPromise; turn += 1) {
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
    }
    assert.ok(engine.promotionPromise);
    assert.equal(settled, false);
    assert.equal(engine.index, activeIndex, 'leased SQLite must stay open until reader release');
    reader.release();
    reader = undefined;
    await shuttingDown;
    assert.equal(engine.index, undefined);
  } finally {
    reader?.release();
    await Promise.allSettled([shuttingDown, engine.shutdown()].filter(Boolean));
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('first-build priority rows publish early and terminal promotion replaces their tokens', async () => {
  const workspace = createWorkspace();
  writeFileSync(join(workspace.rootPath, 'opened.txt'), 'opened priority needle');
  const engine = createOnlyPreviewSearchEngine();
  const candidateReady = deferred();
  const releasePromotion = deferred();
  const promote = engine.promoteCandidate.bind(engine);
  engine.promoteCandidate = async (...args) => {
    candidateReady.resolve();
    await releasePromotion.promise;
    return await promote(...args);
  };
  try {
    const initialize = engine.initialize({
      workspaceId: 'workspace',
      generation: 4,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await candidateReady.promise;
    const priority = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 4,
      relativePath: 'opened.txt'
    });
    await engine.prioritizeFile(priority);
    const firstResult = deferred();
    const batches = [];
    const searching = engine.search({
      workspaceId: 'workspace',
      generation: 4,
      requestId: 'priority-request',
      query: 'priority needle',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false,
      onResult: (result) => {
        batches.push(result);
        firstResult.resolve();
      }
    });
    await firstResult.promise;
    const earlyToken = batches[0].resultToken;
    releasePromotion.resolve();
    await initialize;
    const response = await searching;
    assert.deepEqual(
      response.contents.map(({ relativePath }) => relativePath),
      ['opened.txt']
    );
    assert.notEqual(response.contents[0].resultToken, earlyToken);
    await assert.rejects(() =>
      engine.preview({
        workspaceId: 'workspace',
        generation: 4,
        requestId: 'priority-request',
        resultToken: earlyToken,
        isCancelled: () => false
      })
    );
  } finally {
    releasePromotion.resolve();
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('priority plus normal batches retain exact independent 250 Files and Contents ceilings', async () => {
  const workspace = createWorkspace();
  for (let index = 0; index < 250; index += 1) {
    writeFileSync(
      join(workspace.rootPath, `a-${String(index).padStart(3, '0')}-needle.txt`),
      'body needle'
    );
  }
  writeFileSync(join(workspace.rootPath, 'z-priority-needle.txt'), 'body needle');
  const engine = createOnlyPreviewSearchEngine();
  const candidateReady = deferred();
  const releasePromotion = deferred();
  const promote = engine.promoteCandidate.bind(engine);
  engine.promoteCandidate = async (...args) => {
    candidateReady.resolve();
    await releasePromotion.promise;
    return await promote(...args);
  };
  try {
    const initialize = engine.initialize({
      workspaceId: 'workspace',
      generation: 8,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await candidateReady.promise;
    const priority = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 8,
      relativePath: 'z-priority-needle.txt'
    });
    await engine.prioritizeFile(priority);
    const firstResult = deferred();
    const streamed = [];
    const searching = engine.search({
      workspaceId: 'workspace',
      generation: 8,
      requestId: 'full-priority-sections',
      query: 'needle',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false,
      onResult: (result) => {
        streamed.push(result);
        firstResult.resolve();
      }
    });
    await firstResult.promise;
    releasePromotion.resolve();
    await initialize;
    const response = await searching;
    assert.equal(streamed.filter(({ section }) => section === 'files').length, 250);
    assert.equal(streamed.filter(({ section }) => section === 'contents').length, 250);
    assert.equal(response.files.length, 250);
    assert.equal(response.contents.length, 250);
    assert.equal(
      response.files.some(({ relativePath }) => relativePath === 'z-priority-needle.txt'),
      false
    );
    assert.equal(
      response.contents.some(({ relativePath }) => relativePath === 'z-priority-needle.txt'),
      false
    );
    assert.deepEqual(
      [...engine.globalSearchSession.resultCountBySection.entries()],
      [
        ['files', 250],
        ['contents', 250]
      ]
    );
  } finally {
    releasePromotion.resolve();
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});
