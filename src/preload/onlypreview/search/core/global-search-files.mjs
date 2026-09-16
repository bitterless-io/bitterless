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
  // The containment test, resolved once instead of once per entry. `null` means "every path", so
  // Project scope and the synthetic root drop out of the loop entirely rather than re-deciding the
  // same branch for every entry in the workspace; a directory scope builds its `dir/` prefix once
  // rather than rebuilding that string on each of the 130k iterations a large workspace walks. The
  // trailing slash is what keeps the test segment-safe, so `one-archive/x` is not read as living
  // inside `one`. Kept as a plain prefix rather than a closure: this is the hot loop, and a direct
  // `startsWith` beats a call through a function reference.
  const scopePrefix =
    scope.kind === 'project' || scope.relativePath === '' ? null : `${scope.relativePath}/`;
  await new Promise((resolveTurn) => setImmediate(resolveTurn));
  if (isCancelled()) return { authorities: [], truncated: false, cancelled: true };
  const directoryAuthorities = [];
  const fileAuthorities = [];
  let matchCount = 0;
  let visited = 0;
  let sliceStartedAt = performance.now();
  for (const entry of entries) {
    visited += 1;
    if (visited % 128 === 0 || performance.now() - sliceStartedAt >= 8) {
      await new Promise((resolveTurn) => setImmediate(resolveTurn));
      sliceStartedAt = performance.now();
    }
    if (isCancelled()) return { authorities: [], truncated: false, cancelled: true };
    // Order matters and is load-bearing: the two cheap rejections run before the ICU-heavy
    // `normalizeSearchText`, which dominates this loop. A narrow scope therefore makes the walk
    // cheaper rather than more expensive, because most entries never reach the normalizer.
    if (
      (entry.nodeKind !== 'file' && entry.nodeKind !== 'directory') ||
      (scopePrefix !== null && !entry.relativePath.startsWith(scopePrefix)) ||
      !normalizeSearchText(entry.name).includes(normalizedQuery)
    ) {
      continue;
    }
    matchCount += 1;
    const partition = entry.nodeKind === 'directory' ? directoryAuthorities : fileAuthorities;
    if (partition.length < maxResults) {
      partition.push(createGlobalSearchFileAuthority(entry));
    }
  }
  return {
    authorities: [...directoryAuthorities, ...fileAuthorities].slice(0, maxResults),
    truncated: matchCount > maxResults,
    cancelled: false
  };
};

export const isGlobalSearchPathInScope = inScope;
