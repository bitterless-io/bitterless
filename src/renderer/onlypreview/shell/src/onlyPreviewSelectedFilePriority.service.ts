import { onlyPreviewSearchClient } from './onlyPreviewSearch.client';

export const dispatchOnlyPreviewSelectedFilePriority = (
  hostToken: string,
  workspaceId: string,
  generation: number,
  relativePath: string
): void => {
  void onlyPreviewSearchClient
    .prioritizeFile({ hostToken, workspaceId, generation, relativePath })
    .catch(() => undefined);
};
