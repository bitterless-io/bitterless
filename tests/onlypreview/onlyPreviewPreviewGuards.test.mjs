/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, openSync, closeSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import {
  classifySearchMediaType,
  readClassifiedSearchContent
} from '../../src/preload/onlypreview/search/core/classification.mjs';
import { MAX_TEXT_BYTES } from '../../src/preload/onlypreview/search/core/constants.mjs';

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
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  alias: { electron: join(projectRoot, 'tests/onlypreview/fixtures/electron.stub.mjs') }
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

test('extension-first routing preserves known adapters and defaults remaining files to plaintext', async () => {
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
    '.cjs',
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
  for (const relativePath of [
    'Dockerfiles',
    'README-copy',
    '.gitmodule',
    'makefile.bak',
    'AGENTS.md.bak',
    'plain.unknown',
    'extensionless'
  ]) {
    assert.equal(runtime.classifyOnlyPreviewExtension(relativePath), 'text', relativePath);
    assert.equal(classifySearchMediaType(relativePath), 'text', relativePath);
  }
  assert.equal(runtime.classifyOnlyPreviewExtension('archive.zip'), 'text');
  assert.equal(runtime.classifyOnlyPreviewExtension('architecture.drawio'), 'diagram');
  assert.equal(classifySearchMediaType('architecture.drawio'), 'unknown');
  assert.equal(runtime.classifyOnlyPreviewExtension('slides.PPTX'), 'presentation');
  assert.equal(classifySearchMediaType('slides.PPTX'), 'unknown');
  for (const relativePath of ['legacy.DOC', 'legacy.XLS', 'legacy.PPT']) {
    assert.equal(runtime.classifyOnlyPreviewExtension(relativePath), 'unsupported', relativePath);
    assert.equal(classifySearchMediaType(relativePath), 'unknown', relativePath);
  }
  assert.equal(runtime.classifyOnlyPreviewExtension('module.CJS'), 'text');
  assert.equal(classifySearchMediaType('module.CJS'), 'text');

  const workspaces = { assertOpenedFileCurrent: async () => undefined };
  const service = new runtime.OnlyPreviewClassifierService(workspaces);
  const unknown = createMetadataFile({
    relativePath: 'plain.unknown',
    size: 12,
    bytes: Buffer.from('readable text')
  });
  const unknownDescriptor = await service.describe(unknown.file);
  assert.equal(unknownDescriptor.kind, 'text');
  assert.equal(unknownDescriptor.language, 'plaintext');
  assert.equal(unknownDescriptor.mimeType, 'text/plain; charset=utf-8');
  assert.equal('displayPath' in unknownDescriptor, false);
  assert.doesNotMatch(JSON.stringify(unknownDescriptor), /\/workspace\//u);
  assert.equal(unknown.bodyReadCount(), 0);
  assert.equal((await service.readText(unknown.file, 'monaco')).text, 'readable text');

  const renamedZip = createMetadataFile({
    relativePath: 'archive.js',
    size: 7,
    bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x00])
  });
  assert.equal((await service.describe(renamedZip.file)).kind, 'text');
  assert.equal(renamedZip.bodyReadCount(), 0);
});

test('media catalogs are exact and recognized unsupported formats never issue decoder work', async () => {
  const supported = {
    image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.ico', '.svg'],
    audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'],
    video: ['.mp4', '.webm', '.ogv', '.mov', '.m4v']
  };
  for (const [kind, extensions] of Object.entries(supported)) {
    for (const extension of extensions) {
      assert.equal(runtime.classifyOnlyPreviewExtension(`fixture${extension}`), kind, extension);
    }
  }

  const workspaces = { assertOpenedFileCurrent: async () => undefined };
  const service = new runtime.OnlyPreviewClassifierService(workspaces);
  for (const [category, extensions] of [
    ['image-format', ['.heic', '.heif', '.tif', '.tiff', '.raw']],
    ['video-container', ['.mkv', '.avi', '.wmv', '.flv']]
  ]) {
    for (const extension of extensions) {
      const candidate = createMetadataFile({
        relativePath: `fixture${extension.toUpperCase()}`,
        size: 16,
        bytes: Buffer.alloc(16, 0xff)
      });
      const descriptor = await service.describe(candidate.file);
      assert.equal(descriptor.kind, 'unsupported', extension);
      assert.equal(descriptor.unsupportedCategory, category, extension);
      assert.equal(descriptor.assetUrl, undefined, extension);
      assert.equal(candidate.bodyReadCount(), 0, extension);
    }
  }

  for (const relativePath of ['legacy.doc', 'legacy.xls', 'legacy.ppt']) {
    const legacyOfficeFile = createMetadataFile({
      relativePath,
      size: 4,
      bytes: Buffer.alloc(4)
    });
    assert.equal((await service.describe(legacyOfficeFile.file)).kind, 'unsupported', relativePath);
    assert.equal(legacyOfficeFile.bodyReadCount(), 0, relativePath);
  }

  for (const relativePath of ['fixture.heicx', 'fixture.raw2', 'fixture.mkvs', 'fixture.bin']) {
    const candidate = createMetadataFile({ relativePath, size: 4, bytes: Buffer.alloc(4) });
    const descriptor = await service.describe(candidate.file);
    assert.equal(descriptor.kind, 'text', relativePath);
    assert.equal(descriptor.language, 'plaintext', relativePath);
    assert.equal(descriptor.unsupportedCategory, undefined, relativePath);
    assert.equal(candidate.bodyReadCount(), 0, relativePath);
  }
});

