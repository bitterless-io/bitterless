import { OnlyPreviewSqliteIndex } from './sqlite-index.mjs';
import { requireOnlyPreviewSearchScope } from './search-scope.mjs';
import { createWorkspaceTraversal } from './traversal.mjs';
import {
  createGlobalSearchContentAuthority,
  searchOnlyPreviewGlobalFiles
} from './global-search-files.mjs';
import { createOnlyPreviewSearchDiagnostics } from '../../../../shared/onlypreview/onlyPreviewSearchDiagnostics.mjs';

const cancelledError = () => Object.assign(new Error('Search cancelled'), { code: 'CANCELLED' });

const waitForPromise = async (pending, isCancelled) =>
  await new Promise((resolveWait, rejectWait) => {
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const checkCancellation = () => {
      if (isCancelled()) {
        finish(rejectWait, cancelledError());
        return;
      }
      timer = setTimeout(checkCancellation, 16);
    };
    pending.then(
      (value) => finish(resolveWait, value),
      (error) => finish(rejectWait, error)
    );
    checkCancellation();
  });

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
    authorities: outcome.results
      .filter(({ relativePath }) => !excludedPaths.has(relativePath))
      .map((result) =>
        createGlobalSearchContentAuthority(result, index.metadata(result.relativePath))
      ),
    truncated: outcome.truncated
  };
};

const searchScopedContentsWithoutActiveIndex = async ({
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
      collectTreeEntries: false,
      isCancelled
    });
    await index.rebuild(traversal.entries, context.identity);
    if (isCancelled()) throw cancelledError();
    return await searchIndexContents({
      index,
      query,
      scope,
      cap,
      isCancelled,
      onAuthority,
      excludedPaths: new Set()
    });
  } finally {
    closeIndex(index);
  }
};

const releaseSnapshotReader = (context) => {
  if (typeof context.releaseSearchSnapshotReader === 'function') {
    context.releaseSearchSnapshotReader();
    return;
  }
  context.activeQueryCount = Math.max(0, context.activeQueryCount - 1);
};

const acquireSnapshotReader = async (context, isCancelled) => {
  if (typeof context.acquireSearchSnapshot === 'function') {
    return await context.acquireSearchSnapshot({ isCancelled });
  }
  while (true) {
    if (isCancelled()) throw cancelledError();
    const writerGate = context.promotionPromise;
    if (writerGate) {
      await waitForPromise(writerGate, isCancelled);
      continue;
    }
    const index = context.index;
    if (!index) throw new TypeError('Search index is not ready');
    const treeEntries = context.treeEntries;
    const searchPolicy = context.activeSearchPolicy ?? context.searchPolicy;
    const identity = context.activeIdentity ?? context.identity;
    context.activeQueryCount += 1;
    if (
      context.promotionPromise ||
      index !== context.index ||
      treeEntries !== context.treeEntries ||
      searchPolicy !== (context.activeSearchPolicy ?? context.searchPolicy) ||
      identity !== (context.activeIdentity ?? context.identity)
    ) {
      releaseSnapshotReader(context);
      continue;
    }
    let released = false;
    return {
      index,
      treeEntries,
      maxDepthReached: context.maxDepthReached === true,
      searchPolicy,
      identity,
      release: () => {
        if (released) return;
        released = true;
        releaseSnapshotReader(context);
      }
    };
  }
};

const bindSnapshotAuthority = (authority, lease) => ({
  ...authority,
  searchPolicy: lease.searchPolicy,
  identity: lease.identity
});

const priorityAuthorityIsEligible = (authority, searchPolicy) =>
  !searchPolicy ||
  (authority.nodeKind === 'directory'
    ? !searchPolicy.isExcludedDirectoryPath(authority.relativePath)
    : !searchPolicy.isExcludedFilePath(authority.relativePath));

