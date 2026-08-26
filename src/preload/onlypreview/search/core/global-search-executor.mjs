import { OnlyPreviewSqliteIndex } from './sqlite-index.mjs';
import { requireOnlyPreviewSearchScope } from './search-scope.mjs';
import { createWorkspaceTraversal } from './traversal.mjs';
import {
  createGlobalSearchContentAuthority,
  searchOnlyPreviewGlobalFiles
} from './global-search-files.mjs';

const cancelledError = () => Object.assign(new Error('Search cancelled'), { code: 'CANCELLED' });
const nextTurn = async () => await new Promise((resolveTurn) => setImmediate(resolveTurn));

const closeIndex = (index) => {
  try {
    index?.close();
  } catch {
    // Scoped indexes are isolated and may already be closed by cancellation cleanup.
  }
};

const sectionCap = (maxResults) => Math.max(0, Math.min(250, Math.trunc(maxResults)));

const searchIndexContents = async ({
  index,
  query,
  scope,
  cap,
  isCancelled,
  onAuthority,
  excludedPaths
}) => {
  const outcome = await index.searchContents(query, {
    maxResults: cap,
    scope,
    isCancelled,
    onResult: (result) => {
      if (excludedPaths.has(result.relativePath)) return;
      const metadata = index.metadata(result.relativePath);
      if (metadata) onAuthority(createGlobalSearchContentAuthority(result, metadata));
    }
  });
  if (outcome.cancelled) throw cancelledError();
  return {
    authorities: outcome.results.map((result) =>
      createGlobalSearchContentAuthority(result, index.metadata(result.relativePath))
    ),
    truncated: outcome.truncated
  };
};

const searchScopedWithoutActiveIndex = async ({
  context,
  query,
  scope,
  cap,
  isCancelled,
  onAuthority
}) => {
  const index = new OnlyPreviewSqliteIndex(':memory:');
  try {
    const traversal = await createWorkspaceTraversal({
      rootPath: context.rootPath,
      config: context.config,
      scopeRelativePath: scope.relativePath,
      isCancelled
    });
    await index.rebuild(traversal.entries, context.identity);
    if (isCancelled()) throw cancelledError();
    const files = await searchOnlyPreviewGlobalFiles({
      entries: traversal.treeEntries,
      query,
      scope,
      maxResults: cap,
      isCancelled
    });
    if (files.cancelled) throw cancelledError();
    for (const authority of files.authorities) onAuthority(authority);
    const contents = await searchIndexContents({
      index,
      query,
      scope,
      cap,
      isCancelled,
      onAuthority,
      excludedPaths: new Set()
    });
    return { files, contents };
  } finally {
    closeIndex(index);
  }
};

export const executeOnlyPreviewGlobalSearch = async (context, params) => {
  const { workspaceId, generation, requestId, query, maxResults, scope, isCancelled, onResult } =
    params;
  const cap = sectionCap(maxResults);
  const request = { workspaceId, generation, requestId };
  context.globalSearchSession.begin(request);
  const emittedPathsBySection = new Map([
    ['files', new Set()],
    ['contents', new Set()]
  ]);
  const emitAuthority = (authority) => {
    if (isCancelled()) return;
    const emittedPaths = emittedPathsBySection.get(authority.result.section);
    if (!emittedPaths || (!emittedPaths.has(authority.relativePath) && emittedPaths.size >= cap)) {
      return;
    }
    const result = context.globalSearchSession.issueBatch(request, authority);
    if (result) {
      emittedPaths.add(authority.relativePath);
      onResult?.(result);
    }
  };
  try {
    const validatedScope = requireOnlyPreviewSearchScope(
      scope,
      context.treeEntries,
      (relativePath) => context.browseIndex?.hasDirectory(relativePath) === true
    );
    const priority = await context.selectedFilePriority.searchGlobal(query, {
      maxResults: cap,
      scope: validatedScope,
      isCancelled
    });
    if (priority.cancelled) throw cancelledError();
    for (const authority of [...priority.files, ...priority.contents]) emitAuthority(authority);
    const priorityFilePaths = new Set(priority.files.map(({ relativePath }) => relativePath));
    const priorityContentPaths = new Set(priority.contents.map(({ relativePath }) => relativePath));

    if (context.promotionPromise) {
      await context.promotionPromise;
      if (isCancelled()) throw cancelledError();
      context.globalSearchSession.begin(request);
    }
    let outcome;
    let targetIndex = context.index;
    if (!targetIndex && validatedScope.kind === 'directory') {
      context.activeQueryCount += 1;
      try {
        outcome = await searchScopedWithoutActiveIndex({
          context,
          query,
          scope: validatedScope,
          cap,
          isCancelled,
          onAuthority: (authority) => {
            const priorityPaths =
              authority.result.section === 'files' ? priorityFilePaths : priorityContentPaths;
            if (!priorityPaths.has(authority.relativePath)) emitAuthority(authority);
          }
        });
      } finally {
        context.activeQueryCount -= 1;
      }
    } else {
      if (!targetIndex) {
        const build = context.currentBuildPromise;
        if (!build) throw new TypeError('Search index is not ready');
        while (context.currentBuildPromise === build) {
          if (isCancelled()) throw cancelledError();
          await nextTurn();
        }
        await build;
        if (context.promotionPromise) await context.promotionPromise;
        if (isCancelled()) throw cancelledError();
        context.globalSearchSession.begin(request);
        targetIndex = context.index;
      }
      if (!targetIndex) throw new TypeError('Search index is not ready');
      const files = await searchOnlyPreviewGlobalFiles({
        entries: context.treeEntries,
        query,
        scope: validatedScope,
        maxResults: cap,
        isCancelled
      });
      if (files.cancelled) throw cancelledError();
      for (const authority of files.authorities) {
        if (!priorityFilePaths.has(authority.relativePath)) emitAuthority(authority);
      }
      context.activeQueryCount += 1;
      let contents;
      try {
        contents = await searchIndexContents({
          index: targetIndex,
          query,
          scope: validatedScope,
          cap,
          isCancelled,
          onAuthority: (authority) => {
            if (!priorityContentPaths.has(authority.relativePath)) emitAuthority(authority);
          },
          excludedPaths: priorityContentPaths
        });
      } finally {
        context.activeQueryCount -= 1;
      }
      outcome = { files, contents };
    }
    if (isCancelled()) throw cancelledError();
    const authorities = [...outcome.files.authorities, ...outcome.contents.authorities];
    const terminal = context.globalSearchSession.replace(request, authorities);
    const fileCount = outcome.files.authorities.length;
    return {
      workspaceId,
      generation,
      requestId,
      files: terminal.slice(0, fileCount),
      contents: terminal.slice(fileCount),
      filesTruncated: outcome.files.truncated,
      contentsTruncated: outcome.contents.truncated
    };
  } catch (error) {
    context.globalSearchSession.revoke(requestId);
    throw error;
  }
};
