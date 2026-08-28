import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
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

const createFileSearchEntry = (relativePath, nodeKind) => ({
  relativePath,
  parentRelativePath: relativePath.includes('/')
    ? relativePath.slice(0, relativePath.lastIndexOf('/'))
    : '',
  name: relativePath.split('/').at(-1),
  nodeKind,
  size: nodeKind === 'file' ? 1 : 0,
  modifiedAt: 1,
  previewHint: nodeKind === 'file' ? 'text' : 'none',
  mediaType: nodeKind === 'file' ? 'text' : 'unknown'
});

const createDiagnosticsRecorder = () => {
  const events = [];
  let sequence = 0;
  return {
    events,
    diagnostics: {
      now: () => 0,
      elapsed: () => 0,
      nextTag: (prefix) => `${prefix}${++sequence}`,
      emit: (event, fields) => {
        events.push({ event, ...fields });
        return true;
      }
    }
  };
};

const createExecutorContext = ({ entries, index, diagnostics }) => ({
  treeEntries: entries,
  treeMetadataReady: true,
  browseIndex: { hasDirectory: () => false },
  index,
  diagnostics,
  activeQueryCount: 0,
  globalSearchSession: createOnlyPreviewGlobalSearchSession(),
  selectedFilePriority: {
    searchGlobal: async () => ({ cancelled: false, files: [], contents: [] })
  }
});

test('authoritative Files and Contents start cooperatively and terminal waits for both', async () => {
  let filesVisited = 0;
  let filesExited = false;
  const entries = {
    *[Symbol.iterator]() {
      try {
        for (let index = 0; index < 4; index += 1) {
          filesVisited += 1;
          yield createFileSearchEntry(`other-${index}.txt`, 'file');
        }
      } finally {
        filesExited = true;
      }
    }
  };
  const contentsStarted = deferred();
  const releaseContents = deferred();
  const context = createExecutorContext({
    entries,
    index: {
      searchContents: async () => {
        contentsStarted.resolve({ filesVisited, filesExited });
        await releaseContents.promise;
        return { results: [], truncated: false, cancelled: false };
      },
      metadata: () => undefined
    }
  });
  let terminalSettled = false;
  const searching = executeOnlyPreviewGlobalSearch(context, {
    workspaceId: 'workspace',
    generation: 1,
    requestId: 'concurrent-branches',
    query: 'needle',
    maxResults: 500,
    scope: { kind: 'project' },
    isCancelled: () => false
  }).finally(() => {
    terminalSettled = true;
  });

  const start = await contentsStarted.promise;
  assert.equal(start.filesVisited, 0);
  assert.equal(start.filesExited, false, 'Contents starts before the Files scan exits');
  while (!filesExited) await new Promise((resolveTurn) => setImmediate(resolveTurn));
  assert.equal(terminalSettled, false, 'terminal waits for the still-running Contents branch');

  releaseContents.resolve();
  const response = await searching;
  assert.deepEqual(response.files, []);
  assert.deepEqual(response.contents, []);
  assert.equal(context.activeQueryCount, 0);
});

test('a slow or retired priority lane never serializes or fails ordinary snapshot results', async () => {
  const releasePriority = deferred();
  const firstOrdinaryResult = deferred();
  const context = createExecutorContext({
    entries: [createFileSearchEntry('ordinary-needle.txt', 'file')],
    index: {
      searchContents: async () => ({ results: [], truncated: false, cancelled: false }),
      metadata: () => undefined
    }
  });
  context.selectedFilePriority.searchGlobal = async () => await releasePriority.promise;
  let settled = false;
  const searching = executeOnlyPreviewGlobalSearch(context, {
    workspaceId: 'workspace',
    generation: 1,
    requestId: 'slow-priority',
    query: 'needle',
    maxResults: 10,
    scope: { kind: 'project' },
    isCancelled: () => false,
    onResult: (result) => {
      if (result.relativePath === 'ordinary-needle.txt') firstOrdinaryResult.resolve();
    }
  }).finally(() => {
    settled = true;
  });

  await firstOrdinaryResult.promise;
  assert.equal(settled, false, 'ordinary Files must stream while priority is still pending');
  releasePriority.resolve({ cancelled: true, files: [], contents: [] });
  const response = await searching;
  assert.deepEqual(response.files.map(({ relativePath }) => relativePath), [
    'ordinary-needle.txt'
  ]);
  assert.deepEqual(response.contents, []);
});

