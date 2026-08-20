/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, openSync, closeSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { classifySearchMediaType } from '../../src/preload/onlypreview/search/core/classification.mjs';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-guards-'));
const bundlePath = join(buildRoot, 'runtime.mjs');

await build({
  entryPoints: [join(projectRoot, 'tests/onlypreview/runtime.entry.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json')
});

const runtime = await import(pathToFileURL(bundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const withTempDirectory = async (callback) => {
  const root = mkdtempSync(join(tmpdir(), 'onlypreview-preview-guards-'));
  try {
    return await callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

const createRegistries = () => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  const assets = new runtime.OnlyPreviewAssetRegistry(hosts, workspaces);
  return { hosts, workspaces, assets };
};

const expectOnlyPreviewError = (code) => (error) =>
  error instanceof runtime.OnlyPreviewContractError && error.code === code;

const createMetadataFile = ({ relativePath, size, bytes = Buffer.alloc(0) }) => {
  let bodyReadCount = 0;
  return {
    file: {
      host: { hostToken: 'host-token' },
      workspace: { workspaceId: 'workspace-id', rootRealPath: '/workspace' },
      relativePath,
      realPath: `/workspace/${relativePath}`,
      size,
      modifiedAt: 1,
      modifiedTimeNanoseconds: 1n,
      deviceId: 1n,
      inode: 2n,
      fileHandle: {
        read: async (target, offset, length, position) => {
          bodyReadCount += 1;
          const available = Math.max(0, Math.min(length, bytes.length - position));
          if (available > 0) bytes.copy(target, offset, position, position + available);
          return { bytesRead: available, buffer: target };
        },
        close: async () => undefined
      }
    },
    bodyReadCount: () => bodyReadCount
  };
};

test('extension and exact basename routing never promotes unknown bytes or demotes known text', async () => {
  const textExtensions = [
    '.c',
    '.cc',
    '.cfg',
    '.conf',
    '.cpp',
    '.cs',
    '.css',
    '.csv',
    '.env',
    '.go',
    '.graphql',
    '.h',
    '.hpp',
    '.htm',
    '.html',
    '.ini',
    '.java',
    '.js',
    '.json',
    '.json5',
    '.jsx',
    '.less',
    '.log',
    '.lua',
    '.markdown',
    '.md',
    '.mdx',
    '.mjs',
    '.mts',
    '.php',
    '.properties',
    '.py',
    '.rb',
    '.rs',
    '.sass',
    '.scss',
    '.sh',
    '.sql',
    '.svelte',
    '.swift',
    '.toml',
    '.ts',
    '.tsx',
    '.txt',
    '.vue',
    '.xml',
    '.yaml',
    '.yml',
    '.zsh'
  ];
  const exactBasenames = [
    'dockerfile',
    'containerfile',
    'makefile',
    'rakefile',
    'gemfile',
    'procfile',
    'readme',
    'license',
    'notice',
    'changelog',
    'authors',
    'codeowners',
    '.gitignore',
    '.gitattributes',
    '.gitmodules',
    '.dockerignore',
    '.editorconfig',
    '.npmrc',
    '.yarnrc',
    '.prettierrc',
    '.eslintrc',
    '.stylelintrc',
    '.babelrc'
  ];
  for (const relativePath of [
    ...textExtensions.map((extension) => `nested/file${extension}`),
    ...exactBasenames.map((name) => `nested/${name.toUpperCase()}`),
    'nested/.env.production'
  ]) {
    assert.equal(runtime.classifyOnlyPreviewExtension(relativePath), 'text', relativePath);
    assert.equal(classifySearchMediaType(relativePath), 'text', relativePath);
  }
  for (const relativePath of ['Dockerfiles', 'README-copy', '.gitmodule', 'makefile.bak']) {
    assert.equal(runtime.classifyOnlyPreviewExtension(relativePath), 'unsupported', relativePath);
    assert.equal(classifySearchMediaType(relativePath), 'unknown', relativePath);
  }
  assert.equal(runtime.classifyOnlyPreviewExtension('archive.zip'), 'unsupported');
  assert.equal(runtime.classifyOnlyPreviewExtension('plain.unknown'), 'unsupported');

  const workspaces = { assertOpenedFileCurrent: async () => undefined };
  const service = new runtime.OnlyPreviewClassifierService(workspaces);
  const unknown = createMetadataFile({
    relativePath: 'plain.unknown',
    size: 12,
    bytes: Buffer.from('readable text')
  });
  assert.equal((await service.describe(unknown.file)).kind, 'unsupported');
  assert.equal(unknown.bodyReadCount(), 0);

  const renamedZip = createMetadataFile({
    relativePath: 'archive.js',
    size: 7,
    bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x00])
  });
  assert.equal((await service.describe(renamedZip.file)).kind, 'text');
  assert.equal(renamedZip.bodyReadCount(), 0);
});

test('size-first metadata gates read zero body bytes at adapter limit plus one', async () => {
  const workspaces = { assertOpenedFileCurrent: async () => undefined };
  const service = new runtime.OnlyPreviewClassifierService(workspaces);
  for (const fixture of [
    ['huge.vue', 1024 ** 3],
    ['notes.md', runtime.ONLY_PREVIEW_MAX_MARKDOWN_BYTES + 1],
    ['page.html', runtime.ONLY_PREVIEW_MAX_HTML_BYTES + 1],
    ['photo.png', runtime.ONLY_PREVIEW_MAX_IMAGE_BYTES + 1],
    ['manual.pdf', runtime.ONLY_PREVIEW_MAX_PDF_BYTES + 1],
    ['book.xlsx', runtime.ONLY_PREVIEW_MAX_SHEET_BYTES + 1],
    ['document.docx', runtime.ONLY_PREVIEW_MAX_DOCUMENT_BYTES + 1]
  ]) {
    const candidate = createMetadataFile({ relativePath: fixture[0], size: fixture[1] });
    const descriptor = await service.describe(candidate.file);
    assert.equal(descriptor.previewError?.code, 'TEXT_TOO_LARGE', fixture[0]);
    assert.equal(candidate.bodyReadCount(), 0, fixture[0]);
  }

  const markdownSource = createMetadataFile({
    relativePath: 'notes.markdown',
    size: runtime.ONLY_PREVIEW_MAX_MARKDOWN_BYTES + 1
  });
  assert.equal((await service.describe(markdownSource.file)).previewError, undefined);
  assert.equal(markdownSource.bodyReadCount(), 0);
});

test('bounded text reads accept exact caps and decode malformed UTF/NUL and odd UTF-16 tails', async () => {
  await withTempDirectory(async (root) => {
    const { hosts, workspaces } = createRegistries();
    const service = new runtime.OnlyPreviewClassifierService(workspaces);
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, root);
    const read = async (relativePath, adapterId) => {
      const file = await workspaces.openFile(host.hostToken, {
        workspaceId: workspace.workspaceId,
        relativePath
      });
      try {
        return await service.readText(file, adapterId);
      } finally {
        await file.fileHandle.close().catch(() => undefined);
      }
    };

    writeFileSync(join(root, 'garbage.js'), Buffer.from([0x50, 0x4b, 0x00, 0xff, 0xc3, 0x28]));
    const garbage = await read('garbage.js', 'monaco');
    assert.equal(garbage.text.includes('\0'), true);
    assert.match(garbage.text, /\uFFFD/u);

    writeFileSync(join(root, 'odd-le.txt'), Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69]));
    assert.equal((await read('odd-le.txt', 'monaco')).text, 'h\uFFFD');
    writeFileSync(join(root, 'odd-be.txt'), Buffer.from([0xfe, 0xff, 0x00, 0x68, 0x00]));
    assert.equal((await read('odd-be.txt', 'monaco')).text, 'h\uFFFD');

    writeFileSync(
      join(root, 'exact.md'),
      Buffer.alloc(runtime.ONLY_PREVIEW_MAX_MARKDOWN_BYTES, 0x61)
    );
    assert.equal(
      (await read('exact.md', 'markdown-dom')).size,
      runtime.ONLY_PREVIEW_MAX_MARKDOWN_BYTES
    );
    const plusOnePath = join(root, 'plus-one.md');
    const descriptor = openSync(plusOnePath, 'w');
    closeSync(descriptor);
    truncateSync(plusOnePath, runtime.ONLY_PREVIEW_MAX_MARKDOWN_BYTES + 1);
    await assert.rejects(
      read('plus-one.md', 'markdown-dom'),
      expectOnlyPreviewError('TEXT_TOO_LARGE')
    );

    writeFileSync(
      join(root, 'exact.markdown'),
      Buffer.alloc(runtime.ONLY_PREVIEW_MAX_TEXT_BYTES, 0x61)
    );
    assert.equal(
      (await read('exact.markdown', 'monaco')).size,
      runtime.ONLY_PREVIEW_MAX_TEXT_BYTES
    );
    const plusOneMonacoPath = join(root, 'plus-one.markdown');
    const plusOneMonaco = openSync(plusOneMonacoPath, 'w');
    closeSync(plusOneMonaco);
    truncateSync(plusOneMonacoPath, runtime.ONLY_PREVIEW_MAX_TEXT_BYTES + 1);
    await assert.rejects(
      read('plus-one.markdown', 'monaco'),
      expectOnlyPreviewError('TEXT_TOO_LARGE')
    );
  });
});

