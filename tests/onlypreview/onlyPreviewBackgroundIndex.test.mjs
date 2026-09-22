/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { setImmediate as tick } from 'node:timers/promises';
import { test } from 'node:test';
import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '../..');
const bundle = await build({
  stdin: {
    contents: `
      export { FileSearchRuntime } from './src/preload/fileSearch/fileSearchRuntime';
      export { FileSearchRuntimeRelayService } from './src/main/fileSearch/fileSearchRuntimeRelay.service';
      export { OnlyPreviewContractError, onlyPreviewFailure } from './src/shared/onlypreview/onlyPreview.contract';
      export { isOnlyPreviewSearchErrorPayload, isOnlyPreviewSearchFailureEvent } from './src/shared/onlypreview/onlyPreviewSearchFailure.contract';
      export { createOnlyPreviewSearchDiagnostics } from './src/shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';
    `,
    resolveDir: root,
    loader: 'ts'
  },
  write: false, bundle: true, platform: 'node', format: 'esm', target: 'node22',
  tsconfig: resolve(root, 'tsconfig.node.json'),
  plugins: [{
    name: 'background-index-coordinator-boundary',
    setup(context) {
      context.onResolve({ filter: /^\.\/fileSearchCoordinator$/ }, () => ({
        path: 'coordinator', namespace: 'background-index'
      }));
      context.onLoad({ filter: /.*/, namespace: 'background-index' }, () => ({
        contents: "export const createFileSearchCoordinator = () => { throw new Error('Inject a test coordinator'); };"
      }));
    }
  }]
});
const {
  FileSearchRuntime, FileSearchRuntimeRelayService, OnlyPreviewContractError, onlyPreviewFailure,
  isOnlyPreviewSearchErrorPayload, isOnlyPreviewSearchFailureEvent, createOnlyPreviewSearchDiagnostics
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const diagnostics = () => createOnlyPreviewSearchDiagnostics({ write: () => undefined });

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const request = { hostToken: 'host-token-0000000000000001', workspaceId: 'workspace-000000000000001', generation: 1 };
const bootstrap = { workspaceId: request.workspaceId, rootPath: '/test/workspace', databasePath: '/test/cache/index.sqlite' };
const memory = {
  measurementComplete: false, processRssBytes: null, workerHeapUsedBytes: null,
  workerExternalBytes: null, treeMetadataEntryCount: null, treeMetadataEstimatedBytes: null,
  filenameTierEstimatedBytes: null, diskIndexBytes: null,
  runtimeOneGiBWarning: false, runtimeTwoGiBLimitExceeded: false
};
const snapshot = (state = 'building', generation = 1) => ({
  workspaceId: request.workspaceId, generation, state,
  index: { workspaceId: request.workspaceId, entries: [], truncated: false, limit: 0 }, memory
});
const searchRequest = { ...request, requestId: 'request-00000000000000001', query: 'needle', maxResults: 250, scope: { kind: 'project' } };
const searchResponse = () => ({
  workspaceId: request.workspaceId, generation: 1, requestId: searchRequest.requestId,
  files: [], contents: [], filesTruncated: false, contentsTruncated: false
});
const fixture = () => {
  const events = [], coordinators = [];
  const runtime = new FileSearchRuntime({ emit: (name, value) => events.push({ name, value }) }, (callbacks) => {
    const coordinator = {
      callbacks, initializes: [], refreshes: [], stopped: 0,
      initialize() { const call = deferred(); this.initializes.push(call); return call.promise; },
      refresh() { const call = deferred(); this.refreshes.push(call); return call.promise; },
      hasActiveSearchIndex: () => false,
      beginDeleteTaskCalls: [],
      async beginDeleteTask(value) { this.beginDeleteTaskCalls.push(value); return { taskId: 'task-000000000000001' }; },
      finishDeleteTaskCalls: [],
      async finishDeleteTask(value) { this.finishDeleteTaskCalls.push(value); return { removedFileCount: value.removedPaths.length }; },
      async shutdown() { this.stopped += 1; }
    };
    coordinators.push(coordinator);
    return coordinator;
  }, diagnostics());
  return { runtime, events, coordinators };
};
const start = async (f, generation = 1) => {
  const result = f.runtime.initialize({ ...request, generation }, bootstrap);
  await tick();
  return { result, coordinator: f.coordinators.at(-1) };
};

test('revoking another Project leaves its pending build and progress active', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const { result, coordinator: c } = await start(f);
  await f.runtime.revokeWorkspace('different-workspace-0001');
  assert.equal(c.stopped, 0);
  c.callbacks.onSnapshot(snapshot());
  assert.equal((await result).ok, true);
  c.callbacks.onSnapshot(snapshot('ready'));
  c.initializes[0].resolve(snapshot('ready'));
  await tick();
  assert.deepEqual(f.events.map(({ value }) => value.snapshot.state), ['building', 'ready']);
});