test('cancellation interrupts the post-warm build wait without waiting for reconciliation', async () => {
  const activeBuild = deferred();
  const firstWarmResult = deferred();
  const context = createExecutorContext({
    entries: [createFileSearchEntry('warm-needle.txt', 'file')],
    index: {
      searchContents: async () => ({ results: [], truncated: false, cancelled: false }),
      metadata: () => undefined
    }
  });
  context.currentBuildPromise = activeBuild.promise;
  let cancelled = false;
  const searching = executeOnlyPreviewGlobalSearch(context, {
    workspaceId: 'workspace',
    generation: 1,
    requestId: 'cancel-build-wait',
    query: 'needle',
    maxResults: 10,
    scope: { kind: 'project' },
    isCancelled: () => cancelled,
    onResult: () => firstWarmResult.resolve()
  });
  try {
    await firstWarmResult.promise;
    cancelled = true;
    const outcome = await Promise.race([
      searching.then(
        () => ({ outcome: 'resolved' }),
        (error) => ({ outcome: 'rejected', error })
      ),
      new Promise((resolve) => setTimeout(() => resolve({ outcome: 'timed-out' }), 250))
    ]);
    assert.equal(outcome.outcome, 'rejected');
    assert.equal(outcome.error?.code, 'CANCELLED');
  } finally {
    activeBuild.resolve();
    await Promise.allSettled([searching]);
  }
});

test('an authoritative branch failure drains its sibling before releasing index ownership', async () => {
  const contentsFailure = new Error('contents branch failed');
  let context;
  let filesExited = false;
  let activeQueryCountAtFilesExit;
  const entries = {
    *[Symbol.iterator]() {
      try {
        for (let index = 0; index < 256; index += 1) {
          yield createFileSearchEntry(`other-${index}.txt`, 'file');
        }
      } finally {
        filesExited = true;
        activeQueryCountAtFilesExit = context.activeQueryCount;
      }
    }
  };
  const recorded = createDiagnosticsRecorder();
  context = createExecutorContext({
    entries,
    diagnostics: recorded.diagnostics,
    index: {
      searchContents: async () => {
        await new Promise((resolveTurn) => setImmediate(resolveTurn));
        throw contentsFailure;
      },
      metadata: () => undefined
    }
  });

  await assert.rejects(
    executeOnlyPreviewGlobalSearch(context, {
      workspaceId: 'workspace',
      generation: 1,
      requestId: 'failed-contents',
      query: 'needle',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false
    }),
    (error) => error === contentsFailure
  );
  assert.equal(filesExited, true);
  assert.equal(activeQueryCountAtFilesExit, 1, 'the failed request still owns the active index');
  assert.equal(context.activeQueryCount, 0);
  assert.deepEqual(
    recorded.events.filter(({ event }) => event === 'search-terminal').map(({ outcome }) => outcome),
    ['failure']
  );
});

test('cancelled engine search emits exactly one cancelled terminal', async () => {
  const recorded = createDiagnosticsRecorder();
  const context = createExecutorContext({
    entries: [],
    diagnostics: recorded.diagnostics,
    index: { searchContents: async () => ({ results: [], truncated: false, cancelled: false }) }
  });
  context.selectedFilePriority.searchGlobal = async () => ({
    cancelled: true,
    files: [],
    contents: []
  });
  await assert.rejects(
    executeOnlyPreviewGlobalSearch(context, {
      workspaceId: 'workspace',
      generation: 1,
      requestId: 'cancelled-search',
      query: 'needle',
      maxResults: 10,
      scope: { kind: 'project' },
      isCancelled: () => true
    }),
    ({ code }) => code === 'CANCELLED'
  );
  assert.deepEqual(
    recorded.events.filter(({ event }) => event === 'search-terminal').map(({ outcome }) => outcome),
    ['cancelled']
  );
});

test('Files stable-partitions mixed matches with directories before files', async () => {
  const outcome = await searchOnlyPreviewGlobalFiles({
    entries: [
      createFileSearchEntry('needle-file-a.txt', 'file'),
      createFileSearchEntry('needle-directory-a', 'directory'),
      createFileSearchEntry('needle-file-b.txt', 'file'),
      createFileSearchEntry('needle-directory-b', 'directory')
    ],
    query: 'needle',
    scope: { kind: 'project' },
    maxResults: 250
  });
  assert.deepEqual(
    outcome.authorities.map(({ relativePath }) => relativePath),
    ['needle-directory-a', 'needle-directory-b', 'needle-file-a.txt', 'needle-file-b.txt']
  );
  assert.equal(outcome.truncated, false);
});

