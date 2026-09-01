/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewSearchEngine } from '../../src/preload/onlypreview/search/core/search-engine.mjs';

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-search-refresh-'));
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

test('a full reconcile keeps every browse capability and republishes each open directory', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    await write(join(root, 'docs/plan/a.md'), 'alpha');
    await write(join(root, 'docs/plan/b.md'), 'bravo');
    await write(join(root, 'src/main.ts'), 'source');

    const browseListings = [];
    const engine = createOnlyPreviewSearchEngine({
      onBrowseListing: (listing) => browseListings.push(listing)
    });
    try {
      await engine.initialize({
        workspaceId: 'workspace',
        generation: 1,
        rootPath: root,
        databasePath: join(temp, 'cache', 'search.sqlite')
      });
      assert.deepEqual(
        browseListings.map(({ relativePath }) => relativePath),
        ['']
      );
      const rootToken = browseListings[0].directoryToken;
      const docsToken = browseListings[0].entries.find(
        ({ relativePath }) => relativePath === 'docs'
      ).directoryToken;
      const docsListing = await engine.browseDirectory({
        workspaceId: 'workspace',
        generation: 1,
        directoryToken: docsToken
      });
      const planToken = docsListing.entries.find(
        ({ relativePath }) => relativePath === 'docs/plan'
      ).directoryToken;
      await engine.browseDirectory({
        workspaceId: 'workspace',
        generation: 1,
        directoryToken: planToken
      });

      await unlink(join(root, 'docs/plan/b.md'));
      browseListings.length = 0;
      await engine.refresh({ workspaceId: 'workspace', generation: 1 });

      // Every directory the Shell has open is republished under its unchanged capability, so the
      // Project tree keeps its expansion, selection, and scroll instead of collapsing to the root.
      assert.deepEqual(
        browseListings.map(({ relativePath, directoryToken }) => [relativePath, directoryToken]),
        [
          ['', rootToken],
          ['docs', docsToken],
          ['docs/plan', planToken]
        ]
      );
      assert.deepEqual(
        browseListings[2].entries.map(({ relativePath }) => relativePath),
        ['docs/plan/a.md']
      );

      // A capability issued before the reconcile is still usable afterwards.
      const reBrowsedDocs = await engine.browseDirectory({
        workspaceId: 'workspace',
        generation: 1,
        directoryToken: docsToken
      });
      assert.equal(reBrowsedDocs.relativePath, 'docs');
    } finally {
      await engine.shutdown();
    }
  });
});
