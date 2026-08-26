import { constants as fsConstants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import {
  classifySearchMediaType,
  decodeSearchText,
  isSensitiveSearchFile,
  mediaTypeToPreviewHint,
  readBoundedFromHandle
} from './classification.mjs';
import { MAX_TEXT_BYTES } from './constants.mjs';
import { isWorkspaceSearchPathWithinDepth } from './traversal.mjs';
import { pathIsWithin } from './workspace-config.mjs';

export const GLOBAL_SEARCH_PREVIEW_TEXT_BYTES = 256 * 1024;
export const GLOBAL_SEARCH_PREVIEW_DIRECTORY_ENTRIES = 200;

const naturalCollator = new Intl.Collator('und', { numeric: true, sensitivity: 'base' });
const graphemeSegmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

const numeric = (value) => (typeof value === 'bigint' ? Number(value) : value);

const sameIdentity = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  numeric(left.size) === numeric(right.size) &&
  numeric(left.mtimeMs) === numeric(right.mtimeMs);

const expectedIdentity = (stat, authority, nodeKind) =>
  (nodeKind === 'directory' ? stat.isDirectory() : stat.isFile()) &&
  !stat.isSymbolicLink() &&
  Math.trunc(numeric(stat.mtimeMs)) === authority.modifiedAt &&
  (nodeKind === 'directory' || numeric(stat.size) === authority.size);

const adapterFor = (relativePath) => {
  const lower = relativePath.toLocaleLowerCase('und');
  if (/\.md$/u.test(lower)) return 'markdown';
  if (/\.(?:html|htm)$/u.test(lower)) return 'html-static';
  return 'plain';
};

const parentRelativePath = (relativePath) => {
  const parent = dirname(relativePath).replaceAll('\\', '/');
  return parent === '.' ? '' : parent;
};

const direntKind = (entry) =>
  entry.isDirectory()
    ? 'directory'
    : entry.isFile()
      ? 'file'
      : entry.isSymbolicLink()
        ? 'symlink'
        : '';

const compareDirents = (left, right) => {
  const leftDirectory = left.nodeKind === 'directory';
  const rightDirectory = right.nodeKind === 'directory';
  if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
  return (
    naturalCollator.compare(left.name, right.name) || left.name.localeCompare(right.name, 'und')
  );
};

const insertBounded = (entries, entry) => {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareDirents(entries[middle], entry) <= 0) low = middle + 1;
    else high = middle;
  }
  entries.splice(low, 0, entry);
  if (entries.length > GLOBAL_SEARCH_PREVIEW_DIRECTORY_ENTRIES) entries.pop();
};

const safeAbsolutePath = (rootPath, relativePath) => {
  const absolutePath = resolve(rootPath, ...relativePath.split('/'));
  if (!pathIsWithin(rootPath, absolutePath)) throw new TypeError('Preview path escaped workspace');
  return absolutePath;
};

const readStableIdentity = async (rootPath, absolutePath, authority, nodeKind) => {
  const before = await lstat(absolutePath, { bigint: true });
  if (!expectedIdentity(before, authority, nodeKind)) throw new TypeError('Preview result changed');
  const canonical = await realpath(absolutePath);
  if (canonical !== absolutePath || !pathIsWithin(rootPath, canonical)) {
    throw new TypeError('Preview result escaped workspace');
  }
  const after = await lstat(absolutePath, { bigint: true });
  const canonicalAfter = await realpath(absolutePath);
  if (
    !expectedIdentity(after, authority, nodeKind) ||
    !sameIdentity(before, after) ||
    canonicalAfter !== canonical
  ) {
    throw new TypeError('Preview result changed');
  }
  return { stat: after, canonicalPath: canonical };
};

const createInfoPreview = (authority) => ({
  kind: 'info',
  name: authority.name,
  previewHint: authority.previewHint,
  mediaType: authority.mediaType,
  size: authority.size,
  modifiedAt: authority.modifiedAt
});

const cancelledError = () => Object.assign(new Error('Preview cancelled'), { code: 'CANCELLED' });

const readStableFileBuffer = async ({ rootPath, authority, byteLimit, isCancelled }) => {
  const absolutePath = safeAbsolutePath(rootPath, authority.relativePath);
  const identity = await readStableIdentity(rootPath, absolutePath, authority, 'file');
  if (isCancelled()) throw cancelledError();
  const handle = await open(absolutePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(identity.stat, opened)) throw new TypeError('Preview result changed');
    const buffer = await readBoundedFromHandle(handle, byteLimit);
    if (isCancelled()) throw cancelledError();
    const handleAfter = await handle.stat({ bigint: true });
    const current = await readStableIdentity(rootPath, absolutePath, authority, 'file');
    if (!sameIdentity(opened, handleAfter) || !sameIdentity(opened, current.stat)) {
      throw new TypeError('Preview result changed');
    }
    return buffer;
  } finally {
    await handle.close();
  }
};

