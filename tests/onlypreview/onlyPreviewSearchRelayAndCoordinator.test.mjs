/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
        buildContext.onLoad({ filter: /^shell-xpc$/, namespace: 'shell-chain-test' }, () => ({
          contents: `
              export const xpcRenderer = {
                subscribe: (name, callback) => globalThis.__shellSubscriptions.set(name, callback)
              };
              export const createXpcRendererEmitter = () => globalThis.__shellSearchClient;
            `
        }));
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
await import(pathToFileURL(shellChainBundlePath).href);

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
const previewClassifications = [
  ['text', 'text', true, 'md'],
  ['pdf', 'pdf', false, 'pdf'],
  ['image', 'image', false, 'png'],
  ['audio', 'audio', false, 'mp3'],
  ['video', 'video', false, 'mp4'],
  ['sheet', 'unknown', false, 'xlsx'],
  ['document', 'unknown', false, 'docx'],
  ['presentation', 'unknown', false, 'pptx'],
  ['diagram', 'unknown', false, 'drawio'],
  ['unsupported', 'unknown', false, 'bin']
];
const classifiedEntries = previewClassifications.map(
  ([previewHint, mediaType, isText, extension], index) => ({
    ...entry,
    relativePath: `docs/classified-${index}.${extension}`,
    name: `classified-${index}.${extension}`,
    previewHint,
    mediaType,
    isText
  })
);
const classifiedSnapshot = {
  ...snapshot,
  index: {
    ...snapshot.index,
    entries: classifiedEntries,
    limit: classifiedEntries.length
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
const classifiedBrowseListing = {
  ...browseListing,
  entries: classifiedEntries.map((classifiedEntry) => ({
    ...classifiedEntry,
    directoryToken: null,
    searchExcluded: false
  }))
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

test('coordinator refresh does not cancel an accepted streamed Global Search', async () => {
  for (const refreshFails of [false, true]) {
    let releaseSearch;
    const searchGate = new Promise((resolveValue) => {
      releaseSearch = resolveValue;
    });
    let cancelled = false;
    let warmStreamed = false;
    const coordinator = coordinatorRuntime.createFileSearchCoordinator({
      createEngine: () => ({
        search: async (request) => {
          request.onResult(fileSearchResult);
          warmStreamed = true;
          await searchGate;
          cancelled = request.isCancelled();
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
        refresh: async () => {
          if (refreshFails) throw new Error('candidate refresh failed');
          return snapshot;
        },
        revokeSearch: () => undefined,
        shutdown: async () => undefined
      }),
      onSearchBatch: () => undefined
    });
    const searching = coordinator.search({
      workspaceId,
      generation,
      requestId: `refresh-${refreshFails}`,
      query: 'readme',
      maxResults: 10,
      scope: { kind: 'project' }
    });
    while (!warmStreamed) await new Promise((resolveValue) => setImmediate(resolveValue));
    const refreshing = coordinator.refresh({ workspaceId, generation });
    if (refreshFails) await assert.rejects(refreshing, /candidate refresh failed/u);
    else await refreshing;
    releaseSearch();
    assert.equal((await searching).files.length, 1);
    assert.equal(cancelled, false);
    await coordinator.shutdown();
  }
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

test('Global Search Office lane is grant-bound, chunked, one-shot, and independently cancelled', async () => {
  const calls = [];
  let preparedGrant = null;
  let handleOpen = false;
  let readFailure = null;
  const officeReader = {
    bindWorkspace: async (boundWorkspaceId, rootPath) => {
      calls.push(['bind', boundWorkspaceId, rootPath]);
    },
    prepare: async (grant) => {
      preparedGrant = grant;
      calls.push(['prepare', grant.kind, grant.selectionRevision]);
      return {
        grantId: grant.grantId,
        runtimeId: grant.runtimeId,
        selectionRevision: grant.selectionRevision,
        kind: grant.kind,
        size: 4,
        modifiedAt: 12
      };
    },
    open: async (grantId, runtimeId, selectionRevision) => {
      assert.equal(grantId, preparedGrant.grantId);
      assert.equal(runtimeId, preparedGrant.runtimeId);
      assert.equal(selectionRevision, preparedGrant.selectionRevision);
      calls.push(['open', selectionRevision]);
      handleOpen = true;
      return { grantId, runtimeId, selectionRevision, totalBytes: 4 };
    },
    readNext: async (grantId, runtimeId, selectionRevision, offset) => {
      assert.equal(grantId, preparedGrant.grantId);
      assert.equal(runtimeId, preparedGrant.runtimeId);
      assert.equal(selectionRevision, preparedGrant.selectionRevision);
      calls.push(['read', selectionRevision, offset]);
      if (offset !== 0) throw new Error('Office read offset is invalid.');
      if (readFailure) throw readFailure;
      handleOpen = false;
      return {
        grantId,
        runtimeId,
        selectionRevision,
        offset,
        bytes: new Uint8Array([1, 2, 3, 4]).buffer,
        eof: true
      };
    },
    cancel: async (grantId, runtimeId, selectionRevision) => {
      calls.push(['cancel', grantId, runtimeId, selectionRevision]);
      handleOpen = false;
    },
    dispose: async () => calls.push(['dispose'])
  };
  const files = {
    'xlsx-token': ['book.xlsm', 'xlsx'],
    'docx-token': ['manual.docx', 'docx'],
    'pptx-token': ['slides.pptx', 'pptx'],
    'info-token': ['manual.pdf', null]
  };
  const coordinator = coordinatorRuntime.createFileSearchCoordinator({
    createOfficeReader: () => officeReader,
    createEngine: (options) => ({
      initialize: async ({
        workspaceId: initializedWorkspaceId,
        generation: initializedGeneration
      }) => ({
        ...snapshot,
        workspaceId: initializedWorkspaceId,
        generation: initializedGeneration
      }),
      preview: async (previewRequest) => {
        const [relativePath, kind] = files[previewRequest.resultToken];
        const info = { kind: 'info', size: 4, modifiedAt: 12 };
        if (!kind) return { ...info, name: relativePath, previewHint: 'pdf', mediaType: 'pdf' };
        return await options.prepareOfficePreview({
          authority: {
            nodeKind: 'file',
            relativePath,
            name: relativePath,
            size: 4,
            modifiedAt: 12
          },
          preview: info,
          ...previewRequest
        });
      },
      revokeSearch: () => undefined,
      shutdown: async () => undefined,
      hasActiveSearchIndex: () => true
    })
  });
  await coordinator.initialize({
    workspaceId,
    generation,
    rootPath: '/workspace',
    databasePath: '/search.sqlite'
  });

  const baseRequest = {
    hostToken: 'host-token',
    workspaceId,
    generation,
    requestId: 'office-request'
  };
  const xlsx = await coordinator.preview({
    ...baseRequest,
    resultToken: 'xlsx-token'
  });
  assert.equal(xlsx.kind, 'office');
  assert.equal(xlsx.adapter, 'xlsx');
  assert.equal(xlsx.sourceExtension, '.xlsm');
  assert.equal('relativePath' in xlsx, false);
  assert.equal('bytes' in xlsx, false);
  const xlsxRead = { ...baseRequest, resultToken: 'xlsx-token', readGrant: xlsx.readGrant };
  assert.equal((await coordinator.openOfficeRead(xlsxRead)).totalBytes, 4);
  await assert.rejects(() => coordinator.openOfficeRead(xlsxRead), /unavailable/u);
  const xlsxChunk = await coordinator.readOfficeChunk({ ...xlsxRead, offset: 0 });
  assert.deepEqual([...new Uint8Array(xlsxChunk.bytes)], [1, 2, 3, 4]);
  assert.equal(xlsxChunk.eof, true);

  const docx = await coordinator.preview({ ...baseRequest, resultToken: 'docx-token' });
  assert.equal(docx.kind, 'office');
  assert.equal(docx.adapter, 'docx');
  const docxRead = { ...baseRequest, resultToken: 'docx-token', readGrant: docx.readGrant };
  await coordinator.openOfficeRead(docxRead);
  const docxRevision = preparedGrant.selectionRevision;
  const docxCancelCount = calls.filter(
    (call) => call[0] === 'cancel' && call[3] === docxRevision
  ).length;
  await assert.rejects(
    () => coordinator.readOfficeChunk({ ...docxRead, offset: 1 }),
    /offset is invalid/u
  );
  assert.equal(handleOpen, false);
  assert.equal(
    calls.filter((call) => call[0] === 'cancel' && call[3] === docxRevision).length,
    docxCancelCount + 1
  );
  await assert.rejects(
    () => coordinator.readOfficeChunk({ ...docxRead, offset: 0 }),
    /unavailable/u
  );
  await assert.rejects(() => coordinator.openOfficeRead(docxRead), /unavailable/u);

  const pptx = await coordinator.preview({ ...baseRequest, resultToken: 'pptx-token' });
  assert.equal(pptx.kind, 'office');
  assert.equal(pptx.adapter, 'pptx');
  const pptxRead = { ...baseRequest, resultToken: 'pptx-token', readGrant: pptx.readGrant };
  await coordinator.openOfficeRead(pptxRead);
  const pptxRevision = preparedGrant.selectionRevision;
  const pptxCancelCount = calls.filter(
    (call) => call[0] === 'cancel' && call[3] === pptxRevision
  ).length;
  readFailure = new Error('Simulated Office read I/O failure.');
  await assert.rejects(
    () => coordinator.readOfficeChunk({ ...pptxRead, offset: 0 }),
    /simulated Office read I\/O failure/iu
  );
  readFailure = null;
  assert.equal(handleOpen, false);
  assert.equal(
    calls.filter((call) => call[0] === 'cancel' && call[3] === pptxRevision).length,
    pptxCancelCount + 1
  );
  await assert.rejects(
    () => coordinator.readOfficeChunk({ ...pptxRead, offset: 0 }),
    /unavailable/u
  );
  await assert.rejects(() => coordinator.openOfficeRead(pptxRead), /unavailable/u);

  await coordinator.preview({ ...baseRequest, resultToken: 'pptx-token' });
  const activePptx = calls.findLast((call) => call[0] === 'prepare');
  await coordinator.preview({ ...baseRequest, resultToken: 'info-token' });
  assert.equal(
    calls.some((call) => call[0] === 'cancel' && call[3] === activePptx[2]),
    true
  );
  await assert.rejects(
    () =>
      coordinator.openOfficeRead({
        ...baseRequest,
        resultToken: 'pptx-token',
        readGrant: 'forged-grant'
      }),
    /unavailable/u
  );
  await coordinator.shutdown();
  assert.equal(
    calls.some((call) => call[0] === 'dispose'),
    true
  );
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

  openOfficeRead(params) {
    return this.defer('openOfficeRead', params);
  }

  readOfficeChunk(params) {
    return this.defer('readOfficeChunk', params);
  }

  cancelOfficeRead(params) {
    return this.defer('cancelOfficeRead', params);
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

test('file-search relay diagnostics terminal every early initialize/search exit exactly once', async () => {
  const lines = [];
  let now = 10;
  let sequence = 0;
  const diagnostics = {
    now: () => now,
    elapsed: (startedAt) => Math.max(0, now - startedAt),
    nextTag: () => `x${++sequence}`,
    emit: (event, fields) => {
      lines.push({ event, ...fields });
      return true;
    }
  };
  const relay = new runtime.FileSearchRuntimeRelayService(diagnostics);
  const client = new FakeFileSearchClient();
  await assert.rejects(relay.call('host-token', 'search', {}, 5), /runtime stopped unexpectedly/);
  now = 20;
  relay.attach({
    hostToken: 'host-token',
    hostId: 'host-id',
    bootstrapToken: 'bootstrap-token',
    capability,
    client,
    broadcast: () => undefined
  });
  await assert.rejects(relay.call('wrong-host', 'initialize', {}, 5), /does not belong/);
  now = 30;
  const malformed = relay.call('host-token', 'search', {}, 5);
  client.respond('search', { ok: true, value: {} });
  await assert.rejects(malformed, /invalid/i);
  assert.deepEqual(
    lines.map(({ event, outcome }) => [event, outcome ?? null]),
    [
      ['xpc-start', null],
      ['xpc-terminal', 'failure'],
      ['xpc-start', null],
      ['xpc-terminal', 'failure'],
      ['xpc-start', null],
      ['xpc-terminal', 'failure']
    ]
  );
  assert.deepEqual(
    lines.filter(({ event }) => event === 'xpc-terminal').map(({ elapsedMs }) => elapsedMs),
    [0, 0, 0]
  );
});

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
        value: { snapshot: classifiedSnapshot }
      }),
    (error) => error?.code === 'HOST_ROLE_DENIED'
  );
  assert.deepEqual(
    relay.publish({
      capability,
      eventName: 'onlypreview/search-snapshot',
      value: { snapshot: classifiedSnapshot }
    }),
    { ok: true }
  );

  client.respond('initialize', { ok: true, value: classifiedSnapshot });
  await initialize;
  const browseRequest = {
    hostToken: 'host-token',
    workspaceId,
    generation,
    directoryToken: classifiedBrowseListing.directoryToken
  };
  const browse = relay.call('host-token', 'browseDirectory', browseRequest, 5_000);
  client.respond('browseDirectory', { ok: true, value: classifiedBrowseListing });
  assert.deepEqual(await browse, { ok: true, value: classifiedBrowseListing });

  relay.publish({
    capability,
    eventName: 'onlypreview/browse-listing',
    value: { listing: classifiedBrowseListing }
  });
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
  assert.deepEqual(
    broadcasts.map(({ eventName }) => eventName),
    ['onlypreview/search-snapshot', 'onlypreview/browse-listing', 'onlypreview/search-batch']
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

  const officeReadRequest = {
    ...previewRequest,
    readGrant: 'office-read-grant'
  };
  const openOffice = relay.call('host-token', 'openOfficeRead', officeReadRequest, 5_000);
  client.respond('openOfficeRead', {
    ok: true,
    value: {
      workspaceId,
      generation,
      requestId: request.requestId,
      resultToken: fileSearchResult.resultToken,
      readGrant: officeReadRequest.readGrant,
      totalBytes: 4
    }
  });
  assert.equal((await openOffice).ok, true);
  const readOffice = relay.call(
    'host-token',
    'readOfficeChunk',
    { ...officeReadRequest, offset: 0 },
    5_000
  );
  client.respond('readOfficeChunk', {
    ok: true,
    value: {
      workspaceId,
      generation,
      requestId: request.requestId,
      resultToken: fileSearchResult.resultToken,
      readGrant: officeReadRequest.readGrant,
      offset: 0,
      bytes: new Uint8Array([1, 2, 3, 4]).buffer,
      eof: true
    }
  });
  assert.equal((await readOffice).ok, true);
  const cancelOffice = relay.call('host-token', 'cancelOfficeRead', officeReadRequest, 5_000);
  client.respond('cancelOfficeRead', { ok: true, value: undefined });
  assert.equal((await cancelOffice).ok, true);

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
  await assert.rejects(malformedPreview, (error) => error?.code === 'INDEX_PROTOCOL_ERROR');
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