test('matching Project revocation settles a pending build and fences its late events', async () => {
  const f = fixture();
  const { result, coordinator: c } = await start(f);
  await f.runtime.revokeWorkspace(request.workspaceId);
  assert.equal((await result).ok, false);
  assert.ok(c.stopped > 0);
  c.callbacks.onSnapshot(snapshot('ready'));
  c.callbacks.onProgress({ workspaceId: request.workspaceId, generation: 1, buildRevision: 1, phase: 'counting' });
  c.initializes[0].reject(new Error('late revoked build failure'));
  await tick();
  assert.deepEqual(f.events, []);
});

test('the same runtime can reopen a fresh Project and ignores the old Project revocation', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const first = await start(f);
  first.coordinator.callbacks.onSnapshot(snapshot());
  await first.result;
  await f.runtime.revokeWorkspace(request.workspaceId);

  const freshRequest = { ...request, workspaceId: 'workspace-000000000000002', generation: 2 };
  const freshBootstrap = { ...bootstrap, workspaceId: freshRequest.workspaceId };
  const freshSnapshot = {
    ...snapshot('building', 2), workspaceId: freshRequest.workspaceId,
    index: { ...snapshot().index, workspaceId: freshRequest.workspaceId }
  };
  const opened = f.runtime.initialize(freshRequest, freshBootstrap);
  await tick();
  const current = f.coordinators.at(-1);
  assert.notEqual(current, first.coordinator);
  await f.runtime.revokeWorkspace(request.workspaceId);
  assert.equal(current.stopped, 0);
  current.callbacks.onSnapshot(freshSnapshot);
  assert.equal((await opened).value.workspaceId, freshRequest.workspaceId);
  first.coordinator.callbacks.onSnapshot(snapshot('ready'));
  first.coordinator.initializes[0].reject(new Error('late old Project failure'));
  current.callbacks.onSnapshot({ ...freshSnapshot, state: 'ready' });
  current.initializes[0].resolve({ ...freshSnapshot, state: 'ready' });
  await tick();
  assert.deepEqual(f.events.slice(1).map(({ value }) => value.snapshot.workspaceId), [
    freshRequest.workspaceId, freshRequest.workspaceId
  ]);
});

test('revoking an initialization target while old shutdown is pending prevents a later coordinator', async (t) => {
  const f = fixture();
  const shutdown = deferred();
  t.after(async () => { shutdown.resolve(); await f.runtime.dispose(); });
  const first = await start(f);
  first.coordinator.callbacks.onSnapshot(snapshot('ready'));
  first.coordinator.initializes[0].resolve(snapshot('ready'));
  await first.result;
  await tick();
  first.coordinator.shutdown = async () => {
    first.coordinator.stopped += 1;
    await shutdown.promise;
  };

  const nextRequest = { ...request, workspaceId: 'workspace-000000000000003', generation: 3 };
  const opened = f.runtime.initialize(nextRequest, { ...bootstrap, workspaceId: nextRequest.workspaceId });
  await tick();
  assert.equal(first.coordinator.stopped, 1);
  assert.equal(f.coordinators.length, 1);
  await f.runtime.revokeWorkspace(request.workspaceId);
  await f.runtime.revokeWorkspace(nextRequest.workspaceId);
  shutdown.resolve();
  assert.equal((await opened).ok, false);
  assert.equal(f.coordinators.length, 1, 'a revoked target cannot resume after the previous shutdown');
  assert.equal(f.events.length, 1);
});

