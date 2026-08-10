import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { createWorkspaceTraversal } from '../../src/preload/onlypreview/search/core/traversal.mjs';
import {
  loadOnlyPreviewWorkspaceConfig,
  parseOnlyPreviewWorkspaceConfig
} from '../../src/preload/onlypreview/search/core/workspace-config.mjs';

const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-search-traversal-'));
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

const collect = async (iterable) => {
  const entries = [];
  for await (const entry of iterable) entries.push(entry);
  return entries;
};

test('search traversal physically excludes hidden, fixed, and configured paths before body reads', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const outside = join(temp, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await write(join(outside, 'escaped.txt'), 'must not be indexed');
    await write(join(root, 'node_modules/pkg/secret.txt'), 'excluded');
    await write(join(root, 'dist/output.txt'), 'excluded');
    await write(join(root, 'output/report.txt'), 'excluded');
    await write(join(root, '.hidden/private.txt'), 'excluded');
    await write(join(root, 'generated/drop/no.txt'), 'excluded by config');
    await write(join(root, 'generated/keep/yes.txt'), 'included again');
    await write(join(root, '.env.production'), 'SECRET_VALUE=do-not-index');
    await write(
      join(root, 'utf16.txt'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello UTF16', 'utf16le')])
    );
    await write(join(root, 'binary.txt'), Buffer.from([0, 1, 2, 3]));
    await write(join(root, 'large.txt'), Buffer.alloc(1024 * 1024 + 1, 0x61));
    await write(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await symlink(outside, join(root, 'outside-link'));

    const config = parseOnlyPreviewWorkspaceConfig(`
version: 1
exclude:
  - generated/**
  - '!generated/keep/**'
`);
    const readCandidates = [];
    const traversal = await createWorkspaceTraversal({
      rootPath: root,
      config,
      shouldReadContent: ({ relativePath }) => {
        readCandidates.push(relativePath);
        return undefined;
      }
    });
    const files = await collect(traversal.entries);
    const byPath = new Map(files.map((entry) => [entry.relativePath, entry]));
    const searchProjection = new Map(
      traversal.treeEntries.map((entry) => [entry.relativePath, entry])
    );

    assert.equal(byPath.has('node_modules/pkg/secret.txt'), false);
    assert.equal(byPath.has('dist/output.txt'), false);
    assert.equal(byPath.has('output/report.txt'), false);
    assert.equal(byPath.has('.hidden/private.txt'), false);
    assert.equal(byPath.has('generated/drop/no.txt'), false);
    assert.equal(byPath.get('generated/keep/yes.txt').originalContent, 'included again');
    for (const relativePath of [
      'node_modules',
      'node_modules/pkg/secret.txt',
      'dist',
      'dist/output.txt',
      'output',
      'output/report.txt',
      '.hidden',
      '.hidden/private.txt',
      'generated/drop/no.txt'
    ])
      assert.equal(searchProjection.has(relativePath), false, relativePath);
    assert.equal(
      readCandidates.some((relativePath) =>
        /(?:^|\/)(?:node_modules|dist|output|\.hidden)(?:\/|$)/u.test(relativePath)
      ),
      false
    );
    assert.equal(readCandidates.includes('generated/drop/no.txt'), false);
    assert.equal(searchProjection.has('generated'), false);
    assert.equal(searchProjection.get('generated/keep').nodeKind, 'directory');
    assert.equal(searchProjection.get('outside-link').nodeKind, 'symlink');
    assert.equal(byPath.has('outside-link/escaped.txt'), false);

    assert.equal(byPath.get('.env.production').mediaType, 'text');
    assert.equal(byPath.get('.env.production').contentIndexed, false);
    assert.equal(byPath.get('.env.production').originalContent, '');
    assert.equal(byPath.get('utf16.txt').originalContent, 'hello UTF16');
    assert.equal(byPath.get('binary.txt').mediaType, 'unknown');
    assert.equal(byPath.get('binary.txt').contentIndexed, false);
    assert.equal(byPath.get('large.txt').mediaType, 'text');
    assert.equal(byPath.get('large.txt').contentIndexed, false);
    assert.equal(byPath.get('image.png').mediaType, 'image');
    assert.equal(byPath.get('image.png').contentIndexed, false);
  });
});

test('traversal publishes every direct child before entering a nested descendant', async () => {
  await withTempDirectory(async (root) => {
    await write(join(root, 'a-directory/nested/deep.txt'), 'deep');
    await write(join(root, 'z-root.txt'), 'root');
    const published = [];
    const traversal = await createWorkspaceTraversal({
      rootPath: root,
      config: parseOnlyPreviewWorkspaceConfig('version: 1\nexclude: []'),
      onTreeEntry: ({ relativePath }) => published.push(relativePath)
    });
    const files = await collect(traversal.entries);

    assert.deepEqual(published, [
      'a-directory',
      'z-root.txt',
      'a-directory/nested',
      'a-directory/nested/deep.txt'
    ]);
    assert.deepEqual(
      files.map(({ relativePath }) => relativePath),
      ['z-root.txt', 'a-directory/nested/deep.txt']
    );
  });
});

test('depth 32 is a hard recursion boundary while retaining the boundary directory record', async () => {
  await withTempDirectory(async (root) => {
    let current = root;
    for (let depth = 1; depth <= 34; depth += 1) {
      current = join(current, `d${String(depth).padStart(2, '0')}`);
      await mkdir(current);
    }
    await write(join(current, 'too-deep.txt'), 'hidden by depth');
    const traversal = await createWorkspaceTraversal({
      rootPath: root,
      config: parseOnlyPreviewWorkspaceConfig('version: 1\nexclude: []')
    });
    await collect(traversal.entries);
    assert.equal(traversal.statistics.maxDepthReached, true);
    assert.equal(
      traversal.treeEntries.some(({ relativePath }) => relativePath.endsWith('too-deep.txt')),
      false
    );
    assert.equal(
      traversal.treeEntries.filter(({ nodeKind }) => nodeKind === 'directory').length,
      32
    );
  });
});

test('workspace config accepts containment and rejects file or parent-directory symlinks', async () => {
  await withTempDirectory(async (temp) => {
    const root = join(temp, 'workspace');
    const outside = join(temp, 'outside');
    await mkdir(join(root, '.bitterless'), { recursive: true });
    await mkdir(outside);
    const configPath = join(root, '.bitterless/preview-config.yml');
    await write(configPath, 'version: 1\nexclude:\n  - generated/**\n');
    assert.deepEqual((await loadOnlyPreviewWorkspaceConfig(root)).exclude, ['generated/**']);
    await unlink(configPath);
    const externalConfig = join(outside, 'preview-config.yml');
    await write(externalConfig, 'version: 1\nexclude: []');
    await symlink(externalConfig, configPath);
    await assert.rejects(() => loadOnlyPreviewWorkspaceConfig(root), /non-symbolic/u);

    await rm(join(root, '.bitterless'), { recursive: true, force: true });
    await symlink(outside, join(root, '.bitterless'));
    await assert.rejects(() => loadOnlyPreviewWorkspaceConfig(root), /directory/u);
  });
});
