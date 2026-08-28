/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';

import { SECTION_RESULT_CAP } from './planContract.mjs';

const DEFAULT_BATCH_FILES = 48;
const DEFAULT_BATCH_BYTES = 4 * 1024 * 1024;

const createBatches = (files, { maxFiles, batchBytes }) => {
  const batches = [];
  let current = [];
  let currentBytes = 0;
  for (const file of files) {
    current.push(file);
    currentBytes += file.size ?? 0;
    if (current.length >= maxFiles || currentBytes >= batchBytes) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
};

/**
 * A worker pool that reads and literal-scans candidate files. Created once at plan load so query
 * latency excludes worker startup, exactly as a long-lived Preview window would behave.
 */
export const createScanPool = ({ size = Math.max(1, availableParallelism() - 2) } = {}) => {
  const workers = Array.from(
    { length: size },
    () => new Worker(new URL('./scan.worker.mjs', import.meta.url))
  );
  const idle = [...workers];
  const waiting = [];
  let nextId = 0;
  let closed = false;

  const acquire = async () =>
    idle.length > 0
      ? idle.pop()
      : await new Promise((resolveWorker) => waiting.push(resolveWorker));

  const release = (worker) => {
    const next = waiting.shift();
    if (next) next(worker);
    else idle.push(worker);
  };

  const runBatch = async (worker, payload) =>
    await new Promise((resolveBatch, rejectBatch) => {
      const onMessage = (message) => {
        if (message.id !== payload.id) return;
        worker.off('message', onMessage);
        worker.off('error', onError);
        resolveBatch(message);
      };
      const onError = (error) => {
        worker.off('message', onMessage);
        worker.off('error', onError);
        rejectBatch(error);
      };
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.postMessage(payload);
    });

  return {
    size,
    /**
     * Awaits a round trip from every worker so thread bootstrap is charged to whoever creates the
     * pool - usually a plan's load - instead of silently landing on the first query.
     */
    ready: async () => {
      await Promise.all(
        workers.map(
          async (worker) =>
            await new Promise((resolveReady, rejectReady) => {
              const id = (nextId += 1);
              const onMessage = (message) => {
                if (message.id !== id) return;
                worker.off('message', onMessage);
                worker.off('error', rejectReady);
                resolveReady();
              };
              worker.on('message', onMessage);
              worker.once('error', rejectReady);
              worker.postMessage({ type: 'ready', id });
            })
        )
      );
    },

    /**
     * Batches are built in path order and dispatched in path order, so the answer is taken from the
     * contiguous completed prefix. That makes a capped result the same first-N the indexed plans
     * return, and it makes `truncated` provable: either a later batch was never dispatched, or the
     * workers counted more matches than the cap.
     */
    scan: async ({
      rootPath,
      files,
      query,
      maxResults: requestedResults,
      batchFiles: maxFiles = DEFAULT_BATCH_FILES,
      batchBytes = DEFAULT_BATCH_BYTES
    }) => {
      if (closed) throw new TypeError('Scan pool is closed');
      // The shipped engine hard-caps every section at 250 regardless of what the caller asked for.
      const maxResults = Math.min(SECTION_RESULT_CAP, Math.max(0, Math.trunc(requestedResults)));
      const counters = {
        filesRead: 0,
        bytesRead: 0,
        skipped: 0,
        unreadable: 0,
        matched: 0,
        batches: 0,
        batchesDispatched: 0,
        candidateFiles: files.length
      };
      const batches = files.length === 0 ? [] : createBatches(files, { maxFiles, batchBytes });
      counters.batches = batches.length;
      const completed = new Array(batches.length).fill(undefined);
      let contiguous = 0;
      let orderedMatches = 0;
      let firstMatchAtMs;
      let stoppedEarly = false;
      const startedAt = performance.now();
      const inFlight = new Set();
      let cursor = 0;

      const advancePrefix = () => {
        while (contiguous < batches.length && completed[contiguous] !== undefined) {
          orderedMatches += completed[contiguous].counters.matched;
          contiguous += 1;
        }
      };

      while (cursor < batches.length) {
        // Stopping at exactly the cap cannot tell "there are precisely this many matches" from
        // "there are more", and the shipped engine only reports truncated once it has actually seen
        // match number cap+1. So one extra match is the price of an honest flag.
        if (orderedMatches > maxResults) {
          stoppedEarly = true;
          break;
        }
        const index = cursor;
        cursor += 1;
        counters.batchesDispatched += 1;
        const worker = await acquire();
        const payload = {
          id: (nextId += 1),
          rootPath,
          files: batches[index],
          query,
          maxResults
        };
        const pending = runBatch(worker, payload)
          .then((message) => {
            counters.filesRead += message.counters.filesRead;
            counters.bytesRead += message.counters.bytesRead;
            counters.skipped += message.counters.skipped;
            counters.unreadable += message.counters.unreadable;
            counters.matched += message.counters.matched;
            if (message.matches.length > 0 && firstMatchAtMs === undefined) {
              firstMatchAtMs = performance.now() - startedAt;
            }
            completed[index] = message;
            advancePrefix();
          })
          .finally(() => {
            release(worker);
            inFlight.delete(pending);
          });
        inFlight.add(pending);
        if (inFlight.size >= workers.length) await Promise.race([...inFlight]);
      }
      while (inFlight.size > 0) await Promise.all([...inFlight]);
      advancePrefix();

      const usable = stoppedEarly ? completed.slice(0, contiguous) : completed;
      const matches = usable
        .filter(Boolean)
        .flatMap((message) => message.matches)
        // Binary order, matching SQLite's ORDER BY relative_path, so the indexed plans and this one
        // select the same rows when a cap applies.
        .sort((left, right) =>
          left.relativePath < right.relativePath
            ? -1
            : left.relativePath > right.relativePath
              ? 1
              : 0
        );
      counters.orderedMatches = orderedMatches;
      counters.stoppedEarly = stoppedEarly;
      return {
        matches: matches.slice(0, maxResults),
        truncated: orderedMatches > maxResults || matches.length > maxResults,
        firstMatchAtMs,
        counters
      };
    },

    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.all(workers.map(async (worker) => await worker.terminate()));
    }
  };
};
