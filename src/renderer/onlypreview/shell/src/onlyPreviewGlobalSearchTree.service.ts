import {
  OnlyPreviewBrowseProjectionService,
  type OnlyPreviewBrowseProjectionContext,
  type OnlyPreviewBrowseProjectionResult
} from './onlyPreviewBrowseProjection.service';

export const revealOnlyPreviewGlobalSearchDirectory = async (params: {
  relativePath: string;
  projection: OnlyPreviewBrowseProjectionService;
  context: OnlyPreviewBrowseProjectionContext;
  expandedPaths: Set<string>;
  applyResult: (result: OnlyPreviewBrowseProjectionResult) => void;
}): Promise<boolean> => {
  const { relativePath, projection, context, expandedPaths, applyResult } = params;
  const parents = await projection.loadSelectedParentListings(
    `${relativePath}/_scope`,
    context,
    expandedPaths
  );
  applyResult(parents);
  if (!parents.loaded) return false;
  const directory = await projection.loadDirectory(relativePath, context, expandedPaths);
  applyResult(directory);
  if (
    !directory.loaded ||
    directory.index?.entries.some((entry) => entry.relativePath === relativePath) !== true
  ) {
    return false;
  }
  expandedPaths.add('');
  let expandedPath = '';
  for (const segment of relativePath.split('/')) {
    expandedPath = expandedPath ? `${expandedPath}/${segment}` : segment;
    expandedPaths.add(expandedPath);
  }
  return true;
};
