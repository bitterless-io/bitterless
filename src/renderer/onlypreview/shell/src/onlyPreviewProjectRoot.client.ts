import type {
  OnlyPreviewProjectItemCopyKind,
  OnlyPreviewResult,
  OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';

type RunCommand = (command: () => Promise<OnlyPreviewResult<void>>) => Promise<void>;

const rootRequest = (workspace: OnlyPreviewWorkspace | null): {
  hostToken: string;
  workspaceId: string;
} | null => {
  const hostToken = onlyPreviewEnv.hostToken;
  return hostToken && workspace ? { hostToken, workspaceId: workspace.workspaceId } : null;
};

export const showOnlyPreviewProjectRootContextMenu = async (
  workspace: OnlyPreviewWorkspace | null,
  run: RunCommand
): Promise<void> => {
  const request = rootRequest(workspace);
  if (request) await run(() => onlyPreviewClient.showProjectRootContextMenu(request));
};

export const copyOnlyPreviewProjectRoot = async (
  workspace: OnlyPreviewWorkspace | null,
  copyKind: OnlyPreviewProjectItemCopyKind,
  run: RunCommand
): Promise<void> => {
  const request = rootRequest(workspace);
  if (request) await run(() => onlyPreviewClient.copyProjectRoot({ ...request, copyKind }));
};