const runSnapshotPhase = async ({
  context,
  lease,
  query,
  scope,
  cap,
  isCancelled,
  emitAuthority,
  diagnostics,
  diagnostic
}) => {
  let siblingCancelled = false;
  const branchIsCancelled = () => siblingCancelled || isCancelled();
  const runBranch = async (searchBranch) => {
    try {
      const outcome = await searchBranch(branchIsCancelled);
      if (outcome.cancelled) throw cancelledError();
      return outcome;
    } catch (error) {
      siblingCancelled = true;
      throw error;
    }
  };
  const filesPromise = runBranch(async (isBranchCancelled) => {
    const rawOutcome = await searchOnlyPreviewGlobalFiles({
      entries: lease.treeEntries,
      query,
      scope: { kind: 'project' },
      maxResults: cap,
      isCancelled: isBranchCancelled
    });
    if (rawOutcome.cancelled || isBranchCancelled()) throw cancelledError();
    const outcome = {
      ...rawOutcome,
      authorities: rawOutcome.authorities.map((authority) =>
        bindSnapshotAuthority(authority, lease)
      )
    };
    for (const authority of outcome.authorities) emitAuthority(authority);
    return outcome;
  });
  const contentsPromise = runBranch(async (isBranchCancelled) => {
    const rawOutcome = await searchIndexContents({
      index: lease.index,
      query,
      scope,
      cap,
      isCancelled: isBranchCancelled,
      onAuthority: (authority) => {
        if (!isBranchCancelled()) emitAuthority(bindSnapshotAuthority(authority, lease));
      },
      excludedPaths: new Set()
    });
    return {
      ...rawOutcome,
      authorities: rawOutcome.authorities.map((authority) =>
        bindSnapshotAuthority(authority, lease)
      )
    };
  });
  const priorityStartedAt = diagnostics.now();
  const priorityPromise = runBranch(async (isBranchCancelled) => {
    let rawPriority;
    try {
      rawPriority = await context.selectedFilePriority.searchGlobal(query, {
        maxResults: cap,
        scope,
        isCancelled: isBranchCancelled
      });
    } catch (error) {
      if (isBranchCancelled()) throw error;
      return { cancelled: false, files: [], contents: [] };
    }
    diagnostics.emit('search-gate', {
      tag: diagnostic.tag,
      gate: 'priority',
      elapsedMs: diagnostics.elapsed(priorityStartedAt)
    });
    if (isBranchCancelled()) throw cancelledError();
    if (rawPriority.cancelled) return { cancelled: false, files: [], contents: [] };
    const priority = {
      files: rawPriority.files
        .filter((authority) => priorityAuthorityIsEligible(authority, lease.searchPolicy))
        .map((authority) => bindSnapshotAuthority(authority, lease)),
      contents: rawPriority.contents
        .filter((authority) => priorityAuthorityIsEligible(authority, lease.searchPolicy))
        .map((authority) => bindSnapshotAuthority(authority, lease))
    };
    for (const authority of [...priority.files, ...priority.contents]) emitAuthority(authority);
    return priority;
  });
  const settled = await Promise.allSettled([priorityPromise, filesPromise, contentsPromise]);
  const failures = settled.filter(({ status }) => status === 'rejected');
  if (failures.length > 0) {
    const failure = failures.find(({ reason }) => reason?.code !== 'CANCELLED') ?? failures[0];
    throw failure.reason;
  }
  return {
    files: settled[1].value,
    contents: settled[2].value
  };
};

