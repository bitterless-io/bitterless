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
const shellChainBundlePath = join(buildRoot, 'shellChain.mjs');
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
  stdin: {
    contents: `
      export { OnlyPreviewBrowseProjectionService } from './src/renderer/onlypreview/shell/src/onlyPreviewBrowseProjection.service';
      export { onlyPreviewGlobalSearchStore } from './src/renderer/onlypreview/shell/src/onlyPreviewGlobalSearch.store';
    `,
    resolveDir: projectRoot,
    sourcefile: 'shell-chain.entry.ts',
    loader: 'ts'
  },
  outfile: shellChainBundlePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  tsconfig: join(projectRoot, 'tsconfig.web.json'),
  plugins: [
    {
      name: 'shell-xpc-stub',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^electron-xpc\/renderer$/ }, () => ({
          path: 'shell-xpc',
          namespace: 'shell-chain-test'
        }));
        buildContext.onLoad(
          { filter: /^shell-xpc$/, namespace: 'shell-chain-test' },
          () => ({
            contents: `
              export const xpcRenderer = {
                subscribe: (name, callback) => globalThis.__shellSubscriptions.set(name, callback)
              };
              export const createXpcRendererEmitter = () => globalThis.__shellSearchClient;
            `
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
globalThis.window = { onlyPreviewEnv: { hostId: 'host-id', hostToken: 'host-token' } };
globalThis.__shellSubscriptions = new Map();
globalThis.__shellSearchClient = {};
const shellChainRuntime = await import(pathToFileURL(shellChainBundlePath).href);

after(() => rmSync(buildRoot, { recursive: true, force: true }));

const capability = 'a'.repeat(43);
const officeReadCapability = 'o'.repeat(43);
const projectAuthorityCapability = 'p'.repeat(43);
const previewReadCapability = 'v'.repeat(43);
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
const browseEntry = {
  ...entry,
  directoryToken: null,
  searchExcluded: false
};
const browseListing = {
  workspaceId,
  generation,
  directoryToken: 'docs-directory-capability',
  relativePath: 'docs',
  entries: [browseEntry]
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

test('root projection and a streamed search batch render while initialize terminals remain pending', async () => {
  let releaseInitialize;
  let releaseSearch;
  const initializeGate = new Promise((resolveValue) => {
    releaseInitialize = resolveValue;
  });
  const searchGate = new Promise((resolveValue) => {
    releaseSearch = resolveValue;
  });
  let initializeSettled = false;
  let searchSettled = false;
  const projection = new shellChainRuntime.OnlyPreviewBrowseProjectionService();
  const expandedPaths = new Set(['']);
  const store = shellChainRuntime.onlyPreviewGlobalSearchStore;
  store.resetForWorkspace();
  store.configure(
    () => ({
      workspaceId,
      generation,
      ready: projection.ready,
      rootName: 'workspace',
      currentDirectoryRelativePath: ''
    }),
    async () => true
  );
  store.configureScheduler(() => void store.dispatchLatest());
  store.subscribe();
  store.enter();
  store.setQuery('readme');
  let relay;
  const registration = {
    emit: (name, event) => {
      relay.publish({ capability, eventName: name, value: event });
    }
  };
  let searchStarted = false;
  const fileSearchRuntime = new runtime.FileSearchRuntime(registration, (options) =>
    coordinatorRuntime.createFileSearchCoordinator({
      ...options,
      createEngine: (engineOptions) => ({
        initialize: async () => {
          engineOptions.onBrowseListing({
            ...browseListing,
            relativePath: '',
            directoryToken: 'root-directory-capability',
            entries: [
              {
                ...browseEntry,
                relativePath: 'docs',
                parentRelativePath: '',
                name: 'docs',
                nodeKind: 'directory',
                directoryToken: 'docs-directory-capability',
                size: 0,
                previewHint: 'unsupported',
                mediaType: 'unknown',
                isText: false
              }
            ]
          });
          await initializeGate;
          return snapshot;
        },
        search: async (request) => {
          searchStarted = true;
          request.onResult(fileSearchResult);
          await searchGate;
          return {
            workspaceId,
            generation,
            requestId: request.requestId,
            files: [fileSearchResult],
            contents: [],
            filesTruncated: false,
            contentsTruncated: false
          };
        },
        revokeSearch: () => undefined,
        shutdown: async () => undefined
      })
    })
  );
  relay = new runtime.FileSearchRuntimeRelayService();
  const runtimeClient = Object.fromEntries(
    ['initialize', 'refresh', 'prioritizeFile', 'browseDirectory', 'search', 'preview', 'cancel', 'shutdown'].map(
      (method) => [
        method,
        ({ request, bootstrap }) => fileSearchRuntime[method](request, bootstrap)
      ]
    )
  );
  relay.attach({
    hostToken: 'host-token',
    hostId: 'host-id',
    bootstrapToken: 'bootstrap-token',
    capability,
    client: runtimeClient,
    broadcast: (name, params) => {
      if (name === 'onlypreview/browse-listing') {
        projection.applyListing(
          params.listing,
          { hostToken: 'host-token', workspaceId, generation },
          expandedPaths
        );
        store.resumeForAvailableRuntime();
      }
      globalThis.__shellSubscriptions.get(name)?.({ params });
    }
  });
  globalThis.__shellSearchClient.search = (params) =>
    relay.call('host-token', 'search', params, 5_000);
  globalThis.__shellSearchClient.cancel = (params) =>
    relay.call('host-token', 'cancel', params, 5_000);
  const initializing = relay
    .call(
      'host-token',
      'initialize',
      { hostToken: 'host-token', workspaceId, generation },
      5_000,
      runtimeBootstrap
    )
    .finally(() => {
      initializeSettled = true;
    });
  await new Promise((resolveValue) => setImmediate(resolveValue));
  assert.equal(projection.ready, true);
  assert.equal(initializeSettled, false);
  assert.equal(searchStarted, true);
  await new Promise((resolveValue) => setTimeout(resolveValue, 25));
  assert.deepEqual(store.files.map(({ relativePath }) => relativePath), ['docs/readme.md']);
  assert.equal(initializeSettled, false);
  searchSettled = !store.pending;
  assert.equal(searchSettled, false);
  releaseSearch();
  releaseInitialize();
  await initializing;
  while (store.pending) await new Promise((resolveValue) => setImmediate(resolveValue));
  await fileSearchRuntime.dispose();
});

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

test('hidden preload registers pairwise-independent Search, Office, and Project authority handlers', async () => {
  const originalArgv = process.argv;
  globalThis.__fileSearchRegisteredHandlers = [];
  globalThis.__fileSearchEventHandlers = [];
  globalThis.location = { pathname: '/fileSearch/index.html' };
  globalThis.addEventListener = () => undefined;
  process.argv = [
    originalArgv[0],
    originalArgv[1],
    `--file-search-capability=${capability}`,
    `--file-search-office-read-capability=${officeReadCapability}`,
    `--file-search-project-authority-capability=${projectAuthorityCapability}`,
    `--file-search-preview-read-capability=${previewReadCapability}`,
    '--file-search-instance=123e4567-e89b-42d3-a456-426614174000'
  ];
  try {
    const preload = await import(pathToFileURL(preloadBundlePath).href);
    assert.ok(preload.fileSearchRuntime);
    assert.ok(preload.officeReadRuntime);
    assert.ok(preload.projectAuthorityRuntime);
    assert.deepEqual(globalThis.__fileSearchRegisteredHandlers, [
      runtime.fileSearchRuntimeHandlerName(capability),
      `OnlyPreviewOfficeReadRuntime_${officeReadCapability}`,
      `OnlyPreviewFileAuthorityRuntime_${projectAuthorityCapability}`,
      `OnlyPreviewPreviewReadRuntime_${previewReadCapability}`
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
    `--file-search-office-read-capability=${officeReadCapability}`,
    `--file-search-project-authority-capability=${projectAuthorityCapability}`,
    `--file-search-preview-read-capability=${previewReadCapability}`,
    '--file-search-instance=123e4567-e89b-42d3-a456-426614174000'
  ];
  try {
    delete loadModule.cache[loadModule.resolve(preloadBundlePath)];
    const preload = loadModule(preloadBundlePath);
    assert.equal(preload.fileSearchRuntime, null);
    assert.equal(preload.officeReadRuntime, null);
    assert.equal(preload.projectAuthorityRuntime, null);
    assert.deepEqual(globalThis.__fileSearchRegisteredHandlers, []);
    assert.equal(typeof listeners.get('DOMContentLoaded'), 'function');

    globalThis.location.pathname = '/fileSearch/index.html';
    listeners.get('DOMContentLoaded')();
    assert.ok(preload.fileSearchRuntime);
    assert.ok(preload.officeReadRuntime);
    assert.ok(preload.projectAuthorityRuntime);
    assert.deepEqual(globalThis.__fileSearchRegisteredHandlers, [
      runtime.fileSearchRuntimeHandlerName(capability),
      `OnlyPreviewOfficeReadRuntime_${officeReadCapability}`,
      `OnlyPreviewFileAuthorityRuntime_${projectAuthorityCapability}`,
      `OnlyPreviewPreviewReadRuntime_${previewReadCapability}`
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