const infoPreview = async ({ rootPath, authority }) => {
  const absolutePath = safeAbsolutePath(rootPath, authority.relativePath);
  await readStableIdentity(rootPath, absolutePath, authority, 'file');
  return createInfoPreview(authority);
};

const readTextPreview = async ({ rootPath, authority, isCancelled }) => {
  if (authority.size > MAX_TEXT_BYTES || isSensitiveSearchFile(authority.relativePath)) {
    return await infoPreview({ rootPath, authority });
  }
  const buffer = await readStableFileBuffer({
    rootPath,
    authority,
    byteLimit: GLOBAL_SEARCH_PREVIEW_TEXT_BYTES,
    isCancelled
  });
  return {
    kind: 'text',
    adapter: adapterFor(authority.relativePath),
    name: authority.name,
    text: decodeSearchText(buffer),
    truncated: authority.size > buffer.length
  };
};

const browseDirectoryPreview = async ({ rootPath, authority, isCancelled }) => {
  const absolutePath = safeAbsolutePath(rootPath, authority.relativePath);
  const identity = await readStableIdentity(rootPath, absolutePath, authority, 'directory');
  const directory = await opendir(absolutePath);
  const selected = [];
  let acceptedCount = 0;
  let visited = 0;
  for await (const child of directory) {
    const nodeKind = direntKind(child);
    if (!nodeKind) continue;
    acceptedCount += 1;
    insertBounded(selected, { name: child.name, nodeKind });
    visited += 1;
    if (visited % 256 === 0) {
      if (isCancelled()) throw cancelledError();
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
    }
  }
  const current = await lstat(absolutePath, { bigint: true });
  if (!sameIdentity(identity.stat, current)) throw new TypeError('Preview directory changed');
  const entries = [];
  for (const selectedEntry of selected) {
    if (isCancelled()) throw cancelledError();
    const relativePath = `${authority.relativePath}/${selectedEntry.name}`;
    const childPath = safeAbsolutePath(rootPath, relativePath);
    let stat;
    try {
      stat = await lstat(childPath, { bigint: true });
    } catch {
      continue;
    }
    const nodeKind = stat.isSymbolicLink()
      ? 'symlink'
      : stat.isDirectory()
        ? 'directory'
        : stat.isFile()
          ? 'file'
          : '';
    if (!nodeKind) continue;
    if (nodeKind !== 'symlink') {
      const canonical = await realpath(childPath).catch(() => '');
      if (canonical !== childPath || !pathIsWithin(rootPath, canonical)) continue;
    }
    const mediaType = nodeKind === 'file' ? classifySearchMediaType(relativePath) : 'unknown';
    entries.push({
      relativePath,
      parentRelativePath: parentRelativePath(relativePath),
      name: basename(relativePath),
      nodeKind,
      size: nodeKind === 'file' ? numeric(stat.size) : 0,
      modifiedAt: Math.trunc(numeric(stat.mtimeMs)),
      previewHint: nodeKind === 'file' ? mediaTypeToPreviewHint(mediaType) : 'unsupported',
      mediaType,
      isText: nodeKind === 'file' && mediaType === 'text',
      directoryToken: null
    });
  }
  return {
    kind: 'directory',
    name: authority.name,
    entries,
    truncated: acceptedCount > GLOBAL_SEARCH_PREVIEW_DIRECTORY_ENTRIES
  };
};

const contextPreview = async ({ rootPath, authority, isCancelled }) => {
  const buffer = await readStableFileBuffer({
    rootPath,
    authority,
    byteLimit: MAX_TEXT_BYTES,
    isCancelled
  });
  if (!decodeSearchText(buffer).includes(authority.contentMatch.snippetText)) {
    throw new TypeError('Search result context changed');
  }
  const graphemes = [...graphemeSegmenter.segment(authority.contentMatch.snippetText)].map(
    ({ segment }) => segment
  );
  const start = authority.contentMatch.highlightStart;
  const end = start + authority.contentMatch.highlightLength;
  return {
    kind: 'context',
    name: authority.name,
    before: graphemes.slice(0, start).join(''),
    match: graphemes.slice(start, end).join(''),
    after: graphemes.slice(end).join(''),
    truncated: authority.size > Buffer.byteLength(authority.contentMatch.snippetText)
  };
};

export const previewOnlyPreviewGlobalSearchResult = async ({
  authority,
  rootPath,
  searchPolicy,
  isCancelled = () => false
}) => {
  if (
    searchPolicy.isPhysicallyExcludedPath(authority.relativePath) ||
    !isWorkspaceSearchPathWithinDepth(authority.relativePath, {
      isDirectory: authority.nodeKind === 'directory'
    })
  ) {
    throw new TypeError('Preview result is no longer eligible');
  }
  if (authority.result.section === 'contents') {
    return await contextPreview({ rootPath, authority, isCancelled });
  }
  if (authority.nodeKind === 'directory') {
    return await browseDirectoryPreview({ rootPath, authority, isCancelled });
  }
  if (authority.mediaType !== 'text') return await infoPreview({ rootPath, authority });
  return await readTextPreview({ rootPath, authority, isCancelled });
};