test('initialize acknowledges the first snapshot without waiting for a long build; ready still arrives', async () => {
  const f = fixture();
  const { result, coordinator: c } = await start(f);
  let settled = false;
  void result.then(() => { settled = true; });
  await tick();
  assert.equal(settled, false, 'no fabricated response before a real snapshot');
  c.callbacks.onSnapshot(snapshot());
  assert.equal((await result).value.state, 'building');
  assert.equal(c.stopped, 0);
  c.callbacks.onSnapshot(snapshot('ready'));
  c.initializes[0].resolve(snapshot('ready'));
  await tick();
  assert.deepEqual(f.events.map(({ value }) => value.snapshot.state), ['building', 'ready']);
  await f.runtime.dispose();
});

test('refresh coalesces with the active build and acknowledges subsequent refresh snapshots', async () => {
  const f = fixture();
  const { result, coordinator: c } = await start(f);
  c.callbacks.onSnapshot(snapshot());
  await result;
  assert.equal((await f.runtime.refresh(request)).value.state, 'building');
  assert.equal(c.initializes.length, 1);
  assert.equal(c.refreshes.length, 0);
  c.initializes[0].resolve(snapshot('ready'));
  await tick();
  const refreshed = f.runtime.refresh(request);
  c.callbacks.onSnapshot(snapshot('reconciling'));
  assert.equal((await refreshed).value.state, 'reconciling');
  const joined = f.runtime.refresh(request);
  assert.equal((await joined).value.state, 'reconciling');
  assert.equal(c.refreshes.length, 1);
  c.refreshes[0].resolve(snapshot('ready'));
  await tick();
  await f.runtime.dispose();
});

test('pre-snapshot failure stays an RPC failure; background failure is an event and Refresh retries cold initialization', async () => {
  const first = fixture();
  const early = await start(first);
  early.coordinator.initializes[0].reject(new OnlyPreviewContractError('PATH_PERMISSION_DENIED', 'Permission denied.'));
  assert.equal((await early.result).error.code, 'PATH_PERMISSION_DENIED');
  assert.equal(first.events.length, 0);
  assert.equal(early.coordinator.stopped, 1);

  const f = fixture();
  const { result, coordinator: c } = await start(f);
  c.callbacks.onSnapshot(snapshot());
  assert.equal((await result).ok, true);
  c.initializes[0].reject(new OnlyPreviewContractError('INDEX_FAILED', 'Index build failed.'));
  await tick();
  assert.equal(c.stopped, 0, 'background failure must not destroy the browsable workspace');
  assert.deepEqual(f.events.at(-1), { name: 'onlypreview/search-failure', value: {
    failure: { workspaceId: request.workspaceId, generation: 1, error: { code: 'INDEX_FAILED', message: 'Index build failed.' } }
  } });
  const retried = f.runtime.refresh(request);
  assert.equal(c.initializes.length, 2);
  assert.equal(c.refreshes.length, 0, 'cold engine cannot be refreshed without an active index');
  c.callbacks.onSnapshot(snapshot());
  assert.equal((await retried).ok, true);
  c.callbacks.onSnapshot(snapshot('ready'));
  c.initializes[1].resolve(snapshot('ready'));
  await tick();
  await f.runtime.dispose();
});

test('supersession and disposal settle pending acknowledgements and fence late progress, ready and failures', async () => {
  const f = fixture();
  const old = await start(f);
  const next = await start(f, 2);
  assert.equal((await old.result).ok, false);
  old.coordinator.callbacks.onSnapshot(snapshot('ready'));
  old.coordinator.callbacks.onProgress({ workspaceId: request.workspaceId, generation: 1, buildRevision: 1, phase: 'counting' });
  old.coordinator.initializes[0].reject(new Error('late obsolete error'));
  next.coordinator.callbacks.onSnapshot(snapshot('building', 2));
  await next.result;
  await f.runtime.dispose();
  next.coordinator.initializes[0].reject(new Error('stopped build'));
  await tick();
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].value.snapshot.generation, 2);
});

test('invalid bootstrap cannot cancel or rebind an authorized build', async () => {
  const f = fixture();
  const { result, coordinator: c } = await start(f);
  c.callbacks.onSnapshot(snapshot());
  await result;
  const refused = await f.runtime.initialize({ ...request, hostToken: 'another-host-000000000000' }, { ...bootstrap, workspaceId: 'wrong-workspace' });
  assert.equal(refused.error.code, 'WORKSPACE_ACCESS_DENIED');
  assert.equal(c.stopped, 0);
  assert.equal(f.coordinators.length, 1);
  await f.runtime.dispose();
});

