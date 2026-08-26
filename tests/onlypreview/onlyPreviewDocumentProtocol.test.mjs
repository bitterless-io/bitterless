/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import ts from 'typescript';

const root = process.cwd();
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8');
const nodeRequire = createRequire(import.meta.url);

const loadTypeScriptModule = (relativePath, dependencies) => {
  const transpiled = ts.transpileModule(source(relativePath), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: relativePath,
    reportDiagnostics: true
  });
  const errors = (transpiled.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
  );
  assert.deepEqual(
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    []
  );
  const loaded = { exports: {} };
  const localRequire = (specifier) => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    if (specifier.startsWith('.') || specifier.startsWith('@')) {
      throw new Error(`Missing test dependency ${specifier} for ${relativePath}`);
    }
    return nodeRequire(specifier);
  };
  const execute = new Function(
    'require',
    'module',
    'exports',
    `${transpiled.outputText}\n//# sourceURL=${join(root, relativePath)}`
  );
  execute(localRequire, loaded, loaded.exports);
  return loaded.exports;
};

class ContractError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const normalizeRelativePath = (value) => {
  if (
    typeof value !== 'string' ||
    !value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new ContractError('INVALID_INPUT', 'invalid path');
  }
  return value;
};

const inertHosts = {
  isLive: () => true,
  onRevoke: () => () => {}
};
const inertWorkspaces = { onRevoke: () => () => {} };
const sharedTypes = {
  ONLY_PREVIEW_SCHEME: 'bitterless-preview',
  ONLY_PREVIEW_MAX_HTML_BYTES: 16,
  ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES: 10,
  ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES: 12
};
const contracts = {
  normalizeOnlyPreviewRelativePath: normalizeRelativePath,
  OnlyPreviewContractError: ContractError
};
/** `network` delivery hands the admitted range to Chromium instead of reading it in this process. */
const NETWORK_DELIVERY_BYTES = Buffer.from('abcdefgh');
const netFetchCalls = [];
const fakeNet = {
  // Mirrors the measured Electron behavior: `file:` fetches honour Range at the byte level but
  // answer 200 with no range headers, so the 206 contract must be synthesized by the caller.
  fetch: async (url, init) => {
    netFetchCalls.push({ url, init });
    const requestedRange = /^bytes=(\d+)-(\d+)$/.exec(init?.headers?.Range ?? '');
    const slice = requestedRange
      ? NETWORK_DELIVERY_BYTES.subarray(Number(requestedRange[1]), Number(requestedRange[2]) + 1)
      : NETWORK_DELIVERY_BYTES;
    return new Response(slice, { status: 200 });
  }
};
const assetModule = loadTypeScriptModule('src/main/onlypreview/onlyPreviewAsset.registry.ts', {
  electron: { net: fakeNet },
  '@shared/onlypreview/onlyPreview.contract': contracts,
  '@shared/onlypreview/onlyPreview.types': sharedTypes,
  './onlyPreviewHost.registry': { onlyPreviewHostRegistry: inertHosts },
  './onlyPreviewWorkspace.registry': { onlyPreviewWorkspaceRegistry: inertWorkspaces }
});

const createRequest = (url, method = 'GET', headers = {}) => ({
  url,
  method,
  headers: new Headers(headers),
  signal: new AbortController().signal
});

const createOpenedFile = (relativePath, bytes, createStream, identity = {}) => ({
  host: { hostToken: 'host-token' },
  workspace: { workspaceId: 'workspace-token', rootRealPath: '/workspace' },
  relativePath,
  realPath: identity.realPath ?? `/workspace/${relativePath}`,
  size: bytes.length,
  modifiedAt: 1,
  modifiedTimeNanoseconds: identity.modifiedTimeNanoseconds ?? 1n,
  deviceId: identity.deviceId ?? 1n,
  inode: identity.inode ?? 1n,
  fileHandle: {
    close: async () => {},
    stat: async () => ({
      size: BigInt(bytes.length),
      dev: identity.deviceId ?? 1n,
      ino: identity.inode ?? 1n,
      mtimeNs: identity.modifiedTimeNanoseconds ?? 1n
    }),
    createReadStream:
      createStream ??
      ((options) =>
        Readable.from(bytes.subarray(options.start, options.end + 1), {
          objectMode: false
        }))
  }
});

