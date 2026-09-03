/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = process.cwd();
const nodeRequire = createRequire(import.meta.url);
const source = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

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
  new Function(
    'require',
    'module',
    'exports',
    `${transpiled.outputText}\n//# sourceURL=${join(root, relativePath)}`
  )(localRequire, loaded, loaded.exports);
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
    throw new ContractError('INVALID_INPUT', 'Invalid relative path.');
  }
  return value;
};

const contracts = {
  normalizeOnlyPreviewRelativePath: normalizeRelativePath,
  OnlyPreviewContractError: ContractError
};
const sharedTypes = {
  ONLY_PREVIEW_SCHEME: 'bitterless-preview',
  ONLY_PREVIEW_MAX_HTML_BYTES: 1024 * 1024,
  ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES: 25 * 1024 * 1024
};
const inertHosts = {
  require: () => ({ hostToken: 'host-token' }),
  isLive: () => true,
  onRevoke: () => () => {}
};
const inertWorkspaces = { onRevoke: () => () => {} };

const toArrayBuffer = (bytes) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createFrameBroker = (sources, options = {}) => {
  const calls = { opens: [], reads: [], cancels: [], inspections: [] };
  const sessions = new Map();
  return {
    calls,
    async inspectPreviewDocumentResource(request) {
      calls.inspections.push({ ...request });
      const bytes = sources.get(request.requestPath);
      if (!bytes) throw new ContractError('PATH_NOT_FOUND', 'Missing resource.');
      return {
        runtimeInstanceId: 'runtime',
        grantId: request.grantId,
        selectionRevision: request.selectionRevision,
        requestPath: request.requestPath,
        size: bytes.length
      };
    },
    async openPreviewRead(request) {
      calls.opens.push(structuredClone(request));
      await options.beforeOpen?.(request);
      const key = request.source.kind === 'document' ? request.source.requestPath : 'selection';
      const bytes = sources.get(key);
      if (!bytes) throw new ContractError('PATH_NOT_FOUND', 'Missing source.');
      if (request.method === 'GET' && bytes.length > 0) {
        sessions.set(request.sessionId, { request, bytes, offset: request.start });
      }
      return {
        runtimeInstanceId: 'runtime',
        grantId: request.grantId,
        selectionRevision: request.selectionRevision,
        workspaceId: 'workspace-token',
        relativePath: 'pages/index.html',
        sessionId: request.sessionId,
        method: request.method,
        start: request.start,
        end: request.end,
        totalBytes: bytes.length,
        eof: request.method === 'HEAD' || bytes.length === 0
      };
    },
    async readNextPreviewChunk(request) {
      calls.reads.push({ ...request });
      const session = sessions.get(request.sessionId);
      if (!session || request.offset !== session.offset) {
        throw new ContractError('INVALID_INPUT', 'Invalid frame offset.');
      }
      const end = Math.min(session.request.end + 1, request.offset + (options.frameBytes ?? 2));
      const frame = session.bytes.subarray(request.offset, end);
      const eof = end === session.request.end + 1;
      session.offset = end;
      if (eof) sessions.delete(request.sessionId);
      return {
        runtimeInstanceId: 'runtime',
        grantId: request.grantId,
        selectionRevision: request.selectionRevision,
        sessionId: request.sessionId,
        offset: options.wrongOffset ? request.offset + 1 : request.offset,
        bytes: toArrayBuffer(frame),
        eof
      };
    },
    async cancelPreviewRead(request) {
      calls.cancels.push({ ...request });
      if (request.sessionId) sessions.delete(request.sessionId);
    }
  };
};

const createModules = (broker) => {
  const assetModule = loadTypeScriptModule('src/main/onlypreview/onlyPreviewAsset.registry.ts', {
    '@main/fileSearch/fileSearchWindow.service': { fileSearchWindowService: broker },
    '@shared/diagnostics/diagnostic.service': { sanitizeErrorCauseChain: () => 'test-cause' },
    '@shared/onlypreview/onlyPreview.contract': contracts,
    '@shared/onlypreview/onlyPreview.types': sharedTypes,
    '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types': {},
    './onlyPreviewHost.registry': { onlyPreviewHostRegistry: inertHosts },
    './onlyPreviewWorkspace.registry': { onlyPreviewWorkspaceRegistry: inertWorkspaces }
  });
  const documentModule = loadTypeScriptModule(
    'src/main/onlypreview/onlyPreviewDocument.registry.ts',
    {
      '@main/fileSearch/fileSearchWindow.service': { fileSearchWindowService: broker },
      '@shared/onlypreview/onlyPreview.contract': contracts,
      '@shared/onlypreview/onlyPreview.types': sharedTypes,
      '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types': {},
      './onlyPreviewAsset.registry': assetModule,
      './onlyPreviewHost.registry': { onlyPreviewHostRegistry: inertHosts },
      './onlyPreviewWorkspace.registry': { onlyPreviewWorkspaceRegistry: inertWorkspaces }
    }
  );
  return { assetModule, documentModule };
};

