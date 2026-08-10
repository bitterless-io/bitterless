import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import {
  createOnlyPreviewSearchCoordinatorRuntime,
} from '../../src/preload/onlypreview/search/core/worker-client.mjs';

class MockWorker extends EventEmitter {
  constructor() {
    super();
    this.messages = [];
    this.terminated = false;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  async terminate() {
    this.terminated = true;
    return 0;
  }

  messagesOfType(type) {
    return this.messages.filter((message) => message.type === type);
  }

  succeed(messageId, value) {
    this.emit('message', { type: 'response', messageId, ok: true, value });
  }

  fail(messageId, code = 'CANCELLED') {
    this.emit('message', {
      type: 'response',
      messageId,
      ok: false,
      error: { code, message: code === 'CANCELLED' ? 'Search cancelled.' : 'failed' },
    });
  }
}

const nextTurn = async () => await new Promise((resolve) => setImmediate(resolve));

const searchValue = (requestId, overrides = {}) => ({
  workspaceId: 'workspace',
  generation: 1,
  requestId,
  query: requestId,
  maxResults: 500,
  scope: { kind: 'project' },
  ...overrides,
});

const row = (relativePath, contentMatch = null) => ({
  fileName: relativePath,
  relativePath,
  mediaType: 'text',
  contentMatch,
});

test('worker client bursts dispatch active then latest only with private Atomics cancellation', async () => {
  const worker = new MockWorker();
  const acceptedBatches = [];
  const coordinator = createOnlyPreviewSearchCoordinatorRuntime({
    worker,
    onSearchBatch: (batch) => acceptedBatches.push(batch),
  });

  const first = coordinator.search(searchValue('first'));
  const firstOutcome = first.catch((error) => error.code);
  await nextTurn();
  const firstMessage = worker.messagesOfType('search')[0];
  assert.ok(firstMessage.value.cancelBuffer instanceof SharedArrayBuffer);
  assert.deepEqual(firstMessage.value.scope, { kind: 'project' });
  assert.equal(worker.messagesOfType('search').length, 1);

  const middle = coordinator.search(searchValue('middle'));
  const middleOutcome = middle.catch((error) => error.code);
  const final = coordinator.search(searchValue('final'));
  assert.equal(Atomics.load(new Int32Array(firstMessage.value.cancelBuffer), 0), 1);
  assert.equal(worker.messagesOfType('search').length, 1);
  worker.fail(firstMessage.messageId);
  assert.equal(await firstOutcome, 'CANCELLED');
  assert.equal(await middleOutcome, 'CANCELLED');
  await nextTurn();

  const searchMessages = worker.messagesOfType('search');
  assert.equal(searchMessages.length, 2);
  assert.equal(searchMessages[1].value.requestId, 'final');
  worker.emit('message', {
    type: 'search-batch',
    workspaceId: 'wrong-workspace',
    generation: 1,
    requestId: 'final',
    results: [row('wrong.txt')],
  });
  worker.emit('message', {
    type: 'search-batch',
    workspaceId: 'workspace',
    generation: 1,
    requestId: 'final',
    results: [row('final.txt')],
  });
  worker.succeed(searchMessages[1].messageId, {
    workspaceId: 'workspace',
    generation: 1,
    requestId: 'final',
    truncated: false,
    resultOrder: ['final.txt'],
  });
  assert.deepEqual(await final, {
    workspaceId: 'workspace',
    generation: 1,
    requestId: 'final',
    results: [row('final.txt')],
    truncated: false,
  });
  assert.equal(acceptedBatches.length, 1);
  assert.equal(acceptedBatches[0].requestId, 'final');

  const shutdown = coordinator.shutdown();
  await nextTurn();
  const shutdownMessage = worker.messagesOfType('shutdown')[0];
  worker.succeed(shutdownMessage.messageId, undefined);
  await shutdown;
  assert.equal(worker.terminated, true);
});

test('worker client accepts only exact bounded relative watch commits', async () => {
  const worker = new MockWorker();
  const accepted = [];
  const coordinator = createOnlyPreviewSearchCoordinatorRuntime({
    worker,
    onWatchCommit: (commit) => accepted.push(commit),
  });
  const valid = {
    workspaceId: 'workspace',
    generation: 4,
    revision: 7,
    full: false,
    changedRelativePaths: ['selected.txt', 'folder'],
  };
  worker.emit('message', { type: 'watch-commit', commit: valid });
  worker.emit('message', {
    type: 'watch-commit',
    commit: { ...valid, revision: 8, changedRelativePaths: ['/absolute.txt'] },
  });
  worker.emit('message', {
    type: 'watch-commit',
    commit: { ...valid, revision: 9, changedRelativePaths: ['../outside.txt'] },
  });
  worker.emit('message', {
    type: 'watch-commit',
    commit: { ...valid, revision: 10, extra: true },
  });
  assert.deepEqual(accepted, [valid]);

  const shutdown = coordinator.shutdown();
  await nextTurn();
  worker.succeed(worker.messagesOfType('shutdown')[0].messageId, undefined);
  await shutdown;
});

test('refresh drains active search, cancels pending, and starts no mutation concurrently', async () => {
  const worker = new MockWorker();
  const coordinator = createOnlyPreviewSearchCoordinatorRuntime({ worker });
  const active = coordinator.search(searchValue('active'));
  const activeOutcome = active.catch((error) => error.code);
  await nextTurn();
  const activeMessage = worker.messagesOfType('search')[0];
  const pending = coordinator.search(searchValue('pending'));
  const pendingOutcome = pending.catch((error) => error.code);
  const refresh = coordinator.refresh({ workspaceId: 'workspace', generation: 1 });
  await nextTurn();
  assert.equal(worker.messagesOfType('refresh').length, 0);
  assert.equal(Atomics.load(new Int32Array(activeMessage.value.cancelBuffer), 0), 1);
  worker.fail(activeMessage.messageId);
  assert.equal(await activeOutcome, 'CANCELLED');
  assert.equal(await pendingOutcome, 'CANCELLED');
  await nextTurn();
  const refreshMessage = worker.messagesOfType('refresh')[0];
  assert.ok(refreshMessage);
  worker.succeed(refreshMessage.messageId, {
    workspaceId: 'workspace',
    generation: 1,
    state: 'ready',
    index: { workspaceId: 'workspace', entries: [], truncated: false, limit: 0 },
    memory: {},
  });
  await refresh;

  const shutdown = coordinator.shutdown();
  await nextTurn();
  worker.succeed(worker.messagesOfType('shutdown')[0].messageId, undefined);
  await shutdown;
});

test('batch upserts enrich a path, stay at 50, and final metadata reconstructs canonical order', async () => {
  const worker = new MockWorker();
  const accepted = [];
  const coordinator = createOnlyPreviewSearchCoordinatorRuntime({
    worker,
    onSearchBatch: (batch) => accepted.push(batch),
  });
  const operation = coordinator.search(searchValue('enrich'));
  await nextTurn();
  const message = worker.messagesOfType('search')[0];
  const title = row('same.txt');
  const enriched = row('same.txt', {
    snippetText: 'needle',
    highlightStart: 0,
    highlightLength: 6,
  });
  worker.emit('message', {
    type: 'search-batch',
    workspaceId: 'workspace',
    generation: 1,
    requestId: 'enrich',
    results: [title],
  });
  worker.emit('message', {
    type: 'search-batch',
    workspaceId: 'workspace',
    generation: 1,
    requestId: 'enrich',
    results: [enriched],
  });
  worker.succeed(message.messageId, {
    workspaceId: 'workspace',
    generation: 1,
    requestId: 'enrich',
    truncated: false,
    resultOrder: ['same.txt'],
  });
  const response = await operation;
  assert.deepEqual(response.results, [enriched]);
  assert.deepEqual(accepted.map(({ results }) => results), [[title], [enriched]]);
  assert.equal(accepted.every(({ results }) => results.length <= 50), true);
  const messageCount = worker.messages.length;
  await coordinator.cancel({ requestId: 'enrich' });
  assert.equal(worker.messages.length, messageCount);

  const shutdown = coordinator.shutdown();
  await nextTurn();
  worker.succeed(worker.messagesOfType('shutdown')[0].messageId, undefined);
  await shutdown;
});
