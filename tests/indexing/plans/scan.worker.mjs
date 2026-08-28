/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parentPort } from 'node:worker_threads';

import {
  decodeSearchText,
  isSensitiveSearchFile
} from '../../../src/preload/onlypreview/search/core/classification.mjs';
import { MAX_TEXT_BYTES } from '../../../src/preload/onlypreview/search/core/constants.mjs';
import {
  createPlainTextSnippet,
  normalizeSearchText
} from '../../../src/preload/onlypreview/search/core/normalization.mjs';

/**
 * Reuses the shipped snippet projection so a scanning plan and an indexed plan describe the same
 * match the same way; result parity across plans is a gate in the benchmark.
 */
const scanFile = async ({ rootPath, file, normalizedQuery, counters, projectSnippet }) => {
  if (file.size > MAX_TEXT_BYTES || isSensitiveSearchFile(file.relativePath)) {
    counters.skipped += 1;
    return undefined;
  }
  const buffer = await readFile(join(rootPath, ...file.relativePath.split('/'))).catch(
    () => undefined
  );
  if (!buffer) {
    counters.unreadable += 1;
    return undefined;
  }
  counters.filesRead += 1;
  counters.bytesRead += buffer.byteLength;
  const source = decodeSearchText(buffer);
  const normalized = normalizeSearchText(source);
  if (!normalized.includes(normalizedQuery)) return undefined;
  counters.matched += 1;
  // Snippet projection is the expensive half, so past the cap the file is counted but not rendered.
  // Without that count the pool could not tell a complete answer from a truncated one.
  if (!projectSnippet) return { relativePath: file.relativePath, counted: true };
  const contentMatch = createPlainTextSnippet(source, normalizedQuery);
  if (!contentMatch) return undefined;
  return {
    relativePath: file.relativePath,
    name: file.relativePath.split('/').at(-1),
    snippet: contentMatch.snippetText,
    highlightStart: contentMatch.highlightStart,
    highlightLength: contentMatch.highlightLength
  };
};

parentPort.on('message', async (message) => {
  if (message.type === 'stop') {
    parentPort.close();
    return;
  }
  if (message.type === 'ready') {
    parentPort.postMessage({ id: message.id, ready: true });
    return;
  }
  const counters = { filesRead: 0, bytesRead: 0, skipped: 0, unreadable: 0, matched: 0 };
  const normalizedQuery = normalizeSearchText(message.query);
  const matches = [];
  for (const file of message.files) {
    const match = await scanFile({
      rootPath: message.rootPath,
      file,
      normalizedQuery,
      counters,
      projectSnippet: matches.length < message.maxResults
    });
    if (match && !match.counted) matches.push(match);
  }
  parentPort.postMessage({ id: message.id, matches, counters });
});
