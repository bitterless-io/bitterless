import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rename, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import {
  MAX_INDEX_DEPTH,
  MAX_WATCH_CHANGE_PATHS,
  ONE_GIB_BYTES,
  TWO_GIB_BYTES
} from '../../src/preload/onlypreview/search/core/constants.mjs';
import {
  assessOnlyPreviewSearchMemory,
  createOnlyPreviewSearchEngine
} from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import {
  createWorkspaceTraversal,
  readSingleWorkspaceFile
} from '../../src/preload/onlypreview/search/core/traversal.mjs';
import { createWorkspaceWatchController } from '../../src/preload/onlypreview/search/core/watch-controller.mjs';
import { pathIsWithin } from '../../src/preload/onlypreview/search/core/workspace-config.mjs';

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-search-boundary-'));
  try {
    return await callback(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
};

const write = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

const delay = async (milliseconds) =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds));

const deferred = () => {
  let resolve;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
};

const search = async (engine, query, requestId = query) => {
  const response = await engine.search({
    workspaceId: 'workspace',
    generation: 1,
    requestId,
    query,
    maxResults: 500,
    scope: { kind: 'project' },
    cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  });
  return { ...response, results: [...response.files, ...response.contents] };
};

const indexedPaths = (engine) =>
  engine.index.database
    .prepare('SELECT relative_path FROM files ORDER BY relative_path')
    .all()
    .map(({ relative_path: relativePath }) => relativePath);

const applyWatch = async (engine, change) =>
  await engine.enqueue(async () => await engine.applyWatchChangesInternal(change));

test('bounded watch promotes paths beyond the shared index depth to full reconcile', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const commits = [];
    await mkdir(root);
    const engine = createOnlyPreviewSearchEngine({ onWatchCommit: (commit) => commits.push(commit) });
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;
    const relativePath = `${Array.from({ length: MAX_INDEX_DEPTH }, (_, index) => `d${index}`).join('/')}/too-deep.txt`;
    await write(join(root, relativePath), 'too deep');
    await applyWatch(engine, { full: false, paths: [relativePath] });
    assert.equal(commits.at(-1).full, true);
    assert.equal(engine.index.filenameTier.get(relativePath), undefined);
    await engine.shutdown();
  });
});

const execFileAsync = promisify(execFile);

const treeIdentity = (entries) =>
  [...entries].sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'und'));

const freshTreeIdentity = async (engine, rootPath) => {
  const indexedMetadata = new Map(engine.treeEntries.map((entry) => [entry.relativePath, entry]));
  const traversal = await createWorkspaceTraversal({
    rootPath,
    config: engine.config,
    shouldReadContent: ({ relativePath }) => {
      const entry = indexedMetadata.get(relativePath);
      return {
        unchanged: true,
        mediaType: entry?.mediaType ?? 'unknown',
        contentIndexed: entry?.isText === true
      };
    }
  });
  for await (const entry of traversal.entries) {
    // Exhaust metadata traversal without reading unchanged file bodies.
    void entry;
  }
  return treeIdentity(traversal.treeEntries);
};

test('database and config containment honor both POSIX and Windows separators', () => {
  assert.equal(pathIsWithin('/workspace', '/workspace', posix), true);
  assert.equal(pathIsWithin('/workspace', '/workspace/cache/search.sqlite', posix), true);
  assert.equal(pathIsWithin('/workspace', '/user-data/search.sqlite', posix), false);
  assert.equal(
    pathIsWithin('/workspace', '/workspace/.bitterless/preview-config.yml', posix),
    true
  );
  assert.equal(pathIsWithin('/workspace', '/outside/preview-config.yml', posix), false);
  assert.equal(pathIsWithin('C:\\workspace', 'C:\\workspace', win32), true);
  assert.equal(pathIsWithin('C:\\workspace', 'C:\\workspace\\cache\\search.sqlite', win32), true);
  assert.equal(pathIsWithin('C:\\workspace', 'C:\\user-data\\search.sqlite', win32), false);
  assert.equal(pathIsWithin('C:\\workspace', 'C:\\workspace-other\\search.sqlite', win32), false);
  assert.equal(pathIsWithin('C:\\workspace', 'D:\\user-data\\search.sqlite', win32), false);
  assert.equal(
    pathIsWithin('C:\\workspace', 'C:\\workspace\\.bitterless\\preview-config.yml', win32),
    true
  );
  assert.equal(pathIsWithin('C:\\workspace', 'C:\\outside\\preview-config.yml', win32), false);
});