export const executeOnlyPreviewGlobalSearch = async (context, params) => {
  const { workspaceId, generation, requestId, query, maxResults, scope, isCancelled, onResult } =
    params;
  const cap = sectionCap(maxResults);
  const diagnostics = context.diagnostics ?? createOnlyPreviewSearchDiagnostics();
  const diagnostic = { tag: diagnostics.nextTag('q'), startedAt: diagnostics.now() };
  diagnostics.emit('search-accepted', { tag: diagnostic.tag, generation });
  const firstSections = new Set();
  let terminalCounts = { filesCount: 0, contentsCount: 0 };
  const markFirstSection = (section) => {
    if (firstSections.has(section)) return;
    firstSections.add(section);
    diagnostics.emit('search-first-section', {
      tag: diagnostic.tag,
      section,
      elapsedMs: diagnostics.elapsed(diagnostic.startedAt)
    });
  };
  const request = { workspaceId, generation, requestId };
  context.globalSearchSession.begin(request);
  const emittedPathsBySection = new Map([
    ['files', new Set()],
    ['contents', new Set()]
  ]);
  const emitAuthority = (authority) => {
    if (isCancelled()) return;
    const emittedPaths = emittedPathsBySection.get(authority.result.section);
    if (
      !emittedPaths ||
      emittedPaths.has(authority.relativePath) ||
      emittedPaths.size >= cap
    ) {
      return;
    }
    const result = context.globalSearchSession.issueBatch(request, authority);
    if (result) {
      emittedPaths.add(authority.relativePath);
      markFirstSection(authority.result.section);
      onResult?.(result);
    }
  };
  const terminalResponse = (outcome) => {
    if (isCancelled()) throw cancelledError();
    const authorities = [...outcome.files.authorities, ...outcome.contents.authorities];
    const terminal = context.globalSearchSession.replace(request, authorities);
    const fileCount = outcome.files.authorities.length;
    terminalCounts = {
      filesCount: fileCount,
      contentsCount: outcome.contents.authorities.length
    };
    diagnostics.emit('search-section-terminal', {
      tag: diagnostic.tag,
      section: 'files',
      count: fileCount,
      truncated: outcome.files.truncated,
      elapsedMs: diagnostics.elapsed(diagnostic.startedAt)
    });
    diagnostics.emit('search-section-terminal', {
      tag: diagnostic.tag,
      section: 'contents',
      count: outcome.contents.authorities.length,
      truncated: outcome.contents.truncated,
      elapsedMs: diagnostics.elapsed(diagnostic.startedAt)
    });
    return {
      workspaceId,
      generation,
      requestId,
      files: terminal.slice(0, fileCount),
      contents: terminal.slice(fileCount),
      filesTruncated: outcome.files.truncated,
      contentsTruncated: outcome.contents.truncated
    };
  };
  try {
    const validatedScope = requireOnlyPreviewSearchScope(
      scope,
      context.treeEntries,
      (relativePath) => context.browseIndex?.hasDirectory(relativePath) === true
    );
    const pendingPromotion = context.promotionPromise;
    if (pendingPromotion) {
      const gateStartedAt = diagnostics.now();
      await waitForPromise(pendingPromotion, isCancelled);
      diagnostics.emit('search-gate', {
        tag: diagnostic.tag,
        gate: 'promotion',
        elapsedMs: diagnostics.elapsed(gateStartedAt)
      });
      context.globalSearchSession.begin(request);
    }
    const activeBuild = context.currentBuildPromise;
    if (!context.index && !activeBuild) throw new TypeError('Search index is not ready');
    if (!context.index && activeBuild) {
      const priorityStartedAt = diagnostics.now();
      context.activeQueryCount += 1;
      try {
        const priority = await context.selectedFilePriority.searchGlobal(query, {
          maxResults: cap,
          scope: validatedScope,
          isCancelled
        });
        diagnostics.emit('search-gate', {
          tag: diagnostic.tag,
          gate: 'priority',
          elapsedMs: diagnostics.elapsed(priorityStartedAt)
        });
        if (priority.cancelled) throw cancelledError();
        for (const authority of [...priority.files, ...priority.contents]) emitAuthority(authority);
        const priorityContentPaths = new Set(
          priority.contents.map(({ relativePath }) => relativePath)
        );
        if (validatedScope.kind === 'directory' && validatedScope.relativePath) {
          await searchScopedContentsWithoutActiveIndex({
            context,
            query,
            scope: validatedScope,
            cap,
            isCancelled,
            onAuthority: (authority) => {
              if (!priorityContentPaths.has(authority.relativePath)) emitAuthority(authority);
            }
          });
        }
      } finally {
        releaseSnapshotReader(context);
      }
    }
    let warmOutcome;
    let warmIndex;
    if (context.index) {
      const warmLease = await acquireSnapshotReader(context, isCancelled);
      warmIndex = warmLease.index;
      try {
        warmOutcome = await runSnapshotPhase({
          context,
          lease: warmLease,
          query,
          scope: validatedScope,
          cap,
          isCancelled,
          emitAuthority,
          diagnostics,
          diagnostic
        });
        if (!activeBuild) {
          const response = terminalResponse(warmOutcome);
          diagnostics.emit('search-terminal', {
            tag: diagnostic.tag,
            outcome: 'success',
            ...terminalCounts,
            elapsedMs: diagnostics.elapsed(diagnostic.startedAt)
          });
          return response;
        }
      } finally {
        warmLease.release();
      }
    }
    if (activeBuild) {
      const gateStartedAt = diagnostics.now();
      let buildSucceeded = false;
      try {
        await waitForPromise(activeBuild, isCancelled);
        buildSucceeded = true;
      } catch (error) {
        if (error?.code === 'CANCELLED' || !context.index) throw error;
      }
      diagnostics.emit('search-gate', {
        tag: diagnostic.tag,
        gate: 'initial-tree',
        elapsedMs: diagnostics.elapsed(gateStartedAt)
      });
      if (isCancelled()) throw cancelledError();
      if (!buildSucceeded && warmOutcome && context.index === warmIndex) {
        if (!context.globalSearchSession.isCurrent(request)) {
          context.globalSearchSession.begin(request);
        }
        const response = terminalResponse(warmOutcome);
        diagnostics.emit('search-terminal', {
          tag: diagnostic.tag,
          outcome: 'success',
          ...terminalCounts,
          elapsedMs: diagnostics.elapsed(diagnostic.startedAt)
        });
        return response;
      }
      context.globalSearchSession.begin(request);
      const freshLease = await acquireSnapshotReader(context, isCancelled);
      try {
        const freshOutcome = await runSnapshotPhase({
          context,
          lease: freshLease,
          query,
          scope: validatedScope,
          cap,
          isCancelled,
          emitAuthority,
          diagnostics,
          diagnostic
        });
        if (freshOutcome.files.authorities.length > 0) markFirstSection('files');
        if (freshOutcome.contents.authorities.length > 0) markFirstSection('contents');
        const response = terminalResponse(freshOutcome);
        diagnostics.emit('search-terminal', {
          tag: diagnostic.tag,
          outcome: 'success',
          ...terminalCounts,
          elapsedMs: diagnostics.elapsed(diagnostic.startedAt)
        });
        return response;
      } finally {
        freshLease.release();
      }
    }
    throw new TypeError('Search index is not ready');
  } catch (error) {
    context.globalSearchSession.revoke(requestId);
    diagnostics.emit('search-terminal', {
      tag: diagnostic.tag,
      outcome: error?.code === 'CANCELLED' ? 'cancelled' : 'failure',
      ...terminalCounts,
      elapsedMs: diagnostics.elapsed(diagnostic.startedAt)
    });
    throw error;
  }
};
