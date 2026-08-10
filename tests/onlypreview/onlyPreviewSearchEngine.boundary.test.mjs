import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rename, rm, symlink, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import {
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

const search = async (engine, query, requestId = query) =>
  await engine.search({
    workspaceId: 'workspace',
    generation: 1,
    requestId,
    query,
    maxResults: 500,
    scope: { kind: 'project' },
    cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  });

const indexedPaths = (engine) =>
  engine.index.database
    .prepare('SELECT relative_path FROM files ORDER BY relative_path')
    .all()
    .map(({ relative_path: relativePath }) => relativePath);

const applyWatch = async (engine, change) =>
  await engine.enqueue(async () => await engine.applyWatchChangesInternal(change));

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

test('tree metadata and Project Search maintain independent exclusion boundaries', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(
      join(root, '.bitterless/preview-config.yml'),
      ['version: 1', 'exclude:', '  - excluded/**', ''].join('\n')
    );
    await write(join(root, 'visible.txt'), 'visible body token');
    await write(join(root, 'excluded/drop.txt'), 'excluded body token');
    await write(join(root, '.hidden/private.txt'), 'hidden body token');
    await write(join(root, 'node_modules/pkg/module.txt'), 'module body token');
    await write(join(root, 'dist/bundle.txt'), 'dist body token');
    await write(join(root, 'output/report.txt'), 'output body token');

    const engine = createOnlyPreviewSearchEngine();
    const snapshot = await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    const treePaths = new Set(snapshot.index.entries.map(({ relativePath }) => relativePath));
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
      assert.ok(treePaths.has(relativePath), relativePath);
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

test('watch CRUD, rename, and config transitions converge tree and search tiers', async () => {
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
    const engine = createOnlyPreviewSearchEngine({
      readWorkspaceFile: async (params) => {
        watchReads.push(params.relativePath);
        return await readSingleWorkspaceFile(params);
      }
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
    await applyWatch(engine, {
      full: false,
      paths: [
        'visible.txt',
        'excluded/drop.txt',
        '.hidden/private.txt',
        'node_modules/pkg/module.txt'
      ]
    });
    assert.deepEqual(watchReads, ['visible.txt']);
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
    assert.ok(engine.treeEntries.some(({ relativePath }) => relativePath === 'excluded/drop.txt'));
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

test('a child-only hint fully reconciles when its parent changed from file to directory', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const parentPath = join(root, 'parent.txt');
    const relativeChildPath = 'parent.txt/child.txt';
    const commits = [];
    await write(parentPath, 'stale parent body token');
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
    assert.equal((await search(engine, 'stale parent body token')).results.length, 1);

    await unlink(parentPath);
    await write(join(root, relativeChildPath), 'replacement child body');
    await applyWatch(engine, { full: false, paths: [relativeChildPath] });

    assert.equal(commits.at(-1).full, true);
    assert.equal(indexedPaths(engine).includes('parent.txt'), false);
    assert.equal(indexedPaths(engine).includes(relativeChildPath), true);
    assert.equal((await search(engine, 'stale parent body token')).results.length, 0);
    assert.equal((await search(engine, 'parent.txt')).results.length, 0);
    assert.equal(
      engine.treeEntries.some(
        (entry) => entry.relativePath === 'parent.txt' && entry.nodeKind === 'directory'
      ),
      true
    );
    await engine.shutdown();
  });
});

test(
  'watch fully reconciles when an indexed regular file becomes a FIFO',
  { skip: process.platform === 'win32' },
  async () => {
    await withTempDirectory(async (temp) => {
      const root = join(temp, 'workspace');
      const relativePath = 'changing-kind.txt';
      const absolutePath = join(root, relativePath);
      const commits = [];
      await write(absolutePath, 'stale special-file token');
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
      assert.equal((await search(engine, 'stale special-file token')).results.length, 1);

      await unlink(absolutePath);
      await execFileAsync('mkfifo', [absolutePath]);
      await applyWatch(engine, { full: false, paths: [relativePath] });

      assert.equal(indexedPaths(engine).includes(relativePath), false);
      assert.equal(
        engine.treeEntries.some(({ relativePath: treePath }) => treePath === relativePath),
        false
      );
      assert.equal((await search(engine, 'stale special-file token')).results.length, 0);
      assert.equal(commits.at(-1).full, true);
      await engine.shutdown();
    });
  }
);

test('a rename watch hint always promotes incremental paths to a full reconcile', async () => {
  const emitter = new EventEmitter();
  emitter.close = () => undefined;
  let listener;
  const changes = [];
  const controller = createWorkspaceWatchController({
    rootPath: '/virtual/workspace',
    watchFactory: (_rootPath, _options, callback) => {
      listener = callback;
      return emitter;
    },
    onReconcile: async (change) => changes.push(change)
  });
  listener('rename', 'renamed.txt');
  await controller.flushNow();
  assert.deepEqual(changes, [{ full: true, paths: [] }]);
  await controller.close();
});

test('an oversized watch burst reconciles both tiers before processing individual paths', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(join(root, 'burst.txt'), 'old burst value');
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
    await write(join(root, 'burst.txt'), 'new burst searchable value');
    await applyWatch(engine, {
      full: false,
      paths: Array.from({ length: MAX_WATCH_CHANGE_PATHS + 1 }, (_, index) => `hint-${index}.txt`)
    });
    assert.deepEqual(watchReads, []);
    assert.equal((await search(engine, 'new burst searchable value')).results.length, 1);
    assert.deepEqual(commits.at(-1), {
      workspaceId: 'workspace',
      generation: 1,
      revision: 1,
      full: true,
      changedRelativePaths: []
    });
    await engine.shutdown();
  });
});

