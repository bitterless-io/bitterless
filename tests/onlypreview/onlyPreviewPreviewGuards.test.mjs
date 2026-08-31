/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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

const createRegistries = () => {
  const hosts = new runtime.OnlyPreviewHostRegistry();
  const workspaces = new runtime.OnlyPreviewWorkspaceRegistry(hosts);
  const assets = new runtime.OnlyPreviewAssetRegistry(hosts, workspaces);
  return { hosts, workspaces, assets };
};

const expectOnlyPreviewError = (code) => (error) =>
  error instanceof runtime.OnlyPreviewContractError && error.code === code;

const createMetadataFile = ({ relativePath, size, bytes = Buffer.alloc(0) }) => {
  let sampleReadCount = 0;
  return {
    file: {
      workspaceId: 'workspace-id',
      relativePath,
      size,
      modifiedAt: 1
    },
    bytes,
    readSample: () => {
      sampleReadCount += 1;
      return new Uint8Array(bytes);
    },
    sampleReadCount: () => sampleReadCount
  };
};

const createPreparedSelection = (descriptor, selectionRevision = 1) => ({
  grantId: `preview-grant-${selectionRevision}`,
  selectionRevision,
  workspaceId: descriptor.workspaceId,
  workspaceGeneration: 1,
  relativePath: descriptor.relativePath,
  runtimeInstanceId: 'hidden-preview-runtime',
  descriptor
});

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

  const service = new runtime.OnlyPreviewClassifierService();
  const unknown = createMetadataFile({
    relativePath: 'plain.unknown',
    size: Buffer.byteLength('readable text'),
    bytes: Buffer.from('readable text')
  });
  const unknownDescriptor = service.describe(unknown.file);
  assert.equal(unknownDescriptor.kind, 'text');
  assert.equal(unknownDescriptor.language, 'plaintext');
  assert.equal(unknownDescriptor.mimeType, 'text/plain; charset=utf-8');
  assert.equal('displayPath' in unknownDescriptor, false);
  assert.doesNotMatch(JSON.stringify(unknownDescriptor), /\/workspace\//u);
  assert.equal(unknown.sampleReadCount(), 0);
  assert.equal(service.decodeText(unknown.file, 'monaco', unknown.bytes).text, 'readable text');

  const renamedZip = createMetadataFile({
    relativePath: 'archive.js',
    size: 7,
    bytes: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff, 0x00])
  });
  assert.equal(service.describe(renamedZip.file).kind, 'text');
  assert.equal(renamedZip.sampleReadCount(), 0);
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

  const service = new runtime.OnlyPreviewClassifierService();
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
      const descriptor = service.describe(candidate.file);
      assert.equal(descriptor.kind, 'unsupported', extension);
      assert.equal(descriptor.unsupportedCategory, category, extension);
      assert.equal(descriptor.assetUrl, undefined, extension);
      assert.equal(candidate.sampleReadCount(), 0, extension);
    }
  }

  for (const relativePath of ['legacy.doc', 'legacy.xls', 'legacy.ppt']) {
    const legacyOfficeFile = createMetadataFile({
      relativePath,
      size: 4,
      bytes: Buffer.alloc(4)
    });
    assert.equal(service.describe(legacyOfficeFile.file).kind, 'unsupported', relativePath);
    assert.equal(legacyOfficeFile.sampleReadCount(), 0, relativePath);
  }

  for (const relativePath of ['fixture.heicx', 'fixture.raw2', 'fixture.mkvs', 'fixture.bin']) {
    const candidate = createMetadataFile({ relativePath, size: 4, bytes: Buffer.alloc(4) });
    const descriptor = service.describe(candidate.file);
    assert.equal(descriptor.kind, 'text', relativePath);
    assert.equal(descriptor.language, 'plaintext', relativePath);
    assert.equal(descriptor.unsupportedCategory, undefined, relativePath);
    assert.equal(candidate.sampleReadCount(), 0, relativePath);
  }
});

