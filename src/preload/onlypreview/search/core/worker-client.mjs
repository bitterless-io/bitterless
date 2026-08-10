import { randomUUID } from 'node:crypto';

import { MAX_BATCH_RESULTS, MAX_WATCH_CHANGE_PATHS } from './constants.mjs';
import { createLatestSingleFlight } from './single-flight.mjs';

export const createOnlyPreviewSearchCoordinatorRuntime = ({
  worker,
  onSnapshot,
  onSearchBatch,
  onWatchCommit,
}) => {
  const pending = new Map();
  const searchBatches = new Map();
  let closed = false;
  let shuttingDown = false;
  let controlTail = Promise.resolve();

  const rejectPending = (message) => {
    const error = new Error(message);
    for (const call of pending.values()) call.reject(error);
    pending.clear();
  };

  const isRelativePath = (value) => {
    if (typeof value !== 'string' || !value || value.length > 16_384 ||
        value.includes('\0') || value.startsWith('/') || value.startsWith('\\') ||
        /^[a-zA-Z]:/u.test(value)) return false;
    return !value.split('/').some((segment) => !segment || segment === '.' || segment === '..');
  };

  const isWatchCommit = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !==
          'changedRelativePaths,full,generation,revision,workspaceId') return false;
    return typeof value.workspaceId === 'string' && value.workspaceId.length > 0 &&
      value.workspaceId.length <= 256 && Number.isSafeInteger(value.generation) &&
      value.generation >= 0 && Number.isSafeInteger(value.revision) && value.revision > 0 &&
      typeof value.full === 'boolean' && Array.isArray(value.changedRelativePaths) &&
      value.changedRelativePaths.length <= MAX_WATCH_CHANGE_PATHS &&
      value.changedRelativePaths.every(isRelativePath);
  };

  const onMessage = (message) => {
    if (message.type === 'snapshot') {
      onSnapshot?.(message.snapshot);
      return;
    }
    if (message.type === 'watch-commit') {
      if (isWatchCommit(message.commit)) onWatchCommit?.(message.commit);
      return;
    }
    if (message.type === 'search-batch') {
      const batch = searchBatches.get(message.requestId);
      if (!batch || batch.cancelled || batch.workspaceId !== message.workspaceId ||
          batch.generation !== message.generation) return;
      if (!Array.isArray(message.results) || message.results.length > MAX_BATCH_RESULTS) {
        batch.invalid = true;
        return;
      }
      for (const result of message.results) {
        if (!batch.results.has(result.relativePath)) batch.order.push(result.relativePath);
        batch.results.set(result.relativePath, result);
      }
      onSearchBatch?.({
        workspaceId: message.workspaceId,
        generation: message.generation,
        requestId: message.requestId,
        results: message.results,
      });
      return;
    }
    const call = pending.get(message.messageId);
    if (!call) return;
    pending.delete(message.messageId);
    if (message.ok) call.resolve(message.value);
    else call.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
  };

  const onError = () => rejectPending('OnlyPreview search worker stopped unexpectedly.');
  const onExit = () => {
    closed = true;
    rejectPending('OnlyPreview search worker exited.');
  };
  worker.on('message', onMessage);
  worker.on('error', onError);
  worker.on('exit', onExit);

  const call = (request) => {
    if (closed) return Promise.reject(new Error('OnlyPreview search worker is closed.'));
    const messageId = randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(messageId, { resolve, reject });
      worker.postMessage({ ...request, messageId });
    });
  };

  const searchScheduler = createLatestSingleFlight({
    createControl: () => ({ cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT) }),
    execute: async (value, control) => {
      const batches = {
        workspaceId: value.workspaceId,
        generation: value.generation,
        order: [],
        results: new Map(),
        invalid: false,
        cancelled: false,
      };
      searchBatches.set(value.requestId, batches);
      try {
        const complete = await call({
          type: 'search',
          value: { ...value, cancelBuffer: control.cancelBuffer },
        });
        const results = complete.resultOrder.map((path) => batches.results.get(path));
        if (batches.invalid || results.some((result) => result === undefined) ||
            complete.resultOrder.length !== batches.results.size ||
            complete.workspaceId !== value.workspaceId ||
            complete.generation !== value.generation || complete.requestId !== value.requestId) {
          throw new Error('OnlyPreview search worker returned inconsistent result batches.');
        }
        return {
          workspaceId: complete.workspaceId,
          generation: complete.generation,
          requestId: complete.requestId,
          results,
          truncated: complete.truncated,
        };
      } finally {
        searchBatches.delete(value.requestId);
      }
    },
    cancelExecution: (value, control) => {
      const batch = searchBatches.get(value.requestId);
      if (batch) batch.cancelled = true;
      const state = new Int32Array(control.cancelBuffer);
      Atomics.store(state, 0, 1);
      Atomics.notify(state, 0);
    },
  });

  const runControl = (operation) => {
    const block = searchScheduler.beginBlock();
    const result = controlTail.then(async () => {
      await block.drained;
      return await operation();
    });
    controlTail = result.then(() => undefined, () => undefined);
    return result.finally(() => block.release());
  };

  return {
    initialize: async (value) => await runControl(async () =>
      await call({ type: 'initialize', value })),
    refresh: async (value) => await runControl(async () =>
      await call({ type: 'refresh', value })),
    search: async (value) => {
      if (shuttingDown) throw new Error('OnlyPreview search worker is closing.');
      return await searchScheduler.submit(value);
    },
    cancel: async (value) => {
      searchScheduler.cancelWhere((request) => request.requestId === value.requestId);
    },
    shutdown: async () => {
      if (closed || shuttingDown) return;
      shuttingDown = true;
      await runControl(async () => await call({ type: 'shutdown' }));
      await searchScheduler.close();
      closed = true;
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
      await worker.terminate();
    },
  };
};