const createDocumentHarness = (files) => {
  const directoryState = {
    realPath: null,
    deviceId: 7n,
    inode: 13n,
    isDirectory: true
  };
  const workspaces = {
    onRevoke: () => () => {},
    openFile: async (_hostToken, fileRef) => {
      const factory = files.get(fileRef.relativePath);
      if (!factory) throw new Error('missing');
      return factory();
    }
  };
  const module = loadTypeScriptModule('src/main/onlypreview/onlyPreviewDocument.registry.ts', {
    '@shared/onlypreview/onlyPreview.contract': contracts,
    '@shared/onlypreview/onlyPreview.types': sharedTypes,
    'node:fs/promises': {
      realpath: async (path) => directoryState.realPath ?? path,
      stat: async () => ({
        isDirectory: () => directoryState.isDirectory,
        dev: directoryState.deviceId,
        ino: directoryState.inode
      })
    },
    './onlyPreviewAsset.registry': assetModule,
    './onlyPreviewHost.registry': { onlyPreviewHostRegistry: inertHosts },
    './onlyPreviewWorkspace.registry': { onlyPreviewWorkspaceRegistry: workspaces }
  });
  return {
    registry: new module.OnlyPreviewDocumentRegistry(inertHosts, workspaces),
    files,
    directoryState
  };
};

const createRealDocumentHarness = (workspaceRoot) => {
  const workspaces = {
    onRevoke: () => () => {},
    openFile: async (_hostToken, fileRef) => {
      const targetPath = join(workspaceRoot, ...fileRef.relativePath.split('/'));
      const fileHandle = await open(targetPath, 'r');
      const stats = await fileHandle.stat({ bigint: true });
      return {
        host: { hostToken: 'host-token' },
        workspace: { workspaceId: 'workspace-token', rootRealPath: workspaceRoot },
        relativePath: fileRef.relativePath,
        realPath: await realpath(targetPath),
        size: Number(stats.size),
        modifiedAt: Number(stats.mtimeMs),
        deviceId: stats.dev,
        inode: stats.ino,
        modifiedTimeNanoseconds: stats.mtimeNs,
        fileHandle
      };
    }
  };
  const module = loadTypeScriptModule('src/main/onlypreview/onlyPreviewDocument.registry.ts', {
    '@shared/onlypreview/onlyPreview.contract': contracts,
    '@shared/onlypreview/onlyPreview.types': sharedTypes,
    './onlyPreviewAsset.registry': assetModule,
    './onlyPreviewHost.registry': { onlyPreviewHostRegistry: inertHosts },
    './onlyPreviewWorkspace.registry': { onlyPreviewWorkspaceRegistry: workspaces }
  });
  return {
    registry: new module.OnlyPreviewDocumentRegistry(inertHosts, workspaces),
    openFile: (relativePath) =>
      workspaces.openFile('host-token', { workspaceId: 'workspace-token', relativePath })
  };
};

test('document protocol is revision scoped and rejects ambiguous paths', () => {
  const registry = source('src/main/onlypreview/onlyPreviewDocument.registry.ts');

  assert.match(registry, /selectionRevision:\s*number/);
  assert.match(registry, /entryDirectoryRelativePath/);
  assert.match(registry, /decodeURIComponent/);
  assert.match(registry, /%2f\|%5c/i);
  assert.match(registry, /segment === '\.' \|\|\s*segment === '\.\.'/);
  assert.match(registry, /normalizeOnlyPreviewRelativePath/);
  assert.match(registry, /workspaces\.openFile/);
  assert.match(registry, /revokeSelection/);
  assert.match(registry, /activeStreams/);
});

