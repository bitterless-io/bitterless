import { xpcMain } from 'electron-xpc/main';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import { ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT } from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewTargetMutations } from './onlyPreviewExplicitOpen.service';
import { onlyPreviewHostRegistry } from './onlyPreviewHost.registry';
import { onlyPreviewRecentDirectoryService } from './onlyPreviewRecentDirectory.service';
import { onlyPreviewSelectionCoordinator } from './onlyPreviewSelectionCoordinator.service';
import { onlyPreviewWorkspaceRegistry } from './onlyPreviewWorkspace.registry';

/** Unbind a matching Project while retaining its tab/window, views and reusable search runtime. */
export const clearOnlyPreviewWorkspace = async (
  hostToken: string,
  rootRealPath: string
): Promise<void> => {
  await onlyPreviewTargetMutations.run(async () => {
    const host = onlyPreviewWindowHelper.getStandaloneHost();
    if (host?.hostToken !== hostToken || !onlyPreviewHostRegistry.isLive(hostToken)) return;
    if (!onlyPreviewWorkspaceRegistry.canClearProjectRoot(hostToken, rootRealPath)) return;

    onlyPreviewSelectionCoordinator.advance(hostToken);
    const revocations: Promise<void>[] = [];
    const revocationErrors: unknown[] = [];
    // Clearing waits for an in-flight restore/bind. Capture its eventual revocation too, including
    // an authority that was still pending when this operation entered the target FIFO.
    const unsubscribe = onlyPreviewWorkspaceRegistry.onRevoke((workspace) => {
      const generation = workspace.projectAuthorityGeneration;
      if (workspace.hostToken !== hostToken || workspace.kind !== 'project' || !generation) return;
      revocations.push(fileSearchWindowService.revokeProjectWorkspace({
        workspaceId: workspace.workspaceId,
        workspaceGeneration: generation
      }).catch((error) => { revocationErrors.push(error); }));
    });
    try {
      await onlyPreviewRecentDirectoryService.clearWorkspace(hostToken);
      await Promise.all(revocations);
      if (revocationErrors.length) throw revocationErrors[0];
    } finally {
      unsubscribe();
      if (onlyPreviewHostRegistry.isLive(hostToken)) {
        onlyPreviewWindowHelper.reportDisplayUrl(
          hostToken,
          onlyPreviewWorkspaceRegistry.describeDisplayUrl(hostToken)
        );
        xpcMain.broadcast(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, { hostId: host.hostId });
      }
    }
  });
};