test('initialization rejects an in-workspace database and accepts sibling user data', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await mkdir(root);
    const engine = createOnlyPreviewSearchEngine();
    await assert.rejects(
      engine.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: root,
        databasePath: join(root, 'cache', 'search.sqlite')
      }),
      /outside the workspace/u
    );
    if (process.platform !== 'win32') {
      const insideTarget = join(root, 'inside-target.sqlite');
      const databaseLink = join(temp, 'database-link.sqlite');
      await write(insideTarget, 'must not be opened as SQLite');
      await symlink(insideTarget, databaseLink);
      await assert.rejects(
        engine.initialize({
          workspaceId: 'workspace',
          generation: 2,
          rootPath: root,
          databasePath: databaseLink
        }),
        /outside the workspace/u
      );
    }
    const snapshot = await engine.initialize({
      workspaceId: 'workspace',
      generation: 3,
      rootPath: root,
      databasePath: join(temp, 'user-data', 'search.sqlite')
    });
    assert.equal(snapshot.state, 'ready');
    await engine.shutdown();
  });
});

test('Utility browse listings stay complete while the Search projection applies exclusions', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(
      join(root, '.bitterless/preview-config.yml'),
      ['version: 1', 'exclude:', '  - excluded', ''].join('\n')
    );
    await write(join(root, 'visible.txt'), 'visible body token');
    await write(join(root, 'excluded/drop.txt'), 'excluded body token');
    await write(join(root, '.hidden/private.txt'), 'hidden body token');
    await write(join(root, 'node_modules/pkg/module.txt'), 'module body token');
    await write(join(root, 'dist/bundle.txt'), 'dist body token');
    await write(join(root, 'output/report.txt'), 'output body token');

    const browseListings = [];
    const engine = createOnlyPreviewSearchEngine({
      onBrowseListing: (listing) => browseListings.push(listing)
    });
    const snapshot = await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    assert.equal(browseListings.length, 1);
    assert.deepEqual(
      browseListings[0].entries.map(({ name }) => name),
      ['.bitterless', '.hidden', 'dist', 'excluded', 'node_modules', 'output', 'visible.txt']
    );
    assert.deepEqual(
      Object.fromEntries(
        browseListings[0].entries.map(({ relativePath, searchExcluded }) => [
          relativePath,
          searchExcluded
        ])
      ),
      {
        '.bitterless': true,
        '.hidden': true,
        dist: true,
        excluded: true,
        node_modules: true,
        output: true,
        'visible.txt': false
      }
    );
    const excludedDirectory = browseListings[0].entries.find(
      ({ relativePath }) => relativePath === 'excluded'
    );
    const excludedListing = await engine.browseDirectory({
      workspaceId: 'workspace',
      generation: 1,
      directoryToken: excludedDirectory.directoryToken
    });
    assert.equal(excludedListing.entries[0].relativePath, 'excluded/drop.txt');
    assert.equal(excludedListing.entries[0].searchExcluded, true);

    const searchProjectionPaths = new Set(
      snapshot.index.entries.map(({ relativePath }) => relativePath)
    );
    for (const relativePath of [
      '.bitterless',
      '.bitterless/preview-config.yml',
      '.hidden/private.txt',
      'excluded/drop.txt',
      'node_modules',
      'node_modules/pkg/module.txt',
      'dist/bundle.txt',
      'output/report.txt'
    ])
      assert.equal(searchProjectionPaths.has(relativePath), false, relativePath);
    assert.equal(searchProjectionPaths.has('visible.txt'), true);
    assert.deepEqual(indexedPaths(engine), ['visible.txt']);
    assert.equal((await search(engine, 'body token')).results.length, 1);
    assert.equal(snapshot.memory.treeMetadataEntryCount, snapshot.index.entries.length);
    assert.ok(snapshot.memory.treeMetadataEstimatedBytes > 0);
    await engine.shutdown();
  });
});

