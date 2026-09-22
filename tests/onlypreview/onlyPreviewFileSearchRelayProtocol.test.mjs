/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { build } from 'esbuild';

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const buildRoot = mkdtempSync(join(tmpdir(), 'bitterless-file-search-protocol-'));
const bundlePath = join(buildRoot, 'relayProtocol.mjs');

await build({
  stdin: {
    contents: `
      export { FileSearchRuntimeRelayService } from './src/main/fileSearch/fileSearchRuntimeRelay.service';
      export {
        FILE_SEARCH_MAX_RETIRED_REQUESTS,
        FileSearchRetiredRequestRegistry
      } from './src/main/fileSearch/fileSearchRetiredRequest.registry';
    `,
    resolveDir: projectRoot,
    sourcefile: 'relayProtocol.entry.ts',
    loader: 'ts'
  },
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
const browseEntry = { ...entry, directoryToken: null, searchExcluded: false };
const browseListing = {
  workspaceId,
  generation,
  directoryToken: 'docs-directory-capability',
  relativePath: 'docs',
  entries: [browseEntry]
};
const fileResult = {
  section: 'files',
  resultToken: 'file-result-token',
  name: 'readme.md',
  relativePath: 'docs/readme.md',
  parentRelativePath: 'docs',
  nodeKind: 'file',
  previewHint: 'text',
  mediaType: 'text'
};
const contentResult = {
  section: 'contents',
  resultToken: 'content-result-token',
  fileName: 'readme.md',
  relativePath: 'docs/readme.md',
  parentRelativePath: 'docs',
  mediaType: 'text',
  contentMatch: { snippetText: 'A👨‍👩‍👧‍👦B', highlightStart: 1, highlightLength: 1 }
};

class FakeFileSearchClient {
  calls = [];
  pending = [];

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

  respondLast(method, value) {
    const index = this.pending.findLastIndex((pending) => pending.method === method);
    assert.notEqual(index, -1, `missing pending ${method}`);
    this.pending.splice(index, 1)[0].resolve(value);
  }
}

const createHarness = () => {
  const client = new FakeFileSearchClient();
  const broadcasts = [];
  const relay = new runtime.FileSearchRuntimeRelayService();
  const protocolFailures = [];
  relay.attach({
    hostToken: 'host-token',
    hostId: 'bound-host-id',
    bootstrapToken: 'main-private-bootstrap-token',
    capability,
    client,
    broadcast: (eventName, params) => broadcasts.push({ eventName, params }),
    onProtocolFailure: (rule) => protocolFailures.push(rule)
  });
  return { broadcasts, client, relay, protocolFailures };
};

const initialize = async ({ client, relay }) => {
  const initializing = relay.call(
    'host-token',
    'initialize',
    { hostToken: 'host-token', workspaceId, generation },
    5_000
  );
  client.respond('initialize', { ok: true, value: snapshot });
  await initializing;
};

const searchRequest = (requestId, requestGeneration = generation) => ({
  hostToken: 'host-token',
  workspaceId,
  generation: requestGeneration,
  requestId,
  query: 'needle',
  maxResults: 2,
  scope: { kind: 'project' }
});

const searchResponse = (requestId, responseGeneration = generation) => ({
  ok: true,
  value: {
    workspaceId,
    generation: responseGeneration,
    requestId,
    files: [fileResult],
    contents: [contentResult],
    filesTruncated: false,
    contentsTruncated: false
  }
});

const searchBatch = (requestId, overrides = {}) => ({
  workspaceId,
  generation,
  requestId,
  files: [fileResult],
  contents: [contentResult],
  ...overrides
});

const publishBatch = (relay, batch) =>
  relay.publish({
    capability,
    eventName: 'onlypreview/search-batch',
    value: { batch }
  });

const isIndexProtocolError = (error) => error?.code === 'INDEX_PROTOCOL_ERROR';

test('retired search request registry evicts its oldest entry at the fixed cap', () => {
  const registry = new runtime.FileSearchRetiredRequestRegistry();
  for (let index = 0; index <= runtime.FILE_SEARCH_MAX_RETIRED_REQUESTS; index += 1) {
    registry.remember({
      workspaceId,
      generation,
      requestId: `retired-${index}`,
      maxResults: 2
    });
  }
  assert.equal(registry.find(workspaceId, generation, 'retired-0'), null);
  assert.equal(
    registry.find(workspaceId, generation, `retired-${runtime.FILE_SEARCH_MAX_RETIRED_REQUESTS}`)
      ?.maxResults,
    2
  );
});

test('successful cancel retires a search before its pending terminal response', async () => {
  const harness = createHarness();
  await initialize(harness);
  const requestId = 'cancelled-search';
  const searching = harness.relay.call('host-token', 'search', searchRequest(requestId), 5_000);
  const cancelling = harness.relay.call(
    'host-token',
    'cancel',
    { hostToken: 'host-token', requestId },
    5_000
  );
  harness.client.respond('cancel', { ok: true, value: undefined });
  await cancelling;

  assert.deepEqual(publishBatch(harness.relay, searchBatch(requestId)), { ok: true });
  assert.deepEqual(harness.broadcasts, []);
  assert.equal(
    harness.client.pending.some(({ method }) => method === 'search'),
    true,
    'the original runtime search is intentionally still pending'
  );
  harness.client.respond('search', searchResponse(requestId));
  await searching;
  harness.relay.detach();
});

test('a replacement search retires an older pending request before cancel returns', async () => {
  const harness = createHarness();
  await initialize(harness);
  const firstRequestId = 'superseded-search';
  const replacementRequestId = 'replacement-search';
  const first = harness.relay.call('host-token', 'search', searchRequest(firstRequestId), 5_000);
  const replacement = harness.relay.call(
    'host-token',
    'search',
    searchRequest(replacementRequestId),
    5_000
  );

  assert.deepEqual(publishBatch(harness.relay, searchBatch(firstRequestId)), { ok: true });
  assert.deepEqual(harness.broadcasts, []);
  assert.deepEqual(publishBatch(harness.relay, searchBatch(replacementRequestId)), { ok: true });
  assert.deepEqual(
    harness.broadcasts.map(({ eventName }) => eventName),
    ['onlypreview/search-batch']
  );
  harness.client.respond('search', searchResponse(firstRequestId));
  harness.client.respond('search', searchResponse(replacementRequestId));
  await Promise.all([first, replacement]);
  harness.relay.detach();
});

test('a valid batch arriving after its search terminal is ignored', async () => {
  const harness = createHarness();
  await initialize(harness);
  const requestId = 'terminal-search';
  const searching = harness.relay.call('host-token', 'search', searchRequest(requestId), 5_000);
  harness.client.respond('search', searchResponse(requestId));
  await searching;

  assert.deepEqual(publishBatch(harness.relay, searchBatch(requestId)), { ok: true });
  assert.deepEqual(harness.broadcasts, []);
  harness.relay.detach();
});

test('a reused search request id clears its retired marker before streaming', async () => {
  const harness = createHarness();
  await initialize(harness);
  const requestId = 'reused-search';
  const first = harness.relay.call('host-token', 'search', searchRequest(requestId), 5_000);
  harness.client.respond('search', searchResponse(requestId));
  await first;

  const replacement = harness.relay.call('host-token', 'search', searchRequest(requestId), 5_000);
  assert.deepEqual(publishBatch(harness.relay, searchBatch(requestId)), { ok: true });
  assert.deepEqual(
    harness.broadcasts.map(({ eventName }) => eventName),
    ['onlypreview/search-batch']
  );
  harness.client.respond('search', searchResponse(requestId));
  await replacement;
  harness.relay.detach();
});

test('an old-generation search settling cannot overwrite a current reused-id tombstone', async () => {
  const harness = createHarness();
  await initialize(harness);
  const requestId = 'generation-reused-search';
  const oldSearch = harness.relay.call('host-token', 'search', searchRequest(requestId), 5_000);
  const nextGeneration = generation + 1;
  const reinitializing = harness.relay.call(
    'host-token',
    'initialize',
    { hostToken: 'host-token', workspaceId, generation: nextGeneration },
    5_000
  );
  harness.client.respond('initialize', {
    ok: true,
    value: { ...snapshot, generation: nextGeneration }
  });
  await reinitializing;

  const currentSearch = harness.relay.call(
    'host-token',
    'search',
    searchRequest(requestId, nextGeneration),
    5_000
  );
  harness.client.respondLast('search', searchResponse(requestId, nextGeneration));
  await currentSearch;
  harness.client.respond('search', searchResponse(requestId));
  await oldSearch;

  assert.deepEqual(
    publishBatch(harness.relay, searchBatch(requestId, { generation: nextGeneration })),
    { ok: true }
  );
  assert.deepEqual(harness.broadcasts, []);
  const priority = harness.relay.call(
    'host-token',
    'prioritizeFile',
    {
      hostToken: 'host-token',
      workspaceId,
      generation: nextGeneration,
      relativePath: entry.relativePath
    },
    5_000
  );
  harness.client.respond('prioritizeFile', { ok: true, value: undefined });
  await priority;
  harness.relay.detach();
});

test('a never-issued current-generation batch latches the index protocol failure', async () => {
  const harness = createHarness();
  await initialize(harness);
  assert.throws(
    () => publishBatch(harness.relay, searchBatch('never-issued-search')),
    isIndexProtocolError
  );
  const callCount = harness.client.calls.length;
  await assert.rejects(
    harness.relay.call(
      'host-token',
      'prioritizeFile',
      { hostToken: 'host-token', workspaceId, generation, relativePath: entry.relativePath },
      5_000
    ),
    isIndexProtocolError
  );
  assert.equal(harness.client.calls.length, callCount);
  harness.relay.detach();
});

test('a timed-out search is retired so its valid late batch stays ignorable', async () => {
  const harness = createHarness();
  await initialize(harness);
  const requestId = 'timed-out-search';
  const searching = harness.relay.call('host-token', 'search', searchRequest(requestId), 5);
  await assert.rejects(searching, /timed out/u);
  assert.deepEqual(publishBatch(harness.relay, searchBatch(requestId)), { ok: true });
  assert.deepEqual(harness.broadcasts, []);
  harness.client.respond('search', searchResponse(requestId));
  harness.relay.detach();
});

test('well-formed stale snapshots remain ignored without faulting the runtime', async () => {
  const harness = createHarness();
  await initialize(harness);
  assert.deepEqual(
    harness.relay.publish({
      capability,
      eventName: 'onlypreview/search-snapshot',
      value: { snapshot: { ...snapshot, generation: generation - 1 } }
    }),
    { ok: true }
  );
  const priority = harness.relay.call(
    'host-token',
    'prioritizeFile',
    { hostToken: 'host-token', workspaceId, generation, relativePath: entry.relativePath },
    5_000
  );
  harness.client.respond('prioritizeFile', { ok: true, value: undefined });
  await priority;
  assert.deepEqual(harness.broadcasts, []);
  harness.relay.detach();
});

const expectSnapshotEventFailure = async (invalidSnapshot) => {
  const harness = createHarness();
  const initializing = harness.relay.call(
    'host-token',
    'initialize',
    { hostToken: 'host-token', workspaceId, generation },
    5_000
  );
  assert.throws(
    () =>
      harness.relay.publish({
        capability,
        eventName: 'onlypreview/search-snapshot',
        value: { snapshot: invalidSnapshot }
      }),
    isIndexProtocolError
  );
  await assert.rejects(initializing, isIndexProtocolError);
  assert.deepEqual(harness.broadcasts, []);
  harness.client.respond('initialize', { ok: true, value: snapshot });
  harness.relay.detach();
};

test('current snapshot extra keys, invalid entries, and non-finite memory fail closed', async () => {
  for (const invalidSnapshot of [
    { ...snapshot, absolutePath: '/private/workspace' },
    { ...snapshot, index: { ...snapshot.index, entries: [{ ...entry, unexpected: true }] } },
    { ...snapshot, memory: { ...snapshot.memory, processRssBytes: Number.POSITIVE_INFINITY } }
  ]) {
    await expectSnapshotEventFailure(invalidSnapshot);
  }
});

test('a protocol latch names the failing rule and asks the host to recover', async () => {
  // latch 是粘性的:一次拒绝之后这个运行时的搜索永久失效。在此之前它既不说是哪条规则挂的
  // (日志只有 `reason=non-batch-event`,七个拒绝点压成一个词),也没有任何人因此重启运行时
  // —— 用户只能重启整个应用。两件事一起修:规则名进日志,并且把 latch 接到宿主的恢复通路上。
  const harness = createHarness();
  const initializing = harness.relay.call(
    'host-token',
    'initialize',
    { hostToken: 'host-token', workspaceId, generation },
    5_000
  );
  assert.throws(
    () =>
      harness.relay.publish({
        capability,
        eventName: 'onlypreview/search-snapshot',
        value: { snapshot: { ...snapshot, absolutePath: '/private/workspace' } }
      }),
    isIndexProtocolError
  );
  await assert.rejects(initializing, isIndexProtocolError);

  assert.equal(harness.protocolFailures.length, 1, 'the host must be told exactly once');
  assert.match(
    harness.protocolFailures[0],
    /^snapshot:/u,
    'the rule must name the event that failed, not a generic word'
  );

  // 第二次拒绝不再重复通知 —— latch 已经落定,宿主已经在恢复了。
  assert.throws(
    () =>
      harness.relay.publish({
        capability,
        eventName: 'onlypreview/search-snapshot',
        value: { snapshot }
      }),
    isIndexProtocolError
  );
  assert.equal(harness.protocolFailures.length, 1);

  harness.client.respond('initialize', { ok: true, value: snapshot });
  harness.relay.detach();
});

test('an invalid specialized hint/media pair fails the pending initialize immediately', async () => {
  await expectSnapshotEventFailure({
    ...snapshot,
    index: {
      ...snapshot.index,
      entries: [
        {
          ...entry,
          relativePath: 'docs/book.xlsx',
          name: 'book.xlsx',
          previewHint: 'sheet',
          mediaType: 'pdf',
          isText: false
        }
      ]
    }
  });
});

const expectBrowseEventFailure = async (invalidEntry) => {
  const harness = createHarness();
  await initialize(harness);
  assert.throws(
    () =>
      harness.relay.publish({
        capability,
        eventName: 'onlypreview/browse-listing',
        value: { listing: { ...browseListing, entries: [invalidEntry] } }
      }),
    isIndexProtocolError
  );
  assert.deepEqual(harness.broadcasts, []);
  harness.relay.detach();
};

test('browse entries keep strict marker, extra-key, and symlink-exclusion validation', async () => {
  const missingMarker = { ...browseEntry };
  delete missingMarker.searchExcluded;
  for (const invalidEntry of [
    missingMarker,
    { ...browseEntry, searchExcluded: 'false' },
    { ...browseEntry, unexpected: true },
    {
      ...browseEntry,
      nodeKind: 'symlink',
      previewHint: 'unsupported',
      mediaType: 'unknown',
      isText: false,
      size: 0,
      searchExcluded: true
    }
  ]) {
    await expectBrowseEventFailure(invalidEntry);
  }
});

test('an absolute path in an active search batch latches and wakes that search', async () => {
  const harness = createHarness();
  await initialize(harness);
  const requestId = 'invalid-batch-search';
  const searching = harness.relay.call('host-token', 'search', searchRequest(requestId), 5_000);
  assert.throws(
    () =>
      publishBatch(
        harness.relay,
        searchBatch(requestId, {
          files: [],
          contents: [{ ...contentResult, relativePath: '/private/readme.md' }]
        })
      ),
    isIndexProtocolError
  );
  await assert.rejects(searching, isIndexProtocolError);
  harness.client.respond('search', searchResponse(requestId));
  assert.deepEqual(harness.broadcasts, []);
  harness.relay.detach();
});

test('invalid browse and cancel terminal responses use the dedicated protocol code', async () => {
  {
    const harness = createHarness();
    await initialize(harness);
    const browsing = harness.relay.call(
      'host-token',
      'browseDirectory',
      {
        hostToken: 'host-token',
        workspaceId,
        generation,
        directoryToken: browseListing.directoryToken
      },
      5_000
    );
    harness.client.respond('browseDirectory', {
      ok: true,
      value: { ...browseListing, entries: [{ ...browseEntry, searchExcluded: 'false' }] }
    });
    await assert.rejects(browsing, isIndexProtocolError);
    harness.relay.detach();
  }
  {
    const harness = createHarness();
    const cancelling = harness.relay.call(
      'host-token',
      'cancel',
      { hostToken: 'host-token', requestId: 'cancel-invalid' },
      5_000
    );
    harness.client.respond('cancel', { ok: true, value: null });
    await assert.rejects(cancelling, isIndexProtocolError);
    harness.relay.detach();
  }
});

/**
 * The owner hit `INDEX_PROTOCOL_ERROR` twice (2026-09-17 disk-driven, 2026-09-21 batch-driven) and
 * the second was undiagnosable: a dozen rules all reported the same sentence, the rejection latches
 * the runtime until restart, and the log named neither the rule nor the row. These guards exist so
 * the third occurrence answers "which rule" from the log alone.
 */
const captureLatchNotices = (run) => {
  const notices = [];
  const original = console.info;
  console.info = (...args) => notices.push(args.join(' '));
  try {
    run();
  } finally {
    console.info = original;
  }
  return notices.filter((line) => line.includes('event=protocol-latched'));
};

const latchReasonFor = async (overrides) => {
  const harness = createHarness();
  await initialize(harness);
  const requestId = 'rejection-reason-search';
  const searching = harness.relay.call('host-token', 'search', searchRequest(requestId), 5_000);
  const notices = captureLatchNotices(() => {
    assert.throws(
      () => publishBatch(harness.relay, searchBatch(requestId, overrides)),
      isIndexProtocolError
    );
  });
  await assert.rejects(searching, isIndexProtocolError);
  harness.relay.detach();
  assert.equal(notices.length, 1, `expected one latch notice, got ${JSON.stringify(notices)}`);
  return notices[0].slice(notices[0].indexOf('reason=') + 'reason='.length);
};

test('a latched batch names the rule and the row that rejected it', async () => {
  const second = { ...fileResult, resultToken: 'second', relativePath: 'docs/a.md', name: 'a.md' };
  const third = { ...fileResult, resultToken: 'third', relativePath: 'docs/b.md', name: 'b.md' };
  const cases = [
    [
      { files: [], contents: [{ ...contentResult, relativePath: '/private/readme.md' }] },
      'contents[0] relativePath-shape'
    ],
    [
      { files: [{ ...fileResult, parentRelativePath: 'elsewhere' }], contents: [] },
      'files[0] parent-mismatch parentLen=9 expectedLen=4'
    ],
    [
      { files: [{ ...fileResult, unexpected: true }], contents: [] },
      'files[0] exact-keys missing=[] extra=[unexpected]'
    ],
    [{ files: [{ ...fileResult, nodeKind: 'symlink' }], contents: [] }, 'files[0] nodeKind=symlink'],
    [
      { files: [fileResult, { ...fileResult, resultToken: 'second' }], contents: [] },
      'files[1] duplicate-relativePath'
    ],
    // searchRequest asks for 2; the per-batch bound is the smaller of that and the wire's own cap.
    [{ files: [fileResult, second, third], contents: [] }, 'files over-cap count=3 maximum=2'],
    [
      {
        files: [],
        contents: [
          { ...contentResult, contentMatch: { snippetText: 'A👨‍👩‍👧‍👦B', highlightStart: 2, highlightLength: 5 } }
        ]
      },
      // Graphemes, not code units: the family emoji is one.
      'contents[0] highlight-overruns start=2 length=5 graphemes=3'
    ],
    // No pending search owns this id, so the batch never reaches a per-result rule. Worth pinning:
    // it is the reason a batch that merely arrived late reports, and it is not a validation failure.
    [{ requestId: 'someone-elses-search' }, 'no-matching-pending-search']
  ];
  for (const [overrides, expected] of cases) {
    assert.equal(await latchReasonFor(overrides), expected);
  }
});

/**
 * Every field the reason echoes is chosen by the producer, and the rule failed because that field
 * holds something unexpected — so "unexpected" can be a path. The failure wire drops any message
 * carrying a path separator, which would silently take the whole diagnostic with it.
 */
test('a reason never carries a path, a name, or snippet text, even when the bad value is one', async () => {
  const leaks = [
    [{ files: [{ ...fileResult, previewHint: 'docs/secret.md' }], contents: [] }, 'files[0] previewHint=<string:14>'],
    [{ files: [{ ...fileResult, nodeKind: { path: '/private/x' } }], contents: [] }, 'files[0] nodeKind=<object>'],
    [
      { files: [], contents: [{ ...contentResult, mediaType: '/Users/ral/Documents' }] },
      'contents[0] mediaType=<string:20>'
    ],
    [
      { files: [{ ...fileResult, 'docs/sneaky.md': true }], contents: [] },
      'files[0] exact-keys missing=[] extra=[<string:14>]'
    ]
  ];
  for (const [overrides, expected] of leaks) {
    const reason = await latchReasonFor(overrides);
    assert.equal(reason, expected);
    assert.doesNotMatch(reason, /[\\/]/, 'a path separator here means the log line is dropped whole');
  }
});

test('a non-batch rejection says so rather than naming a stale batch rule', async () => {
  const harness = createHarness();
  await initialize(harness);
  const notices = captureLatchNotices(() => {
    assert.throws(
      () =>
        harness.relay.publish({
          capability,
          eventName: 'onlypreview/browse-listing',
          value: { listing: { ...browseListing, entries: [{ ...browseEntry, searchExcluded: 'false' }] } }
        }),
      isIndexProtocolError
    );
  });
  assert.deepEqual(notices.map((line) => line.slice(line.indexOf('reason='))), [
    'reason=non-batch-event'
  ]);
  harness.relay.detach();
});

test('only the first rejection is reported; the latch makes every later one an echo', async () => {
  const harness = createHarness();
  await initialize(harness);
  const requestId = 'echo-search';
  const searching = harness.relay.call('host-token', 'search', searchRequest(requestId), 5_000);
  const notices = captureLatchNotices(() => {
    for (const relativePath of ['/private/one.md', '/private/two.md']) {
      assert.throws(
        () =>
          publishBatch(
            harness.relay,
            searchBatch(requestId, { files: [], contents: [{ ...contentResult, relativePath }] })
          ),
        isIndexProtocolError
      );
    }
  });
  assert.equal(notices.length, 1, 'the second publish rethrows the latched error and logs nothing');
  await assert.rejects(searching, isIndexProtocolError);
  harness.relay.detach();
});

/**
 * `_expectationOf` records `maxResults: null` for any request whose value is absent or out of range.
 * The cap was then `Math.min(50, maxResults ?? 0)` — zero — so the first non-empty batch of such a
 * search latched the whole runtime, permanently, for every other search too. An unknown per-search
 * cap is not evidence that zero results are allowed; the wire's own per-batch cap is the bound.
 */
test('a search that never recorded a result cap streams instead of latching the runtime', async () => {
  const harness = createHarness();
  await initialize(harness);
  const requestId = 'uncapped-search';
  const { maxResults: _ignored, ...uncapped } = searchRequest(requestId);
  const searching = harness.relay.call('host-token', 'search', uncapped, 5_000);
  const notices = captureLatchNotices(() => {
    assert.deepEqual(publishBatch(harness.relay, searchBatch(requestId)), { ok: true });
  });
  assert.deepEqual(notices, []);
  assert.deepEqual(
    harness.broadcasts.map(({ eventName }) => eventName),
    ['onlypreview/search-batch']
  );
  // The terminal response still refuses an uncapped search — that contract is unchanged. What the
  // fix removes is a malformed request taking the runtime down before anyone sees a result.
  harness.client.respond('search', searchResponse(requestId));
  await assert.rejects(searching, isIndexProtocolError);
  harness.relay.detach();
});
