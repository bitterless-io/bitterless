import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { createOnlyPreviewBrowseIndex } from '../../src/preload/onlypreview/search/core/browse-index.mjs';

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-browse-index-'));
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

test('browse listings ignore Project Search exclusions and return every immediate child naturally', async () => {
  await withTempDirectory(async (root) => {
    await write(join(root, 'z10.txt'), 'ten');
    await write(join(root, 'z2.txt'), 'two');
    await write(join(root, '.hidden/private.txt'), 'browse only');
    await write(join(root, '.git/config'), 'browse only');
    await write(join(root, 'node_modules/pkg/index.js'), 'browse only');
    await write(join(root, 'dist/output.js'), 'browse only');
    await write(join(root, 'output/report.txt'), 'browse only');
    await write(join(root, 'generated/drop.txt'), 'browse only');
    await write(join(root, 'Folder10/item.txt'), 'ten');
    await write(join(root, 'Folder2/item.txt'), 'two');

    const browse = createOnlyPreviewBrowseIndex(await realpath(root));
    const rootListing = await browse.rootListing({ workspaceId: 'workspace', generation: 7 });
    assert.equal(rootListing.workspaceId, 'workspace');
    assert.equal(rootListing.generation, 7);
    assert.equal(rootListing.relativePath, '');
    assert.match(rootListing.directoryToken, /^[0-9a-f-]{36}$/u);
    assert.deepEqual(
      rootListing.entries.map(({ name }) => name),
      [
        '.git',
        '.hidden',
        'dist',
        'Folder2',
        'Folder10',
        'generated',
        'node_modules',
        'output',
        'z2.txt',
        'z10.txt'
      ]
    );
    assert.equal(
      rootListing.entries.some(({ relativePath }) => relativePath.includes('/')),
      false,
      'a listing contains only the complete immediate-child set'
    );

    const nodeModules = rootListing.entries.find(({ name }) => name === 'node_modules');
    assert.equal(nodeModules.nodeKind, 'directory');
    assert.match(nodeModules.directoryToken, /^[0-9a-f-]{36}$/u);
    const dependencyListing = await browse.list({
      workspaceId: 'workspace',
      generation: 7,
      directoryToken: nodeModules.directoryToken
    });
    assert.equal(dependencyListing.relativePath, 'node_modules');
    assert.deepEqual(
      dependencyListing.entries.map(({ name }) => name),
      ['pkg']
    );
  });
});

test('browse capabilities are opaque, do not recurse through symlinks, and expire on reset', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const outside = join(temp, 'outside');
    await write(join(root, 'folder/item.txt'), 'inside');
    await write(join(outside, 'escaped.txt'), 'outside');
    await symlink(outside, join(root, 'outside-link'));

    const browse = createOnlyPreviewBrowseIndex(await realpath(root));
    const rootListing = await browse.rootListing({ workspaceId: 'workspace', generation: 1 });
    const folder = rootListing.entries.find(({ name }) => name === 'folder');
    const outsideLink = rootListing.entries.find(({ name }) => name === 'outside-link');
    assert.equal(folder.nodeKind, 'directory');
    assert.equal(folder.directoryToken.includes('folder'), false);
    assert.equal(outsideLink.nodeKind, 'symlink');
    assert.equal(outsideLink.directoryToken, null);
    await assert.rejects(
      () =>
        browse.list({
          workspaceId: 'workspace',
          generation: 1,
          directoryToken: 'folder'
        }),
      /capability is stale/u
    );

    const staleToken = folder.directoryToken;
    browse.reset();
    await assert.rejects(
      () =>
        browse.list({
          workspaceId: 'workspace',
          generation: 1,
          directoryToken: staleToken
        }),
      /capability is stale/u
    );
  });
});

test('browse rejects a directory replaced by an external symlink before opendir without leaking names', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const movedRoot = join(temp, 'workspace-original');
    const outside = join(temp, 'outside');
    await write(join(root, 'inside.txt'), 'inside');
    await write(join(outside, 'outside-secret-name.txt'), 'outside');

    let replaced = false;
    const browse = createOnlyPreviewBrowseIndex(await realpath(root), {
      raceHook: async ({ point, relativePath }) => {
        if (replaced || point !== 'before-directory-open' || relativePath !== '') return;
        replaced = true;
        await rename(root, movedRoot);
        await symlink(outside, root);
      }
    });

    try {
      await assert.rejects(
        () => browse.rootListing({ workspaceId: 'workspace', generation: 1 }),
        /Browse (?:path|directory)/u
      );
    } finally {
      if (replaced) {
        await rm(root);
        await rename(movedRoot, root);
      }
    }

    const listing = await browse.rootListing({ workspaceId: 'workspace', generation: 1 });
    assert.deepEqual(
      listing.entries.map(({ name }) => name),
      ['inside.txt']
    );
    assert.equal(browse.hasDirectory('outside-secret-name.txt'), false);
  });
});

test('browse omits a child replaced by an external symlink after lstat without leaking target metadata', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const movedChild = join(temp, 'inside-original.txt');
    const outside = join(temp, 'outside-secret.txt');
    const child = join(root, 'inside.txt');
    await write(child, 'inside');
    await write(join(root, 'stable.txt'), 'stable');
    await write(outside, 'outside metadata must stay private');

    let replaced = false;
    const browse = createOnlyPreviewBrowseIndex(await realpath(root), {
      raceHook: async ({ point, relativePath }) => {
        if (replaced || point !== 'after-child-lstat' || relativePath !== 'inside.txt') return;
        replaced = true;
        await rename(child, movedChild);
        await symlink(outside, child);
      }
    });

    try {
      const listing = await browse.rootListing({ workspaceId: 'workspace', generation: 1 });
      assert.deepEqual(
        listing.entries.map(({ name }) => name),
        ['stable.txt']
      );
      assert.equal(
        listing.entries.some(({ size }) => size === 'outside metadata must stay private'.length),
        false
      );
    } finally {
      if (replaced) {
        await rm(child);
        await rename(movedChild, child);
      }
    }
  });
});
