/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';
import { OnlyPreviewSqliteIndex } from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setImmediate(done));
const bounded = async (promise, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 2_000);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const paths = (results) => results.map(({ relativePath }) => relativePath);
const cancelled = (error) => error?.code === 'CANCELLED';
// `current/network/` exists so a directory scope still has a folder AND a file to match by name.
// Before Files was scope-fenced the only name matches were under `areas/`, i.e. outside the scope
// this test uses - which is exactly what may no longer stream.
const sampleFiles = {
  'current/local.txt': 'network inside the selected directory',
  'current/network/network.md': '# network inside the selected directory',
  'areas/network/network.md': '# network outside the selected directory',
  'outside-body.txt': 'network in another root file'
};

const withEngine = async (files, run) => {
  const temp = await mkdtemp(join(tmpdir(), 'onlypreview-cold-metadata-'));
  const rootPath = join(temp, 'workspace');
  const engine = createOnlyPreviewSearchEngine({
    watchFactory: () => ({ on: () => undefined, close: () => undefined })
  });
  const pending = [];
  const releases = [];
  const state = { cancelled: false };
  const track = (promise) => {
    promise.catch(() => undefined);
    pending.push(promise);
    return promise;
  };
  const gate = () => {
    const entered = deferred();
    const allowed = deferred();
    releases.push(allowed.resolve);
    return {
      entered: entered.promise,
      enter: entered.resolve,
      wait: allowed.promise,
      release: allowed.resolve
    };
  };
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const path = join(rootPath, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    const request = { workspaceId: 'workspace', generation: 1 };
    const start = () =>
      track(
        engine.initialize({
          ...request,
          rootPath: rootPath,
          databasePath: join(temp, 'search.sqlite')
        })
      );
    const search = (requestId, options = {}) =>
      track(
        engine.search({
          ...request,
          requestId,
          query: 'network',
          maxResults: 500,
          scope: { kind: 'project' },
          isCancelled: () => state.cancelled,
          ...options
        })
      );
    await run({ engine, state, gate, start, search, request, rootPath: await realpath(rootPath) });
  } finally {
    state.cancelled = true;
    for (const release of releases) release();
    await bounded(Promise.allSettled(pending), 'fixture operations drain');
    await bounded(engine.shutdown(), 'fixture engine shutdown');
    await rm(temp, { recursive: true, force: true });
  }
};

const holdContentBuild = ({ engine, gate }) => {
  const held = gate();
  const runTraversal = engine.runTraversal.bind(engine);
  let traversals = 0;
  engine.runTraversal = async (...args) => {
    held.enter();
    await held.wait;
    traversals += 1;
    return await runTraversal(...args);
  };
  return { ...held, traversals: () => traversals };
};
const holdBeforeMetadata = ({ engine, gate }, failure) => {
  const held = gate();
  const emitRootBrowseListing = engine.emitRootBrowseListing.bind(engine);
  engine.emitRootBrowseListing = async (...args) => {
    const listing = await emitRootBrowseListing(...args);
    held.enter();
    await held.wait;
    if (failure) throw failure;
    return listing;
  };
  return held;
};

