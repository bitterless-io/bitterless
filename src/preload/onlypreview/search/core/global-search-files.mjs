import { normalizeSearchText } from './normalization.mjs';

const inScope = (relativePath, scope) =>
  scope.kind === 'project' ||
  scope.relativePath === '' ||
  relativePath.startsWith(`${scope.relativePath}/`);

export const createGlobalSearchFileAuthority = (entry) => ({
  result: {
    section: 'files',
    name: entry.name,
    relativePath: entry.relativePath,
    parentRelativePath: entry.parentRelativePath,
    nodeKind: entry.nodeKind,
    previewHint: entry.previewHint,
    mediaType: entry.mediaType
  },
  relativePath: entry.relativePath,
  nodeKind: entry.nodeKind,
  name: entry.name,
  size: entry.size,
  modifiedAt: entry.modifiedAt,
  previewHint: entry.previewHint,
  mediaType: entry.mediaType
});

export const createGlobalSearchContentAuthority = (result, metadata) => ({
  result: {
    section: 'contents',
    fileName: result.fileName,
    relativePath: result.relativePath,
    parentRelativePath: result.relativePath.includes('/')
      ? result.relativePath.slice(0, result.relativePath.lastIndexOf('/'))
      : '',
    mediaType: 'text',
    contentMatch: result.contentMatch
  },
  relativePath: result.relativePath,
  nodeKind: 'file',
  name: result.fileName,
  size: metadata.size,
  modifiedAt: metadata.modifiedMs,
  previewHint: 'text',
  mediaType: 'text',
  contentMatch: result.contentMatch
});

export const searchOnlyPreviewGlobalFiles = async ({
  entries,
  query,
  scope,
  maxResults,
  isCancelled = () => false
}) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery || maxResults <= 0) return { authorities: [], truncated: false };
  const authorities = [];
  let truncated = false;
  let visited = 0;
  let sliceStartedAt = performance.now();
  for (const entry of entries) {
    visited += 1;
    if (visited % 128 === 0 || performance.now() - sliceStartedAt >= 8) {
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
      sliceStartedAt = performance.now();
    }
    if (isCancelled()) return { authorities: [], truncated: false, cancelled: true };
    if (
      (entry.nodeKind !== 'file' && entry.nodeKind !== 'directory') ||
      !inScope(entry.relativePath, scope) ||
      !normalizeSearchText(entry.name).includes(normalizedQuery)
    ) {
      continue;
    }
    if (authorities.length < maxResults) authorities.push(createGlobalSearchFileAuthority(entry));
    else {
      truncated = true;
      break;
    }
  }
  return { authorities, truncated, cancelled: false };
};

export const isGlobalSearchPathInScope = inScope;