const prepared = (relativePath, size, descriptor = {}) => ({
  runtimeInstanceId: 'runtime',
  grantId: 'grant-token',
  selectionRevision: 7,
  workspaceId: 'workspace-token',
  workspaceGeneration: 2,
  relativePath,
  descriptor: {
    workspaceId: 'workspace-token',
    relativePath,
    name: relativePath.split('/').at(-1),
    extension: '.bin',
    kind: 'image',
    mimeType: 'application/octet-stream',
    language: '',
    size,
    modifiedAt: 1,
    ...descriptor
  }
});

const createRequest = (url, method = 'GET', headers = {}, controller = new AbortController()) =>
  new Request(url, { method, headers, signal: controller.signal });

test('Main asset/document routers are path-free framed brokers with no filesystem fallback', () => {
  for (const relativePath of [
    'src/main/onlypreview/onlyPreviewAsset.registry.ts',
    'src/main/onlypreview/onlyPreviewDocument.registry.ts'
  ]) {
    const code = source(relativePath);
    assert.doesNotMatch(code, /node:fs|node:fs\/promises|createReadStream|fileHandle|net\.fetch/);
    assert.match(code, /cancelPreviewRead/);
  }
  const assets = source('src/main/onlypreview/onlyPreviewAsset.registry.ts');
  assert.match(assets, /openPreviewRead/);
  assert.match(assets, /readNextPreviewChunk/);
  const documents = source('src/main/onlypreview/onlyPreviewDocument.registry.ts');
  assert.match(documents, /inspectPreviewDocumentResource/);
  assert.match(documents, /createOnlyPreviewReadResponse/);
  assert.match(documents, /activeSessions/);
  assert.doesNotMatch(documents, /realPath|deviceId|inode|resourceIdentities/);
});