const attach = (relay, client, broadcast = () => undefined) => relay.attach({
  hostToken: request.hostToken, hostId: 'host-000000000000000001', bootstrapToken: 'bootstrap',
  capability: 'capability', client, broadcast
});
const bindRelay = async (relay, client, broadcast) => {
  attach(relay, { initialize: async () => ({ ok: true, value: snapshot() }), ...client }, broadcast);
  await relay.call(request.hostToken, 'initialize', request, 1000, bootstrap);
};

test('non-search control deadlines remain bounded', async (t) => {
  const relay = new FileSearchRuntimeRelayService(diagnostics());
  const pending = deferred();
  attach(relay, { initialize: () => pending.promise });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const result = relay.call(request.hostToken, 'initialize', request, 10, bootstrap);
  const rejected = assert.rejects(result, /request timed out/);
  t.mock.timers.tick(11);
  await rejected;
  relay.detach();
});

test('failure events are generation/host fenced and use the same bounded payload validator as RPC errors', async () => {
  const relay = new FileSearchRuntimeRelayService(diagnostics());
  const emitted = [];
  const waiting = deferred();
  await bindRelay(relay, { search: () => waiting.promise }, (name, value) => emitted.push({ name, value }));
  const failure = { workspaceId: request.workspaceId, generation: 1, error: { code: 'INDEX_FAILED', message: 'Index build failed.' } };
  const publish = (value) => relay.publish({ capability: 'capability', eventName: 'onlypreview/search-failure', value: { failure: value } });
  publish({ ...failure, generation: 0 });
  assert.equal(emitted.length, 0);
  publish(failure);
  assert.equal(emitted[0].value.hostId, 'host-000000000000000001');
  assert.equal(isOnlyPreviewSearchFailureEvent(emitted[0].value), true);
  assert.throws(() => relay.publish({ capability: 'wrong', eventName: 'onlypreview/search-failure', value: { failure } }), { code: 'HOST_ROLE_DENIED' });
  for (const error of [
    { code: 'UNKNOWN', message: 'Bad' },
    { code: 'INDEX_FAILED', message: '/private/path' },
    { code: 'INDEX_FAILED', message: 'x'.repeat(4097) },
    { code: 'INDEX_FAILED', message: 'Bad', extra: true }
  ]) {
    assert.equal(isOnlyPreviewSearchFailureEvent({ hostId: 'host', failure: { ...failure, error } }), false);
  }
  const result = relay.call(request.hostToken, 'search', searchRequest, 1000);
  const rejected = assert.rejects(result, { code: 'INDEX_PROTOCOL_ERROR' });
  assert.throws(() => publish({ ...failure, extra: true }), { code: 'INDEX_PROTOCOL_ERROR' });
  await rejected;
  relay.detach();
});

// Why the real producer is in this bundle: it and the validator above used to live in separate ones,
// so the optional `causeCode` task 179 added to every failure payload was invisible here, and the
// first cancelled search latched INDEX_PROTOCOL_ERROR for the life of the runtime. Hand-written
// two-key literals cannot catch that — only the producer's own output can.
test('every error the search runtime can throw produces a payload this wire accepts', () => {
  const cancelled = Object.assign(new Error('Search cancelled.'), { code: 'CANCELLED' });
  const scopeGate = new TypeError('Search directory scope does not exist');
  const errno = Object.assign(new Error("ENOENT: open '/private/var/x'"), { code: 'ENOENT' });
  for (const error of [
    cancelled,
    scopeGate,
    errno,
    new Error('Search index is not ready'),
    new OnlyPreviewContractError('INDEX_FAILED', 'Index build failed.')
  ]) {
    const { error: payload } = onlyPreviewFailure(error);
    assert.equal(isOnlyPreviewSearchErrorPayload(payload), true, JSON.stringify(payload));
  }
  assert.equal(onlyPreviewFailure(cancelled).error.causeCode, 'CANCELLED');
  assert.equal(onlyPreviewFailure(scopeGate).error.causeCode, 'TypeError');
  // The cause class crosses; the path in the underlying message never does.
  assert.equal(onlyPreviewFailure(errno).error.message, 'OnlyPreview could not complete this operation.');
  for (const payload of [
    { code: 'INDEX_FAILED', message: 'Bad', causeCode: 'a/b' },
    { code: 'INDEX_FAILED', message: 'Bad', causeCode: 'a\\b' },
    { code: 'INDEX_FAILED', message: 'Bad', causeCode: 'x'.repeat(65) },
    { code: 'INDEX_FAILED', message: 'Bad', causeCode: 7 },
    { code: 'INDEX_FAILED', message: 'Bad', operation: '../etc' },
    { code: 'INDEX_FAILED', message: 'Bad', unexpected: 'x' },
    { code: 'INDEX_FAILED' },
    { message: 'Bad' }
  ]) {
    assert.equal(isOnlyPreviewSearchErrorPayload(payload), false, JSON.stringify(payload));
  }
});