test('watch uses 400ms trailing updates and falls back when recursive watch is unavailable', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await mkdir(root);
    const commits = [];
    const engine = createOnlyPreviewSearchEngine({
      onWatchCommit: (commit) => commits.push(commit)
    });
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await write(join(root, 'watched.txt'), 'watch needle');
    const readyDeadline = Date.now() + 1_500;
    while (commits.length === 0 && Date.now() < readyDeadline) await delay(25);
    assert.equal(commits.length > 0, true);
    assert.equal((await search(engine, 'watch needle', 'late')).results.length, 1);
    await engine.shutdown();

    let fallbackReconciles = 0;
    const controller = createWorkspaceWatchController({
      rootPath: root,
      watchFactory: () => {
        throw new Error('recursive watch unsupported');
      },
      fallbackIntervalMs: 10,
      onReconcile: async ({ full }) => {
        if (full) fallbackReconciles += 1;
      }
    });
    assert.equal(controller.mode(), 'fallback-reconcile');
    await delay(35);
    assert.equal(fallbackReconciles > 0, true);
    await controller.close();

    const emitter = new EventEmitter();
    emitter.close = () => undefined;
    let directListener;
    const directReconciles = [];
    const direct = createWorkspaceWatchController({
      rootPath: root,
      watchFactory: (_rootPath, _options, listener) => {
        directListener = listener;
        return emitter;
      },
      onReconcile: async (change) => directReconciles.push(change)
    });
    assert.equal(direct.mode(), 'watch');
    directListener('change', 'first.txt');
    await delay(250);
    directListener('change', 'tail.txt');
    await delay(250);
    assert.equal(directReconciles.length, 0);
    await delay(250);
    assert.deepEqual(directReconciles, [
      {
        full: false,
        paths: ['first.txt', 'tail.txt']
      }
    ]);
    await direct.close();
  });
});

test('watch reattaches with capped backoff and does not latch fallback builds while one is slow', async () => {
  const emitter = new EventEmitter();
  emitter.close = () => undefined;
  const slowReconcile = deferred();
  const reconciles = [];
  let attachAttempts = 0;
  let watchListener;
  const controller = createWorkspaceWatchController({
    rootPath: '/virtual/workspace',
    fallbackIntervalMs: 5,
    retryBaseMs: 10,
    retryMaxMs: 20,
    watchFactory: (_rootPath, _options, listener) => {
      attachAttempts += 1;
      if (attachAttempts < 3) throw new Error('recursive watch temporarily unavailable');
      watchListener = listener;
      return emitter;
    },
    onReconcile: async (change) => {
      reconciles.push(change);
      if (reconciles.length === 1) await slowReconcile.promise;
    }
  });

  assert.equal(controller.mode(), 'fallback-reconcile');
  const reattachDeadline = Date.now() + 500;
  while (controller.mode() !== 'watch' && Date.now() < reattachDeadline) await delay(5);
  assert.equal(controller.mode(), 'watch');
  assert.equal(attachAttempts, 3);
  assert.equal(reconciles.length, 1);
  assert.equal(reconciles[0].full, true);
  await delay(50);
  assert.equal(reconciles.length, 1, 'fallback ticks must not queue behind a slow full build');

  slowReconcile.resolve();
  await controller.flushNow();
  await controller.flushNow();
  assert.equal(reconciles.length, 2);
  assert.equal(reconciles[1].full, true, 'reattach must reconcile the post-fallback watch gap');
  await delay(30);
  assert.equal(reconciles.length, 2, 'successful reattach must not queue a third full build');
  watchListener('change', 'visible.txt');
  await controller.flushNow();
  assert.deepEqual(reconciles.at(-1), { full: false, paths: ['visible.txt'] });
  await controller.close();
});

