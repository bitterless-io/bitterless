/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { parentPort } from 'node:worker_threads';

import { decodeSearchText } from '../../../src/preload/onlypreview/search/core/classification.mjs';
import { splitContentDefinedChunks } from '../../../src/preload/onlypreview/search/core/chunking.mjs';

/**
 * Bytes arrive as transferred ArrayBuffers, so a batch costs no copy on the way in. The chunk
 * records travel back by structured clone because only the main thread may touch the database.
 */
const chunkBatch = (files) => {
  const startedAt = performance.now();
  const chunked = [];
  let bytes = 0;
  for (const file of files) {
    bytes += file.bytes.byteLength;
    const source = decodeSearchText(Buffer.from(file.bytes));
    chunked.push({ relativePath: file.relativePath, chunks: splitContentDefinedChunks(source) });
  }
  return { files: chunked, counters: { bytes, chunkMs: performance.now() - startedAt } };
};

/**
 * Plan B's chunking tier. The main thread reads bytes and writes SQLite; grapheme segmentation and
 * NFKC normalisation - the two things that dominate a first build - happen here instead, so several
 * cores work while the single writer connection stays busy.
 */
parentPort.on('message', (message) => {
  if (message.type === 'stop') {
    parentPort.close();
    return;
  }
  parentPort.postMessage({ id: message.id, ...chunkBatch(message.files) });
});
