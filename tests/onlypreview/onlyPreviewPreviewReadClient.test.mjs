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

const runtimeInstanceId = '123e4567-e89b-42d3-a456-426614174000';
const sessionId = '123e4567-e89b-42d3-a456-426614174001';
const grant = {
  grantId: 'grant-token',
  selectionRevision: 7,
  workspaceId: 'workspace-token',
  workspaceGeneration: 2,
  relativePath: 'notes/readme.txt'
};

const success = (value) => ({ ok: true, value });

const preparedSelection = {
  ...grant,
  runtimeInstanceId,
  descriptor: {
    workspaceId: grant.workspaceId,
    relativePath: grant.relativePath,
    name: 'readme.txt',
    extension: '.txt',
    kind: 'text',
    mimeType: 'text/plain; charset=utf-8',
    language: 'plaintext',
    size: 3,
    modifiedAt: 1
  }
};

const createClient = (overrides = {}) => {
  const cancellationCalls = [];
  const client = {
    ready: async () => ({ ok: true }),
    bindWorkspace: async () => success(undefined),
    revokeWorkspace: async () => success(undefined),
    prepare: async () => success(preparedSelection),
    inspectDocumentResource: async () => success(undefined),
    open: async () => success(undefined),
    readNext: async () => success(undefined),
    cancel: async (request) => {
      cancellationCalls.push(structuredClone(request));
      return success(undefined);
    },
    ...overrides
  };
  return { client, cancellationCalls };
};

const createService = (client) => {
  const contractModule = { OnlyPreviewContractError: ContractError };
  const responseModule = loadTypeScriptModule(
    'src/main/fileSearch/fileSearchPreviewReadResponse.service.ts',
    {
      '@shared/onlypreview/onlyPreview.contract': contractModule,
      '@shared/onlypreview/onlyPreview.types': {}
    }
  );
  const clientModule = loadTypeScriptModule(
    'src/main/fileSearch/fileSearchPreviewReadClient.service.ts',
    {
      'electron-xpc/main': { createXpcMainEmitter: () => client },
      '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types': {
        ONLY_PREVIEW_READ_CHUNK_BYTES: 512 * 1024,
        onlyPreviewPreviewReadRuntimeHandlerName: (capability) =>
          `OnlyPreviewPreviewReadRuntime_${capability}`
      },
      '@shared/onlypreview/onlyPreview.contract': contractModule,
      './fileSearchPreviewReadResponse.service': responseModule
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
  const service = new clientModule.FileSearchPreviewReadClientService(host);
  service.start(runtimeInstanceId);
  return { service, protocolErrors };
};

const deferred = () => {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

test('Preview Read ready accepts only exact typed path-free envelopes', async () => {
  const validFailure = createClient({
    ready: async () => ({ ok: false, error: 'Preview Read runtime is unavailable.' })
  });
  const validFailureService = createService(validFailure.client);
  await assert.rejects(
    validFailureService.service.waitUntilReady(new Promise(() => {})),
    (error) => {
      assert.equal(error.message, 'Preview Read runtime failed to initialize.');
      return true;
    }
  );
  assert.deepEqual(validFailureService.protocolErrors, []);

  for (const invalidReady of [
    { ok: true, extra: true },
    { ok: false, error: 42 },
    { ok: false, error: '/Users/ral/private/runtime.log' }
  ]) {
    const fake = createClient({ ready: async () => invalidReady });
    const { service, protocolErrors } = createService(fake.client);
    await assert.rejects(service.waitUntilReady(new Promise(() => {})), ProtocolRejectedError);
    assert.deepEqual(protocolErrors, ['Preview Read readiness response is invalid.']);
    assert.doesNotMatch(protocolErrors[0], /Users|private|runtime\.log/);
  }
});

test('Main Preview Read client fences cancel-before-open-response without publishing a session', async () => {
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
    selectionRevision: grant.selectionRevision,
    sessionId,
    method: 'GET',
    source: { kind: 'selection' },
    start: 0,
    end: 2
  });
  await openStarted.promise;
  await service.cancel({
    grantId: grant.grantId,
    selectionRevision: grant.selectionRevision,
    sessionId
  });
  openResponse.resolve(
    success({
      runtimeInstanceId,
      grantId: grant.grantId,
      selectionRevision: grant.selectionRevision,
      workspaceId: grant.workspaceId,
      relativePath: grant.relativePath,
      sessionId,
      method: 'GET',
      start: 0,
      end: 2,
      totalBytes: 3,
      eof: false
    })
  );

  await assert.rejects(openPromise, (error) => {
    assert.equal(error.code, 'OPERATION_FAILED');
    assert.match(error.message, /cancelled/i);
    return true;
  });
  assert.equal(fake.cancellationCalls.length, 1);
  assert.deepEqual(
    {
      grantId: fake.cancellationCalls[0].grantId,
      selectionRevision: fake.cancellationCalls[0].selectionRevision,
      sessionId: fake.cancellationCalls[0].sessionId
    },
    {
      grantId: grant.grantId,
      selectionRevision: grant.selectionRevision,
      sessionId
    }
  );
  await assert.rejects(
    service.readNext({
      grantId: grant.grantId,
      selectionRevision: grant.selectionRevision,
      sessionId,
      offset: 0
    }),
    (error) => error.code === 'INVALID_INPUT'
  );
});