test('watch failure during an active full build schedules exactly one post-reattach recovery', async () => {
  const firstWatcher = new EventEmitter();
  firstWatcher.close = () => undefined;
  const replacementWatcher = new EventEmitter();
  replacementWatcher.close = () => undefined;
  const releaseInitialFull = deferred();
  const reconciles = [];
  let attachAttempts = 0;
  const controller = createWorkspaceWatchController({
    rootPath: '/virtual/workspace',
    fallbackIntervalMs: 10,
    retryBaseMs: 5,
    retryMaxMs: 5,
    watchFactory: () => {
      attachAttempts += 1;
      return attachAttempts === 1 ? firstWatcher : replacementWatcher;
    },
    onReconcile: async (change) => {
      reconciles.push(change);
      if (reconciles.length === 1) await releaseInitialFull.promise;
    }
  });

  controller.requestFullReconcile();
  const initialFlush = controller.flushNow();
  const startedDeadline = Date.now() + 200;
  while (reconciles.length === 0 && Date.now() < startedDeadline) await delay(2);
  assert.equal(reconciles.length, 1);
  firstWatcher.emit('error', new Error('watch failed during traversal'));
  const reattachDeadline = Date.now() + 200;
  while (controller.mode() !== 'watch' && Date.now() < reattachDeadline) await delay(2);
  assert.equal(controller.mode(), 'watch');

  releaseInitialFull.resolve();
  await initialFlush;
  await controller.flushNow();
  assert.deepEqual(
    reconciles.map(({ full }) => full),
    [true, true]
  );
  await delay(30);
  assert.equal(reconciles.length, 2);
  await controller.close();
});

test('watch CRUD, rename, and config transitions converge Search projection and SQLite', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const configPath = join(root, '.bitterless/preview-config.yml');
    await write(configPath, 'version: 1\nexclude:\n  - excluded/**\n');
    await write(join(root, 'visible.txt'), 'visible old');
    await write(join(root, 'excluded/drop.txt'), 'excluded old');
    await write(join(root, '.hidden/private.txt'), 'hidden old');
    await write(join(root, 'node_modules/pkg/module.txt'), 'module old');
    await write(join(root, 'rename-old.txt'), 'rename body');
    const watchReads = [];
    const commits = [];
    const engine = createOnlyPreviewSearchEngine({
      readWorkspaceFile: async (params) => {
        watchReads.push(params.relativePath);
        return await readSingleWorkspaceFile(params);
      },
      onWatchCommit: (commit) => commits.push(commit)
    });
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    await write(join(root, 'visible.txt'), 'shared watch token visible');
    await write(join(root, 'excluded/drop.txt'), 'shared watch token excluded');
    await write(join(root, '.hidden/private.txt'), 'shared watch token hidden');
    await write(join(root, 'node_modules/pkg/module.txt'), 'shared watch token module');
    const excludedBurst = Array.from(
      { length: MAX_WATCH_CHANGE_PATHS + 40 },
      (_, index) => `node_modules/pkg/cache-${index}.js`
    );
    await applyWatch(engine, {
      full: false,
      paths: [
        'excluded',
        'visible.txt',
        'excluded/drop.txt',
        '.hidden/private.txt',
        'node_modules/pkg/module.txt',
        'dist/bundle.txt',
        'build/cache/output.js',
        'output/report.txt',
        ...excludedBurst
      ]
    });
    assert.equal(commits.every(({ full }) => full === false), true);
    assert.equal(
      commits.some(({ changedRelativePaths }) => changedRelativePaths.includes('visible.txt')),
      true
    );
    assert.deepEqual(watchReads, ['visible.txt']);
    assert.equal(
      engine.treeEntries.some(({ relativePath }) => relativePath === 'excluded'),
      false
    );
    assert.equal(
      engine.index.database
        .prepare("SELECT count(*) AS count FROM search_tree WHERE relative_path = 'excluded'")
        .get().count,
      0
    );
    assert.deepEqual(
      (await search(engine, 'shared watch token')).results.map(({ relativePath }) => relativePath),
      ['visible.txt']
    );

    await write(join(root, 'created.txt'), 'created watch token');
    await applyWatch(engine, { full: false, paths: ['created.txt'] });
    assert.equal((await search(engine, 'created watch token')).results.length, 1);
    await unlink(join(root, 'created.txt'));
    await applyWatch(engine, { full: false, paths: ['created.txt'] });
    assert.equal((await search(engine, 'created watch token')).results.length, 0);
    assert.equal(
      engine.treeEntries.some(({ relativePath }) => relativePath === 'created.txt'),
      false
    );

    await rename(join(root, 'rename-old.txt'), join(root, 'rename-new.txt'));
    await applyWatch(engine, { full: true, paths: [] });
    assert.equal((await search(engine, 'rename-old')).results.length, 0);
    assert.equal((await search(engine, 'rename-new')).results.length, 1);

    await write(configPath, 'version: 1\nexclude: []\n');
    await applyWatch(engine, {
      full: false,
      paths: ['.bitterless/preview-config.yml']
    });
    assert.ok(indexedPaths(engine).includes('excluded/drop.txt'));
    assert.equal(indexedPaths(engine).includes('.hidden/private.txt'), false);
    assert.equal(indexedPaths(engine).includes('node_modules/pkg/module.txt'), false);
    await write(configPath, 'version: 1\nexclude:\n  - excluded/**\n');
    await applyWatch(engine, {
      full: false,
      paths: ['.bitterless/preview-config.yml']
    });
    assert.equal(indexedPaths(engine).includes('excluded/drop.txt'), false);
    assert.equal(
      engine.treeEntries.some(({ relativePath }) => relativePath === 'excluded/drop.txt'),
      false
    );
    await engine.shutdown();
  });
});

