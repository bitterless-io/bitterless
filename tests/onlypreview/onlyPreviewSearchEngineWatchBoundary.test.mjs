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
    const replacementResults = await search(engine, 'parent.txt');
    assert.equal(replacementResults.contents.length, 0);
    assert.deepEqual(
      replacementResults.files.map(({ relativePath, nodeKind }) => [relativePath, nodeKind]),
      [['parent.txt', 'directory']]
    );
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

test('rename watch hints retain path context for authoritative engine classification', async () => {
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
  assert.deepEqual(changes, [
    { full: false, paths: ['renamed.txt'], renamePaths: ['renamed.txt'] }
  ]);
  await controller.close();
});

test('rename hints update a stable file incrementally but reconcile an actual rename', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const originalPath = join(root, 'original.txt');
    const renamedPath = join(root, 'renamed.txt');
    const commits = [];
    await write(originalPath, 'original value');
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

    await write(originalPath, 'updated in place');
    await applyWatch(engine, {
      full: false,
      paths: ['original.txt'],
      renamePaths: ['original.txt']
    });
    assert.deepEqual(commits.at(-1), {
      workspaceId: 'workspace',
      generation: 1,
      revision: 1,
      full: false,
      changedRelativePaths: ['original.txt']
    });
    assert.equal((await search(engine, 'updated in place')).results.length, 1);

    await rename(originalPath, renamedPath);
    await applyWatch(engine, {
      full: false,
      paths: ['original.txt', 'renamed.txt'],
      renamePaths: ['original.txt', 'renamed.txt']
    });
    assert.equal(commits.at(-1).full, true);
    assert.equal((await search(engine, 'updated in place')).results[0].relativePath, 'renamed.txt');
    await engine.shutdown();
  });
});

test('an oversized watch burst reconciles Search projection and SQLite before individual paths', async () => {
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

