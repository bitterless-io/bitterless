import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { OnlyPreviewValidatedTarget } from '@shared/onlypreview/onlyPreviewFileAuthorityRuntime.types';
import { onlyPreviewRecentDirectoryService } from './onlyPreviewRecentDirectory.service';

/** Inputs are canonical targets produced by the file authority worker, including symlink resolution. */
export const isOnlyPreviewPathWithinWorkspace = (rootRealPath: string, targetRealPath: string): boolean => {
  const path = relative(rootRealPath, targetRealPath);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
};

export const resolveOnlyPreviewTargetScope = async (
  target: OnlyPreviewValidatedTarget,
  resolveRoot: () => Promise<string> = () => onlyPreviewRecentDirectoryService.resolveWorkspaceRoot()
): Promise<{ kind: 'directory' | 'inside' | 'outside'; rootRealPath: string }> => {
  if (!target.selectedRelativePath) return { kind: 'directory', rootRealPath: target.rootRealPath };
  const rootRealPath = await resolveRoot();
  return {
    kind: isOnlyPreviewPathWithinWorkspace(rootRealPath, resolve(target.rootRealPath, target.selectedRelativePath))
      ? 'inside' : 'outside',
    rootRealPath
  };
};
