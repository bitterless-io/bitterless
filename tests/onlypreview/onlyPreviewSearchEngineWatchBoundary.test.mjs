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
  TWO_GIB_BYTES,
  WATCH_TRAILING_MS
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
import { REBUILD_REQUIRED } from '../../src/preload/onlypreview/search/core/watch-reconciler.mjs';
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

const deferred = () => {
  let resolve;
  const promise = new Promise((resolveValue) => {
    resolve = resolveValue;
  });
  return { promise, resolve };
};

const previewToken = async (engine, requestId, resultToken) =>
  await engine.preview({
    workspaceId: 'workspace',
    generation: 1,
    requestId,
    resultToken,
    isCancelled: () => false
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

test('a watch commit revokes the search session it observed when the commit began', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(join(root, 'subject.txt'), 'subject body token');
    await write(join(root, 'unrelated.txt'), 'first');
    const engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: true });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    const response = await search(engine, 'subject', 'before-commit');
    const subject = response.files.find(({ relativePath }) => relativePath === 'subject.txt');
    assert.equal((await previewToken(engine, 'before-commit', subject.resultToken)).kind, 'text');

    await write(join(root, 'unrelated.txt'), 'second');
    await applyWatch(engine, { full: false, paths: ['unrelated.txt'] });

    await assert.rejects(() => previewToken(engine, 'before-commit', subject.resultToken));
    await engine.shutdown();
  });
});

test('a watch commit leaves a session that began inside the commit window alive', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(join(root, 'subject.txt'), 'subject body token');
    await write(join(root, 'unrelated.txt'), 'first');
    const engine = createOnlyPreviewSearchEngine();
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: true });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    // Hold the commit open before it takes the writer lease, so the query below runs entirely
    // inside the window the reconcile is already in - the ordering a reader lease makes reachable
    // in the product, because the writer waits for exactly the query it would otherwise revoke.
    const commitOpened = deferred();
    const releaseCommit = deferred();
    const acquireWriter = engine.acquireSearchSnapshotWriter.bind(engine);
    engine.acquireSearchSnapshotWriter = async (...args) => {
      commitOpened.resolve();
      await releaseCommit.promise;
      return await acquireWriter(...args);
    };

    await write(join(root, 'unrelated.txt'), 'second');
    const applying = applyWatch(engine, { full: false, paths: ['unrelated.txt'] });
    await commitOpened.promise;

    const response = await search(engine, 'subject', 'inside-commit');
    const subject = response.files.find(({ relativePath }) => relativePath === 'subject.txt');
    releaseCommit.resolve();
    await applying;

    assert.equal((await previewToken(engine, 'inside-commit', subject.resultToken)).kind, 'text');
    await engine.shutdown();
  });
});

// Ral 2026-09-16:「巨卡,导致别的程序都受到影响」。全量 reconcile 的代价随工作区大小走,而触发它的
// 两条路都是固定节奏(无 watcher 的 30s 兜底轮询、macOS FSEvents 队列溢出送来的 `filename === null`
// 升级只隔 400ms 尾抖动)。一棵 97,914 文件的树上一轮全量约 60s,于是上一轮刚落地下一轮就开跑 ——
// 26 小时跑了 238 轮,两个 renderer 长期占 30–120% CPU。退避按**上次实际耗时**算,小工作区行为不变。
test('a full reconcile cannot restart until the previous one has been idle for a multiple of its own cost', async () => {
  const emitter = new EventEmitter();
  emitter.close = () => undefined;
  let watchListener;
  const fullReconciles = [];
  const controller = createWorkspaceWatchController({
    rootPath: '/workspace',
    watchFactory: (_rootPath, _options, listener) => {
      watchListener = listener;
      return emitter;
    },
    onReconcile: async ({ full }) => {
      if (!full) return;
      fullReconciles.push(Date.now());
      await delay(600); // 这一轮全量的代价 → 冷却 600 × 4 = 2400ms
    }
  });
  assert.equal(controller.mode(), 'watch');

  // FSEvents 队列溢出:Node 送来没有文件名的事件,本控制器据此升级成全量。
  watchListener('change', null);
  await delay(WATCH_TRAILING_MS + 900);
  assert.equal(fullReconciles.length, 1);

  // 冷却窗口内再来一次溢出 —— 不许开跑,但待办要留着。
  watchListener('change', null);
  await delay(WATCH_TRAILING_MS + 600);
  assert.equal(fullReconciles.length, 1);

  // 冷却结束后它自己补跑,不需要新的事件来推。
  await delay(2_000);
  assert.equal(fullReconciles.length, 2);

  await controller.close();
});

/**
 * Ral 2026-09-22:索引在空转 —— 参考机 5 小时 13 分跑了 149 轮重建,每轮拷 2.75 GB、
 * 遍历 41,855 个条目,只为发现差 1 个文件。
 *
 * 根因不是缺少退避,而是退避拦不到它要拦的那类活:「要不要整库重建」是 watch-reconciler 才定的
 * (目录变更、超出深度上限的路径、超量批次都会升级),而控制器的闸只看自己派发时的 `full`。
 * 于是最贵的那条路整个绕开了冷却。现在升级会被交还,由控制器重排成全量,走上同一道闸。
 */