test('Files directory-saturated cap keeps the first 250 directories and truthful truncation', async () => {
  const directories = Array.from({ length: 251 }, (_, index) =>
    createFileSearchEntry(`needle-directory-${String(index).padStart(3, '0')}`, 'directory')
  );
  const outcome = await searchOnlyPreviewGlobalFiles({
    entries: [createFileSearchEntry('needle-file.txt', 'file'), ...directories],
    query: 'needle',
    scope: { kind: 'project' },
    maxResults: 250
  });
  assert.equal(outcome.authorities.length, 250);
  assert.equal(
    outcome.authorities.every(({ nodeKind }) => nodeKind === 'directory'),
    true
  );
  assert.equal(outcome.authorities[0].relativePath, 'needle-directory-000');
  assert.equal(outcome.authorities.at(-1).relativePath, 'needle-directory-249');
  assert.equal(outcome.truncated, true);
});

test('Files fills the remaining cap with stable files and reports overflow', async () => {
  const directories = [
    createFileSearchEntry('needle-directory-a', 'directory'),
    createFileSearchEntry('needle-directory-b', 'directory')
  ];
  const files = Array.from({ length: 249 }, (_, index) =>
    createFileSearchEntry(`needle-file-${String(index).padStart(3, '0')}.txt`, 'file')
  );
  const outcome = await searchOnlyPreviewGlobalFiles({
    entries: [files[0], directories[0], ...files.slice(1), directories[1]],
    query: 'needle',
    scope: { kind: 'project' },
    maxResults: 250
  });
  assert.equal(outcome.authorities.length, 250);
  assert.deepEqual(
    outcome.authorities.slice(0, 2).map(({ relativePath }) => relativePath),
    ['needle-directory-a', 'needle-directory-b']
  );
  assert.equal(outcome.authorities[2].relativePath, 'needle-file-000.txt');
  assert.equal(outcome.authorities.at(-1).relativePath, 'needle-file-247.txt');
  assert.equal(outcome.truncated, true);
});

