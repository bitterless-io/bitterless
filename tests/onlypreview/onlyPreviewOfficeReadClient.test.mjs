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

class ProtocolRejectedError extends Error {}

const maxBytes = 25 * 1024 * 1024;
const chunkBytes = 512 * 1024;
const instanceId = '123e4567-e89b-42d3-a456-426614174000';
const grant = {
  grantId: 'office-grant',
  runtimeId: 'preview-runtime',
  selectionRevision: 7,
  kind: 'xlsx',
  workspaceId: 'workspace-token',
  relativePath: 'book.xlsx',
  maxBytes
};

const success = (value) => ({ ok: true, value });
const toArrayBuffer = (value) => {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const prepared = (size) => ({
  grantId: grant.grantId,
  runtimeId: grant.runtimeId,
  selectionRevision: grant.selectionRevision,
  kind: grant.kind,
  size,
  modifiedAt: 1
});

const opened = (totalBytes) => ({
  grantId: grant.grantId,
  runtimeId: grant.runtimeId,
  selectionRevision: grant.selectionRevision,
  totalBytes
});

const chunk = (offset, bytes, eof) => ({
  grantId: grant.grantId,
  runtimeId: grant.runtimeId,
  selectionRevision: grant.selectionRevision,
  offset,
  bytes: toArrayBuffer(bytes),
  eof
});

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createClient = (overrides = {}) => {
  const cancellationCalls = [];
  const client = {
    ready: async () => ({ ok: true }),
    bindWorkspace: async () => success(undefined),
    prepare: async () => success(prepared(700_000)),
    open: async () => success(opened(700_000)),
    readNext: async () => success(chunk(0, new Uint8Array(chunkBytes), false)),
    cancel: async (request) => {
      cancellationCalls.push(structuredClone(request));
      return success(undefined);
    },
    ...overrides
  };
  return { cancellationCalls, client };
};

const createService = (client) => {
  const contractModule = { OnlyPreviewContractError: ContractError };
  const responseModule = loadTypeScriptModule(
    'src/main/fileSearch/fileSearchOfficeReadResponse.service.ts',
    {
      '@shared/onlypreview/onlyPreview.contract': contractModule,
      '@shared/onlypreview/onlyPreview.types': {}
    }
  );
  const clientModule = loadTypeScriptModule(
    'src/main/fileSearch/fileSearchOfficeReadClient.service.ts',
    {
      'electron-xpc/main': { createXpcMainEmitter: () => client },
      '@shared/onlypreview/onlyPreview.contract': contractModule,
      '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types': {
        ONLY_PREVIEW_OFFICE_READ_CHUNK_BYTES: chunkBytes,
        ONLY_PREVIEW_OFFICE_READ_MAX_BYTES: maxBytes,
        onlyPreviewOfficeReadRuntimeHandlerName: (capability) =>
          `OnlyPreviewOfficeReadRuntime_${capability}`
      },
      './fileSearchOfficeReadResponse.service': responseModule
    }
  );
  const protocolErrors = [];
  const window = { isDestroyed: () => false };
  const host = {
    getLifecycleState: () => ({ lifecycleId: 1, window }),
    rejectProtocol: (message) => {
      protocolErrors.push(message);
      throw new ProtocolRejectedError(message);
    }
  };
  const service = new clientModule.FileSearchOfficeReadClientService(host);
  service.start(instanceId);
  return { protocolErrors, service };
};

test('Office ready accepts only exact typed path-free envelopes', async () => {
  const validFailure = createClient({
    ready: async () => ({ ok: false, error: 'Office read runtime is unavailable.' })
  });
  const validFailureService = createService(validFailure.client);
  await assert.rejects(
    validFailureService.service.waitUntilReady(new Promise(() => {})),
    /failed to initialize/
  );
  assert.deepEqual(validFailureService.protocolErrors, []);

  for (const invalidReady of [
    { ok: true, extra: true },
    { ok: false, error: 42 },
    { ok: false, error: '/Users/ral/private/book.xlsx' }
  ]) {
    const fake = createClient({ ready: async () => invalidReady });
    const { protocolErrors, service } = createService(fake.client);
    await assert.rejects(service.waitUntilReady(new Promise(() => {})), ProtocolRejectedError);
    assert.deepEqual(protocolErrors, ['Office read readiness response is invalid.']);
  }
});

test('Office operation errors accept only exact typed path-free envelopes', async () => {
  const safeFailure = createClient({
    prepare: async () => ({
      ok: false,
      error: {
        code: 'PATH_NOT_FOUND',
        message: 'The selected Office file is unavailable.'
      }
    })
  });
  const safeFailureService = createService(safeFailure.client);
  await assert.rejects(safeFailureService.service.prepare(grant), (error) => {
    assert.equal(error.code, 'PATH_NOT_FOUND');
    assert.equal(error.message, 'The selected Office file is unavailable.');
    return true;
  });
  assert.deepEqual(safeFailureService.protocolErrors, []);

  const pathLeakingFailure = createClient({
    prepare: async () => ({
      ok: false,
      error: {
        code: 'PATH_NOT_FOUND',
        message: '/Users/ral/private/book.xlsx could not be opened.'
      }
    })
  });
  const pathLeakingFailureService = createService(pathLeakingFailure.client);
  await assert.rejects(pathLeakingFailureService.service.prepare(grant), ProtocolRejectedError);
  assert.deepEqual(pathLeakingFailureService.protocolErrors, ['Office read response is invalid.']);
});

test('Main Office relay fences late open responses after cancel, rebind, or stop', async (t) => {
  for (const invalidation of ['cancel', 'rebind', 'stop']) {
    await t.test(invalidation, async () => {
      const openStarted = deferred();
      const openResponse = deferred();
      const fake = createClient({
        open: async (request) => {
          openStarted.resolve(request);
          return openResponse.promise;
        }
      });
      const { service } = createService(fake.client);
      await service.prepare(grant);
      const openPromise = service.open({
        grantId: grant.grantId,
        runtimeId: grant.runtimeId,
        selectionRevision: grant.selectionRevision
      });
      await openStarted.promise;

      if (invalidation === 'cancel') {
        await service.cancel({
          grantId: grant.grantId,
          runtimeId: grant.runtimeId,
          selectionRevision: grant.selectionRevision
        });
      } else if (invalidation === 'rebind') {
        await service.bindWorkspace({
          workspaceId: 'replacement-workspace',
          rootPath: '/replacement-workspace'
        });
      } else {
        service.stop();
      }

      openResponse.resolve(success(opened(700_000)));
      await assert.rejects(openPromise, (error) => {
        assert.equal(error.code, 'OPERATION_FAILED');
        assert.match(error.message, /cancelled/i);
        return true;
      });
      await assert.rejects(
        service.readNext({
          grantId: grant.grantId,
          runtimeId: grant.runtimeId,
          selectionRevision: grant.selectionRevision,
          offset: 0
        }),
        (error) => error.code === 'INVALID_INPUT'
      );
      if (invalidation !== 'rebind') {
        assert.ok(fake.cancellationCalls.length >= 1);
      }
    });
  }
});

test('Main Office relay fences late prepare responses after rebind or stop', async (t) => {
  for (const invalidation of ['rebind', 'stop']) {
    await t.test(invalidation, async () => {
      const prepareStarted = deferred();
      const prepareResponse = deferred();
      const fake = createClient({
        prepare: async (request) => {
          prepareStarted.resolve(request);
          return prepareResponse.promise;
        }
      });
      const { service } = createService(fake.client);
      const preparePromise = service.prepare(grant);
      await prepareStarted.promise;

      if (invalidation === 'rebind') {
        await service.bindWorkspace({
          workspaceId: 'replacement-workspace',
          rootPath: '/replacement-workspace'
        });
      } else {
        service.stop();
      }

      prepareResponse.resolve(success(prepared(700_000)));
      await assert.rejects(preparePromise, (error) => {
        assert.equal(error.code, 'OPERATION_FAILED');
        assert.match(error.message, /superseded/i);
        return true;
      });
      await assert.rejects(
        service.open({
          grantId: grant.grantId,
          runtimeId: grant.runtimeId,
          selectionRevision: grant.selectionRevision
        }),
        (error) => error.code === 'INVALID_INPUT'
      );
    });
  }
});

test('Main Office relay allows only one sequential frame request and fences rebind', async () => {
  const readStarted = deferred();
  const readResponse = deferred();
  const fake = createClient({
    prepare: async () => success(prepared(16)),
    open: async () => success(opened(16)),
    readNext: async (request) => {
      readStarted.resolve(request);
      return readResponse.promise;
    }
  });
  const { service } = createService(fake.client);
  await service.prepare({ ...grant, maxBytes: 16 });
  await service.open({
    grantId: grant.grantId,
    runtimeId: grant.runtimeId,
    selectionRevision: grant.selectionRevision
  });
  const firstRead = service.readNext({
    grantId: grant.grantId,
    runtimeId: grant.runtimeId,
    selectionRevision: grant.selectionRevision,
    offset: 0
  });
  await readStarted.promise;
  await assert.rejects(
    service.readNext({
      grantId: grant.grantId,
      runtimeId: grant.runtimeId,
      selectionRevision: grant.selectionRevision,
      offset: 0
    }),
    (error) => error.code === 'INVALID_INPUT'
  );

  await service.bindWorkspace({
    workspaceId: 'replacement-workspace',
    rootPath: '/replacement-workspace'
  });
  readResponse.resolve(success(chunk(0, new Uint8Array(16), true)));
  await assert.rejects(firstRead, (error) => {
    assert.equal(error.code, 'OPERATION_FAILED');
    assert.match(error.message, /superseded/i);
    return true;
  });
});

test('Main Office relay accepts only sequential frames no larger than 512 KiB', async () => {
  const sourceBytes = new Uint8Array(700_000);
  sourceBytes.fill(7);
  const fake = createClient({
    prepare: async () => success(prepared(sourceBytes.byteLength)),
    open: async () => success(opened(sourceBytes.byteLength)),
    readNext: async (request) => {
      const end = Math.min(request.offset + chunkBytes, sourceBytes.byteLength);
      return success(
        chunk(
          request.offset,
          sourceBytes.subarray(request.offset, end),
          end === sourceBytes.byteLength
        )
      );
    }
  });
  const { service } = createService(fake.client);
  await service.prepare(grant);
  await service.open({
    grantId: grant.grantId,
    runtimeId: grant.runtimeId,
    selectionRevision: grant.selectionRevision
  });
  const first = await service.readNext({
    grantId: grant.grantId,
    runtimeId: grant.runtimeId,
    selectionRevision: grant.selectionRevision,
    offset: 0
  });
  assert.equal(first.bytes.byteLength, chunkBytes);
  assert.equal(first.eof, false);
  const second = await service.readNext({
    grantId: grant.grantId,
    runtimeId: grant.runtimeId,
    selectionRevision: grant.selectionRevision,
    offset: first.bytes.byteLength
  });
  assert.equal(second.bytes.byteLength, sourceBytes.byteLength - chunkBytes);
  assert.equal(second.eof, true);
  await assert.rejects(
    service.readNext({
      grantId: grant.grantId,
      runtimeId: grant.runtimeId,
      selectionRevision: grant.selectionRevision,
      offset: sourceBytes.byteLength
    }),
    (error) => error.code === 'INVALID_INPUT'
  );
});

test('Main Office relay rejects oversized or inconsistent preload payloads', async () => {
  const oversizedPrepare = createClient({
    prepare: async () => success(prepared(maxBytes + 1))
  });
  const prepareService = createService(oversizedPrepare.client);
  await assert.rejects(prepareService.service.prepare(grant), ProtocolRejectedError);
  assert.deepEqual(prepareService.protocolErrors, ['Office read preparation response is invalid.']);

  const oversizedOpen = createClient({
    prepare: async () => success(prepared(maxBytes)),
    open: async () => success(opened(maxBytes + 1))
  });
  const openService = createService(oversizedOpen.client);
  await openService.service.prepare(grant);
  await assert.rejects(
    openService.service.open({
      grantId: grant.grantId,
      runtimeId: grant.runtimeId,
      selectionRevision: grant.selectionRevision
    }),
    ProtocolRejectedError
  );
  assert.deepEqual(openService.protocolErrors, ['Office read open response is invalid.']);

  const oversizedChunk = createClient({
    prepare: async () => success(prepared(700_000)),
    open: async () => success(opened(700_000)),
    readNext: async () => success(chunk(0, new Uint8Array(chunkBytes + 1), false))
  });
  const chunkService = createService(oversizedChunk.client);
  await chunkService.service.prepare(grant);
  await chunkService.service.open({
    grantId: grant.grantId,
    runtimeId: grant.runtimeId,
    selectionRevision: grant.selectionRevision
  });
  await assert.rejects(
    chunkService.service.readNext({
      grantId: grant.grantId,
      runtimeId: grant.runtimeId,
      selectionRevision: grant.selectionRevision,
      offset: 0
    }),
    ProtocolRejectedError
  );
  assert.deepEqual(chunkService.protocolErrors, ['Office read chunk response is invalid.']);

  const earlyEof = createClient({
    prepare: async () => success(prepared(16)),
    open: async () => success(opened(16)),
    readNext: async () => success(chunk(0, new Uint8Array(8), true))
  });
  const earlyEofService = createService(earlyEof.client);
  await earlyEofService.service.prepare({ ...grant, maxBytes: 16 });
  await earlyEofService.service.open({
    grantId: grant.grantId,
    runtimeId: grant.runtimeId,
    selectionRevision: grant.selectionRevision
  });
  await assert.rejects(
    earlyEofService.service.readNext({
      grantId: grant.grantId,
      runtimeId: grant.runtimeId,
      selectionRevision: grant.selectionRevision,
      offset: 0
    }),
    ProtocolRejectedError
  );
  assert.deepEqual(earlyEofService.protocolErrors, ['Office read chunk response is invalid.']);
});
