import { dialog } from 'electron';
import { xpcMain } from 'electron-xpc/main';
import { onlyPreviewHostRegistry } from '@main/miniapps/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewTargetMutations } from '@main/miniapps/onlypreview/onlyPreviewExplicitOpen.service';
import { onlyPreviewRecentDirectoryService } from '@main/miniapps/onlypreview/onlyPreviewRecentDirectory.service';
import { onlyPreviewSelectionCoordinator } from '@main/miniapps/onlypreview/onlyPreviewSelectionCoordinator.service';
import { onlyPreviewPreviewRegionService } from '@main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service';
import {
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewWindowHelper } from './onlyPreviewWindow.helper';

export const chooseOnlyPreviewFolder = async (
  hostToken: string,
  changeWorkspace: (change: () => Promise<OnlyPreviewWorkspace | null>) => Promise<OnlyPreviewWorkspace | null> = change => change()
): Promise<OnlyPreviewWorkspace | null> => {
  const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
  const window = onlyPreviewWindowHelper.getStandaloneWindow(host.hostToken);
  const result = await dialog.showOpenDialog(window, {
    title: 'Open Folder in OnlyPreview',
    properties: ['openDirectory']
  });
  const target = result.canceled ? null : (result.filePaths[0] ?? null);
  if (!target) return null;
  return await changeWorkspace(() => onlyPreviewTargetMutations.run(async () => {
    // The dialog does not hold the FIFO. Its owner may have relocated while the dialog was open.
    onlyPreviewWindowHelper.getMountKind(host.hostToken);
    const generation = onlyPreviewRecentDirectoryService.beginExplicitTarget(host.hostToken);
    try {
      const workspace = await onlyPreviewRecentDirectoryService.openExplicitTarget(
        host.hostToken,
        target,
        generation
      );
      if (workspace) {
        onlyPreviewSelectionCoordinator.advance(host.hostToken);
        onlyPreviewPreviewRegionService.clearWorkspace(host.hostToken, workspace.workspaceId);
      }
      return workspace;
    } finally {
      onlyPreviewRecentDirectoryService.finishExplicitTarget(generation);
      xpcMain.broadcast(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, { hostId: host.hostId });
    }
  }));
};