test('watch metadata rejects a path whose parent symlink escapes the workspace', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const outside = join(temp, 'outside');
    await write(join(root, 'visible.txt'), 'visible');
    await write(join(outside, 'secret.txt'), 'external metadata must stay absent');
    const watchReads = [];
    const engine = createOnlyPreviewSearchEngine({
      readWorkspaceFile: async (params) => {
        watchReads.push(params.relativePath);
        return await readSingleWorkspaceFile(params);
      }
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
    await symlink(outside, join(root, 'linked'));
    await applyWatch(engine, { full: false, paths: ['linked/secret.txt'] });
    assert.deepEqual(watchReads, []);
    assert.equal(indexedPaths(engine).includes('linked/secret.txt'), false);
    assert.equal(
      engine.treeEntries.some(({ relativePath }) => relativePath === 'linked/secret.txt'),
      false
    );
    assert.ok(
      engine.treeEntries.some(
        ({ relativePath, nodeKind }) => relativePath === 'linked' && nodeKind === 'symlink'
      )
    );
    await engine.shutdown();
  });
});

test('tree and disk estimates never participate in runtime memory thresholds', () => {
  const base = {
    measurementComplete: true,
    processRssBytes: ONE_GIB_BYTES,
    workerHeapUsedBytes: 1,
    workerExternalBytes: 1,
    filenameTierEstimatedBytes: 1,
    treeMetadataEntryCount: 1,
    treeMetadataEstimatedBytes: TWO_GIB_BYTES + 100,
    diskIndexBytes: TWO_GIB_BYTES + 100
  };
  assert.deepEqual(assessOnlyPreviewSearchMemory(base), {
    ...base,
    runtimeOneGiBWarning: false,
    runtimeTwoGiBLimitExceeded: false
  });
  assert.equal(
    assessOnlyPreviewSearchMemory({
      ...base,
      workerHeapUsedBytes: ONE_GIB_BYTES + 1
    }).runtimeOneGiBWarning,
    true
  );
  assert.equal(
    assessOnlyPreviewSearchMemory({
      ...base,
      processRssBytes: TWO_GIB_BYTES
    }).runtimeTwoGiBLimitExceeded,
    false
  );
  assert.equal(
    assessOnlyPreviewSearchMemory({
      ...base,
      processRssBytes: TWO_GIB_BYTES + 1
    }).runtimeTwoGiBLimitExceeded,
    true
  );
});
