import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  classifySearchMediaType,
  mediaTypeToPreviewHint,
  readClassifiedSearchContent
} from '../../src/preload/onlypreview/search/core/classification.mjs';
import { MAX_TEXT_BYTES } from '../../src/preload/onlypreview/search/core/constants.mjs';
import {
  OnlyPreviewSqliteIndex,
  SEARCH_ENGINE_IDENTITY
} from '../../src/preload/onlypreview/search/core/sqlite-index.mjs';
import {
  createWorkspaceTraversal,
  readSingleWorkspaceFile
} from '../../src/preload/onlypreview/search/core/traversal.mjs';
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
    assert.equal(byPath.get('binary.txt').mediaType, 'text');
    assert.equal(byPath.get('binary.txt').contentIndexed, true);
    assert.equal(byPath.get('binary.txt').originalContent, '\u0000\u0001\u0002\u0003');
    assert.equal(byPath.get('large.txt').mediaType, 'text');
    assert.equal(byPath.get('large.txt').contentIndexed, false);
    assert.equal(byPath.get('image.png').mediaType, 'image');
    assert.equal(byPath.get('image.png').contentIndexed, false);
  });
});

test('search text eligibility defaults remaining files to text and stays size-first and tolerant', async () => {
  for (const relativePath of [
    'src/App.vue',
    'notes.markdown',
    'Dockerfile',
    'README',
    '.gitmodules',
    '.EDITORCONFIG'
  ]) {
    assert.equal(classifySearchMediaType(relativePath), 'text', relativePath);
  }
  assert.equal(classifySearchMediaType('plain.unknown'), 'text');
  assert.equal(classifySearchMediaType('AGENTS.md.bak'), 'text');
  for (const relativePath of ['legacy.doc', 'legacy.xls', 'legacy.ppt']) {
    assert.equal(classifySearchMediaType(relativePath), 'unknown', relativePath);
    assert.equal(mediaTypeToPreviewHint('unknown', relativePath), 'unsupported', relativePath);
  }

  const createHandle = (bytes, { postSize = bytes.length } = {}) => {
    let readCount = 0;
    return {
      handle: {
        read: async (target, offset, length, position) => {
          readCount += 1;
          const available = Math.max(0, Math.min(length, bytes.length - position));
          if (available > 0) bytes.copy(target, offset, position, position + available);
          return { bytesRead: available, buffer: target };
        },
        stat: async () => ({
          size: postSize,
          dev: 1,
          ino: 2,
          mtimeMs: 3,
          isFile: () => true
        })
      },
      readCount: () => readCount,
      openedStat: {
        size: bytes.length,
        dev: 1,
        ino: 2,
        mtimeMs: 3,
        isFile: () => true
      }
    };
  };

  for (const [relativePath, size] of [
    ['workbook.xlsx', 12],
    ['legacy.doc', 12],
    ['legacy.xls', 12],
    ['legacy.ppt', 12],
    ['image.png', 12],
    ['huge.vue', 1024 ** 3],
    ['.env.production', 12]
  ]) {
    const fixture = createHandle(Buffer.alloc(Math.min(size, 12), 0x61));
    fixture.openedStat.size = size;
    const result = await readClassifiedSearchContent({
      handle: fixture.handle,
      relativePath,
      openedStat: fixture.openedStat
    });
    assert.equal(result.contentIndexed, false, relativePath);
    assert.equal(fixture.readCount(), 0, relativePath);
  }

  for (const relativePath of ['plain.unknown', 'archive.zip', 'AGENTS.md.bak']) {
    const fixture = createHandle(Buffer.from('fallback text'));
    const result = await readClassifiedSearchContent({
      handle: fixture.handle,
      relativePath,
      openedStat: fixture.openedStat
    });
    assert.equal(result.mediaType, 'text', relativePath);
    assert.equal(result.contentIndexed, true, relativePath);
    assert.equal(result.originalContent, 'fallback text', relativePath);
    assert.ok(fixture.readCount() > 0, relativePath);
  }

  const renamedZipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0xc3, 0x28]);
  const renamedZip = createHandle(renamedZipBytes);
  const renamedZipResult = await readClassifiedSearchContent({
    handle: renamedZip.handle,
    relativePath: 'archive.js',
    openedStat: renamedZip.openedStat
  });
  assert.equal(renamedZipResult.mediaType, 'text');
  assert.equal(renamedZipResult.contentIndexed, true);
  assert.equal(renamedZipResult.originalContent.includes('\0'), true);
  assert.match(renamedZipResult.originalContent, /\uFFFD/u);

  const sameBytesZip = createHandle(renamedZipBytes);
  const sameBytesZipResult = await readClassifiedSearchContent({
    handle: sameBytesZip.handle,
    relativePath: 'archive.zip',
    openedStat: sameBytesZip.openedStat
  });
  assert.equal(sameBytesZipResult.mediaType, 'text');
  assert.equal(sameBytesZipResult.contentIndexed, true);
  assert.equal(sameBytesZipResult.originalContent.includes('\0'), true);
  assert.match(sameBytesZipResult.originalContent, /\uFFFD/u);
  assert.ok(sameBytesZip.readCount() > 0);

  const oddUtf16 = createHandle(Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69]));
  assert.equal(
    (
      await readClassifiedSearchContent({
        handle: oddUtf16.handle,
        relativePath: 'odd.txt',
        openedStat: oddUtf16.openedStat
      })
    ).originalContent,
    'h\uFFFD'
  );
  const oddUtf16Be = createHandle(Buffer.from([0xfe, 0xff, 0x00, 0x68, 0x00]));
  assert.equal(
    (
      await readClassifiedSearchContent({
        handle: oddUtf16Be.handle,
        relativePath: 'odd-be.txt',
        openedStat: oddUtf16Be.openedStat
      })
    ).originalContent,
    'h\uFFFD'
  );

  const exact = createHandle(Buffer.alloc(MAX_TEXT_BYTES, 0x61));
  assert.equal(
    (
      await readClassifiedSearchContent({
        handle: exact.handle,
        relativePath: 'exact.txt',
        openedStat: exact.openedStat
      })
    ).contentIndexed,
    true
  );
  const growth = createHandle(Buffer.from('stable'), { postSize: 7 });
  const changed = await readClassifiedSearchContent({
    handle: growth.handle,
    relativePath: 'growing.txt',
    openedStat: growth.openedStat
  });
  assert.equal(changed.changed, true);
  assert.equal(changed.contentIndexed, false);
  assert.equal(changed.originalContent, '');
});