test('reviewed SVG, AAC, and QuickTime signatures stay broad enough without accepting malformed atoms', async () => {
  const service = new runtime.OnlyPreviewClassifierService();
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
    assert.equal(
      service.describe(candidate.file, candidate.readSample()).previewError,
      undefined,
      relativePath
    );
  }

  const malformedAtom = Buffer.alloc(16);
  malformedAtom.writeUInt32BE(4, 0);
  malformedAtom.write('moov', 4, 4, 'ascii');
  const malformed = createMetadataFile({
    relativePath: 'malformed.mov',
    size: malformedAtom.length,
    bytes: malformedAtom
  });
  assert.equal(
    service.describe(malformed.file, malformed.readSample()).previewError?.code,
    'SIGNATURE_MISMATCH'
  );

  const truncatedPng = createMetadataFile({
    relativePath: 'truncated.png',
    size: 8,
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  });
  assert.equal(
    service.describe(truncatedPng.file, truncatedPng.readSample()).previewError,
    undefined,
    'a valid header is admitted for the renderer decoder to classify the truncated payload'
  );
});

test('empty supported image and media are classified before signature reads', async () => {
  const service = new runtime.OnlyPreviewClassifierService();
  for (const [relativePath, errorCode] of [
    ['empty.png', 'IMAGE_EMPTY'],
    ['empty.mp3', 'MEDIA_EMPTY'],
    ['empty.mp4', 'MEDIA_EMPTY'],
    ['empty.drawio', 'DIAGRAM_EMPTY']
  ]) {
    const candidate = createMetadataFile({ relativePath, size: 0 });
    const descriptor = service.describe(candidate.file);
    assert.equal(descriptor.previewError?.code, errorCode, relativePath);
    assert.equal(candidate.sampleReadCount(), 0, relativePath);
  }
});

test('size-first metadata gates read zero body bytes at adapter limit plus one', async () => {
  const service = new runtime.OnlyPreviewClassifierService();
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
    const descriptor = service.describe(candidate.file);
    assert.equal(descriptor.previewError?.code, 'TEXT_TOO_LARGE', fixture[0]);
    assert.equal(candidate.sampleReadCount(), 0, fixture[0]);
  }

  const markdownSource = createMetadataFile({
    relativePath: 'notes.markdown',
    size: runtime.ONLY_PREVIEW_MAX_MARKDOWN_BYTES + 1
  });
  assert.equal(service.describe(markdownSource.file).previewError, undefined);
  assert.equal(markdownSource.sampleReadCount(), 0);

  assert.equal(runtime.ONLY_PREVIEW_DEFAULT_FILE_SIZE_LIMIT_BYTES, 10 * 1024 * 1024);
  assert.equal(runtime.getOnlyPreviewFileSizeLimit('unsupported'), 10 * 1024 * 1024);
  assert.equal(runtime.getOnlyPreviewFileSizeLimit('drawio-viewer'), 20 * 1024 * 1024);
  const largeDiagram = createMetadataFile({
    relativePath: 'large.drawio',
    size: 11 * 1024 * 1024
  });
  assert.equal(service.describe(largeDiagram.file).previewError, undefined);
  assert.equal(largeDiagram.sampleReadCount(), 0);
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
  const service = new runtime.OnlyPreviewClassifierService();
  const decode = (relativePath, adapterId, bytes, size = bytes.byteLength) =>
    service.decodeText(
      { workspaceId: 'workspace-id', relativePath, size, modifiedAt: 1 },
      adapterId,
      bytes
    );

  const garbage = decode('garbage.js', 'monaco', Buffer.from([0x50, 0x4b, 0x00, 0xff, 0xc3, 0x28]));
  assert.equal(garbage.text.includes('\0'), true);
  assert.match(garbage.text, /\uFFFD/u);

  assert.equal(
    decode('odd-le.txt', 'monaco', Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69])).text,
    'h\uFFFD'
  );
  assert.equal(
    decode('odd-be.txt', 'monaco', Buffer.from([0xfe, 0xff, 0x00, 0x68, 0x00])).text,
    'h\uFFFD'
  );

  const exactMarkdown = Buffer.alloc(runtime.ONLY_PREVIEW_MAX_MARKDOWN_BYTES, 0x61);
  assert.equal(
    decode('exact.md', 'markdown-dom', exactMarkdown).size,
    runtime.ONLY_PREVIEW_MAX_MARKDOWN_BYTES
  );
  assert.throws(
    () =>
      decode(
        'plus-one.md',
        'markdown-dom',
        Buffer.alloc(0),
        runtime.ONLY_PREVIEW_MAX_MARKDOWN_BYTES + 1
      ),
    expectOnlyPreviewError('TEXT_TOO_LARGE')
  );

  const exactMonaco = Buffer.alloc(runtime.ONLY_PREVIEW_MAX_TEXT_BYTES, 0x61);
  assert.equal(
    decode('exact.markdown', 'monaco', exactMonaco).size,
    runtime.ONLY_PREVIEW_MAX_TEXT_BYTES
  );
  assert.throws(
    () =>
      decode(
        'plus-one.markdown',
        'monaco',
        Buffer.alloc(0),
        runtime.ONLY_PREVIEW_MAX_TEXT_BYTES + 1
      ),
    expectOnlyPreviewError('TEXT_TOO_LARGE')
  );
});