test('an incremental change that needs a rebuild is re-queued as a full reconcile, not run inline', async () => {
  const emitter = new EventEmitter();
  emitter.close = () => undefined;
  let watchListener;
  const dispatched = [];
  const controller = createWorkspaceWatchController({
    rootPath: '/workspace',
    watchFactory: (_rootPath, _options, listener) => {
      watchListener = listener;
      return emitter;
    },
    onReconcile: async (change, options) => {
      dispatched.push({ full: change.full, deferRebuild: options?.deferRebuild === true });
      // 一次自称增量的变更,reconciler 判定它需要整库重建。
      if (!change.full) return REBUILD_REQUIRED;
    }
  });

  watchListener('change', 'note.md');
  // 两个尾抖动窗口:第一个派出增量,交还之后控制器再排一次,第二个窗口才派出全量。
  await delay(WATCH_TRAILING_MS * 2 + 600);

  assert.deepEqual(dispatched, [
    // 增量派发带 deferRebuild —— 允许交还,不许就地重建。
    { full: false, deferRebuild: true },
    // 交还后重排成全量;全量这一次不带 deferRebuild,它就是要跑完的那次。
    { full: true, deferRebuild: false }
  ]);

  await controller.close();
});

// 退避只挡全量。增量 reconcile 的代价与改动数成正比,不是自激源头,挡它只会让索引无谓地陈旧。
test('the full-reconcile cooldown does not delay incremental reconciles', async () => {
  const emitter = new EventEmitter();
  emitter.close = () => undefined;
  let watchListener;
  const changes = [];
  const controller = createWorkspaceWatchController({
    rootPath: '/workspace',
    watchFactory: (_rootPath, _options, listener) => {
      watchListener = listener;
      return emitter;
    },
    onReconcile: async (change) => {
      changes.push(change);
      if (change.full) await delay(600);
    }
  });

  watchListener('change', null);
  await delay(WATCH_TRAILING_MS + 900);
  assert.deepEqual(changes.map((change) => change.full), [true]);

  watchListener('change', 'note.md');
  await delay(WATCH_TRAILING_MS + 300);
  assert.deepEqual(changes.map((change) => change.full), [true, false]);
  assert.deepEqual(changes[1].paths, ['note.md']);

  await controller.close();
});

/**
 * Ral 2026-09-22:存一个文件就让整机发顿。
 *
 * 触发条件是「父目录还不在索引树里」—— `readParentDirectoryTreeEntry` 原本只要树里没有父目录
 * 就判 `valid: false`,调用方据此升级成全量重建。于是新建功能目录、git checkout 带出新目录、
 * 解压、脚手架生成,每一次都要克隆整库再遍历整棵树(参考机 2.75 GB + 41,855 条目)。
 * 实测:往已在树里的目录加文件 1.6–2.8 ms,往新目录加一个文件是一次完整重建。
 *
 * 下面三条钉住:新目录走增量且内容真的可搜、嵌套新目录整条链补齐、而真正对不上的情形仍然升级。
 */
const rebuildHappened = (engine, run) => {
  const before = engine.buildRevision;
  return run().then(() => engine.buildRevision !== before);
};

test('a file created inside a brand-new directory reconciles incrementally and is searchable', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(join(root, 'seed.txt'), 'seed body token');
    const engine = createOnlyPreviewSearchEngine({});
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    await write(join(root, 'fresh/leaf.txt'), 'fresh directory body token');
    const rebuilt = await rebuildHappened(engine, () =>
      applyWatch(engine, { full: false, paths: ['fresh/leaf.txt'] })
    );

    assert.equal(rebuilt, false, '新目录里建文件不该触发整库重建');
    assert.ok(indexedPaths(engine).includes('fresh/leaf.txt'), '文件必须真的进了索引');
    assert.equal((await search(engine, 'fresh directory body token')).results.length, 1);
    // 新目录本身也要进树,否则面包屑与目录展开会少一层。
    assert.ok(engine.treeEntries.some(({ relativePath }) => relativePath === 'fresh'));
  });
});

test('a nested chain of brand-new directories is materialised whole, not rebuilt', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(join(root, 'seed.txt'), 'seed body token');
    const engine = createOnlyPreviewSearchEngine({});
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    await write(join(root, 'a/b/c/deep.txt'), 'deep nested body token');
    const rebuilt = await rebuildHappened(engine, () =>
      applyWatch(engine, { full: false, paths: ['a/b/c/deep.txt'] })
    );

    assert.equal(rebuilt, false);
    assert.ok(indexedPaths(engine).includes('a/b/c/deep.txt'));
    assert.equal((await search(engine, 'deep nested body token')).results.length, 1);
    // 缺一层都会让树断开,所以整条链都要在。
    const treePaths = new Set(engine.treeEntries.map(({ relativePath }) => relativePath));
    for (const directory of ['a', 'a/b', 'a/b/c']) {
      assert.ok(treePaths.has(directory), `祖先链缺了 ${directory}`);
    }
  });
});

/**
 * 安全没有放松:符号链接目录仍然升级成全量。
 *
 * 逐层校验里 `realpath(absolutePath) === absolutePath` 这一条等于宣告整条路径上没有符号链接,
 * 它一层都没少跑 —— 只是现在对缺失的每一层都跑一遍,而不是见到缺失就整棵重来。
 */
test('a symlinked directory on the new chain still escalates to a full reconcile', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(join(root, 'seed.txt'), 'seed body token');
    const outside = join(temp, 'outside');
    await mkdir(join(outside, 'real'), { recursive: true });
    await writeFile(join(outside, 'real', 'linked.txt'), 'linked body token');
    const engine = createOnlyPreviewSearchEngine({});
    await engine.initialize({
      workspaceId: 'workspace',
      generation: 1,
      rootPath: root,
      databasePath: join(temp, 'cache', 'search.sqlite')
    });
    await engine.watchController.close({ drain: false });
    engine.watchController = undefined;
    engine.watchRevision += 1;

    await symlink(join(outside, 'real'), join(root, 'linkdir'));
    const rebuilt = await rebuildHappened(engine, () =>
      applyWatch(engine, { full: false, paths: ['linkdir/linked.txt'] })
    );

    assert.equal(rebuilt, true, '符号链接目录必须仍然走全量,增量补链不得放行它');
  });
});