test('reviewed SVG, AAC, and QuickTime signatures stay broad enough without accepting malformed atoms', async () => {
  const workspaces = { assertOpenedFileCurrent: async () => undefined };
  const service = new runtime.OnlyPreviewClassifierService(workspaces);
  const fixtures = [
    [
      'commented.svg',
      Buffer.from(
        '\uFEFF <?xml version="1.0"?>\n<!-- generated -->\n<!DOCTYPE svg [<!ENTITY x "ok">]>\n<svg viewBox="0 0 1 1">'
      )
    ],
    ['adif.aac', Buffer.from('ADIFfixture')],
    ...['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip'].map((atomType) => {
      const bytes = Buffer.alloc(16);
      bytes.writeUInt32BE(16, 0);
      bytes.write(atomType, 4, 4, 'ascii');
      return [`${atomType}.mov`, bytes];
    })
  ];
  for (const [relativePath, bytes] of fixtures) {
    const candidate = createMetadataFile({ relativePath, size: bytes.length, bytes });
    assert.equal((await service.describe(candidate.file)).previewError, undefined, relativePath);
  }

  const malformedAtom = Buffer.alloc(16);
  malformedAtom.writeUInt32BE(4, 0);
  malformedAtom.write('moov', 4, 4, 'ascii');
  const malformed = createMetadataFile({
    relativePath: 'malformed.mov',
    size: malformedAtom.length,
    bytes: malformedAtom
  });
  assert.equal((await service.describe(malformed.file)).previewError?.code, 'SIGNATURE_MISMATCH');

  const truncatedPng = createMetadataFile({
    relativePath: 'truncated.png',
    size: 8,
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  });
  assert.equal(
    (await service.describe(truncatedPng.file)).previewError,
    undefined,
    'a valid header is admitted for the renderer decoder to classify the truncated payload'
  );
});

test('empty supported image and media are classified before signature reads', async () => {
  const workspaces = { assertOpenedFileCurrent: async () => undefined };
  const service = new runtime.OnlyPreviewClassifierService(workspaces);
  for (const [relativePath, errorCode] of [
    ['empty.png', 'IMAGE_EMPTY'],
    ['empty.mp3', 'MEDIA_EMPTY'],
    ['empty.mp4', 'MEDIA_EMPTY'],
    ['empty.drawio', 'DIAGRAM_EMPTY']
  ]) {
    const candidate = createMetadataFile({ relativePath, size: 0 });
    const descriptor = await service.describe(candidate.file);
    assert.equal(descriptor.previewError?.code, errorCode, relativePath);
    assert.equal(candidate.bodyReadCount(), 0, relativePath);
  }
});

