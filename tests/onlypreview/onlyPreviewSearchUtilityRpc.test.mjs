/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-onlypreview-search-rpc-'));
const bundlePath = join(buildRoot, 'runtime.mjs');

await build({
  entryPoints: [join(projectRoot, 'tests/onlypreview/searchBootstrap.runtime.entry.ts')],
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

class FakeUtilityChild extends EventEmitter {
  messages = [];

  postMessage(message) {
    this.messages.push(message);
  }
}

const createHarness = () => {
  const child = new FakeUtilityChild();
  const broadcasts = [];
  const rpc = new runtime.OnlyPreviewSearchUtilityRpcService();
  rpc.attach({
    hostToken: 'host-token',
    hostId: 'bound-host-id',
    searchToken: 'private-search-token',
    child,
    broadcast: (eventName, params) => broadcasts.push({ eventName, params }),
    onUnexpectedExit: () => {}
  });
  return { broadcasts, child, rpc };
};

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
const memory = {
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
};
const snapshot = {
  workspaceId,
  generation,
  state: 'ready',
  index: { workspaceId, entries: [entry], truncated: false, limit: 1 },
  memory
};
const result = {
  fileName: 'readme.md',
  relativePath: 'docs/readme.md',
  mediaType: 'text',
  contentMatch: { snippetText: 'A👨‍👩‍👧‍👦B', highlightStart: 1, highlightLength: 1 }
};

const emitEvent = (child, eventName, property, value, extra = {}) =>
  child.emit('message', {
    type: 'onlypreview-search-utility-event',
    eventName,
    value: { [property]: value },
    ...extra
  });

const respond = (child, requestIndex, resultValue, extra = {}) => {
  child.emit('message', {
    type: 'onlypreview-search-utility-response',
    requestId: child.messages[requestIndex].requestId,
    result: resultValue,
    ...extra
  });
};

test('Main deeply rejects malformed snapshot, batch, and watch events before broadcast', async () => {
  const { broadcasts, child, rpc } = createHarness();
  const initialize = rpc.call(
    'host-token',
    'initialize',
    { hostToken: 'host-token', workspaceId, generation },
    5_000
  );

  emitEvent(child, 'onlypreview/search-snapshot', 'snapshot', snapshot);
  const sparseEntries = new Array(1);
  const invalidSnapshots = [
    { ...snapshot, absolutePath: '/private/root' },
    { ...snapshot, index: { ...snapshot.index, absolutePath: '/private/root' } },
    { ...snapshot, index: { ...snapshot.index, entries: [{ ...entry, unexpected: true }] } },
    {
      ...snapshot,
      index: { ...snapshot.index, entries: [{ ...entry, relativePath: '/readme.md' }] }
    },
    {
      ...snapshot,
      index: { ...snapshot.index, entries: [{ ...entry, relativePath: '../readme.md' }] }
    },
    { ...snapshot, index: { ...snapshot.index, entries: sparseEntries } },
    { ...snapshot, index: { ...snapshot.index, entries: [entry, { ...entry }], limit: 2 } },
    {
      ...snapshot,
      index: {
        ...snapshot.index,
        entries: [entry, { ...entry, name: 'two.md', relativePath: 'docs/two.md' }]
      }
    },
    { ...snapshot, memory: { ...memory, rootPath: '/private/root' } },
    { ...snapshot, memory: { ...memory, processRssBytes: Number.POSITIVE_INFINITY } }
  ];
  for (const invalid of invalidSnapshots) {
    emitEvent(child, 'onlypreview/search-snapshot', 'snapshot', invalid);
  }
  child.emit('message', {
    type: 'onlypreview-search-utility-event',
    eventName: 'onlypreview/search-snapshot',
    value: { snapshot, rootPath: '/private/root' }
  });
  emitEvent(child, 'onlypreview/search-snapshot', 'snapshot', snapshot, {
    rootPath: '/private/root'
  });

  respond(child, 0, { ok: true, value: snapshot });
  assert.deepEqual(await initialize, { ok: true, value: snapshot });

  const searchRequest = {
    hostToken: 'host-token',
    workspaceId,
    generation,
    requestId: 'renderer-search-request',
    query: 'needle',
    maxResults: 2,
    scope: { kind: 'project' }
  };
  const search = rpc.call('host-token', 'search', searchRequest, 5_000);
  const batch = { workspaceId, generation, requestId: searchRequest.requestId, results: [result] };
  emitEvent(child, 'onlypreview/search-batch', 'batch', batch);
  const sparseResults = new Array(1);
  const invalidBatches = [
    { ...batch, absolutePath: '/private/root' },
    { ...batch, results: [{ ...result, relativePath: '/private/readme.md' }] },
    { ...batch, results: [{ ...result, relativePath: '../readme.md' }] },
    { ...batch, results: [{ ...result, rootPath: '/private/root' }] },
    { ...batch, results: sparseResults },
    { ...batch, results: [result, { ...result }] },
    {
      ...batch,
      results: [result, { ...result, fileName: 'two.md', relativePath: 'docs/two.md' }, result]
    },
    {
      ...batch,
      results: [{ ...result, contentMatch: { ...result.contentMatch, highlightStart: 3 } }]
    },
    {
      ...batch,
      results: [
        { ...result, contentMatch: { ...result.contentMatch, absolutePath: '/private/root' } }
      ]
    },
    {
      ...batch,
      results: [
        {
          ...result,
          contentMatch: {
            snippetText: 'x'.repeat(65_537),
            highlightStart: 0,
            highlightLength: 1
          }
        }
      ]
    }
  ];
  for (const invalid of invalidBatches) {
    emitEvent(child, 'onlypreview/search-batch', 'batch', invalid);
  }

  const commit = {
    workspaceId,
    generation,
    revision: 1,
    full: false,
    changedRelativePaths: ['docs/readme.md']
  };
  emitEvent(child, 'onlypreview/search-watch-commit', 'commit', commit);
  const sparsePaths = new Array(1);
  const invalidCommits = [
    { ...commit, absolutePath: '/private/root' },
    { ...commit, changedRelativePaths: ['/private/readme.md'] },
    { ...commit, changedRelativePaths: ['../readme.md'] },
    { ...commit, changedRelativePaths: sparsePaths },
    { ...commit, changedRelativePaths: ['docs/readme.md', 'docs/readme.md'] },
    {
      ...commit,
      changedRelativePaths: Array.from({ length: 513 }, (_, index) => `docs/${index}.md`)
    },
    { ...commit, full: true, changedRelativePaths: ['docs/readme.md'] }
  ];
  for (const invalid of invalidCommits) {
    emitEvent(child, 'onlypreview/search-watch-commit', 'commit', invalid);
  }

  assert.deepEqual(
    broadcasts.map(({ eventName }) => eventName),
    ['onlypreview/search-snapshot', 'onlypreview/search-batch', 'onlypreview/search-watch-commit']
  );
  respond(child, 1, {
    ok: true,
    value: {
      workspaceId,
      generation,
      requestId: searchRequest.requestId,
      results: [result],
      truncated: false
    }
  });
  assert.equal((await search).ok, true);
  rpc.detach();
});

test('utility responses are exact, pending-bound, and validated by requested method', async () => {
  const { child, rpc } = createHarness();
  const expectProtocolRejection = async (operation) => {
    await assert.rejects(operation, (error) => error?.code === 'PROTOCOL_ERROR');
  };

  let operation = rpc.call('host-token', 'cancel', { requestId: 'renderer-request-id' }, 5_000);
  respond(child, 0, { ok: true, value: undefined }, { rootPath: '/private/root' });
  await expectProtocolRejection(operation);

  operation = rpc.call('host-token', 'cancel', { requestId: 'renderer-request-id' }, 5_000);
  respond(child, 1, { ok: true, value: { rootPath: '/private/root' } });
  await expectProtocolRejection(operation);

  operation = rpc.call('host-token', 'shutdown', { hostToken: 'host-token' }, 5_000);
  respond(child, 2, {
    ok: false,
    error: { code: 'OPERATION_FAILED', message: 'Failed at /private/root.' }
  });
  await expectProtocolRejection(operation);

  operation = rpc.call('host-token', 'shutdown', { hostToken: 'host-token' }, 5_000);
  const safeFailure = {
    ok: false,
    error: { code: 'OPERATION_FAILED', message: 'OnlyPreview could not complete this operation.' }
  };
  respond(child, 3, safeFailure);
  assert.deepEqual(await operation, safeFailure);

  operation = rpc.call(
    'host-token',
    'browseDirectory',
    { hostToken: 'host-token', workspaceId, generation, directoryToken: 'directory-token' },
    5_000
  );
  respond(child, 4, {
    ok: true,
    value: {
      workspaceId,
      generation,
      requestId: 'renderer-request-id',
      results: [],
      truncated: false
    }
  });
  await expectProtocolRejection(operation);

  operation = rpc.call(
    'host-token',
    'search',
    {
      hostToken: 'host-token',
      workspaceId,
      generation,
      requestId: 'renderer-request-id',
      query: 'needle',
      maxResults: 1,
      scope: { kind: 'project' }
    },
    5_000
  );
  respond(child, 5, {
    ok: true,
    value: {
      workspaceId,
      generation,
      requestId: 'different-request-id',
      results: [],
      truncated: false
    }
  });
  await expectProtocolRejection(operation);
  rpc.detach();
});