test('document registry streams contained resources, budgets responses, and aborts on revoke', async () => {
  const entryBytes = Buffer.from('hello');
  const scriptBytes = Buffer.from('12345678');
  const files = new Map([
    ['pages/index.html', () => createOpenedFile('pages/index.html', entryBytes)],
    ['pages/assets/app.js', () => createOpenedFile('pages/assets/app.js', scriptBytes)]
  ]);
  const { registry } = createDocumentHarness(files);
  const entry = createOpenedFile('pages/index.html', entryBytes);
  const entryUrl = await registry.issue(entry, 4);

  const entryResponse = await registry.respond(createRequest(entryUrl));
  assert.equal(entryResponse.status, 200);
  assert.equal(entryResponse.headers.get('access-control-allow-origin'), null);
  assert.equal(entryResponse.headers.get('x-dns-prefetch-control'), 'off');
  assert.match(entryResponse.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
  assert.match(entryResponse.headers.get('content-security-policy') ?? '', /webrtc 'block'/);
  assert.match(
    entryResponse.headers.get('content-security-policy') ?? '',
    /script-src 'self' 'unsafe-inline'/
  );
  assert.equal(await entryResponse.text(), 'hello');

  const scriptUrl = entryUrl.replace('/index.html', '/assets/app.js');
  const budgetResponse = await registry.respond(createRequest(scriptUrl));
  assert.equal(budgetResponse.status, 429, '5 + 8 accepted bytes exceeds the 12-byte harness cap');

  const traversal = await registry.respond(
    createRequest(entryUrl.replace('/index.html', '/%2e%2e/secret.js'))
  );
  assert.equal(traversal.status, 404);
  const encodedSeparator = await registry.respond(
    createRequest(entryUrl.replace('/index.html', '/assets%2Fapp.js'))
  );
  assert.equal(encodedSeparator.status, 404);

  let activeStream;
  files.set('pages/index.html', () =>
    createOpenedFile('pages/index.html', entryBytes, () => {
      activeStream = new Readable({ read: () => undefined });
      return activeStream;
    })
  );
  const secondRegistry = createDocumentHarness(files).registry;
  const secondUrl = await secondRegistry.issue(entry, 9);
  const streamingResponse = await secondRegistry.respond(createRequest(secondUrl));
  assert.equal(streamingResponse.status, 200);
  assert.equal(activeStream.destroyed, false);
  const bodyRead = streamingResponse.text();
  secondRegistry.revokeSelection('host-token', 9);
  assert.equal(activeStream.destroyed, true, 'revocation destroys the active file stream');
  await assert.rejects(bodyRead, 'revocation also terminates the consumer-facing response body');
  assert.equal((await secondRegistry.respond(createRequest(secondUrl))).status, 404);
});

test('document registry rejects same-size identity replacement and over-limit relative assets', async () => {
  const originalEntry = Buffer.from('hello');
  const files = new Map([
    [
      'index.html',
      () => createOpenedFile('index.html', originalEntry, undefined, { deviceId: 1n, inode: 8n })
    ],
    ['large.js', () => createOpenedFile('large.js', Buffer.alloc(11))]
  ]);
  const { registry } = createDocumentHarness(files);
  const entry = createOpenedFile('index.html', originalEntry, undefined, {
    deviceId: 1n,
    inode: 7n
  });
  const entryUrl = await registry.issue(entry, 2);
  assert.equal((await registry.respond(createRequest(entryUrl))).status, 409);

  files.set('index.html', () =>
    createOpenedFile('index.html', originalEntry, undefined, { deviceId: 1n, inode: 7n })
  );
  const replacementEntry = createOpenedFile('index.html', originalEntry, undefined, {
    deviceId: 1n,
    inode: 7n
  });
  const replacementUrl = await registry.issue(replacementEntry, 3);
  const largeUrl = replacementUrl.replace('/index.html', '/large.js');
  assert.equal((await registry.respond(createRequest(largeUrl))).status, 413);
});

test('document registry revokes the token when the entry is replaced before a resource request', async () => {
  const entryBytes = Buffer.from('html');
  const files = new Map([
    [
      'pages/index.html',
      () => createOpenedFile('pages/index.html', entryBytes, undefined, { inode: 21n })
    ],
    [
      'pages/new.js',
      () => createOpenedFile('pages/new.js', Buffer.from('new'), undefined, { inode: 22n })
    ]
  ]);
  const { registry } = createDocumentHarness(files);
  const entry = createOpenedFile('pages/index.html', entryBytes, undefined, { inode: 21n });
  const entryUrl = await registry.issue(entry, 3);
  const resourceUrl = entryUrl.replace('/index.html', '/new.js');

  files.set('pages/index.html', () =>
    createOpenedFile('pages/index.html', entryBytes, undefined, { inode: 99n })
  );
  assert.equal((await registry.respond(createRequest(resourceUrl))).status, 409);
  assert.equal((await registry.respond(createRequest(resourceUrl))).status, 404);
});

test('document registry pins relative resource identity and canonical entry directory', async () => {
  const entryBytes = Buffer.from('html');
  const resourceBytes = Buffer.from('js');
  const files = new Map([
    [
      'pages/index.html',
      () => createOpenedFile('pages/index.html', entryBytes, undefined, { inode: 10n })
    ],
    [
      'pages/app.js',
      () => createOpenedFile('pages/app.js', resourceBytes, undefined, { inode: 11n })
    ],
    [
      'pages/file-link.js',
      () =>
        createOpenedFile('pages/file-link.js', resourceBytes, undefined, {
          inode: 12n,
          realPath: '/workspace/private.js'
        })
    ],
    [
      'pages/dir-link/app.js',
      () =>
        createOpenedFile('pages/dir-link/app.js', resourceBytes, undefined, {
          inode: 13n,
          realPath: '/workspace/private/app.js'
        })
    ]
  ]);
  const { registry } = createDocumentHarness(files);
  const entry = createOpenedFile('pages/index.html', entryBytes, undefined, { inode: 10n });
  const entryUrl = await registry.issue(entry, 7);
  const resourceUrl = entryUrl.replace('/index.html', '/app.js');
  assert.equal((await registry.respond(createRequest(resourceUrl))).status, 200);

  files.set('pages/app.js', () =>
    createOpenedFile('pages/app.js', resourceBytes, undefined, { inode: 99n })
  );
  assert.equal((await registry.respond(createRequest(resourceUrl))).status, 409);
  files.set('pages/app.js', () =>
    createOpenedFile('pages/app.js', resourceBytes, undefined, {
      inode: 11n,
      realPath: '/workspace/pages/repointed.js'
    })
  );
  assert.equal((await registry.respond(createRequest(resourceUrl))).status, 409);
  assert.equal(
    (await registry.respond(createRequest(entryUrl.replace('/index.html', '/file-link.js'))))
      .status,
    404
  );
  assert.equal(
    (await registry.respond(createRequest(entryUrl.replace('/index.html', '/dir-link/app.js'))))
      .status,
    404
  );
});

test('document registry rejects a same-path entry-directory replacement before a new resource opens', async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'onlypreview-document-directory-'));
  const pagesPath = join(workspaceRoot, 'pages');
  const retiredPagesPath = join(workspaceRoot, 'retired-pages');
  mkdirSync(pagesPath);
  writeFileSync(join(pagesPath, 'index.html'), 'html');
  writeFileSync(join(pagesPath, 'app.js'), 'old');
  const { registry, openFile } = createRealDocumentHarness(await realpath(workspaceRoot));

  try {
    const entry = await openFile('pages/index.html');
    const entryUrl = await registry.issue(entry, 8);
    await entry.fileHandle.close();

    renameSync(pagesPath, retiredPagesPath);
    mkdirSync(pagesPath);
    writeFileSync(join(pagesPath, 'index.html'), 'html');
    writeFileSync(join(pagesPath, 'new.js'), 'new');

    const response = await registry.respond(
      createRequest(entryUrl.replace('/index.html', '/new.js'))
    );
    assert.equal(response.status, 409);
  } finally {
    registry.clear();
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('document resource streams reject real growth and same-size path replacement', async () => {
  for (const mutate of [
    (resourcePath) => writeFileSync(resourcePath, 'abcdef'),
    (resourcePath, replacementPath) => {
      writeFileSync(replacementPath, 'xyz');
      renameSync(replacementPath, resourcePath);
    }
  ]) {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'onlypreview-document-stream-'));
    const pagesPath = join(workspaceRoot, 'pages');
    const resourcePath = join(pagesPath, 'app.js');
    const replacementPath = join(pagesPath, 'replacement.js');
    mkdirSync(pagesPath);
    writeFileSync(join(pagesPath, 'index.html'), 'html');
    writeFileSync(resourcePath, 'abc');
    const { registry, openFile } = createRealDocumentHarness(await realpath(workspaceRoot));

    try {
      const entry = await openFile('pages/index.html');
      const entryUrl = await registry.issue(entry, 11);
      await entry.fileHandle.close();
      const response = await registry.respond(
        createRequest(entryUrl.replace('/index.html', '/app.js'))
      );
      assert.equal(response.status, 200);
      mutate(resourcePath, replacementPath);
      await assert.rejects(response.arrayBuffer());
    } finally {
      registry.clear();
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  }
});

