/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-file-search-relay-'));
const bundlePath = join(buildRoot, 'runtime.mjs');
const preloadBundlePath = join(buildRoot, 'fileSearch.preload.cjs');
const coordinatorBundlePath = join(buildRoot, 'fileSearchCoordinator.mjs');
const loadModule = createRequire(import.meta.url);

await build({
  entryPoints: [join(projectRoot, 'tests/onlypreview/searchBootstrap.runtime.entry.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'file-search-coordinator-stub',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^\.\/fileSearchCoordinator$/ }, () => ({
          path: 'file-search-coordinator',
          namespace: 'file-search-runtime-test'
        }));
        buildContext.onLoad(
          { filter: /^file-search-coordinator$/, namespace: 'file-search-runtime-test' },
          () => ({
            contents: `export const createFileSearchCoordinator = () => {
              throw new Error('Runtime behavior tests must inject a coordinator.');
            };`
          })
        );
      }
    }
  ]
});

await build({
  entryPoints: [join(projectRoot, 'src/preload/fileSearch/fileSearch.preload.ts')],
  outfile: preloadBundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'file-search-xpc-preload-stub',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^electron-xpc\/preload$/ }, () => ({
          path: 'electron-xpc-preload',
          namespace: 'file-search-test'
        }));
        buildContext.onLoad(
          { filter: /^electron-xpc-preload$/, namespace: 'file-search-test' },
          () => ({
            contents: `
              export class XpcPreloadHandler {
                constructor() {
                  globalThis.__fileSearchRegisteredHandlers.push(this.constructor.name);
                }
              }
              export const createXpcPreloadEmitter = (name) => {
                globalThis.__fileSearchEventHandlers.push(name);
                return { publish: async () => ({ ok: true }) };
              };
            `
          })
        );
      }
    }
  ]
});

await build({
  entryPoints: [join(projectRoot, 'src/preload/fileSearch/fileSearchCoordinator.ts')],
  outfile: coordinatorBundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
  tsconfig: join(projectRoot, 'tsconfig.node.json'),
  plugins: [
    {
      name: 'file-search-engine-stub',
      setup(buildContext) {
        buildContext.onResolve({ filter: /search-engine\.mjs$/ }, () => ({
          path: 'search-engine',
          namespace: 'file-search-coordinator-test'
        }));
        buildContext.onLoad(
          { filter: /^search-engine$/, namespace: 'file-search-coordinator-test' },
          () => ({
            contents: `export const createOnlyPreviewSearchEngine = () => {
              throw new Error('Coordinator tests must inject an engine.');
            };`
          })
        );
      }
    }
  ]
});

