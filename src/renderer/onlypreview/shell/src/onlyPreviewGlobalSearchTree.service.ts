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
  expandedPaths.add('');
  const parents = await projection.loadSelectedParentListings(
    `${relativePath}/_scope`,
    context,
    expandedPaths
  );
  applyResult(parents);
  expandedPaths.add(relativePath);
  const directory = await projection.loadDirectory(relativePath, context, expandedPaths);
  applyResult(directory);
  return directory.index?.entries.some((entry) => entry.relativePath === relativePath) === true;
};