test('a cancelled search answer resolves ok:false instead of latching the protocol failure', async () => {
  const relay = new FileSearchRuntimeRelayService(diagnostics());
  const cancelled = () =>
    onlyPreviewFailure(Object.assign(new Error('Search cancelled.'), { code: 'CANCELLED' }));
  await bindRelay(relay, { search: async () => cancelled() }, () => undefined);
  const answer = await relay.call(request.hostToken, 'search', searchRequest, 1000);
  assert.equal(answer.ok, false);
  assert.equal(answer.error.causeCode, 'CANCELLED');
  // The latch is what made this permanent: a second query has to still be answerable.
  const again = await relay.call(request.hostToken, 'search', searchRequest, 1000);
  assert.equal(again.ok, false);
  relay.detach();
});

test('a late building acknowledgement cannot regress a newer ready snapshot in Main', async () => {
  const relay = new FileSearchRuntimeRelayService(diagnostics());
  const pending = deferred();
  attach(relay, { initialize: () => pending.promise });
  const result = relay.call(request.hostToken, 'initialize', request, 1000, bootstrap);
  relay.publish({ capability: 'capability', eventName: 'onlypreview/search-snapshot', value: { snapshot: snapshot('ready') } });
  pending.resolve({ ok: true, value: snapshot('building') });
  assert.equal((await result).value.state, 'ready');
  relay.detach();
});