test('bounded response rejects a stream that grows beyond its admitted stat', async () => {
  let sourceStream;
  const response = await assetModule.createOnlyPreviewFileResponse({
    request: createRequest('bitterless-preview://asset/token/file.bin'),
    fileHandle: {
      close: async () => {},
      createReadStream: () => {
        sourceStream = Readable.from(Buffer.from('grow'), { objectMode: false });
        return sourceStream;
      }
    },
    fileSize: 3,
    mimeType: 'application/octet-stream',
    maxBytes: 3
  });
  assert.equal(response.status, 200);
  await assert.rejects(response.arrayBuffer());
  assert.equal(sourceStream.destroyed, true);
});

test('asset registry rejects real file growth and same-size path replacement during streaming', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'onlypreview-stream-identity-'));
  const targetPath = join(directory, 'preview.pdf');
  const replacementPath = join(directory, 'replacement.pdf');
  const hosts = {
    isLive: () => true,
    onRevoke: () => () => {}
  };
  const openCurrent = async () => {
    const fileHandle = await open(targetPath, 'r');
    const stats = await fileHandle.stat({ bigint: true });
    return {
      host: { hostToken: 'host-token' },
      workspace: { workspaceId: 'workspace-token' },
      relativePath: 'preview.pdf',
      realPath: await realpath(targetPath),
      size: Number(stats.size),
      modifiedAt: Number(stats.mtimeMs),
      deviceId: stats.dev,
      inode: stats.ino,
      modifiedTimeNanoseconds: stats.mtimeNs,
      fileHandle
    };
  };
  const workspaces = {
    onRevoke: () => () => {},
    openFile: async () => openCurrent()
  };

  try {
    for (const mutate of [
      () => writeFileSync(targetPath, 'abcdef'),
      () => {
        writeFileSync(replacementPath, 'xyz');
        renameSync(replacementPath, targetPath);
      }
    ]) {
      writeFileSync(targetPath, 'abc');
      const issued = await openCurrent();
      const registry = new assetModule.OnlyPreviewAssetRegistry(hosts, workspaces);
      const assetUrl = registry.issue(issued, 'application/pdf', {
        selectionRevision: 1,
        maxBytes: 16
      });
      await issued.fileHandle.close();

      const head = await registry.respond(createRequest(assetUrl, 'HEAD'));
      assert.equal(head.status, 200);
      assert.equal(head.headers.get('access-control-allow-origin'), '*');
      assert.equal(head.headers.get('access-control-expose-headers'), 'Accept-Ranges');
      const range = await registry.respond(createRequest(assetUrl, 'GET', { Range: 'bytes=0-1' }));
      assert.equal(range.status, 206);
      assert.equal(range.headers.get('access-control-allow-origin'), '*');
      assert.equal(Buffer.from(await range.arrayBuffer()).toString(), 'ab');
      const unsatisfiable = await registry.respond(
        createRequest(assetUrl, 'GET', { Range: 'bytes=9-10' })
      );
      assert.equal(unsatisfiable.status, 416);
      assert.equal(unsatisfiable.headers.get('access-control-allow-origin'), '*');
      const options = await registry.respond(createRequest(assetUrl, 'OPTIONS'));
      assert.equal(options.status, 405);
      assert.equal(options.headers.get('access-control-allow-origin'), null);

      const response = await registry.respond(createRequest(assetUrl));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), '*');
      mutate();
      await assert.rejects(response.arrayBuffer());
      registry.clear();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('selection-lifetime media assets survive the legacy TTL until explicit selection revoke', async () => {
  const bytes = Buffer.from('media-bytes');
  const hosts = {
    isLive: () => true,
    onRevoke: () => () => {}
  };
  const workspaces = {
    onRevoke: () => () => {},
    openFile: async () => createOpenedFile('fixture.mp4', bytes)
  };
  const registry = new assetModule.OnlyPreviewAssetRegistry(hosts, workspaces);
  const originalNow = Date.now;
  let now = 1_700_000_000_000;
  Date.now = () => now;
  try {
    const ttlUrl = registry.issue(createOpenedFile('fixture.mp4', bytes), 'video/mp4', {
      selectionRevision: 1,
      maxBytes: bytes.length
    });
    const selectionUrl = registry.issue(createOpenedFile('fixture.mp4', bytes), 'video/mp4', {
      selectionRevision: 2,
      maxBytes: bytes.length,
      lifetime: 'selection'
    });
    now += assetModule.ONLY_PREVIEW_ASSET_TOKEN_TTL_MS + 1;

    assert.equal((await registry.respond(createRequest(ttlUrl, 'HEAD'))).status, 404);
    const head = await registry.respond(createRequest(selectionUrl, 'HEAD'));
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('accept-ranges'), 'bytes');
    const range = await registry.respond(
      createRequest(selectionUrl, 'GET', { Range: 'bytes=6-10' })
    );
    assert.equal(range.status, 206);
    assert.equal(Buffer.from(await range.arrayBuffer()).toString(), 'bytes');

    registry.revokeSelection('host-token', 2);
    assert.equal((await registry.respond(createRequest(selectionUrl, 'HEAD'))).status, 404);
  } finally {
    Date.now = originalNow;
    registry.clear();
  }
});

