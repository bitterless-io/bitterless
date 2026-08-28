import { unwrapOnlyPreviewResult } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewGlobalSearchDirectoryRevealAction,
  OnlyPreviewGlobalSearchWorkspaceContext
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewClient } from '../../common/onlyPreviewClient';
import { onlyPreviewEnv } from '../../common/contextBridge/onlyPreviewEnv.bridge';

class OnlyPreviewGlobalSearchShellClient {
  private serializedWorkspace = '';
  private reportChain: Promise<void> = Promise.resolve();

  report(workspace: OnlyPreviewGlobalSearchWorkspaceContext | null): void {
    const serialized = JSON.stringify(workspace);
    if (serialized === this.serializedWorkspace) return;
    this.serializedWorkspace = serialized;
    const report = workspace ? { ...workspace } : null;
    this.reportChain = this.reportChain
      .catch(() => undefined)
      .then(async () => {
        const hostToken = onlyPreviewEnv.hostToken;
        if (!hostToken) return;
        unwrapOnlyPreviewResult(
          await onlyPreviewClient.reportGlobalSearchContext({ hostToken, workspace: report })
        );
      });
  }

  async dismiss(): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    unwrapOnlyPreviewResult(
      await onlyPreviewClient.closeGlobalSearch({ hostToken, mode: 'opener' })
    );
  }

  async completeDirectoryReveal(
    action: OnlyPreviewGlobalSearchDirectoryRevealAction,
    succeeded: boolean
  ): Promise<void> {
    const hostToken = onlyPreviewEnv.hostToken;
    if (!hostToken) return;
    unwrapOnlyPreviewResult(
      await onlyPreviewClient.reportGlobalSearchDirectoryReveal({
        hostToken,
        actionId: action.actionId,
        workspaceId: action.workspaceId,
        generation: action.generation,
        relativePath: action.relativePath,
        succeeded
      })
    );
  }
}

export const onlyPreviewGlobalSearchShellClient = new OnlyPreviewGlobalSearchShellClient();