test('watch refreshes a loaded excluded browse directory without admitting it to Search', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(join(root, '.hidden/old.txt'), 'browse only');
    const browseListings = [];
    const commits = [];
    const engine = createOnlyPreviewSearchEngine({
      onBrowseListing: (listing) => browseListings.push(listing),
      onWatchCommit: (commit) => commits.push(commit)
    });
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    const rootListing = browseListings.at(-1);
    const hiddenDirectory = rootListing.entries.find(
      ({ relativePath }) => relativePath === '.hidden'
    );
    const initialHiddenListing = await engine.browseDirectory({
      workspaceId: 'workspace',
      generation: 1,
      directoryToken: hiddenDirectory.directoryToken
    });
    assert.deepEqual(
      initialHiddenListing.entries.map(({ name }) => name),
      ['old.txt']
    );
    assert.equal(initialHiddenListing.entries[0].searchExcluded, true);
    browseListings.length = 0;

    await write(join(root, '.hidden/new.txt'), 'new browse-only value');
    await applyWatch(engine, { full: false, paths: ['.hidden/new.txt'] });
    assert.equal(commits.at(-1).full, false);
    assert.equal(browseListings.length, 1);
    assert.equal(browseListings[0].relativePath, '.hidden');
    assert.equal(browseListings[0].directoryToken, hiddenDirectory.directoryToken);
    assert.deepEqual(
      browseListings[0].entries.map(({ name }) => name),
      ['new.txt', 'old.txt']
    );
    assert.equal(
      browseListings[0].entries.every(({ searchExcluded }) => searchExcluded),
      true
    );
    assert.equal(
      engine.treeEntries.some(({ relativePath }) => relativePath.startsWith('.hidden')),
      false
    );
    assert.deepEqual(indexedPaths(engine), []);
    assert.deepEqual((await search(engine, 'browse-only value')).results, []);

    browseListings.length = 0;
    const updatedContent = 'updated browse-only value with a new size';
    await write(join(root, '.hidden/new.txt'), updatedContent);
    await applyWatch(engine, { full: false, paths: ['.hidden/new.txt'] });
    assert.equal(commits.at(-1).full, false);
    assert.equal(browseListings.length, 1);
    assert.equal(
      browseListings[0].entries.find(({ name }) => name === 'new.txt').size,
      Buffer.byteLength(updatedContent)
    );
    assert.equal(
      browseListings[0].entries.find(({ name }) => name === 'new.txt').searchExcluded,
      true
    );

    browseListings.length = 0;
    await unlink(join(root, '.hidden/old.txt'));
    await applyWatch(engine, { full: false, paths: ['.hidden/old.txt'] });
    assert.equal(commits.at(-1).full, false);
    assert.equal(browseListings.length, 1);
    assert.deepEqual(
      browseListings[0].entries.map(({ name }) => name),
      ['new.txt']
    );

    browseListings.length = 0;
    await mkdir(join(root, '.hidden/new-folder'));
    await applyWatch(engine, { full: false, paths: ['.hidden/new-folder'] });
    assert.equal(commits.at(-1).full, false);
    assert.equal(browseListings.length, 1);
    assert.equal(browseListings[0].relativePath, '.hidden');
    assert.deepEqual(
      browseListings[0].entries.map(({ name }) => name),
      ['new-folder', 'new.txt']
    );

    browseListings.length = 0;
    await rm(join(root, '.hidden/new-folder'), { recursive: true, force: true });
    await applyWatch(engine, { full: false, paths: ['.hidden/new-folder'] });
    assert.equal(commits.at(-1).full, false);
    assert.equal(browseListings.length, 1);
    assert.equal(browseListings[0].relativePath, '.hidden');
    assert.deepEqual(
      browseListings[0].entries.map(({ name }) => name),
      ['new.txt']
    );
    await engine.shutdown();
  });
});