test('Global Search independently caps Files and Contents and includes directories', async () => {
  const workspace = createWorkspace();
  mkdirSync(join(workspace.rootPath, 'needle-directory'));
  mkdirSync(join(workspace.rootPath, 'content'));
  for (let index = 0; index < 260; index += 1) {
    writeFileSync(
      join(workspace.rootPath, `needle-file-${String(index).padStart(3, '0')}.txt`),
      'other'
    );
    writeFileSync(
      join(workspace.rootPath, 'content', `body-${String(index).padStart(3, '0')}.txt`),
      'before needle after'
    );
  }
  const engine = createOnlyPreviewSearchEngine();
  try {
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    const streamedTokens = new Map();
    const response = await engine.search({
      workspaceId: 'workspace',
      generation: 1,
      requestId: 'request-one',
      query: 'needle',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false,
      onResult: (result) =>
        streamedTokens.set(`${result.section}:${result.relativePath}`, result.resultToken)
    });
    assert.equal(response.files.length, 250);
    assert.equal(response.contents.length, 250);
    assert.equal(response.filesTruncated, true);
    assert.equal(response.contentsTruncated, true);
    assert.equal(
      response.files.some(({ nodeKind }) => nodeKind === 'directory'),
      true
    );
    assert.equal(
      response.contents.every(({ contentMatch }) => contentMatch.highlightLength > 0),
      true
    );
    assert.equal(new Set(response.files.map(({ resultToken }) => resultToken)).size, 250);
    assert.equal(new Set(response.contents.map(({ resultToken }) => resultToken)).size, 250);
    assert.equal(engine.globalSearchSession.resultsByToken.size, 500);
    for (const result of [...response.files, ...response.contents]) {
      assert.equal(
        result.resultToken,
        streamedTokens.get(`${result.section}:${result.relativePath}`),
        'terminal rows retain valid tokens already published by normal batches'
      );
    }
    assert.equal(JSON.stringify(response).includes(workspace.rootPath), false);
  } finally {
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('Files stays project-wide while Contents obeys the current directory scope', async () => {
  const workspace = createWorkspace();
  mkdirSync(join(workspace.rootPath, 'one'));
  mkdirSync(join(workspace.rootPath, 'areas'));
  mkdirSync(join(workspace.rootPath, 'areas', 'network'));
  writeFileSync(join(workspace.rootPath, 'one', 'current.txt'), 'network in current');
  writeFileSync(join(workspace.rootPath, 'areas', 'network', 'guide.txt'), 'network outside');
  const engine = createOnlyPreviewSearchEngine();
  try {
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 2,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    const scoped = await engine.search({
      workspaceId: 'workspace',
      generation: 2,
      requestId: 'scoped',
      query: 'network',
      maxResults: 500,
      scope: { kind: 'directory', relativePath: 'one' },
      isCancelled: () => false
    });
    assert.deepEqual(
      scoped.files.map(({ relativePath }) => relativePath),
      ['areas/network']
    );
    assert.deepEqual(
      scoped.contents.map(({ relativePath }) => relativePath),
      ['one/current.txt']
    );
    const project = await engine.search({
      workspaceId: 'workspace',
      generation: 2,
      requestId: 'project',
      query: 'network',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false
    });
    assert.deepEqual(
      project.files.map(({ relativePath }) => relativePath),
      ['areas/network']
    );
    assert.equal(project.contents.length, 2);
  } finally {
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('first build streams scoped Contents but waits for project Files metadata and splits priority scope', async () => {
  const workspace = createWorkspace();
  mkdirSync(join(workspace.rootPath, 'current'));
  mkdirSync(join(workspace.rootPath, 'areas'));
  mkdirSync(join(workspace.rootPath, 'areas', 'network'));
  writeFileSync(join(workspace.rootPath, 'current', 'local.txt'), 'network local');
  writeFileSync(join(workspace.rootPath, 'areas', 'network', 'network.js'), 'network outside');
  const diagnosticEvents = [];
  let diagnosticSequence = 0;
  const engine = createOnlyPreviewSearchEngine({
    diagnostics: {
      now: () => 0,
      elapsed: () => 0,
      nextTag: (prefix) => `${prefix}${++diagnosticSequence}`,
      emit: (event, fields) => {
        diagnosticEvents.push({ event, ...fields });
        return true;
      }
    }
  });
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
      generation: 3,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await candidateReady.promise;
    const priority = engine.supersedePriority({
      workspaceId: 'workspace',
      generation: 3,
      relativePath: 'areas/network/network.js'
    });
    await engine.prioritizeFile(priority);
    const firstResult = deferred();
    const streamed = [];
    let settled = false;
    const searching = engine
      .search({
        workspaceId: 'workspace',
        generation: 3,
        requestId: 'scoped-first-build',
        query: 'network',
        maxResults: 500,
        scope: { kind: 'directory', relativePath: 'current' },
        isCancelled: () => false,
        onResult: (result) => {
          streamed.push(result);
          firstResult.resolve();
        }
      })
      .finally(() => {
        settled = true;
      });
    await firstResult.promise;
    assert.equal(streamed[0].section, 'files');
    assert.equal(streamed[0].relativePath, 'areas/network/network.js');
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    assert.equal(settled, false, 'terminal Files must wait for complete project metadata');

    const earlyToken = streamed[0].resultToken;
    releasePromotion.resolve();
    await initialize;
    const response = await searching;
    assert.deepEqual(
      response.files.map(({ relativePath }) => relativePath),
      ['areas/network', 'areas/network/network.js']
    );
    assert.deepEqual(
      response.contents.map(({ relativePath }) => relativePath),
      ['current/local.txt']
    );
    assert.notEqual(
      response.files.find(({ relativePath }) => relativePath.endsWith('network.js')).resultToken,
      earlyToken
    );
    const gateIndex = diagnosticEvents.findIndex(
      ({ event, gate }) => event === 'search-gate' && gate === 'initial-tree'
    );
    const terminalIndex = diagnosticEvents.findIndex(
      ({ event, outcome }) => event === 'search-terminal' && outcome === 'success'
    );
    assert.ok(gateIndex >= 0 && terminalIndex > gateIndex);
    assert.equal(
      diagnosticEvents.filter(({ event }) => event === 'search-terminal').length,
      1
    );
  } finally {
    releasePromotion.resolve();
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('a search entering real first-build promotion sees the committed Files metadata', async () => {
  const workspace = createWorkspace();
  mkdirSync(join(workspace.rootPath, 'network'));
  writeFileSync(join(workspace.rootPath, 'network', 'guide.txt'), 'network body');
  const engine = createOnlyPreviewSearchEngine();
  const candidateReady = deferred();
  const allowPromotion = deferred();
  const firstReaderEntered = deferred();
  const releaseFirstReader = deferred();
  const promote = engine.promoteCandidate.bind(engine);
  engine.promoteCandidate = async (...args) => {
    candidateReady.resolve();
    await allowPromotion.promise;
    return await promote(...args);
  };
  const searchPriority = engine.selectedFilePriority.searchGlobal.bind(
    engine.selectedFilePriority
  );
  let prioritySearchCount = 0;
  let firstReaderCancelled = false;
  let initialize;
  let firstSearch;
  let terminalSearch;
  try {
    engine.selectedFilePriority.searchGlobal = async (...args) => {
      prioritySearchCount += 1;
      if (prioritySearchCount === 1) {
        firstReaderEntered.resolve();
        await releaseFirstReader.promise;
      }
      return await searchPriority(...args);
    };
    initialize = engine.initialize({
      workspaceId: 'workspace',
      generation: 33,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await candidateReady.promise;
    assert.equal(engine.treeMetadataReady, false);

    firstSearch = engine.search({
      workspaceId: 'workspace',
      generation: 33,
      requestId: 'first-build-reader-one',
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
    allowPromotion.resolve();
    for (let turn = 0; turn < 200 && !engine.promotionPromise; turn += 1) {
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
    }
    assert.ok(engine.promotionPromise, 'first build must enter real candidate promotion');

    terminalSearch = engine.search({
      workspaceId: 'workspace',
      generation: 33,
      requestId: 'first-build-reader-two',
      query: 'network',
      maxResults: 500,
      scope: { kind: 'project' },
      isCancelled: () => false
    });
    await new Promise((resolveTurn) => setImmediate(resolveTurn));
    assert.equal(prioritySearchCount, 1);

    firstReaderCancelled = true;
    releaseFirstReader.resolve();
    await firstSearchRejection;
    const response = await terminalSearch;
    assert.equal(engine.treeMetadataReady, true);
    assert.deepEqual(
      response.files.map(({ relativePath }) => relativePath),
      ['network']
    );
    await initialize;
  } finally {
    firstReaderCancelled = true;
    allowPromotion.resolve();
    releaseFirstReader.resolve();
    await Promise.allSettled([initialize, firstSearch, terminalSearch].filter(Boolean));
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});

test('reusable SQLite startup streams the committed Files and Contents snapshot before promotion', async () => {
  const workspace = createWorkspace();
  mkdirSync(join(workspace.rootPath, 'network'));
  writeFileSync(join(workspace.rootPath, 'network', 'guide.txt'), 'network body');
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
      generation: 34,
      rootPath: workspace.rootPath,
      databasePath: workspace.databasePath
    });
    await candidateReady.promise;
    assert.ok(engine.index, 'startup reconcile must expose the reusable SQLite seed');
    assert.equal(engine.treeMetadataReady, true);
    assert.equal(
      engine.treeEntries.some(({ relativePath }) => relativePath === 'network'),
      true
    );

    let settled = false;
    const firstWarmFiles = deferred();
    const firstWarmContents = deferred();
    const warmResults = [];
    searching = engine
      .search({
        workspaceId: 'workspace',
        generation: 34,
        requestId: 'reusable-startup',
        query: 'network',
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
    assert.equal(settled, false, 'the warm batch must not terminalize before freshness promotion');
    assert.equal(
      warmResults.some(
        ({ section, relativePath }) => section === 'files' && relativePath === 'network'
      ),
      true
    );
    assert.equal(
      warmResults.some(
        ({ section, relativePath }) =>
          section === 'contents' && relativePath === 'network/guide.txt'
      ),
      true
    );

    allowPromotion.resolve();
    await initialize;
    const response = await searching;
    assert.equal(engine.treeMetadataReady, true);
    assert.deepEqual(
      response.files.map(({ relativePath }) => relativePath),
      ['network']
    );
  } finally {
    allowPromotion.resolve();
    await Promise.allSettled([initialize, searching].filter(Boolean));
    await seededEngine.shutdown();
    await engine.shutdown();
    rmSync(workspace.base, { recursive: true, force: true });
  }
});