test('size-first metadata gates read zero body bytes at adapter limit plus one', async () => {
  const workspaces = { assertOpenedFileCurrent: async () => undefined };
  const service = new runtime.OnlyPreviewClassifierService(workspaces);
  for (const fixture of [
    ['huge.vue', 1024 ** 3],
    ['huge.unknown', runtime.ONLY_PREVIEW_MAX_TEXT_BYTES + 1],
    ['notes.md', runtime.ONLY_PREVIEW_MAX_MARKDOWN_BYTES + 1],
    ['page.html', runtime.ONLY_PREVIEW_MAX_HTML_BYTES + 1],
    ['photo.png', runtime.ONLY_PREVIEW_MAX_IMAGE_BYTES + 1],
    ['manual.pdf', runtime.ONLY_PREVIEW_MAX_PDF_BYTES + 1],
    ['book.xlsx', runtime.ONLY_PREVIEW_MAX_SHEET_BYTES + 1],
    ['document.docx', runtime.ONLY_PREVIEW_MAX_DOCUMENT_BYTES + 1],
    ['slides.pptx', runtime.ONLY_PREVIEW_MAX_PRESENTATION_BYTES + 1],
    ['diagram.drawio', runtime.ONLY_PREVIEW_MAX_DIAGRAM_BYTES + 1]
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

  assert.equal(runtime.ONLY_PREVIEW_DEFAULT_FILE_SIZE_LIMIT_BYTES, 10 * 1024 * 1024);
  assert.equal(runtime.getOnlyPreviewFileSizeLimit('unsupported'), 10 * 1024 * 1024);
  assert.equal(runtime.getOnlyPreviewFileSizeLimit('drawio-viewer'), 20 * 1024 * 1024);
  const largeDiagram = createMetadataFile({
    relativePath: 'large.drawio',
    size: 11 * 1024 * 1024
  });
  assert.equal((await service.describe(largeDiagram.file)).previewError, undefined);
  assert.equal(largeDiagram.bodyReadCount(), 0);
});

test('unknown search text uses the 1 MiB size-first admission gate without body sniffing', async () => {
  const openedStat = (size) => ({
    dev: 1,
    ino: 2,
    size,
    mtimeMs: 3,
    isFile: () => true
  });
  const createHandle = (bytes, stat) => {
    let readCount = 0;
    let highestRequestedOffset = 0;
    return {
      handle: {
        read: async (target, offset, length, position) => {
          readCount += 1;
          highestRequestedOffset = Math.max(highestRequestedOffset, position + length);
          const available = Math.max(0, Math.min(length, bytes.length - position));
          if (available > 0) bytes.copy(target, offset, position, position + available);
          return { bytesRead: available, buffer: target };
        },
        stat: async () => stat
      },
      readCount: () => readCount,
      highestRequestedOffset: () => highestRequestedOffset
    };
  };

  const exactStat = openedStat(MAX_TEXT_BYTES);
  const exact = createHandle(Buffer.alloc(MAX_TEXT_BYTES, 0x61), exactStat);
  const exactResult = await readClassifiedSearchContent({
    handle: exact.handle,
    relativePath: 'AGENTS.md.bak',
    openedStat: exactStat
  });
  assert.equal(exactResult.mediaType, 'text');
  assert.equal(exactResult.contentIndexed, true);
  assert.equal(exactResult.originalContent.length, MAX_TEXT_BYTES);
  assert.ok(exact.readCount() > 0);
  assert.equal(exact.highestRequestedOffset(), MAX_TEXT_BYTES);

  const tooLargeStat = openedStat(MAX_TEXT_BYTES + 1);
  const tooLarge = createHandle(Buffer.alloc(0), tooLargeStat);
  assert.deepEqual(
    await readClassifiedSearchContent({
      handle: tooLarge.handle,
      relativePath: 'large.arbitrary',
      openedStat: tooLargeStat
    }),
    {
      mediaType: 'text',
      contentIndexed: false,
      originalContent: ''
    }
  );
  assert.equal(tooLarge.readCount(), 0);

  const packageStat = openedStat(4);
  const packageFile = createHandle(Buffer.from([0x50, 0x4b, 0x03, 0x04]), packageStat);
  assert.deepEqual(
    await readClassifiedSearchContent({
      handle: packageFile.handle,
      relativePath: 'workbook.xlsx',
      openedStat: packageStat
    }),
    {
      mediaType: 'unknown',
      contentIndexed: false,
      originalContent: ''
    }
  );
  assert.equal(packageFile.readCount(), 0);
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
    ['fake.docx', Buffer.from('not zip'), 'document'],
    ['fake.pptx', Buffer.from('not zip'), 'presentation']
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
    ],
    [
      'exact.pptx',
      runtime.ONLY_PREVIEW_MAX_PRESENTATION_BYTES,
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      'presentation'
    ],
    ['exact.drawio', runtime.ONLY_PREVIEW_MAX_DIAGRAM_BYTES, Buffer.alloc(0), 'diagram']
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
