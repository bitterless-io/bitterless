import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type { OnlyPreviewWorkspace } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewWorkspaceRegistry } from './onlyPreviewWorkspace.registry';
import { onlyPreviewPreviewRegionService } from './views/onlyPreviewPreviewRegion.service';

/**
 * Present the file a restored Project was last previewing.
 *
 * Main has to do this, exactly as it does for an explicitly opened file: the renderer only learns
 * the path, and attaching the preview surface is Main's. The remembered path is re-authorized first
 * because it is a value from the previous session — a path that is now a directory, or gone, must
 * not be presented, and the caller swallows the rejection so the Project simply opens with nothing
 * selected.
 */
export const presentOnlyPreviewRestoredSelection = async (
  hostToken: string,
  workspace: OnlyPreviewWorkspace
): Promise<void> => {
  const relativePath = workspace.selectedRelativePath;
  if (!relativePath) return;
  const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(hostToken, {
    workspaceId: workspace.workspaceId,
    relativePath
  });
  const file = await fileSearchWindowService.authorizeProjectItem({
    workspaceId: authority.workspaceId,
    workspaceGeneration: authority.workspaceGeneration,
    relativePath: authority.relativePath
  });
  if (file.nodeKind !== 'file') {
    throw new OnlyPreviewContractError(
      'PATH_NOT_REGULAR_FILE',
      'The remembered selection is no longer a file.'
    );
  }
  onlyPreviewWorkspaceRegistry.select(hostToken, {
    workspaceId: file.workspaceId,
    relativePath: file.relativePath
  });
  await onlyPreviewPreviewRegionService.present(hostToken, {
    workspaceId: file.workspaceId,
    relativePath: file.relativePath
  });
};
