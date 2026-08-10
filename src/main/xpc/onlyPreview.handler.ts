import { dialog, Menu, shell } from 'electron';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import {
  OnlyPreviewContractError,
  onlyPreviewFailure,
  onlyPreviewSuccess,
  parseOnlyPreviewBounds,
  parseOnlyPreviewIndexRevision
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_INDEX_PROGRESS_EVENT,
  ONLY_PREVIEW_REFRESH_EVENT,
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewApi,
  type OnlyPreviewFileRef,
  type OnlyPreviewHostRequest,
  type OnlyPreviewResult,
  type OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import { onlyPreviewHostRegistry } from '@main/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from '@main/onlypreview/onlyPreviewWorkspace.registry';
import { onlyPreviewIndexService } from '@main/onlypreview/onlyPreviewIndex.service';
import { onlyPreviewClassifierService } from '@main/onlypreview/onlyPreviewClassifier.service';
import { onlyPreviewSettingsService } from '@main/onlypreview/onlyPreviewSettings.service';
import { onlyPreviewAssetRegistry } from '@main/onlypreview/onlyPreviewAsset.registry';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import { i18nHelper } from '@main/i18n/i18n.helper';
import {
  onlyPreviewRecentDirectoryService,
  type OnlyPreviewRecentDirectoryStorage
} from '@main/onlypreview/onlyPreviewRecentDirectory.service';

type ApiParams<T extends keyof OnlyPreviewApi> = Parameters<OnlyPreviewApi[T]>[0];

const runOperation = async <T>(operation: () => Promise<T>): Promise<OnlyPreviewResult<T>> => {
  try {
    return onlyPreviewSuccess(await operation());
  } catch (error) {
    return onlyPreviewFailure(error);
  }
};

const broadcastWorkspace = (hostId: string): void => {
  xpcMain.broadcast(ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT, { hostId });
};

const selectionGenerationByHost = new Map<string, number>();
const recentDirectoryStorage = createXpcMainEmitter<OnlyPreviewRecentDirectoryStorage>('SettingDao');
onlyPreviewRecentDirectoryService.configureStorage(recentDirectoryStorage);

onlyPreviewHostRegistry.onRevoke((host) => {
  selectionGenerationByHost.delete(host.hostToken);
});

class OnlyPreviewHandler extends XpcMainHandler implements OnlyPreviewApi {
  async openOnlyPreviewWindow(): ReturnType<OnlyPreviewApi['openOnlyPreviewWindow']> {
    return await runOperation(async () => {
      await onlyPreviewWindowHelper.ensureStandalone();
    });
  }

  async chooseFolder(
    params: ApiParams<'chooseFolder'>
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>> {
    return await runOperation(async () => {
      const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      const window = onlyPreviewWindowHelper.getStandaloneWindow(host.hostToken);
      const result = await dialog.showOpenDialog(window, {
        title: 'Open Folder in OnlyPreview',
        properties: ['openDirectory']
      });
      const target = result.canceled ? null : (result.filePaths[0] ?? null);
      if (!target) return null;
      const generation = onlyPreviewRecentDirectoryService.beginExplicitTarget(host.hostToken);
      try {
        const workspace = await onlyPreviewRecentDirectoryService.openExplicitTarget(
          host.hostToken,
          target,
          generation
        );
        if (workspace) broadcastWorkspace(host.hostId);
        return workspace;
      } finally {
        onlyPreviewRecentDirectoryService.finishExplicitTarget(generation);
      }
    });
  }

  async restoreWorkspace(
    params: ApiParams<'restoreWorkspace'>
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>> {
    return await runOperation(async () =>
      await onlyPreviewRecentDirectoryService.restoreWorkspace(params?.hostToken)
    );
  }

  async listDirectory(
    params: ApiParams<'listDirectory'>
  ): ReturnType<OnlyPreviewApi['listDirectory']> {
    return await runOperation(async () => {
      const settings = await onlyPreviewSettingsService.get();
      return await onlyPreviewIndexService.listDirectory({
        hostToken: params?.hostToken,
        workspaceId: params?.workspaceId,
        relativePath: params?.relativePath,
        showHiddenFiles: settings.showHiddenFiles
      });
    });
  }

  async buildIndex(params: ApiParams<'buildIndex'>): ReturnType<OnlyPreviewApi['buildIndex']> {
    return await runOperation(async () => {
      const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      const indexRevision = parseOnlyPreviewIndexRevision(params?.indexRevision);
      const settings = await onlyPreviewSettingsService.get();
      return await onlyPreviewIndexService.build({
        hostToken: params?.hostToken,
        workspaceId: params?.workspaceId,
        showHiddenFiles: settings.showHiddenFiles,
        onProgress: (progress) => {
          xpcMain.broadcast(ONLY_PREVIEW_INDEX_PROGRESS_EVENT, {
            hostId: host.hostId,
            indexRevision,
            ...progress
          });
        }
      });
    });
  }

  async describeFile(
    params: ApiParams<'describeFile'>
  ): ReturnType<OnlyPreviewApi['describeFile']> {
    return await runOperation(async () => {
      const file = await onlyPreviewWorkspaceRegistry.openFile(params?.hostToken, params);
      try {
        return await onlyPreviewClassifierService.describe(file);
      } finally {
        await file.fileHandle.close().catch(() => undefined);
      }
    });
  }

  async readText(params: ApiParams<'readText'>): ReturnType<OnlyPreviewApi['readText']> {
    return await runOperation(async () => {
      const file = await onlyPreviewWorkspaceRegistry.openFile(params?.hostToken, params);
      try {
        return await onlyPreviewClassifierService.readText(file);
      } finally {
        await file.fileHandle.close().catch(() => undefined);
      }
    });
  }

  async selectStandaloneFile(
    params: ApiParams<'selectStandaloneFile'>
  ): ReturnType<OnlyPreviewApi['selectStandaloneFile']> {
    return await runOperation(async () => {
      const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      const standaloneHost = onlyPreviewWindowHelper.getStandaloneHost();
      if (host.kind !== 'standalone' || host.hostToken !== standaloneHost?.hostToken) {
        throw new OnlyPreviewContractError(
          'HOST_ROLE_DENIED',
          'Only the active standalone OnlyPreview window can synchronize selection.'
        );
      }
      const generation = (selectionGenerationByHost.get(host.hostToken) || 0) + 1;
      selectionGenerationByHost.set(host.hostToken, generation);
      const file = await onlyPreviewWorkspaceRegistry.resolveFile(host.hostToken, params);
      if (selectionGenerationByHost.get(host.hostToken) !== generation) return;
      onlyPreviewWorkspaceRegistry.select(host.hostToken, {
        workspaceId: file.workspace.workspaceId,
        relativePath: file.relativePath
      });
      xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, { hostId: host.hostId });
    });
  }

  async updatePreviewBounds(
    params: ApiParams<'updatePreviewBounds'>
  ): ReturnType<OnlyPreviewApi['updatePreviewBounds']> {
    return await runOperation(async () => {
      onlyPreviewWindowHelper.updatePreviewBounds(
        params?.hostToken,
        parseOnlyPreviewBounds(params)
      );
    });
  }

  async minimizeWindow(
    params: ApiParams<'minimizeWindow'>
  ): ReturnType<OnlyPreviewApi['minimizeWindow']> {
    return await runOperation(async () => {
      onlyPreviewWindowHelper.minimizeWindow(params?.hostToken);
    });
  }

  async toggleMaximizeWindow(
    params: ApiParams<'toggleMaximizeWindow'>
  ): ReturnType<OnlyPreviewApi['toggleMaximizeWindow']> {
    return await runOperation(async () => {
      onlyPreviewWindowHelper.toggleMaximizeWindow(params?.hostToken);
    });
  }

  async closeWindow(params: ApiParams<'closeWindow'>): ReturnType<OnlyPreviewApi['closeWindow']> {
    return await runOperation(async () => {
      onlyPreviewWindowHelper.closeWindow(params?.hostToken);
    });
  }

  async showFileContextMenu(
    params: ApiParams<'showFileContextMenu'>
  ): ReturnType<OnlyPreviewApi['showFileContextMenu']> {
    return await runOperation(async () => {
      const window = onlyPreviewWindowHelper.getStandaloneWindow(params?.hostToken);
      const file = await onlyPreviewWorkspaceRegistry.resolveFile(params?.hostToken, params);
      const request: OnlyPreviewHostRequest & OnlyPreviewFileRef = {
        hostToken: file.host.hostToken,
        workspaceId: file.workspace.workspaceId,
        relativePath: file.relativePath
      };
      const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
      Menu.buildFromTemplate([
        {
          id: 'onlypreview-preview',
          label: labels.preview,
          click: () => void this.selectStandaloneFile(request)
        },
        { type: 'separator' },
        {
          id: 'onlypreview-open-externally',
          label: labels.openExternally,
          click: () => void this.openExternally(request)
        },
        {
          id: 'onlypreview-reveal-in-folder',
          label: labels.revealInFolder,
          click: () => void this.revealInFolder(request)
        }
      ]).popup({ window });
    });
  }

  async openExternally(
    params: ApiParams<'openExternally'>
  ): ReturnType<OnlyPreviewApi['openExternally']> {
    return await runOperation(async () => {
      const file = await onlyPreviewWorkspaceRegistry.resolveFile(params?.hostToken, params);
      const failure = await shell.openPath(file.realPath);
      if (failure) throw new Error('The operating system could not open this file.');
    });
  }

  async revealInFolder(
    params: ApiParams<'revealInFolder'>
  ): ReturnType<OnlyPreviewApi['revealInFolder']> {
    return await runOperation(async () => {
      const file = await onlyPreviewWorkspaceRegistry.resolveFile(params?.hostToken, params);
      shell.showItemInFolder(file.realPath);
    });
  }

  async getSettings(params: ApiParams<'getSettings'>): ReturnType<OnlyPreviewApi['getSettings']> {
    return await runOperation(async () => {
      onlyPreviewHostRegistry.require(params?.hostToken, ['content', 'settings']);
      return await onlyPreviewSettingsService.get();
    });
  }

  async saveSettings(
    params: ApiParams<'saveSettings'>
  ): ReturnType<OnlyPreviewApi['saveSettings']> {
    return await runOperation(async () => {
      onlyPreviewHostRegistry.require(params?.hostToken, ['settings']);
      return await onlyPreviewSettingsService.save(params?.settings);
    });
  }

  async openSettings(
    params: ApiParams<'openSettings'>
  ): ReturnType<OnlyPreviewApi['openSettings']> {
    return await runOperation(async () => {
      onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      await onlyPreviewWindowHelper.openSettings(params.hostToken);
    });
  }

  async closeSettings(
    params: ApiParams<'closeSettings'>
  ): ReturnType<OnlyPreviewApi['closeSettings']> {
    return await runOperation(async () => {
      onlyPreviewWindowHelper.closeSettings(params?.hostToken);
    });
  }
}

export const onlyPreviewHandler = new OnlyPreviewHandler();

onlyPreviewWindowHelper.setCommandHandler(({ hostToken, command }) => {
  if (command === 'refresh') {
    try {
      const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
      xpcMain.broadcast(ONLY_PREVIEW_REFRESH_EVENT, { hostId: host.hostId });
    } catch {
      // A closing view can deliver its final input after the host has been revoked.
    }
    return;
  }
  if (command === 'open-settings') {
    void onlyPreviewHandler.openSettings({ hostToken });
    return;
  }
  void onlyPreviewHandler.chooseFolder({ hostToken });
});

export const openOnlyPreviewAbsoluteTarget = async (target: string): Promise<void> => {
  const generation = onlyPreviewRecentDirectoryService.beginExplicitTarget();
  try {
    const host = await onlyPreviewWindowHelper.ensureStandalone();
    const workspace = await onlyPreviewRecentDirectoryService.openExplicitTarget(
      host.hostToken,
      target,
      generation
    );
    if (workspace) broadcastWorkspace(host.hostId);
    onlyPreviewWindowHelper.show();
  } finally {
    onlyPreviewRecentDirectoryService.finishExplicitTarget(generation);
  }
};

export const destroyOnlyPreviewForAuth = (): void => {
  onlyPreviewWindowHelper.destroy();
  onlyPreviewAssetRegistry.clear();
  onlyPreviewHostRegistry.clear();
  onlyPreviewRecentDirectoryService.clearTransientState();
};

export const destroyOnlyPreviewForHostQuit = (): void => {
  destroyOnlyPreviewForAuth();
};

export type { OnlyPreviewHandler };
