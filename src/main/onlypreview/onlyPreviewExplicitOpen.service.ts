import { xpcMain } from 'electron-xpc/main';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT
} from '@shared/onlypreview/onlyPreview.types';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import { onlyPreviewPreviewRegionService } from './views/onlyPreviewPreviewRegion.service';
import { onlyPreviewWorkspaceRegistry } from './onlyPreviewWorkspace.registry';
import { onlyPreviewSelectionCoordinator } from './onlyPreviewSelectionCoordinator.service';
import { onlyPreviewRecentDirectoryService } from './onlyPreviewRecentDirectory.service';
import { registerOnlyPreviewExplicitTarget } from './onlyPreviewExplicitTarget.registry';
import {
  OnlyPreviewTargetMutationQueue,
  serializeOnlyPreviewOpenTarget
} from './onlyPreviewOpenRouter.service';
import { onlyPreviewOpenDiagnostics } from './onlyPreviewOpenDiagnostics.runtime';
import type { OnlyPreviewOpenTrace } from '@shared/onlypreview/onlyPreviewOpenDiagnostics.mjs';

export const onlyPreviewTargetMutations = new OnlyPreviewTargetMutationQueue();

const performOpenOnlyPreviewAbsoluteTarget = async (
  target: string,
  trace: OnlyPreviewOpenTrace
): Promise<void> => {
  const recentGeneration = onlyPreviewRecentDirectoryService.beginExplicitTarget();
  try {
    trace.mark({ phase: 'fifo' });
    const host = await onlyPreviewWindowHelper.ensureStandalone('explicit');
    trace.mark({ phase: 'window' });
    onlyPreviewRecentDirectoryService.bindExplicitTarget(host.hostToken, recentGeneration);
    const inspected = await fileSearchWindowService.inspectTarget(target);
    trace.mark({ phase: 'inspect', kind: inspected.selectedRelativePath ? 'file' : 'directory' });

    if (!inspected.selectedRelativePath) {
      const workspace = await onlyPreviewRecentDirectoryService.openExplicitTarget(
        host.hostToken,
        target,
        recentGeneration
      );
      if (workspace) {
        trace.mark({ phase: 'authority', authority: 'directory' });
        onlyPreviewSelectionCoordinator.advance(host.hostToken);
        onlyPreviewPreviewRegionService.clearWorkspace(host.hostToken, workspace.workspaceId);
        xpcMain.broadcast(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, { hostId: host.hostId });
        onlyPreviewWindowHelper.show();
      }
      trace.mark({ phase: 'accepted', authority: 'directory' });
      trace.end({ outcome: 'accepted' });
      return;
    }

    const selectionGeneration = onlyPreviewSelectionCoordinator.advance(host.hostToken);
    let fileRef = onlyPreviewWorkspaceRegistry.resolveProjectFileRef(host.hostToken, inspected);
    if (fileRef) {
      trace.mark({ phase: 'authority', authority: 'project' });
      const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
        host.hostToken,
        fileRef
      );
      const file = await fileSearchWindowService.authorizeProjectItem({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        relativePath: authority.relativePath
      });
      if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, selectionGeneration)) {
        trace.end({ outcome: 'superseded' });
        return;
      }
      if (file.nodeKind !== 'file') {
        throw new OnlyPreviewContractError(
          'PATH_NOT_REGULAR_FILE',
          'Only regular files can be selected for Preview.'
        );
      }
      onlyPreviewWorkspaceRegistry.revokeExternalPreview(host.hostToken);
      fileRef = { workspaceId: file.workspaceId, relativePath: file.relativePath };
      onlyPreviewWorkspaceRegistry.select(host.hostToken, fileRef);
    } else {
      trace.mark({ phase: 'authority', authority: 'external' });
      fileRef = onlyPreviewWorkspaceRegistry.registerExternalPreview(host.hostToken, inspected);
      onlyPreviewWorkspaceRegistry.clearProjectSelection(host.hostToken);
    }

    await onlyPreviewPreviewRegionService.present(host.hostToken, fileRef, trace.tag);
    trace.mark({ phase: 'presentation-issued' });
    if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, selectionGeneration)) {
      trace.end({ outcome: 'superseded' });
      return;
    }
    xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, { hostId: host.hostId });
    onlyPreviewWindowHelper.show();
    trace.mark({ phase: 'accepted' });
    trace.end({ outcome: 'accepted' });
  } catch (error) {
    trace.end({ outcome: 'failure' });
    throw error;
  } finally {
    onlyPreviewRecentDirectoryService.finishExplicitTarget(recentGeneration);
  }
};

const serializedOpenOnlyPreviewAbsoluteTarget = serializeOnlyPreviewOpenTarget(
  performOpenOnlyPreviewAbsoluteTarget,
  onlyPreviewTargetMutations
);

export const openOnlyPreviewAbsoluteTarget = (target: string): Promise<void> => {
  const trace = onlyPreviewOpenDiagnostics.trace('target', { kind: 'unknown' }, 't');
  return serializedOpenOnlyPreviewAbsoluteTarget(target, trace);
};

registerOnlyPreviewExplicitTarget(openOnlyPreviewAbsoluteTarget);