test('native signatures stay mandatory, Office admission stays preload-only, and asset grants stay bounded', async () => {
  const service = new runtime.OnlyPreviewClassifierService();
  for (const [relativePath, bytes, expectedKind] of [
    ['fake.pdf', Buffer.from('not pdf'), 'pdf'],
    ['fake.png', Buffer.from('not png'), 'image'],
    ['fake.mp4', Buffer.from('not video'), 'video']
  ]) {
    const candidate = createMetadataFile({ relativePath, size: bytes.length, bytes });
    const descriptor = service.describe(candidate.file, candidate.readSample());
    assert.equal(descriptor.kind, expectedKind);
    assert.equal(descriptor.previewError?.code, 'SIGNATURE_MISMATCH');
    assert.equal(candidate.sampleReadCount(), 1);
    assert.equal(descriptor.assetUrl, undefined);
  }

  for (const [relativePath, bytes, expectedKind] of [
    ['fake.xlsx', Buffer.from('not zip'), 'sheet'],
    ['fake.docx', Buffer.from('not zip'), 'document'],
    ['fake.pptx', Buffer.from('not zip'), 'presentation']
  ]) {
    const candidate = createMetadataFile({ relativePath, size: bytes.length, bytes });
    const descriptor = service.describe(candidate.file);
    assert.equal(descriptor.kind, expectedKind);
    assert.equal(descriptor.previewError, undefined);
    assert.equal(candidate.sampleReadCount(), 0);
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
    const descriptor = service.describe(
      candidate.file,
      expectedKind === 'pdf' || expectedKind === 'image' ? candidate.readSample() : undefined
    );
    assert.equal(descriptor.kind, expectedKind, relativePath);
    assert.equal(descriptor.previewError, undefined, relativePath);
  }

  const { hosts, assets } = createRegistries();
  const host = hosts.issue('standalone', 'content');
  const stableMedia = createMetadataFile({
    relativePath: 'stable.mp4',
    size: 10,
    bytes: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])
  });
  const stableDescriptor = service.describe(stableMedia.file, stableMedia.readSample());
  const stableSelection = createPreparedSelection(stableDescriptor);
  assert.throws(
    () => assets.issue(host.hostToken, stableSelection, 'video/mp4', { maxBytes: 10 }),
    expectOnlyPreviewError('INVALID_INPUT')
  );
  assert.throws(
    () =>
      assets.issue(host.hostToken, stableSelection, 'video/mp4', {
        selectionRevision: 1,
        maxBytes: Number.POSITIVE_INFINITY
      }),
    expectOnlyPreviewError('INVALID_INPUT')
  );
  assert.match(
    assets.issue(host.hostToken, stableSelection, 'video/mp4', {
      selectionRevision: 1,
      maxBytes: stableDescriptor.size
    }),
    /^bitterless-preview:\/\/asset\//u
  );
});

test('large stable media retains exact-size range delivery without a preview cap', async () => {
  const mediaSize = runtime.ONLY_PREVIEW_MAX_PDF_BYTES + 1024;
  const candidate = createMetadataFile({
    relativePath: 'large.mp4',
    size: mediaSize,
    bytes: Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])
  });
  const service = new runtime.OnlyPreviewClassifierService();
  const descriptor = service.describe(candidate.file, candidate.readSample());
  assert.equal(descriptor.previewError, undefined);

  const { hosts, assets } = createRegistries();
  const host = hosts.issue('standalone', 'content');
  const url = assets.issue(host.hostToken, createPreparedSelection(descriptor), 'video/mp4', {
    selectionRevision: 1,
    maxBytes: descriptor.size,
    lifetime: 'selection'
  });
  assert.match(url, /^bitterless-preview:\/\/asset\//u);
});
