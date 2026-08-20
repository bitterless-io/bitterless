import { app, dialog, Menu, shell } from 'electron';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import {
  OnlyPreviewContractError,
  onlyPreviewFailure,
  onlyPreviewSuccess,
  parseOnlyPreviewBounds,
  parseOnlyPreviewPreviewErrorRequest,
  parseOnlyPreviewPreviewRuntimeRequest,
  parseOnlyPreviewPreviewRevisionRequest,
  parseOnlyPreviewTextReadRequest
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_REFRESH_EVENT,
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewApi,
  type OnlyPreviewAgentSkillGuideInfo,
  type OnlyPreviewFileRef,
  type OnlyPreviewHostRequest,
  type OnlyPreviewResult,
  type OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import { createMcpConfigJson, getMcpServerName } from '@shared/mcp/mcpBridge.shared';
import { ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE } from '@shared/onlypreview/onlyPreviewAgentSkillVersion.shared';
import { onlyPreviewHostRegistry } from '@main/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from '@main/onlypreview/onlyPreviewWorkspace.registry';
import { onlyPreviewSettingsService } from '@main/onlypreview/onlyPreviewSettings.service';
import { onlyPreviewAssetRegistry } from '@main/onlypreview/onlyPreviewAsset.registry';
import { onlyPreviewDocumentRegistry } from '@main/onlypreview/onlyPreviewDocument.registry';
import { onlyPreviewPreviewRegionService } from '@main/onlypreview/views/onlyPreviewPreviewRegion.service';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import { i18nHelper } from '@main/i18n/i18n.helper';
import { registerOnlyPreviewExplicitTarget } from '@main/onlypreview/onlyPreviewExplicitTarget.registry';
import {
  onlyPreviewRecentDirectoryService,
  type OnlyPreviewRecentDirectoryStorage
} from '@main/onlypreview/onlyPreviewRecentDirectory.service';
import {
  createOnlyPreviewAgentSkillGuideInfo,
  requireOnlyPreviewAgentSkillPath,
  resolveOnlyPreviewAgentSkillPath
} from '@main/onlypreview/onlyPreviewAgentSkill.service';
import { mcpHandler } from './mcp.handler';

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
const recentDirectoryStorage =
  createXpcMainEmitter<OnlyPreviewRecentDirectoryStorage>('SettingDao');
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
        if (workspace) {
          selectionGenerationByHost.set(
            host.hostToken,
            (selectionGenerationByHost.get(host.hostToken) || 0) + 1
          );
          onlyPreviewPreviewRegionService.clearWorkspace(host.hostToken, workspace.workspaceId);
          broadcastWorkspace(host.hostId);
        }
        return workspace;
      } finally {
        onlyPreviewRecentDirectoryService.finishExplicitTarget(generation);
      }
    });
  }

  async restoreWorkspace(
    params: ApiParams<'restoreWorkspace'>
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>> {
    return await runOperation(async () => {
      const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      const generation = (selectionGenerationByHost.get(host.hostToken) || 0) + 1;
      selectionGenerationByHost.set(host.hostToken, generation);
      const workspace = await onlyPreviewRecentDirectoryService.restoreWorkspace(host.hostToken);
      if (selectionGenerationByHost.get(host.hostToken) !== generation) return workspace;
      const current = onlyPreviewPreviewRegionService.snapshot(host.hostToken);
      if (workspace?.selectedRelativePath) {
        if (
          current.fileRef?.workspaceId !== workspace.workspaceId ||
          current.fileRef.relativePath !== workspace.selectedRelativePath
        ) {
          await onlyPreviewPreviewRegionService.present(host.hostToken, {
            workspaceId: workspace.workspaceId,
            relativePath: workspace.selectedRelativePath
          });
        }
      } else if (current.fileRef || current.workspaceId !== (workspace?.workspaceId ?? null)) {
        onlyPreviewPreviewRegionService.clearWorkspace(
          host.hostToken,
          workspace?.workspaceId ?? null
        );
      }
      return workspace;
    });
  }

  async readText(params: ApiParams<'readText'>): ReturnType<OnlyPreviewApi['readText']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewTextReadRequest(params);
      return await onlyPreviewPreviewRegionService.readText(request.hostToken, {
        previewRuntimeToken: request.previewRuntimeToken,
        selectionRevision: request.selectionRevision,
        workspaceId: request.workspaceId,
        relativePath: request.relativePath,
        adapterId: request.adapterId
      });
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
      await onlyPreviewPreviewRegionService.present(host.hostToken, {
        workspaceId: file.workspace.workspaceId,
        relativePath: file.relativePath
      });
      if (selectionGenerationByHost.get(host.hostToken) !== generation) return;
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

  async getPreviewPresentation(
    params: ApiParams<'getPreviewPresentation'>
  ): ReturnType<OnlyPreviewApi['getPreviewPresentation']> {
    return await runOperation(async () =>
      onlyPreviewPreviewRegionService.snapshot(params?.hostToken)
    );
  }

  async getVuePreviewPresentation(
    params: ApiParams<'getVuePreviewPresentation'>
  ): ReturnType<OnlyPreviewApi['getVuePreviewPresentation']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewPreviewRuntimeRequest(params);
      return onlyPreviewPreviewRegionService.snapshotForVue(
        request.hostToken,
        request.previewRuntimeToken
      );
    });
  }

  async reportPreviewReady(
    params: ApiParams<'reportPreviewReady'>
  ): ReturnType<OnlyPreviewApi['reportPreviewReady']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewPreviewRevisionRequest(params);
      onlyPreviewPreviewRegionService.reportVueReady(
        request.hostToken,
        request.selectionRevision,
        request.previewRuntimeToken
      );
    });
  }

  async reportPreviewReset(
    params: ApiParams<'reportPreviewReset'>
  ): ReturnType<OnlyPreviewApi['reportPreviewReset']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewPreviewRevisionRequest(params);
      onlyPreviewPreviewRegionService.reportVueReset(
        request.hostToken,
        request.selectionRevision,
        request.previewRuntimeToken
      );
    });
  }

  async reportPreviewError(
    params: ApiParams<'reportPreviewError'>
  ): ReturnType<OnlyPreviewApi['reportPreviewError']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewPreviewErrorRequest(params);
      onlyPreviewPreviewRegionService.reportVueError(
        request.hostToken,
        request.selectionRevision,
        request.previewRuntimeToken,
        request.errorCode
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

  async openAgentSkillGuide(
    params: ApiParams<'openAgentSkillGuide'>
  ): ReturnType<OnlyPreviewApi['openAgentSkillGuide']> {
    return await runOperation(async () => {
      const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      await onlyPreviewWindowHelper.openAgentSkillGuide(host.hostToken);
    });
  }

  async getAgentSkillGuideInfo(
    params: ApiParams<'getAgentSkillGuideInfo'>
  ): Promise<OnlyPreviewResult<OnlyPreviewAgentSkillGuideInfo>> {
    return await runOperation(async () => {
      onlyPreviewWindowHelper.requireAgentSkillGuideHost(params?.hostToken);
      const commandPath = await mcpHandler.ensureShim();
      const serverName = getMcpServerName(app.getName());
      const skillPath = requireOnlyPreviewAgentSkillPath(
        resolveOnlyPreviewAgentSkillPath({
          appPath: app.getAppPath(),
          isPackaged: app.isPackaged,
          resourcesPath: process.resourcesPath
        })
      );
      onlyPreviewWindowHelper.requireAgentSkillGuideHost(params?.hostToken);
      return createOnlyPreviewAgentSkillGuideInfo({
        configJson: createMcpConfigJson(commandPath, serverName),
        serverName,
        skillPath,
        skillVersionCode: ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE
      });
    });
  }
}