test('non-text signatures stay mandatory and asset capabilities require exact revision and finite max', async () => {
  const workspaces = { assertOpenedFileCurrent: async () => undefined };
  const service = new runtime.OnlyPreviewClassifierService(workspaces);
  for (const [relativePath, bytes, expectedKind] of [
    ['fake.pdf', Buffer.from('not pdf'), 'pdf'],
    ['fake.png', Buffer.from('not png'), 'image'],
    ['fake.mp4', Buffer.from('not video'), 'video'],
    ['fake.xlsx', Buffer.from('not zip'), 'sheet'],
    ['fake.docx', Buffer.from('not zip'), 'document']
  ]) {
    const candidate = createMetadataFile({ relativePath, size: bytes.length, bytes });
    const descriptor = await service.describe(candidate.file);
    assert.equal(descriptor.kind, expectedKind);
    assert.equal(descriptor.previewError?.code, 'SIGNATURE_MISMATCH');
    assert.ok(candidate.bodyReadCount() > 0);
    assert.equal(descriptor.assetUrl, undefined);
  }

  for (const [relativePath, size, bytes, expectedKind] of [
    ['exact.pdf', runtime.ONLY_PREVIEW_MAX_PDF_BYTES, Buffer.from('%PDF-'), 'pdf'],
    [
      'exact.png',
      runtime.ONLY_PREVIEW_MAX_IMAGE_BYTES,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      'image'
    ],
    [
      'exact.xlsx',
      runtime.ONLY_PREVIEW_MAX_SHEET_BYTES,
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      'sheet'
    ],
    [
      'exact.docx',
      runtime.ONLY_PREVIEW_MAX_DOCUMENT_BYTES,
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      'document'
    ]
  ]) {
    const candidate = createMetadataFile({ relativePath, size, bytes });
    const descriptor = await service.describe(candidate.file);
    assert.equal(descriptor.kind, expectedKind, relativePath);
    assert.equal(descriptor.previewError, undefined, relativePath);
  }

  await withTempDirectory(async (root) => {
    writeFileSync(join(root, 'stable.mp4'), Buffer.from('0123456789'));
    const { hosts, workspaces: registry, assets } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await registry.createForTarget(host.hostToken, root);
    const file = await registry.openFile(host.hostToken, {
      workspaceId: workspace.workspaceId,
      relativePath: 'stable.mp4'
    });
    try {
      assert.throws(
        () => assets.issue(file, 'video/mp4', { maxBytes: file.size }),
        expectOnlyPreviewError('INVALID_INPUT')
      );
      assert.throws(
        () =>
          assets.issue(file, 'video/mp4', {
            selectionRevision: 1,
            maxBytes: Number.POSITIVE_INFINITY
          }),
        expectOnlyPreviewError('INVALID_INPUT')
      );
      assert.match(
        assets.issue(file, 'video/mp4', { selectionRevision: 1, maxBytes: file.size }),
        /^bitterless-preview:\/\/asset\//u
      );
    } finally {
      await file.fileHandle.close().catch(() => undefined);
    }
  });
});