test('real runtime and relay acknowledge before 10 minutes while the background build continues past 14 minutes', async (t) => {
  const f = fixture();
  const relay = new FileSearchRuntimeRelayService(diagnostics());
  attach(relay, { initialize: ({ request: value, bootstrap: granted }) => f.runtime.initialize(value, granted) });
  f.runtime.registration.emit = (eventName, value) => relay.publish({ capability: 'capability', eventName, value });
  t.after(async () => { relay.detach(); await f.runtime.dispose(); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const initialized = relay.call(request.hostToken, 'initialize', request, 600_000, bootstrap);
  await tick();
  const c = f.coordinators[0];
  c.callbacks.onSnapshot(snapshot());
  assert.equal((await initialized).value.state, 'building');
  t.mock.timers.tick(850_000);
  assert.equal(c.stopped, 0);
  c.callbacks.onSnapshot(snapshot('ready'));
  c.initializes[0].resolve(snapshot('ready'));
  await tick();
  assert.equal(c.stopped, 0);
});

const counting = (buildRevision = 1) => ({ workspaceId: request.workspaceId, generation: request.generation, phase: 'counting', buildRevision });
const indexing = (completed, buildRevision = 1) => ({ ...counting(buildRevision), phase: 'indexing', completed, total: 100 });
const publishProgress = (relay, progress) => {
  return relay.publish({ capability: 'capability', eventName: 'onlypreview/search-progress', value: { progress } });
};

test('only advancing build progress renews the same-generation search idle deadline', async (t) => {
  const relay = new FileSearchRuntimeRelayService(diagnostics());
  const pending = deferred();
  await bindRelay(relay, { search: () => pending.promise });
  t.after(() => relay.detach());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const searched = relay.call(request.hostToken, 'search', searchRequest, 60_000);
  let settled = false;
  void searched.then(() => { settled = true; });
  for (const progress of [counting(), indexing(0), indexing(1), counting(2), indexing(0, 2)]) {
    t.mock.timers.tick(59_000);
    publishProgress(relay, progress);
    await tick();
    assert.equal(settled, false);
  }
  pending.resolve({ ok: true, value: searchResponse() });
  assert.equal((await searched).ok, true);
});

for (const [label, baseline, repeated] of [
  ['counting duplicates', counting(), counting()],
  ['completed duplicates', indexing(10), indexing(10)],
  ['completed regression', indexing(10), indexing(9)],
  ['phase regression', indexing(10), counting()],
  ['old build revisions', indexing(10, 2), indexing(20, 1)],
  ['total-only changes', indexing(10), { ...indexing(10), total: 200 }],
  ['stale generations', indexing(10), { ...indexing(20), generation: 0 }],
  ['other workspaces', indexing(10), { ...indexing(20), workspaceId: 'other-workspace' }]
]) {
  test(`${label} cannot renew a search deadline`, async (t) => {
    const relay = new FileSearchRuntimeRelayService(diagnostics());
    await bindRelay(relay, { search: () => deferred().promise });
    t.after(() => relay.detach());
    publishProgress(relay, baseline);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const rejected = assert.rejects(relay.call(request.hostToken, 'search', searchRequest, 60_000), /request timed out/);
    t.mock.timers.tick(59_000);
    publishProgress(relay, repeated);
    t.mock.timers.tick(1001);
    await rejected;
  });
}

test('malformed progress fails closed instead of extending the search deadline', async (t) => {
  const relay = new FileSearchRuntimeRelayService(diagnostics());
  await bindRelay(relay, { search: () => deferred().promise });
  t.after(() => relay.detach());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rejected = assert.rejects(relay.call(request.hostToken, 'search', searchRequest, 60_000), { code: 'INDEX_PROTOCOL_ERROR' });
  t.mock.timers.tick(59_000);
  assert.throws(() => publishProgress(relay, { ...indexing(10), extra: true }), { code: 'INDEX_PROTOCOL_ERROR' });
  await rejected;
});

test('cancelled and superseded searches cannot lease time from later progress', async (t) => {
  const relay = new FileSearchRuntimeRelayService(diagnostics());
  await bindRelay(relay, {
    search: () => deferred().promise,
    cancel: async () => ({ ok: true, value: undefined })
  });
  t.after(() => relay.detach());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const old = relay.call(request.hostToken, 'search', searchRequest, 60_000);
  const oldRejected = assert.rejects(old, /request timed out/);
  const newerRequest = { ...searchRequest, requestId: 'request-00000000000000002' };
  const newer = relay.call(request.hostToken, 'search', newerRequest, 60_000);
  const newerRejected = assert.rejects(newer, /request timed out/);
  await relay.call(request.hostToken, 'cancel', { hostToken: request.hostToken, requestId: newerRequest.requestId }, 1000);
  t.mock.timers.tick(59_000);
  publishProgress(relay, indexing(1));
  t.mock.timers.tick(1001);
  await Promise.all([oldRejected, newerRejected]);
});

test('runtime stop terminates a search immediately even after a renewed deadline', async (t) => {
  const relay = new FileSearchRuntimeRelayService(diagnostics());
  await bindRelay(relay, { search: () => deferred().promise });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rejected = assert.rejects(relay.call(request.hostToken, 'search', searchRequest, 60_000), /stopped unexpectedly/);
  t.mock.timers.tick(59_000);
  publishProgress(relay, indexing(1));
  relay.detach();
  await rejected;
});

test('late same-build progress after ready cannot renew a search deadline', async (t) => {
  const relay = new FileSearchRuntimeRelayService(diagnostics());
  await bindRelay(relay, { search: () => deferred().promise });
  t.after(() => relay.detach());
  publishProgress(relay, indexing(10));
  relay.publish({ capability: 'capability', eventName: 'onlypreview/search-snapshot', value: { snapshot: snapshot('ready') } });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const rejected = assert.rejects(relay.call(request.hostToken, 'search', searchRequest, 60_000), /request timed out/);
  t.mock.timers.tick(59_000);
  publishProgress(relay, indexing(20));
  t.mock.timers.tick(1001);
  await rejected;
});

// `beginDeleteTask` / `finishDeleteTask`(index-solution.html #4)—— `fileSearch.preload.ts` 的
// `commitDelete` 直接调用它们(不经 XPC),这里钉的是 `FileSearchRuntime` 这一层的合同:
// 用自己的 `active.workspaceId`/`active.generation` 去喂 coordinator,调用方不需要、也不能
// 传入这两个字段(传了也会被忽略——它们不是这两个方法的参数)。
test('beginDeleteTask feeds the coordinator the runtime\'s own workspace/generation, not a caller-supplied one', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const { coordinator: c } = await start(f, 7);
  const result = await f.runtime.beginDeleteTask(['docs/readme.md', 'docs/old']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { taskId: 'task-000000000000001' });
  assert.deepEqual(c.beginDeleteTaskCalls, [
    { workspaceId: request.workspaceId, generation: 7, relativePaths: ['docs/readme.md', 'docs/old'] }
  ]);
});

test('finishDeleteTask feeds the coordinator the runtime\'s own workspace/generation', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const { coordinator: c } = await start(f, 7);
  const result = await f.runtime.finishDeleteTask('task-000000000000001', ['docs/readme.md']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { removedFileCount: 1 });
  assert.deepEqual(c.finishDeleteTaskCalls, [
    {
      workspaceId: request.workspaceId,
      generation: 7,
      taskId: 'task-000000000000001',
      removedPaths: ['docs/readme.md']
    }
  ]);
});

