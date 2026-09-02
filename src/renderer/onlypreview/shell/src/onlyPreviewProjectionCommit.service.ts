import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewIndex } from '@shared/onlypreview/onlyPreview.types';
import { getOnlyPreviewErrorMessage, onlyPreviewI18n } from '../../common/onlyPreviewI18n';
import type { OnlyPreviewBrowseProjectionResult } from './onlyPreviewBrowseProjection.service';
import type { OnlyPreviewTreeRow } from './onlyPreviewShell.type';
import { resolveOnlyPreviewDeletedSelection } from './onlyPreviewTree.service';

export interface OnlyPreviewProjectionCommitInput {
  result: OnlyPreviewBrowseProjectionResult;
  /** The projection result still belongs to the Shell's active workspace and search generation. */
  current: boolean;
  index: OnlyPreviewIndex | null;
  treeSelectedRelativePath: string | null;
  readRows: () => readonly OnlyPreviewTreeRow[];
}

export interface OnlyPreviewProjectionCommit {
  errorMessage: string | null;
  /** The row that inherits a selection whose item this projection removed, otherwise `null`. */
  inheritedSelection: string | null;
}

const listedPaths = (index: OnlyPreviewIndex | null): Set<string> =>
  new Set((index?.entries || []).map((entry) => entry.relativePath));

// A projection update must never disturb the Project tree: the selection, the expanded directories,
// and the scroll position all stay where they are. Deleting the selected item is the one exception,
// and even then only the selection moves — to the row that took the deleted row's place.
export const resolveOnlyPreviewProjectionCommit = ({
  result,
  current,
  index,
  treeSelectedRelativePath,
  readRows
}: OnlyPreviewProjectionCommitInput): OnlyPreviewProjectionCommit => {
  const commit: OnlyPreviewProjectionCommit = { errorMessage: null, inheritedSelection: null };
  if (result.error && current) {
    commit.errorMessage =
      result.error instanceof OnlyPreviewContractError
        ? getOnlyPreviewErrorMessage(result.error.code)
        : onlyPreviewI18n.errors.OPERATION_FAILED;
  }
  if (!result.changed || !treeSelectedRelativePath) return commit;
  if (!index?.entries.some((entry) => entry.relativePath === treeSelectedRelativePath)) {
    return commit;
  }
  const paths = listedPaths(result.index);
  if (paths.has(treeSelectedRelativePath)) return commit;
  commit.inheritedSelection = resolveOnlyPreviewDeletedSelection(
    readRows(),
    treeSelectedRelativePath,
    (candidate) => paths.has(candidate)
  );
  return commit;
};