test('large stable media retains exact-size range delivery without a preview cap', async () => {
  await withTempDirectory(async (root) => {
    const mediaPath = join(root, 'large.mp4');
    writeFileSync(mediaPath, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]));
    const mediaSize = runtime.ONLY_PREVIEW_MAX_PDF_BYTES + 1024;
    truncateSync(mediaPath, mediaSize);
    const { hosts, workspaces, assets } = createRegistries();
    const host = hosts.issue('standalone', 'content');
    const workspace = await workspaces.createForTarget(host.hostToken, root);
    const opened = await workspaces.openFile(host.hostToken, {
      workspaceId: workspace.workspaceId,
      relativePath: 'large.mp4'
    });
    const service = new runtime.OnlyPreviewClassifierService(workspaces);
    try {
      assert.equal((await service.describe(opened)).previewError, undefined);
      const url = assets.issue(opened, 'video/mp4', {
        selectionRevision: 1,
        maxBytes: opened.size
      });
      await opened.fileHandle.close();
      const response = await assets.respond(
        new Request(url, { headers: { Range: `bytes=${mediaSize - 2}-${mediaSize - 1}` } })
      );
      assert.equal(response.status, 206);
      assert.equal((await response.arrayBuffer()).byteLength, 2);
    } finally {
      await opened.fileHandle.close().catch(() => undefined);
    }
  });
});