// 空数组是合法的"取消"用法(`commitDelete` 失败时用它把已开的任务干净销账);它必须原样
// 传到 coordinator,不能被这一层悄悄拦成空操作。
test('finishDeleteTask with an empty removedPaths still reaches the coordinator, as a clean cancel', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const { coordinator: c } = await start(f);
  const result = await f.runtime.finishDeleteTask('task-000000000000001', []);
  assert.equal(result.ok, true);
  assert.deepEqual(c.finishDeleteTaskCalls, [
    { workspaceId: request.workspaceId, generation: 1, taskId: 'task-000000000000001', removedPaths: [] }
  ]);
});

// 没有活跃索引(从未 initialize,或已 dispose)时,两个方法都答 `ok:true, value:null` ——
// 调用方(`commitDelete`)据此跳过整套 begin/finish,而不是把"没有索引"当成错误处理。
test('beginDeleteTask and finishDeleteTask answer null without an active index, not an error', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const begin = await f.runtime.beginDeleteTask(['docs/readme.md']);
  assert.deepEqual(begin, { ok: true, value: null });
  const finish = await f.runtime.finishDeleteTask('task-000000000000001', ['docs/readme.md']);
  assert.deepEqual(finish, { ok: true, value: null });
});

/**
 * Ral 2026-09-22:「preview 的 tab 和独立窗口来回切换会导致重复的 loading project ⋯
 * 独立窗口中 loading 还没结束又切回到 tab 中」。
 *
 * 不合并时这两次调用互相拆台,而不是排队:每次 initialize 都 `++this.sessionId`,后来者一进门
 * 就让前一个的 `_requireCurrentSession` 抛错。参考机 05:00 那次,第一次等了 9 分 42 秒一次都没
 * 轮到,第二次把它判 failure,接着自己也失败,最后运行时被 FileSearchLifecycleFence 停掉。
 */
test('a repeated initialize for the same target joins the one in flight instead of superseding it', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const first = f.runtime.initialize({ ...request, generation: 1 }, bootstrap);
  await tick();
  const second = f.runtime.initialize({ ...request, generation: 1 }, bootstrap);
  await tick();

  // 一个目标只起一个 coordinator —— 第二次没有取代第一次,也就没有把它判失败。
  assert.equal(f.coordinators.length, 1);
  const c = f.coordinators[0];
  assert.equal(c.stopped, 0);

  c.callbacks.onSnapshot(snapshot());
  c.initializes[0].resolve(snapshot('ready'));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  // 同一次运行的同一份结果,不是两次各建一份。
  assert.equal(a.value.state, b.value.state);
});

test('a different generation still supersedes — that is what sessionId is for', async (t) => {
  const f = fixture();
  t.after(() => f.runtime.dispose());
  const first = f.runtime.initialize({ ...request, generation: 1 }, bootstrap);
  await tick();
  const second = f.runtime.initialize({ ...request, generation: 2 }, bootstrap);
  await tick();

  assert.equal(f.coordinators.length, 2);
  assert.equal((await first).ok, false, '换了 generation 的调用理应取代前一个');
  const c = f.coordinators[1];
  c.callbacks.onSnapshot(snapshot(undefined, 2));
  c.initializes[0].resolve(snapshot('ready', 2));
  assert.equal((await second).ok, true);
});