test('failed config refresh restores the active browse policy and replaces candidate markers', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const configPath = join(root, '.bitterless/preview-config.yml');
    await write(configPath, 'version: 1\nexclude: []\n');
    await write(join(root, 'configured/keep.txt'), 'active policy content');
    const browseListings = [];
    const engine = createOnlyPreviewSearchEngine({
      onBrowseListing: (listing) => browseListings.push(listing)
    });
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    browseListings.length = 0;
    engine.buildAndPromoteCandidate = async () => {
      throw new Error('forced candidate failure');
    };
    await write(configPath, 'version: 1\nexclude:\n  - configured/**\n');
    await assert.rejects(
      engine.refresh({ workspaceId: 'workspace', generation: 1 }),
      /forced candidate failure/u
    );

    assert.equal(browseListings.length, 2);
    const candidateRoot = browseListings[0];
    const restoredRoot = browseListings[1];
    assert.notEqual(candidateRoot.directoryToken, restoredRoot.directoryToken);
    assert.equal(
      candidateRoot.entries.find(({ relativePath }) => relativePath === 'configured')
        .searchExcluded,
      true
    );
    const restoredDirectory = restoredRoot.entries.find(
      ({ relativePath }) => relativePath === 'configured'
    );
    assert.equal(restoredDirectory.searchExcluded, false);
    const restoredListing = await engine.browseDirectory({
      workspaceId: 'workspace',
      generation: 1,
      directoryToken: restoredDirectory.directoryToken
    });
    assert.equal(restoredListing.entries[0].searchExcluded, false);
    assert.equal(engine.searchPolicy.isExcludedFilePath('configured/keep.txt'), false);
    await engine.shutdown();
  });
});

test('nested file create and delete keep parent metadata identical to fresh traversal', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const parentPath = join(root, 'nested', 'parent');
    const relativePath = 'nested/parent/changing.txt';
    const absolutePath = join(root, relativePath);
    const commits = [];
    await write(join(parentPath, 'stable.txt'), 'stable');
    const engine = createOnlyPreviewSearchEngine({
      onWatchCommit: (commit) => commits.push(commit)
    });
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    await write(absolutePath, 'nested create token');
    await utimes(
      parentPath,
      new Date('2030-01-01T00:00:00.000Z'),
      new Date('2030-01-01T00:00:00.000Z')
    );
    await applyWatch(engine, { full: false, paths: [relativePath] });
    assert.equal(commits.at(-1).full, false);
    assert.deepEqual(treeIdentity(engine.treeEntries), await freshTreeIdentity(engine, root));
    assert.equal((await search(engine, 'nested create token')).results.length, 1);

    await unlink(absolutePath);
    await utimes(
      parentPath,
      new Date('2031-01-01T00:00:00.000Z'),
      new Date('2031-01-01T00:00:00.000Z')
    );
    await applyWatch(engine, { full: false, paths: [relativePath] });
    assert.equal(commits.at(-1).full, false);
    assert.deepEqual(treeIdentity(engine.treeEntries), await freshTreeIdentity(engine, root));
    assert.equal((await search(engine, 'nested create token')).results.length, 0);
    await engine.shutdown();
  });
});
