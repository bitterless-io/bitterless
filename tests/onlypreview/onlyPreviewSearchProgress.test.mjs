import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-search-progress-'));
  try {
    return await callback(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
};

const write = async (path, content = '') => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

test('Utility search build counts before indexing and reports one fenced monotonic revision', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const branch = join(root, 'branch');
    await mkdir(branch, { recursive: true });
    await write(join(root, 'root.txt'), 'root');
    await Promise.all(
      Array.from({ length: 300 }, (_unused, index) =>
        write(join(branch, `file-${String(index).padStart(3, '0')}.txt`), 'x')
      )
    );

    const timeline = [];
    const progress = [];
    let changedBetweenPasses = false;
    const removedPath = join(branch, 'file-299.txt');
    const engine = createOnlyPreviewSearchEngine({
      onBrowseListing: (listing) => timeline.push({ kind: 'browse', listing }),
      onProgress: (event) => {
        timeline.push({ kind: 'progress', event });
        progress.push(event);
        if (!changedBetweenPasses && event.phase === 'indexing' && event.completed === 0) {
          changedBetweenPasses = true;
          unlinkSync(removedPath);
        }
      }
    });

    try {
      const snapshot = await engine.initialize({
        workspaceId: 'workspace',
        generation: 9,
        rootPath: await realpath(root),
        databasePath: join(temp, 'cache', 'search.sqlite')
      });
      assert.equal(changedBetweenPasses, true);
      assert.equal(timeline[0].kind, 'browse', 'the root listing must precede search work');
      assert.equal(timeline[1].kind, 'progress');
      assert.equal(timeline[1].event.phase, 'counting');
      assert.deepEqual(progress[0], {
        workspaceId: 'workspace',
        generation: 9,
        buildRevision: 1,
        phase: 'counting'
      });

      const indexing = progress.filter(({ phase }) => phase === 'indexing');
      assert.deepEqual(indexing[0], {
        workspaceId: 'workspace',
        generation: 9,
        buildRevision: 1,
        phase: 'indexing',
        completed: 0,
        total: 301
      });
      assert.equal(indexing.at(-1).completed, 300);
      assert.equal(indexing.at(-1).total, 301);
      for (let index = 1; index < indexing.length; index += 1) {
        assert.ok(indexing[index].completed >= indexing[index - 1].completed);
        assert.equal(indexing[index].total, indexing[0].total);
      }
      for (const event of progress) {
        assert.equal(
          Object.keys(event).some((key) => /path|filename|content|setting/iu.test(key)),
          false
        );
      }
      assert.equal(snapshot.state, 'ready');
      assert.equal(
        snapshot.index.entries.some(({ relativePath }) => relativePath === 'branch'),
        true
      );
      assert.equal(
        snapshot.index.entries.some(({ relativePath }) => relativePath === 'branch/file-299.txt'),
        false
      );

      const rootListing = timeline[0].listing;
      const branchEntry = rootListing.entries.find(({ name }) => name === 'branch');
      const branchListing = await engine.browseDirectory({
        workspaceId: 'workspace',
        generation: 9,
        directoryToken: branchEntry.directoryToken
      });
      assert.equal(branchListing.entries.length, 299);
      assert.equal(
        branchListing.entries.some(({ relativePath }) => relativePath === 'branch/file-299.txt'),
        false
      );
    } finally {
      await engine.shutdown();
    }
  });
});

test('empty Utility search emits one zero-total build and refresh advances the revision', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await mkdir(root);
    const progress = [];
    const engine = createOnlyPreviewSearchEngine({
      onProgress: (event) => progress.push(event)
    });
    try {
      const request = {
        workspaceId: 'workspace',
        generation: 3,
        rootPath: await realpath(root),
        databasePath: join(temp, 'cache', 'search.sqlite')
      };
      await engine.initialize(request);
      assert.deepEqual(progress, [
        {
          workspaceId: 'workspace',
          generation: 3,
          buildRevision: 1,
          phase: 'counting'
        },
        {
          workspaceId: 'workspace',
          generation: 3,
          buildRevision: 1,
          phase: 'indexing',
          completed: 0,
          total: 0
        }
      ]);

      progress.length = 0;
      await engine.refresh({ workspaceId: 'workspace', generation: 3 });
      assert.equal(progress[0].buildRevision, 2);
      assert.equal(progress[0].phase, 'counting');
      assert.equal(progress[1].buildRevision, 2);
      assert.equal(progress[1].phase, 'indexing');
      assert.equal(progress[1].completed, 0);
      assert.equal(progress[1].total, 0);
    } finally {
      await engine.shutdown();
    }
  });
});