export const onlyPreviewHandler = new OnlyPreviewHandler();

onlyPreviewWindowHelper.setCommandHandler(({ hostToken, command }) => {
  if (command === 'refresh') {
    try {
      const host = onlyPreviewHostRegistry.require(hostToken, ['content']);
      void onlyPreviewPreviewRegionService.refresh(host.hostToken).catch(() => undefined);
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
    if (workspace) {
      if (workspace.selectedRelativePath) {
        onlyPreviewWorkspaceRegistry.select(host.hostToken, {
          workspaceId: workspace.workspaceId,
          relativePath: workspace.selectedRelativePath
        });
        await onlyPreviewPreviewRegionService.present(host.hostToken, {
          workspaceId: workspace.workspaceId,
          relativePath: workspace.selectedRelativePath
        });
      } else {
        onlyPreviewPreviewRegionService.clearWorkspace(host.hostToken, workspace.workspaceId);
      }
      broadcastWorkspace(host.hostId);
    }
    onlyPreviewWindowHelper.show();
  } finally {
    onlyPreviewRecentDirectoryService.finishExplicitTarget(generation);
  }
};

registerOnlyPreviewExplicitTarget(openOnlyPreviewAbsoluteTarget);

export const destroyOnlyPreviewForAuth = (): void => {
  onlyPreviewWindowHelper.destroy();
  onlyPreviewAssetRegistry.clear();
  onlyPreviewDocumentRegistry.clear();
  onlyPreviewHostRegistry.clear();
  onlyPreviewRecentDirectoryService.clearTransientState();
};

export const destroyOnlyPreviewForHostQuit = (): void => {
  destroyOnlyPreviewForAuth();
};

export type { OnlyPreviewHandler };
