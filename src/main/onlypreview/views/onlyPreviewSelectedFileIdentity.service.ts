import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { onlyPreviewWorkspaceRegistry } from '@main/onlypreview/onlyPreviewWorkspace.registry';
import type { OnlyPreviewPreviewPresentation } from '@shared/onlypreview/onlyPreview.types';

// A full watch commit carries no changed paths, so without this check an unrelated delete, rename,
// or temp-file save would rebuild the surface of a file nobody touched. One Project authority read
// decides it: a missing item, a non-file, or moved `size`/`modifiedAt` is a real change; anything
// else keeps the mounted preview, its selection revision, and its find state.
export const onlyPreviewSelectedFileChanged = async (
  hostToken: string,
  presentation: OnlyPreviewPreviewPresentation
): Promise<boolean> => {
  const { descriptor, fileRef } = presentation;
  if (!fileRef || !descriptor || descriptor.relativePath !== fileRef.relativePath) return true;
  try {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(hostToken, fileRef);
    const target = await fileSearchWindowService.authorizeProjectItem({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath
    });
    return (
      target.nodeKind !== 'file' ||
      target.size !== descriptor.size ||
      target.modifiedAt !== descriptor.modifiedAt
    );
  } catch {
    return true;
  }
};
