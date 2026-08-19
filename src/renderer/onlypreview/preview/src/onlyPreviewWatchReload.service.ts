import type { OnlyPreviewSearchWatchCommit } from '@shared/onlypreview/onlyPreviewSearch.type';

export interface OnlyPreviewWatchReloadCursor {
  workspaceId: string;
  generation: number;
  revision: number;
}

export interface OnlyPreviewWatchReloadDecision {
  cursor: OnlyPreviewWatchReloadCursor;
  reload: boolean;
}

export const createOnlyPreviewWatchReloadCursor = (): OnlyPreviewWatchReloadCursor => ({
  workspaceId: '',
  generation: -1,
  revision: 0
});

export const evaluateOnlyPreviewWatchReload = (
  cursor: OnlyPreviewWatchReloadCursor,
  commit: OnlyPreviewSearchWatchCommit,
  selectedRelativePath: string
): OnlyPreviewWatchReloadDecision => {
  if (
    cursor.workspaceId === commit.workspaceId &&
    cursor.generation === commit.generation &&
    commit.revision <= cursor.revision
  ) {
    return { cursor, reload: false };
  }
  const nextCursor = {
    workspaceId: commit.workspaceId,
    generation: commit.generation,
    revision: commit.revision
  };
  const reload =
    !!selectedRelativePath &&
    (commit.full ||
      commit.changedRelativePaths.some(
        (relativePath) =>
          relativePath === selectedRelativePath ||
          selectedRelativePath.startsWith(`${relativePath}/`)
      ));
  return { cursor: nextCursor, reload };
};