test('framed response preserves GET, HEAD, Range and concurrent session semantics', async () => {
  const bytes = Buffer.from('abcdefgh');
  const broker = createFrameBroker(new Map([['selection', bytes]]));
  const { assetModule } = createModules(broker);
  const base = {
    grantId: 'grant-token',
    selectionRevision: 7,
    source: { kind: 'selection' },
    fileSize: bytes.length,
    mimeType: 'application/pdf',
    maxBytes: bytes.length
  };

  const [first, second] = await Promise.all([
    assetModule.createOnlyPreviewReadResponse({
      ...base,
      request: createRequest('bitterless-preview://asset/a/file.pdf', 'GET', {
        Range: 'bytes=0-3'
      })
    }),
    assetModule.createOnlyPreviewReadResponse({
      ...base,
      request: createRequest('bitterless-preview://asset/b/file.pdf', 'GET', {
        Range: 'bytes=4-7'
      })
    })
  ]);
  assert.equal(first.status, 206);
  assert.equal(first.headers.get('content-range'), 'bytes 0-3/8');
  assert.equal(second.status, 206);
  const [firstBytes, secondBytes] = await Promise.all([first.text(), second.text()]);
  assert.equal(firstBytes, 'abcd');
  assert.equal(secondBytes, 'efgh');
  assert.equal(new Set(broker.calls.reads.map((call) => call.sessionId)).size, 2);

  const head = await assetModule.createOnlyPreviewReadResponse({
    ...base,
    request: createRequest('bitterless-preview://asset/a/file.pdf', 'HEAD')
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(broker.calls.opens.at(-1).method, 'HEAD');
  const invalid = await assetModule.createOnlyPreviewReadResponse({
    ...base,
    request: createRequest('bitterless-preview://asset/a/file.pdf', 'GET', {
      Range: 'bytes=99-100'
    })
  });
  assert.equal(invalid.status, 416);
});

test('asset registry issues opaque PDF/media URLs and revokes exact active frame sessions', async () => {
  const bytes = Buffer.from('pdf-bytes');
  const broker = createFrameBroker(new Map([['selection', bytes]]), { frameBytes: 3 });
  const { assetModule } = createModules(broker);
  const registry = new assetModule.OnlyPreviewAssetRegistry(inertHosts, inertWorkspaces);
  const selection = prepared('papers/report.pdf', bytes.length, {
    extension: '.pdf',
    kind: 'pdf',
    mimeType: 'application/pdf'
  });
  const url = registry.issue('host-token', selection, 'application/pdf', {
    selectionRevision: 7,
    maxBytes: bytes.length,
    lifetime: 'selection'
  });
  const response = await registry.respond(createRequest(url, 'GET', { Range: 'bytes=1-6' }));
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'df-byt');
  assert.ok(broker.calls.reads.length >= 2);

  const pending = await registry.respond(createRequest(url));
  const reader = pending.body.getReader();
  await reader.read();
  registry.revokeSelection('host-token', 7);
  assert.equal(broker.calls.cancels.at(-1).grantId, 'grant-token');
  assert.equal(typeof broker.calls.cancels.at(-1).sessionId, 'string');
  assert.equal((await registry.respond(createRequest(url))).status, 404);
});

test('abort during a deferred frame open cancels and cleans the exact pending session', async () => {
  const bytes = Buffer.from('pending-bytes');
  const started = deferred();
  const release = deferred();
  const broker = createFrameBroker(new Map([['selection', bytes]]), {
    beforeOpen: async (request) => {
      started.resolve(request);
      await release.promise;
    }
  });
  const { assetModule } = createModules(broker);
  const controller = new AbortController();
  const activeSessions = new Set();
  const responsePromise = assetModule.createOnlyPreviewReadResponse({
    request: createRequest('bitterless-preview://asset/a/pending.bin', 'GET', {}, controller),
    grantId: 'grant-token',
    selectionRevision: 7,
    source: { kind: 'selection' },
    fileSize: bytes.length,
    mimeType: 'application/octet-stream',
    maxBytes: bytes.length,
    onSession: (sessionId) => activeSessions.add(sessionId),
    onSessionClosed: (sessionId) => activeSessions.delete(sessionId),
    isSessionLive: (sessionId) => activeSessions.has(sessionId)
  });
  const openRequest = await started.promise;
  assert.equal(activeSessions.has(openRequest.sessionId), true);

  controller.abort();
  assert.deepEqual(broker.calls.cancels.at(-1), {
    grantId: 'grant-token',
    selectionRevision: 7,
    sessionId: openRequest.sessionId
  });
  assert.equal(activeSessions.size, 0);

  release.resolve();
  await assert.rejects(responsePromise, /cancelled/i);
  assert.equal(activeSessions.size, 0);
  assert.ok(broker.calls.cancels.every((request) => request.sessionId === openRequest.sessionId));
});

test('asset and document token revocation fence deferred opens and cancel their exact sessions', async () => {
  const scenarios = [
    {
      sourceKey: 'selection',
      create: (modules, broker, bytes) => {
        const registry = new modules.assetModule.OnlyPreviewAssetRegistry(
          inertHosts,
          inertWorkspaces
        );
        const url = registry.issue(
          'host-token',
          prepared('papers/pending.pdf', bytes.length, {
            extension: '.pdf',
            kind: 'pdf',
            mimeType: 'application/pdf'
          }),
          'application/pdf',
          { selectionRevision: 7, maxBytes: bytes.length, lifetime: 'selection' }
        );
        return { registry, url, broker };
      }
    },
    {
      sourceKey: 'index.html',
      create: (modules, broker, bytes) => {
        const registry = new modules.documentModule.OnlyPreviewDocumentRegistry(
          inertHosts,
          inertWorkspaces
        );
        const url = registry.issue(
          'host-token',
          prepared('pages/index.html', bytes.length, {
            extension: '.html',
            kind: 'text',
            mimeType: 'text/html'
          }),
          7
        );
        return { registry, url, broker };
      }
    }
  ];

  for (const scenario of scenarios) {
    const bytes = Buffer.from('pending-token-bytes');
    const started = deferred();
    const release = deferred();
    const broker = createFrameBroker(new Map([[scenario.sourceKey, bytes]]), {
      beforeOpen: async (request) => {
        started.resolve(request);
        await release.promise;
      }
    });
    const modules = createModules(broker);
    const { registry, url } = scenario.create(modules, broker, bytes);
    const responsePromise = registry.respond(createRequest(url));
    const openRequest = await started.promise;

    registry.revokeSelection('host-token', 7);
    assert.deepEqual(broker.calls.cancels.at(-1), {
      grantId: 'grant-token',
      selectionRevision: 7,
      sessionId: openRequest.sessionId
    });

    release.resolve();
    assert.equal((await responsePromise).status, 404);
    assert.ok(broker.calls.cancels.every((request) => request.sessionId === openRequest.sessionId));
    assert.equal((await registry.respond(createRequest(url))).status, 404);
  }
});

test('HTML router validates paths, preserves CSP, and uses transient resource frame sessions', async () => {
  const entry = Buffer.from('<script src="app.js"></script>');
  const script = Buffer.from('ok()');
  const broker = createFrameBroker(
    new Map([
      ['index.html', entry],
      ['app.js', script]
    ])
  );
  const { documentModule } = createModules(broker);
  const registry = new documentModule.OnlyPreviewDocumentRegistry(inertHosts, inertWorkspaces);
  const selection = prepared('pages/index.html', entry.length, {
    extension: '.html',
    kind: 'text',
    mimeType: 'text/html'
  });
  const entryUrl = registry.issue('host-token', selection, 7);
  const entryResponse = await registry.respond(createRequest(entryUrl));
  assert.equal(entryResponse.status, 200);
  assert.match(entryResponse.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
  assert.equal(await entryResponse.text(), entry.toString());
  const scriptResponse = await registry.respond(
    createRequest(entryUrl.replace('/index.html', '/app.js'))
  );
  assert.equal(scriptResponse.status, 200);
  assert.equal(await scriptResponse.text(), 'ok()');
  assert.deepEqual(
    broker.calls.inspections.map((call) => call.requestPath),
    ['index.html', 'app.js']
  );
  assert.deepEqual(
    broker.calls.opens.map((call) => call.source),
    [
      { kind: 'document', requestPath: 'index.html' },
      { kind: 'document', requestPath: 'app.js' }
    ]
  );
  assert.equal(
    (await registry.respond(createRequest(entryUrl.replace('/index.html', '/%2e%2e/secret.js'))))
      .status,
    404
  );
  assert.equal(
    (await registry.respond(createRequest(entryUrl.replace('/index.html', '/app%2F.js')))).status,
    404
  );
});

test('frame broker failure terminates only its response and scopes cancellation to that session', async () => {
  const bytes = Buffer.from('abcd');
  const broker = createFrameBroker(new Map([['selection', bytes]]));
  broker.readNextPreviewChunk = async (request) => {
    broker.calls.reads.push({ ...request });
    throw new ContractError('PROTOCOL_ERROR', 'Invalid Preview Read frame.');
  };
  const { assetModule } = createModules(broker);
  const response = await assetModule.createOnlyPreviewReadResponse({
    request: createRequest('bitterless-preview://asset/a/file.bin'),
    grantId: 'grant-token',
    selectionRevision: 7,
    source: { kind: 'selection' },
    fileSize: bytes.length,
    mimeType: 'application/octet-stream',
    maxBytes: bytes.length
  });
  await assert.rejects(response.arrayBuffer());
  assert.equal(broker.calls.cancels.length, 1);
  assert.equal(broker.calls.cancels[0].grantId, 'grant-token');
  assert.equal(broker.calls.cancels[0].sessionId, broker.calls.opens[0].sessionId);
});

test('document and PDF ceilings remain centralized while hidden reader owns HTML budget', () => {
  const types = source('src/shared/onlypreview/onlyPreview.types.ts');
  const reader = source('src/preload/fileSearch/fileSearchPreviewReader.service.ts');
  const document = source('src/main/onlypreview/onlyPreviewDocument.registry.ts');
  assert.match(types, /'html-page': 1024 \* 1024/);
  assert.match(types, /'chromium-pdf': 100 \* 1024 \* 1024/);
  assert.match(types, /ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES = 25 \* 1024 \* 1024/);
  assert.match(types, /ONLY_PREVIEW_MAX_DOCUMENT_TOTAL_BYTES = 100 \* 1024 \* 1024/);
  assert.match(reader, /acceptedDocumentBytes \+= acceptedBytes/);
  assert.match(reader, /intentionally non-refundable/);
  assert.match(reader, /ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_IDENTITIES/);
  assert.match(document, /ONLY_PREVIEW_MAX_HTML_BYTES/);
  assert.match(document, /ONLY_PREVIEW_MAX_DOCUMENT_RESOURCE_BYTES/);
});

test('session protocol keeps document routing scoped to the active Chrome token', () => {
  const protocolModule = loadTypeScriptModule(
    'src/main/onlypreview/onlyPreviewProtocol.service.ts',
    {
      electron: {
        protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {}, unhandle: () => {} }
      },
      '@shared/diagnostics/diagnostic.service': { sanitizeErrorCauseChain: () => 'test-cause' },
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
  const url = (token) => `bitterless-preview://document/${token.repeat(64)}/index.html`;
  const firstCleanup = protocolModule.installOnlyPreviewSessionProtocol(targetSession, url('a'));
  const secondCleanup = protocolModule.installOnlyPreviewSessionProtocol(targetSession, url('b'));
  firstCleanup();
  assert.equal(handled.filter((entry) => entry.unhandled).length, 1);
  secondCleanup();
  assert.equal(handled.filter((entry) => entry.unhandled).length, 2);
});
