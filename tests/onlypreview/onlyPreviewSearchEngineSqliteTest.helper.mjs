/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const withTempDirectory = async (callback) => {
  const path = await mkdtemp(join(tmpdir(), 'onlypreview-search-sqlite-'));
  try {
    return await callback(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
};

export const write = async (path, content) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

export const search = async (
  engine,
  generation,
  requestId,
  query,
  maxResults = 500,
  scope = { kind: 'project' }
) =>
  await engine.search({
    workspaceId: 'workspace',
    generation,
    requestId,
    query,
    maxResults,
    scope,
    cancelBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  });

export const delay = async (milliseconds) =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds));

export const nextTurn = async () => await new Promise((resolve) => setImmediate(resolve));