test('cold Files and folder tokens work before either content build, both fenced by the directory scope', async () => {
  await withEngine(sampleFiles, async (fixture) => {
    const { engine, gate, start, search, request } = fixture;
    const build = holdContentBuild(fixture);
    const scoped = gate();
    const rebuild = OnlyPreviewSqliteIndex.prototype.rebuild;
    const close = OnlyPreviewSqliteIndex.prototype.close;
    const scopedIndexes = new Set();
    const closedIndexes = new Set();
    OnlyPreviewSqliteIndex.prototype.rebuild = async function (...args) {
      if (this.databasePath === ':memory:') {
        scopedIndexes.add(this);
        scoped.enter();
        await scoped.wait;
      }
      return await rebuild.apply(this, args);
    };
    OnlyPreviewSqliteIndex.prototype.close = function (...args) {
      if (scopedIndexes.has(this)) closedIndexes.add(this);
      return close.apply(this, args);
    };
    let initializing;
    let searching;
    try {
      initializing = start();
      await bounded(build.entered, 'metadata counting finishes');
      assert.equal(engine.index, undefined, 'there is no committed SQLite reader yet');
      assert.equal(build.traversals(), 0, 'the content traversal has not begun');
      const filesReady = deferred();
      const contentsReady = deferred();
      const streamed = [];
      let settled = false;
      searching = search('early-metadata', {
        scope: { kind: 'directory', relativePath: 'current' },
        onResult: (result) => {
          streamed.push(result);
          if (streamed.filter(({ section }) => section === 'files').length === 2)
            filesReady.resolve();
          if (result.section === 'contents') contentsReady.resolve();
        }
      });
      searching.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await bounded(
        Promise.all([scoped.entered, filesReady.promise]),
        'Files bypass blocked scoped Contents'
      );
      const earlyFiles = streamed.filter(({ section }) => section === 'files');
      assert.deepEqual(paths(earlyFiles), ['current/network', 'current/network/network.md']);
      assert.equal(
        streamed.some(({ relativePath }) => relativePath.startsWith('areas/')),
        false,
        'the cold metadata snapshot is fenced by the scope, exactly like Contents'
      );
      assert.deepEqual(
        earlyFiles.map(({ nodeKind }) => nodeKind),
        ['directory', 'file']
      );
      assert.equal(
        streamed.some(({ section }) => section === 'contents'),
        false
      );
      assert.equal(settled, false);
      const memory = await engine.memory();
      assert.equal(memory.treeMetadataEntryCount, 8);
      assert.ok(memory.treeMetadataEstimatedBytes > 0);
      assert.equal(memory.measurementComplete, false);
      assert.equal(memory.diskIndexBytes, null);
      assert.equal((await engine.snapshot()).state, 'building');
      const preview = (row) =>
        engine.preview({
          ...request,
          requestId: 'early-metadata',
          resultToken: row.resultToken,
          isCancelled: () => false
        });
      const filePreview = await preview(earlyFiles[1]);
      assert.equal(filePreview.kind, 'text');
      assert.equal(filePreview.adapter, 'markdown');
      assert.equal(filePreview.text, sampleFiles['current/network/network.md']);
      const directoryPreview = await preview(earlyFiles[0]);
      assert.equal(directoryPreview.kind, 'directory');
      assert.deepEqual(paths(directoryPreview.entries), ['current/network/network.md']);
      assert.equal(engine.index, undefined, 'token previews do not require promotion');
      scoped.release();
      await bounded(contentsReady.promise, 'scoped Contents batch');
      assert.deepEqual(paths(streamed.filter(({ section }) => section === 'contents')), [
        'current/local.txt',
        'current/network/network.md'
      ]);
      assert.equal(settled, false, 'the terminal still waits for the atomic full index');
      assert.equal(build.traversals(), 0);
      build.release();
      await bounded(initializing, 'initial index promotion');
      const response = await bounded(searching, 'fresh terminal response');
      assert.deepEqual(paths(response.files), paths(earlyFiles));
      assert.deepEqual(paths(response.contents), ['current/local.txt', 'current/network/network.md']);
      assert.equal(response.filesTruncated, false);
      assert.equal(response.contentsTruncated, false);
      assert.equal(build.traversals(), 1, 'early Files did not add a content traversal');
      assert.equal(scopedIndexes.size, 1, 'only the selected directory uses a temporary index');
      assert.equal(closedIndexes.size, 1);
      assert.equal(engine.activeQueryCount, 0);
      assert.equal((await engine.snapshot()).state, 'ready');
    } finally {
      build.release();
      scoped.release();
      fixture.state.cancelled = true;
      await bounded(
        Promise.allSettled([initializing, searching].filter(Boolean)),
        'scoped test drain'
      );
      OnlyPreviewSqliteIndex.prototype.rebuild = rebuild;
      OnlyPreviewSqliteIndex.prototype.close = close;
    }
  });
});