test('replacement races retain traversal, watch, and SQLite filename metadata without stale body', async () => {
  await withTempDirectory(async (root) => {
    const target = join(root, 'race.txt');
    const replacement = join(root, 'replacement.tmp');
    await write(target, 'stale body');
    await write(replacement, 'fresh body');
    const traversal = await createWorkspaceTraversal({
      rootPath: root,
      config: parseOnlyPreviewWorkspaceConfig('version: 1\nexclude: []'),
      raceHook: async ({ point, relativePath }) => {
        if (point === 'before-file-open' && relativePath === 'race.txt') {
          await rename(replacement, target);
        }
      }
    });
    const traversed = await collect(traversal.entries);
    const raceEntry = traversed.find(({ relativePath }) => relativePath === 'race.txt');
    assert.equal(raceEntry?.changed, true);
    assert.equal(raceEntry?.contentIndexed, false);
    assert.equal(raceEntry?.originalContent, '');
    assert.equal(
      traversal.treeEntries.some(({ relativePath }) => relativePath === 'race.txt'),
      true
    );

    const watchReplacement = join(root, 'watch-replacement.tmp');
    await write(join(root, 'watch.txt'), 'old watch body');
    await write(watchReplacement, 'new watch body');
    const watched = await readSingleWorkspaceFile({
      rootPath: root,
      relativePath: 'watch.txt',
      raceHook: async ({ point }) => {
        if (point === 'after-file-read') await rename(watchReplacement, join(root, 'watch.txt'));
      }
    });
    assert.equal(watched.changed, true);
    assert.equal(watched.contentIndexed, false);
    assert.equal(watched.originalContent, '');

    const index = new OnlyPreviewSqliteIndex(':memory:');
    try {
      await index.rebuild(
        [
          {
            relativePath: 'watch.txt',
            mediaType: 'text',
            contentIndexed: true,
            originalContent: 'old watch body',
            size: 14,
            modifiedMs: 1
          }
        ],
        { workspaceHash: 'workspace', configHash: 'config', engineHash: SEARCH_ENGINE_IDENTITY }
      );
      index.upsert(watched);
      assert.equal(index.filenameTier.get('watch.txt')?.contentIndexed, false);
      assert.equal(
        (await index.search('old watch body', { scope: { kind: 'project' } })).results.length,
        0
      );
      assert.equal(
        (await index.search('watch', { scope: { kind: 'project' } })).results[0]?.relativePath,
        'watch.txt'
      );
    } finally {
      index.close();
    }
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