test('network delivery serves the PDF from Chromium and synthesizes its range contract', async () => {
  netFetchCalls.length = 0;
  let openedHandles = 0;
  let closedHandles = 0;
  const opened = {
    host: { hostToken: 'host-token' },
    workspace: { workspaceId: 'workspace-token', rootRealPath: '/workspace' },
    relativePath: 'papers/report.pdf',
    realPath: '/workspace/papers/report.pdf',
    size: NETWORK_DELIVERY_BYTES.length,
    modifiedAt: 1,
    modifiedTimeNanoseconds: 1n,
    deviceId: 1n,
    inode: 1n,
    fileHandle: {
      close: async () => {
        closedHandles += 1;
      },
      createReadStream: () => {
        throw new Error('network delivery must never read the file in this process');
      }
    }
  };
  const hosts = { isLive: () => true, onRevoke: () => () => {} };
  const workspaces = {
    onRevoke: () => () => {},
    openFile: async () => {
      openedHandles += 1;
      return opened;
    }
  };
  const registry = new assetModule.OnlyPreviewAssetRegistry(hosts, workspaces);
  const assetUrl = registry.issue(opened, 'application/pdf', {
    selectionRevision: 1,
    maxBytes: NETWORK_DELIVERY_BYTES.length,
    delivery: 'network'
  });

  const full = await registry.respond(createRequest(assetUrl));
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'application/pdf');
  assert.equal(full.headers.get('content-length'), String(NETWORK_DELIVERY_BYTES.length));
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('cache-control'), 'no-store');
  assert.equal(full.headers.get('content-range'), null);
  assert.equal(Buffer.from(await full.arrayBuffer()).toString(), 'abcdefgh');

  const ranged = await registry.respond(createRequest(assetUrl, 'GET', { Range: 'bytes=2-4' }));
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), `bytes 2-4/${NETWORK_DELIVERY_BYTES.length}`);
  assert.equal(ranged.headers.get('content-length'), '3');
  assert.equal(Buffer.from(await ranged.arrayBuffer()).toString(), 'cde');

  const head = await registry.respond(createRequest(assetUrl, 'HEAD'));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String(NETWORK_DELIVERY_BYTES.length));
  const unsatisfiable = await registry.respond(
    createRequest(assetUrl, 'GET', { Range: 'bytes=99-120' })
  );
  assert.equal(unsatisfiable.status, 416);
  const rejectedMethod = await registry.respond(createRequest(assetUrl, 'OPTIONS'));
  assert.equal(rejectedMethod.status, 405);

  // Chromium read the file; the identity handle was still opened and closed for every request.
  assert.deepEqual(
    netFetchCalls.map(({ url, init }) => [
      url,
      init.headers.Range,
      init.bypassCustomProtocolHandlers
    ]),
    [
      ['file:///workspace/papers/report.pdf', 'bytes=0-7', true],
      ['file:///workspace/papers/report.pdf', 'bytes=2-4', true]
    ]
  );
  assert.equal(openedHandles, 5);
  assert.equal(closedHandles, 5);

  registry.revokeSelection('host-token', 1);
  assert.equal((await registry.respond(createRequest(assetUrl))).status, 404);
  assert.equal(netFetchCalls.length, 2);
});