test('cold metadata honors folder-first caps and hard/ordered exclusions before and after promotion', async () => {
  await withEngine(
    {
      'needle-a-folder/child.txt': 'ordinary',
      'needle-z-folder/child.txt': 'ordinary',
      'needle-0.txt': 'ordinary',
      'needle-1.txt': 'ordinary',
      'needle-2.txt': 'ordinary',
      'needle-private/needle-hidden.txt': 'needle excluded',
      'needle-secret.txt': 'needle excluded',
      'vendor/needle-hidden.txt': 'needle excluded',
      '.hidden/needle-hidden.txt': 'needle excluded',
      'package.egg-info/needle-hidden.txt': 'needle excluded',
      '.bitterless/preview-config.yml':
        'version: 1\nexclude:\n  - needle-private/**\n  - needle-secret.txt\n'
    },
    async (fixture) => {
      const { engine, start, search } = fixture;
      const build = holdContentBuild(fixture);
      const initializing = start();
      await bounded(build.entered, 'excluded metadata complete');
      const early = [];
      const ready = deferred();
      const searching = search('metadata-cap', {
        query: 'needle',
        maxResults: 3,
        onResult: (row) => {
          early.push(row);
          if (early.length === 3) ready.resolve();
        }
      });
      await bounded(ready.promise, 'bounded early Files');
      assert.equal(engine.index, undefined);
      assert.deepEqual(paths(early), ['needle-a-folder', 'needle-z-folder', 'needle-0.txt']);
      assert.equal(engine.globalSearchSession.resultsByToken.size, 3);
      assert.equal(build.traversals(), 0);
      build.release();
      await bounded(initializing, 'excluded index promotion');
      const response = await bounded(searching, 'capped terminal');
      assert.deepEqual(paths(response.files), paths(early));
      assert.equal(response.filesTruncated, true);
      assert.deepEqual(response.contents, []);
      const complete = await search('metadata-all', { query: 'needle' });
      assert.deepEqual(paths(complete.files), [
        'needle-a-folder',
        'needle-z-folder',
        'needle-0.txt',
        'needle-1.txt',
        'needle-2.txt'
      ]);
      assert.equal(engine.activeQueryCount, 0);
    }
  );
});

test('cancelling a cold search revokes early tokens and releases readers without cancelling the index build', async () => {
  await withEngine(sampleFiles, async (fixture) => {
    const { engine, state, start, search, request } = fixture;
    const build = holdContentBuild(fixture);
    const initializing = start();
    await bounded(build.entered, 'cold metadata complete');
    const ready = deferred();
    const searching = search('cancel-early', { onResult: (row) => ready.resolve(row) });
    const row = await bounded(ready.promise, 'early cancellation token');
    state.cancelled = true;
    await assert.rejects(bounded(searching, 'cancel while waiting for content build'), cancelled);
    assert.equal(engine.activeQueryCount, 0);
    assert.equal(engine.globalSearchSession.resultsByToken.size, 0);
    await assert.rejects(
      engine.preview({
        ...request,
        requestId: 'cancel-early',
        resultToken: row.resultToken,
        isCancelled: () => false
      }),
      /stale/
    );
    assert.equal(build.traversals(), 0);
    build.release();
    await bounded(initializing, 'promotion after cancelled reader');
    state.cancelled = false;
    const response = await search('after-cancellation');
    assert.deepEqual(paths(response.files), [
      'areas/network',
      'current/network',
      'areas/network/network.md',
      'current/network/network.md'
    ]);
    assert.equal(response.contents.length, 4);
    assert.equal(engine.activeQueryCount, 0);
  });
});

test('cancelling before metadata is ready promptly settles the query and does not poison initialization', async () => {
  await withEngine(sampleFiles, async (fixture) => {
    const { engine, state, start, search } = fixture;
    const metadata = holdBeforeMetadata(fixture);
    const initializing = start();
    await bounded(metadata.entered, 'first browse listing');
    const streamed = [];
    const searching = search('cancel-before-metadata', { onResult: (row) => streamed.push(row) });
    await tick();
    state.cancelled = true;
    await assert.rejects(bounded(searching, 'cancel initial metadata wait'), cancelled);
    assert.deepEqual(streamed, []);
    assert.equal(engine.activeQueryCount, 0);
    metadata.release();
    await bounded(initializing, 'initialization continues after query cancellation');
    state.cancelled = false;
    assert.equal((await search('after-pre-metadata-cancel')).files.length, 4);
  });
});

for (const cancelBuild of [false, true]) {
  test(`${cancelBuild ? 'build cancellation' : 'genuine failure'} before metadata completion terminates the waiting cold query`, async () => {
    await withEngine(sampleFiles, async (fixture) => {
      const { engine, start, search } = fixture;
      const failure = new Error('metadata fixture failure');
      const metadata = holdBeforeMetadata(fixture, cancelBuild ? undefined : failure);
      const initializing = start();
      await bounded(metadata.entered, 'pre-metadata failure boundary');
      const streamed = [];
      const searching = search('failed-before-metadata', { onResult: (row) => streamed.push(row) });
      await tick();
      if (cancelBuild) engine.cancelBuild();
      metadata.release();
      const expected = cancelBuild ? cancelled : (error) => error === failure;
      await assert.rejects(bounded(initializing, 'initialization failure'), expected);
      await assert.rejects(bounded(searching, 'cold metadata failure propagation'), expected);
      assert.deepEqual(streamed, []);
      assert.equal(engine.index, undefined);
      assert.equal(engine.activeQueryCount, 0);
      assert.equal(engine.globalSearchSession.resultsByToken.size, 0);
    });
  });
}