const runtime = await import(pathToFileURL(bundlePath).href);
const coordinatorRuntime = await import(pathToFileURL(coordinatorBundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const capability = 'a'.repeat(43);
const workspaceId = 'workspace-current';
const generation = 4;
const entry = {
  relativePath: 'docs/readme.md',
  parentRelativePath: 'docs',
  name: 'readme.md',
  nodeKind: 'file',
  size: 10,
  modifiedAt: 1,
  previewHint: 'text',
  mediaType: 'text',
  isText: true
};
const snapshot = {
  workspaceId,
  generation,
  state: 'ready',
  index: { workspaceId, entries: [entry], truncated: false, limit: 1 },
  memory: {
    measurementComplete: true,
    processRssBytes: 10,
    workerHeapUsedBytes: 9,
    workerExternalBytes: 8,
    treeMetadataEntryCount: 1,
    treeMetadataEstimatedBytes: 7,
    filenameTierEstimatedBytes: 6,
    diskIndexBytes: 5,
    runtimeOneGiBWarning: false,
    runtimeTwoGiBLimitExceeded: false
  }
};
const fileSearchResult = {
  section: 'files',
  resultToken: 'file-result-token',
  name: 'readme.md',
  relativePath: 'docs/readme.md',
  parentRelativePath: 'docs',
  nodeKind: 'file',
  previewHint: 'text',
  mediaType: 'text'
};
const searchResult = {
  section: 'contents',
  resultToken: 'content-result-token',
  fileName: 'readme.md',
  relativePath: 'docs/readme.md',
  parentRelativePath: 'docs',
  mediaType: 'text',
  contentMatch: { snippetText: 'A👨‍👩‍👧‍👦B', highlightStart: 1, highlightLength: 1 }
};

test('file-search XPC channel names are capability-bound in both directions', () => {
  const otherCapability = 'b'.repeat(43);
  assert.equal(runtime.fileSearchRuntimeHandlerName(capability), `FileSearchRuntime_${capability}`);
  assert.equal(
    runtime.fileSearchRuntimeEventHandlerName(capability),
    `FileSearchRuntimeEventHandler_${capability}`
  );
  assert.notEqual(
    runtime.fileSearchRuntimeHandlerName(capability),
    runtime.fileSearchRuntimeHandlerName(otherCapability)
  );
  assert.notEqual(
    runtime.fileSearchRuntimeEventHandlerName(capability),
    runtime.fileSearchRuntimeEventHandlerName(otherCapability)
  );
});

test('hidden preload registers only capability-bound XPC handler names', async () => {
  const originalArgv = process.argv;
  globalThis.__fileSearchRegisteredHandlers = [];
  globalThis.__fileSearchEventHandlers = [];
  globalThis.location = { pathname: '/fileSearch/index.html' };
  globalThis.addEventListener = () => undefined;
  process.argv = [
    originalArgv[0],
    originalArgv[1],
    `--file-search-capability=${capability}`,
    '--file-search-instance=123e4567-e89b-42d3-a456-426614174000'
  ];
  try {
    const preload = await import(pathToFileURL(preloadBundlePath).href);
    assert.ok(preload.fileSearchRuntime);
    assert.deepEqual(globalThis.__fileSearchRegisteredHandlers, [
      runtime.fileSearchRuntimeHandlerName(capability)
    ]);
    assert.deepEqual(globalThis.__fileSearchEventHandlers, [
      runtime.fileSearchRuntimeEventHandlerName(capability)
    ]);
  } finally {
    process.argv = originalArgv;
    delete globalThis.__fileSearchRegisteredHandlers;
    delete globalThis.__fileSearchEventHandlers;
    delete globalThis.location;
    delete globalThis.addEventListener;
  }
});

test('hidden preload defers exact-target XPC registration until its document URL settles', async () => {
  const originalArgv = process.argv;
  const listeners = new Map();
  globalThis.__fileSearchRegisteredHandlers = [];
  globalThis.__fileSearchEventHandlers = [];
  globalThis.location = { pathname: '/about-blank' };
  globalThis.addEventListener = (eventName, listener) => listeners.set(eventName, listener);
  process.argv = [
    originalArgv[0],
    originalArgv[1],
    `--file-search-capability=${capability}`,
    '--file-search-instance=123e4567-e89b-42d3-a456-426614174000'
  ];
  try {
    delete loadModule.cache[loadModule.resolve(preloadBundlePath)];
    const preload = loadModule(preloadBundlePath);
    assert.equal(preload.fileSearchRuntime, null);
    assert.deepEqual(globalThis.__fileSearchRegisteredHandlers, []);
    assert.equal(typeof listeners.get('DOMContentLoaded'), 'function');

    globalThis.location.pathname = '/fileSearch/index.html';
    listeners.get('DOMContentLoaded')();
    assert.ok(preload.fileSearchRuntime);
    assert.deepEqual(globalThis.__fileSearchRegisteredHandlers, [
      runtime.fileSearchRuntimeHandlerName(capability)
    ]);
    assert.deepEqual(globalThis.__fileSearchEventHandlers, [
      runtime.fileSearchRuntimeEventHandlerName(capability)
    ]);
  } finally {
    process.argv = originalArgv;
    delete globalThis.__fileSearchRegisteredHandlers;
    delete globalThis.__fileSearchEventHandlers;
    delete globalThis.location;
    delete globalThis.addEventListener;
  }
});

const createRuntimeCoordinator = (overrides = {}) => ({
  initialize: async () => snapshot,
  refresh: async () => snapshot,
  prioritizeFile: async () => undefined,
  browseDirectory: async () => {
    throw new Error('Unexpected browseDirectory call.');
  },
  search: async (request) => ({
    workspaceId: request.workspaceId,
    generation: request.generation,
    requestId: request.requestId,
    files: [fileSearchResult],
    contents: [searchResult],
    filesTruncated: false,
    contentsTruncated: false
  }),
  cancel: async () => undefined,
  hasActiveSearchIndex: () => false,
  shutdown: async () => undefined,
  ...overrides
});

const runtimeInitializeRequest = (generationValue = generation) => ({
  hostToken: 'host-token-file-search-000000000000',
  workspaceId,
  generation: generationValue
});

const runtimeBootstrap = {
  workspaceId,
  rootPath: '/private/workspace',
  databasePath: '/private/cache/search.sqlite'
};

test('FileSearchRuntime reports candidate startup failure but keeps a complete active index searchable', async () => {
  let shutdownCount = 0;
  const coordinator = createRuntimeCoordinator({
    initialize: async () => {
      throw new Error('candidate build failed');
    },
    hasActiveSearchIndex: ({
      workspaceId: candidateWorkspaceId,
      generation: candidateGeneration
    }) => candidateWorkspaceId === workspaceId && candidateGeneration === generation,
    shutdown: async () => {
      shutdownCount += 1;
    }
  });
  const fileSearchRuntime = new runtime.FileSearchRuntime(
    { emit: () => undefined },
    () => coordinator
  );

  const initialized = await fileSearchRuntime.initialize(
    runtimeInitializeRequest(),
    runtimeBootstrap
  );
  assert.equal(initialized.ok, false);
  assert.equal(shutdownCount, 0);

  const searched = await fileSearchRuntime.search({
    ...runtimeInitializeRequest(),
    requestId: 'search-after-candidate-failure',
    query: 'readme',
    maxResults: 10,
    scope: { kind: 'project' }
  });
  assert.equal(searched.ok, true);
  assert.deepEqual(searched.value?.contents, [searchResult]);

  await fileSearchRuntime.dispose();
  assert.equal(shutdownCount, 1);
});

test('FileSearchRuntime cleans fatal and superseded startup generations', async () => {
  let fatalShutdownCount = 0;
  const fatalRuntime = new runtime.FileSearchRuntime({ emit: () => undefined }, () =>
    createRuntimeCoordinator({
      initialize: async () => {
        throw new Error('fatal startup failure');
      },
      hasActiveSearchIndex: () => {
        throw new Error('active-index recovery probe failed');
      },
      shutdown: async () => {
        fatalShutdownCount += 1;
      }
    })
  );
  assert.equal(
    (await fatalRuntime.initialize(runtimeInitializeRequest(), runtimeBootstrap)).ok,
    false
  );
  assert.equal(fatalShutdownCount, 1);
  assert.equal(
    (
      await fatalRuntime.search({
        ...runtimeInitializeRequest(),
        requestId: 'search-after-fatal-startup',
        query: 'readme',
        maxResults: 10,
        scope: { kind: 'project' }
      })
    ).ok,
    false
  );

  let resolveFirstInitialize = () => undefined;
  const firstInitialize = new Promise((resolveValue) => {
    resolveFirstInitialize = resolveValue;
  });
  let markFirstInitializeStarted = () => undefined;
  const firstInitializeStarted = new Promise((resolveValue) => {
    markFirstInitializeStarted = resolveValue;
  });
  let firstShutdownCount = 0;
  const coordinators = [
    createRuntimeCoordinator({
      initialize: async () => {
        markFirstInitializeStarted();
        return await firstInitialize;
      },
      hasActiveSearchIndex: () => true,
      shutdown: async () => {
        firstShutdownCount += 1;
      }
    }),
    createRuntimeCoordinator({
      initialize: async () => ({ ...snapshot, generation: generation + 1 })
    })
  ];
  const supersededRuntime = new runtime.FileSearchRuntime({ emit: () => undefined }, () =>
    coordinators.shift()
  );
  const first = supersededRuntime.initialize(runtimeInitializeRequest(), runtimeBootstrap);
  await firstInitializeStarted;
  const second = await supersededRuntime.initialize(
    runtimeInitializeRequest(generation + 1),
    runtimeBootstrap
  );
  assert.equal(second.ok, true);
  resolveFirstInitialize(snapshot);
  assert.equal((await first).ok, false);
  assert.ok(firstShutdownCount >= 1);
  const searched = await supersededRuntime.search({
    ...runtimeInitializeRequest(generation + 1),
    requestId: 'search-after-supersede',
    query: 'readme',
    maxResults: 10,
    scope: { kind: 'project' }
  });
  assert.equal(searched.ok, true);
  await supersededRuntime.dispose();
});

test('FileSearchRuntime accepts priority only for its exact active generation', async () => {
  const accepted = [];
  const fileSearchRuntime = new runtime.FileSearchRuntime({ emit: () => undefined }, () =>
    createRuntimeCoordinator({
      prioritizeFile: async (request) => accepted.push(request)
    })
  );
  assert.equal(
    (await fileSearchRuntime.initialize(runtimeInitializeRequest(), runtimeBootstrap)).ok,
    true
  );
  const request = {
    ...runtimeInitializeRequest(),
    relativePath: 'docs/readme.md'
  };
  assert.equal((await fileSearchRuntime.prioritizeFile(request)).ok, true);
  assert.deepEqual(accepted, [request]);
  assert.equal(
    (
      await fileSearchRuntime.prioritizeFile({
        ...request,
        generation: generation + 1
      })
    ).ok,
    false
  );
  assert.deepEqual(accepted, [request]);
  await fileSearchRuntime.dispose();
});

test('a failed priority operation cannot poison the coordinator search barrier', async () => {
  let searchCount = 0;
  let shutdownCount = 0;
  const coordinator = coordinatorRuntime.createFileSearchCoordinator({
    createEngine: () => ({
      supersedePriority: (request) => ({
        ...request,
        priorityRevision: 1,
        buildEpoch: 1
      }),
      prioritizeFile: async () => {
        throw new Error('in-memory priority index failed');
      },
      search: async (request) => {
        searchCount += 1;
        return {
          workspaceId: request.workspaceId,
          generation: request.generation,
          requestId: request.requestId,
          files: [fileSearchResult],
          contents: [searchResult],
          filesTruncated: false,
          contentsTruncated: false
        };
      },
      revokeSearch: () => undefined,
      shutdown: async () => {
        shutdownCount += 1;
      }
    })
  });
  await assert.rejects(
    coordinator.prioritizeFile({
      hostToken: 'host-token',
      workspaceId,
      generation,
      relativePath: 'docs/readme.md'
    }),
    /priority index failed/u
  );
  const response = await coordinator.search({
    workspaceId,
    generation,
    requestId: 'search-after-priority-failure',
    query: 'readme',
    maxResults: 10,
    scope: { kind: 'project' }
  });
  assert.equal(searchCount, 1);
  assert.deepEqual(response.contents, [searchResult]);
  await coordinator.shutdown();
  assert.equal(shutdownCount, 1);
});

test('a queued replacement search revokes the active result session immediately', async () => {
  const revocations = [];
  let markFirstStarted = () => undefined;
  const firstStarted = new Promise((resolveValue) => {
    markFirstStarted = resolveValue;
  });
  const coordinator = coordinatorRuntime.createFileSearchCoordinator({
    createEngine: () => ({
      search: async (request) => {
        if (request.requestId === 'active-search') {
          markFirstStarted();
          while (!request.isCancelled()) {
            await new Promise((resolveValue) => setImmediate(resolveValue));
          }
          throw Object.assign(new Error('Search cancelled.'), { code: 'CANCELLED' });
        }
        return {
          workspaceId: request.workspaceId,
          generation: request.generation,
          requestId: request.requestId,
          files: [fileSearchResult],
          contents: [searchResult],
          filesTruncated: false,
          contentsTruncated: false
        };
      },
      revokeSearch: (requestId) => revocations.push(requestId),
      shutdown: async () => undefined
    })
  });
  const first = coordinator
    .search({
      workspaceId,
      generation,
      requestId: 'active-search',
      query: 'first',
      maxResults: 10,
      scope: { kind: 'project' }
    })
    .then(
      () => null,
      (error) => error
    );
  await firstStarted;

  const replacement = coordinator.search({
    workspaceId,
    generation,
    requestId: 'pending-search',
    query: 'second',
    maxResults: 10,
    scope: { kind: 'project' }
  });
  assert.deepEqual(revocations, [undefined, undefined]);
  assert.equal((await first)?.code, 'CANCELLED');
  assert.equal((await replacement).requestId, 'pending-search');

  await coordinator.cancel({ requestId: 'active-search' });
  assert.deepEqual(revocations, [undefined, undefined, 'active-search']);
  await coordinator.shutdown();
});

class FakeFileSearchClient {
  calls = [];
  pending = [];

  ready(params) {
    this.calls.push({ method: 'ready', params });
    return Promise.resolve({ ok: true });
  }

  initialize(params) {
    return this.defer('initialize', params);
  }

  refresh(params) {
    return this.defer('refresh', params);
  }

  prioritizeFile(params) {
    return this.defer('prioritizeFile', params);
  }

  browseDirectory(params) {
    return this.defer('browseDirectory', params);
  }

  search(params) {
    return this.defer('search', params);
  }

  preview(params) {
    return this.defer('preview', params);
  }

  cancel(params) {
    return this.defer('cancel', params);
  }

  shutdown(params) {
    return this.defer('shutdown', params);
  }

  defer(method, params) {
    this.calls.push({ method, params });
    return new Promise((resolveValue) => this.pending.push({ method, resolve: resolveValue }));
  }

  respond(method, value) {
    const index = this.pending.findIndex((pending) => pending.method === method);
    assert.notEqual(index, -1, `missing pending ${method}`);
    this.pending.splice(index, 1)[0].resolve(value);
  }
}

const createHarness = () => {
  const client = new FakeFileSearchClient();
  const broadcasts = [];
  const relay = new runtime.FileSearchRuntimeRelayService();
  relay.attach({
    hostToken: 'host-token',
    hostId: 'bound-host-id',
    bootstrapToken: 'main-private-bootstrap-token',
    capability,
    client,
    broadcast: (eventName, params) => broadcasts.push({ eventName, params })
  });
  return { broadcasts, client, relay };
};

test('file-search XPC relay privately enriches calls and rejects pending work on detach', async () => {
  const { client, relay } = createHarness();
  const bootstrap = {
    workspaceId,
    rootPath: '/private/workspace',
    databasePath: '/private/cache/search.sqlite'
  };
  const initialize = relay.call(
    'host-token',
    'initialize',
    { hostToken: 'host-token', workspaceId, generation },
    5_000,
    bootstrap
  );
  assert.deepEqual(client.calls[0], {
    method: 'initialize',
    params: {
      capability,
      request: { hostToken: 'host-token', workspaceId, generation },
      bootstrap
    }
  });
  assert.equal(JSON.stringify(client.calls[0]).includes('main-private-bootstrap-token'), false);
  client.respond('initialize', { ok: true, value: snapshot });
  assert.deepEqual(await initialize, { ok: true, value: snapshot });
  assert.equal(relay.bootstrapTokenForHost('host-token'), 'main-private-bootstrap-token');

  const priorityRequest = {
    hostToken: 'host-token',
    workspaceId,
    generation,
    relativePath: 'docs/readme.md'
  };
  const priority = relay.call('host-token', 'prioritizeFile', priorityRequest, 5_000);
  assert.deepEqual(client.calls.at(-1), {
    method: 'prioritizeFile',
    params: { capability, request: priorityRequest }
  });
  client.respond('prioritizeFile', { ok: true, value: undefined });
  assert.deepEqual(await priority, { ok: true, value: undefined });

  const searchRequest = {
    hostToken: 'host-token',
    workspaceId,
    generation,
    requestId: 'search-1',
    query: 'needle',
    maxResults: 10,
    scope: { kind: 'project' }
  };
  const search = relay.call('host-token', 'search', searchRequest, 5_000);
  const cancel = relay.call(
    'host-token',
    'cancel',
    { hostToken: 'host-token', requestId: 'search-1' },
    5_000
  );
  assert.deepEqual(
    client.calls.slice(-2).map(({ method }) => method),
    ['search', 'cancel'],
    'cancel is an independent XPC request while search remains active'
  );
  client.respond('cancel', { ok: true, value: undefined });
  assert.deepEqual(await cancel, { ok: true, value: undefined });
  relay.detach();
  await assert.rejects(search, /stopped unexpectedly/u);
  await assert.rejects(
    relay.call('host-token', 'search', searchRequest, 5_000),
    /stopped unexpectedly/u
  );
});

test('file-search XPC event path capability-binds and deeply validates public relay values', async () => {
  const { broadcasts, client, relay } = createHarness();
  const initialize = relay.call(
    'host-token',
    'initialize',
    { hostToken: 'host-token', workspaceId, generation },
    5_000
  );

  assert.throws(
    () =>
      relay.publish({
        capability: 'b'.repeat(43),
        eventName: 'onlypreview/search-snapshot',
        value: { snapshot }
      }),
    (error) => error?.code === 'HOST_ROLE_DENIED'
  );
  assert.deepEqual(
    relay.publish({
      capability,
      eventName: 'onlypreview/search-snapshot',
      value: { snapshot }
    }),
    { ok: true }
  );
  for (const invalid of [
    { ...snapshot, absolutePath: '/private/workspace' },
    { ...snapshot, generation: generation - 1 },
    { ...snapshot, index: { ...snapshot.index, entries: [{ ...entry, unexpected: true }] } },
    { ...snapshot, memory: { ...snapshot.memory, processRssBytes: Number.POSITIVE_INFINITY } }
  ]) {
    relay.publish({
      capability,
      eventName: 'onlypreview/search-snapshot',
      value: { snapshot: invalid }
    });
  }

  client.respond('initialize', { ok: true, value: snapshot });
  await initialize;
  const request = {
    hostToken: 'host-token',
    workspaceId,
    generation,
    requestId: 'search-current',
    query: 'needle',
    maxResults: 2,
    scope: { kind: 'project' }
  };
  const search = relay.call('host-token', 'search', request, 5_000);
  relay.publish({
    capability,
    eventName: 'onlypreview/search-batch',
    value: {
      batch: {
        workspaceId,
        generation,
        requestId: request.requestId,
        files: [fileSearchResult],
        contents: [searchResult]
      }
    }
  });
  relay.publish({
    capability,
    eventName: 'onlypreview/search-batch',
    value: {
      batch: {
        workspaceId,
        generation,
        requestId: request.requestId,
        files: [],
        contents: [{ ...searchResult, relativePath: '/private/readme.md' }]
      }
    }
  });
  assert.deepEqual(
    broadcasts.map(({ eventName }) => eventName),
    ['onlypreview/search-snapshot', 'onlypreview/search-batch']
  );
  assert.equal(JSON.stringify(broadcasts).includes('/private/'), false);

  client.respond('search', {
    ok: true,
    value: {
      workspaceId,
      generation,
      requestId: request.requestId,
      files: [fileSearchResult],
      contents: [searchResult],
      filesTruncated: false,
      contentsTruncated: false
    }
  });
  assert.equal((await search).ok, true);

  const previewRequest = {
    hostToken: 'host-token',
    workspaceId,
    generation,
    requestId: request.requestId,
    resultToken: fileSearchResult.resultToken
  };
  const preview = relay.call('host-token', 'preview', previewRequest, 5_000);
  client.respond('preview', {
    ok: true,
    value: {
      kind: 'info',
      name: 'readme.md',
      previewHint: 'text',
      mediaType: 'text',
      size: 10,
      modifiedAt: 1
    }
  });
  assert.equal((await preview).ok, true);

  const malformedPreview = relay.call('host-token', 'preview', previewRequest, 5_000);
  client.respond('preview', {
    ok: true,
    value: {
      kind: 'info',
      name: 'readme.md',
      previewHint: 'text',
      mediaType: 'text',
      size: 10,
      modifiedAt: 1,
      absolutePath: '/private/readme.md'
    }
  });
  await assert.rejects(malformedPreview, (error) => error?.code === 'PROTOCOL_ERROR');
  relay.detach();
});

test('file-search XPC relay rejects malformed responses and enforces timeout', async () => {
  const { client, relay } = createHarness();
  const malformed = relay.call(
    'host-token',
    'cancel',
    { hostToken: 'host-token', requestId: 'cancel-invalid' },
    5_000
  );
  client.respond('cancel', { ok: true, value: null });
  await assert.rejects(malformed, (error) => error?.code === 'PROTOCOL_ERROR');

  await assert.rejects(
    relay.call('host-token', 'cancel', { hostToken: 'host-token', requestId: 'cancel-timeout' }, 5),
    /timed out/u
  );
  relay.detach();
});

test('file-search lifecycle fence accepts only its exact target and fails once', () => {
  const failures = [];
  const fence = new runtime.FileSearchLifecycleFence(
    'file:///app/out/renderer/fileSearch/index.html',
    (message) => failures.push(message)
  );
  assert.equal(fence.acceptNavigation('file:///app/out/renderer/fileSearch/index.html'), true);
  assert.equal(
    fence.acceptNavigation('file:///app/out/renderer/fileSearch/index.html?unexpected=1'),
    false
  );
  fence.fail('second failure');
  assert.deepEqual(failures, ['File-search renderer attempted an unexpected navigation.']);

  const stoppedFailures = [];
  const stopped = new runtime.FileSearchLifecycleFence(
    'https://renderer/fileSearch/index.html',
    (message) => stoppedFailures.push(message)
  );
  stopped.stop();
  assert.equal(stopped.acceptNavigation('https://renderer/fileSearch/index.html'), false);
  assert.deepEqual(stoppedFailures, []);
});

test('file-search readiness retries an unregistered XPC target within one bounded startup deadline', async () => {
  let readyCalls = 0;
  await runtime.waitForFileSearchRuntimeReady({
    runtimeClient: {
      ready: async () => {
        readyCalls += 1;
        return readyCalls === 1 ? null : { ok: true };
      }
    },
    capability,
    instanceId: '123e4567-e89b-42d3-a456-426614174000',
    stopped: new Promise(() => undefined),
    timeoutMs: 100
  });
  assert.equal(readyCalls, 2);

  await assert.rejects(
    runtime.waitForFileSearchRuntimeReady({
      runtimeClient: { ready: async () => ({ ok: false, error: 'invalid runtime' }) },
      capability,
      instanceId: '123e4567-e89b-42d3-a456-426614174000',
      stopped: new Promise(() => undefined),
      timeoutMs: 100
    }),
    /invalid runtime/u
  );
  await assert.rejects(
    runtime.waitForFileSearchRuntimeReady({
      runtimeClient: { ready: async () => null },
      capability,
      instanceId: '123e4567-e89b-42d3-a456-426614174000',
      stopped: Promise.resolve(),
      timeoutMs: 100
    }),
    /stopped during startup/u
  );
});