test('stream delivery stays the default and keeps the byte-counting guard', () => {
  const assets = source('src/main/onlypreview/onlyPreviewAsset.registry.ts');
  const region = source('src/main/onlypreview/views/onlyPreviewPreviewRegion.service.ts');

  assert.match(assets, /delivery: options\.delivery \?\? 'stream'/);
  assert.match(assets, /pipeline\(nodeStream, boundedStream/);
  assert.match(assets, /bypassCustomProtocolHandlers: true/);
  // Only the raw Chromium PDF adapter opts out of in-process reading; the Vue adapters keep their
  // ceilings, which are load-bearing for OOXML and image/media admission.
  const pdfIssue = region.slice(
    region.indexOf("adapter.adapterId === 'chromium-pdf'"),
    region.indexOf("adapter.adapterId === 'xlsx-grid'")
  );
  assert.match(pdfIssue, /delivery: 'network'/);
  assert.doesNotMatch(
    region.slice(region.indexOf("adapter.adapterId === 'xlsx-grid'")),
    /delivery: 'network'/
  );
});

test('document and PDF byte ceilings are enforced at issue and response time', () => {
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const registry = source('src/main/onlypreview/onlyPreviewDocument.registry.ts');
  const assets = source('src/main/onlypreview/onlyPreviewAsset.registry.ts');

  assert.match(types, /'html-page': 1024 \* 1024/);
  assert.match(types, /'chromium-pdf': 100 \* 1024 \* 1024/);
  assert.match(types, /ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES = 25 \* 1024 \* 1024/);
  assert.match(types, /ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES = 100 \* 1024 \* 1024/);
  assert.match(registry, /file\.size > ONLY_PREVIEW_MAX_HTML_BYTES/);
  assert.match(registry, /opened\.size > byteLimit/);
  assert.match(registry, /acceptedResponseBytes/);
  assert.match(registry, /ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES/);
  assert.match(assets, /file\.size > asset\.maxBytes/);
  assert.match(assets, /expectedSize/);
  assert.match(assets, /expectedDeviceId/);
  assert.match(assets, /expectedRealPath/);
  assert.match(registry, /expectedEntryRealPath/);
  assert.match(assets, /pipeline\(nodeStream, boundedStream/);
});

test('a superseded session protocol install cannot unhandle the current one', () => {
  const protocolModule = loadTypeScriptModule(
    'src/main/onlypreview/onlyPreviewProtocol.service.ts',
    {
      electron: {
        protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {}, unhandle: () => {} }
      },
      '@shared/onlypreview/onlyPreview.types': { ONLY_PREVIEW_SCHEME: 'bitterless-preview' },
      './onlyPreviewAsset.registry': {
        onlyPreviewAssetRegistry: { respond: async () => new Response(null) }
      },
      './onlyPreviewDocument.registry': {
        onlyPreviewDocumentRegistry: { respond: async () => new Response(null) }
      }
    }
  );
  const handled = [];
  const targetSession = {
    protocol: {
      handle: (scheme, handler) => handled.push({ scheme, handler }),
      unhandle: () => handled.push({ unhandled: true }),
      isProtocolHandled: () => handled.length > 0 && !handled.at(-1).unhandled
    }
  };
  const url = (token) => `bitterless-preview://asset/${token.repeat(64)}/paper.pdf`;

  const firstCleanup = protocolModule.installOnlyPreviewSessionProtocol(targetSession, url('a'));
  const secondCleanup = protocolModule.installOnlyPreviewSessionProtocol(targetSession, url('b'));
  const installsBefore = handled.filter((entry) => entry.scheme).length;

  // The shared Chrome session outlives one selection, so the stale cleanup must be inert.
  firstCleanup();
  assert.equal(handled.filter((entry) => entry.unhandled).length, 1);
  assert.equal(handled.filter((entry) => entry.scheme).length, installsBefore);

  secondCleanup();
  assert.equal(handled.filter((entry) => entry.unhandled).length, 2);
});

test('default protocol excludes documents while Chrome memory sessions scope one token', () => {
  const protocol = source('src/main/onlypreview/onlyPreviewProtocol.service.ts');

  assert.match(protocol, /installOnlyPreviewSessionProtocol/);
  const defaultHandler = protocol.slice(
    protocol.indexOf('respondToDefaultOnlyPreviewProtocol'),
    protocol.indexOf('export const registerOnlyPreviewScheme')
  );
  assert.doesNotMatch(defaultHandler, /onlyPreviewDocumentRegistry\.respond/);
  assert.match(protocol, /targetSession\.protocol\.handle/);
  assert.match(protocol, /onlyPreviewDocumentRegistry\.respond/);
  assert.match(protocol, /target\.token !== scope\.token/);
  assert.match(protocol, /targetSession\.protocol\.unhandle/);
  const documentRegistry = source('src/main/onlypreview/onlyPreviewDocument.registry.ts');
  for (const extension of ['aac', 'flac', 'mov', 'm4v', 'otf', 'cjs']) {
    assert.match(documentRegistry, new RegExp(`'\\.${extension}'`));
  }
});
