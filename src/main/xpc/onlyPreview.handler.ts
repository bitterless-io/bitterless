import { app, dialog } from 'electron';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import {
  OnlyPreviewContractError,
  onlyPreviewFailure,
  onlyPreviewSuccess,
  parseOnlyPreviewBounds,
  parseOnlyPreviewFileRef,
  parseOnlyPreviewFindIntent,
  parseOnlyPreviewFindResultRequest,
  parseOnlyPreviewPreviewErrorRequest,
  parseOnlyPreviewPreviewReadyRequest,
  parseOnlyPreviewPreviewRuntimeRequest,
  parseOnlyPreviewPreviewRevisionRequest,
  parseOnlyPreviewProjectItemCopyRequest,
  parseOnlyPreviewProjectRootCopyRequest,
  parseOnlyPreviewProjectRootRequest
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_REFRESH_EVENT,
  ONLY_PREVIEW_SELECTION_CHANGED_EVENT,
  ONLY_PREVIEW_WORKSPACE_CHANGED_EVENT,
  type OnlyPreviewApi,
  type OnlyPreviewAgentSkillGuideInfo,
  type OnlyPreviewResult,
  type OnlyPreviewWorkspace
} from '@shared/onlypreview/onlyPreview.types';
import { createMcpConfigJson, getMcpServerName } from '@shared/mcp/mcpBridge.shared';
import { ONLY_PREVIEW_AGENT_SKILL_VERSION_CODE } from '@shared/onlypreview/onlyPreviewAgentSkillVersion.shared';
import {
  getOnlyPreviewOfficePackageKind,
  type OnlyPreviewOfficeReadBrokerApi,
  type OnlyPreviewOfficeReadBrokerRequest,
  type OnlyPreviewOfficeReadCancelBrokerRequest,
  type OnlyPreviewOfficeReadChunkBrokerRequest
} from '@shared/onlypreview/onlyPreviewOfficeReadRuntime.types';
import type {
  OnlyPreviewPreviewTextBrokerApi,
  OnlyPreviewPreviewTextBrokerRequest,
  OnlyPreviewPreviewTextCancelBrokerRequest,
  OnlyPreviewPreviewTextChunkBrokerRequest
} from '@shared/onlypreview/onlyPreviewPreviewReadRuntime.types';
import { onlyPreviewHostRegistry } from '@main/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from '@main/onlypreview/onlyPreviewWorkspace.registry';
import { onlyPreviewSettingsService } from '@main/onlypreview/onlyPreviewSettings.service';
import { onlyPreviewAssetRegistry } from '@main/onlypreview/onlyPreviewAsset.registry';
import { onlyPreviewDocumentRegistry } from '@main/onlypreview/onlyPreviewDocument.registry';
import { onlyPreviewSelectionCoordinator } from '@main/onlypreview/onlyPreviewSelectionCoordinator.service';
import { onlyPreviewPreviewRegionService } from '@main/onlypreview/views/onlyPreviewPreviewRegion.service';
import { onlyPreviewGlobalSearchXpcService } from '@main/onlypreview/views/onlyPreviewGlobalSearchXpc.service';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
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
import { onlyPreviewProjectNativeActionService } from '@main/onlypreview/onlyPreviewProjectNativeAction.service';
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

const recentDirectoryStorage =
  createXpcMainEmitter<OnlyPreviewRecentDirectoryStorage>('SettingDao');
onlyPreviewRecentDirectoryService.configureStorage(recentDirectoryStorage);
onlyPreviewRecentDirectoryService.configureTargetRuntime({
  inspectTarget: async (absoluteTarget) =>
    await fileSearchWindowService.inspectTarget(absoluteTarget),
  bindWorkspace: async (hostToken, workspace) => {
    const binding = await fileSearchWindowService.bindProjectWorkspace({
      workspaceId: workspace.workspaceId,
      rootPath: workspace.displayPath
    });
    let previewReadBound = false;
    try {
      await fileSearchWindowService.bindPreviewReadWorkspace({
        workspaceId: workspace.workspaceId,
        workspaceGeneration: binding.workspaceGeneration,
        rootPath: workspace.displayPath
      });
      previewReadBound = true;
      await fileSearchWindowService.bindOfficeWorkspace({
        workspaceId: workspace.workspaceId,
        rootPath: workspace.displayPath
      });
      onlyPreviewWorkspaceRegistry.bindProjectAuthority(
        hostToken,
        workspace.workspaceId,
        binding.workspaceGeneration
      );
    } catch (error) {
      if (previewReadBound) {
        await fileSearchWindowService
          .revokePreviewReadWorkspace({
            workspaceId: workspace.workspaceId,
            workspaceGeneration: binding.workspaceGeneration
          })
          .catch(() => undefined);
      }
      await fileSearchWindowService
        .revokeProjectWorkspace({
          workspaceId: workspace.workspaceId,
          workspaceGeneration: binding.workspaceGeneration
        })
        .catch(() => undefined);
      throw error;
    }
  }
});

onlyPreviewHostRegistry.onRevoke((host) => {
  onlyPreviewSelectionCoordinator.revoke(host.hostToken);
});

class OnlyPreviewHandler
  extends XpcMainHandler
  implements OnlyPreviewApi, OnlyPreviewOfficeReadBrokerApi, OnlyPreviewPreviewTextBrokerApi
{
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
          onlyPreviewSelectionCoordinator.advance(host.hostToken);
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
      const generation = onlyPreviewSelectionCoordinator.advance(host.hostToken);
      const workspace = await onlyPreviewRecentDirectoryService.restoreWorkspace(host.hostToken);
      if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, generation)) return workspace;
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
      const fileRef = parseOnlyPreviewFileRef(params);
      const generation = onlyPreviewSelectionCoordinator.beginSelection(host.hostToken, fileRef);
      try {
        if (getOnlyPreviewOfficePackageKind(fileRef.relativePath)) {
          onlyPreviewWorkspaceRegistry.select(host.hostToken, fileRef);
          await onlyPreviewPreviewRegionService.present(host.hostToken, fileRef);
          if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, generation)) return;
          xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, { hostId: host.hostId });
          return;
        }
        const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
          host.hostToken,
          fileRef
        );
        const file = await fileSearchWindowService.authorizeProjectItem({
          workspaceId: authority.workspaceId,
          workspaceGeneration: authority.workspaceGeneration,
          relativePath: authority.relativePath
        });
        if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, generation)) return;
        if (file.nodeKind !== 'file') {
          throw new OnlyPreviewContractError(
            'PATH_NOT_REGULAR_FILE',
            'Only regular files can be selected for Preview.'
          );
        }
        onlyPreviewWorkspaceRegistry.select(host.hostToken, {
          workspaceId: file.workspaceId,
          relativePath: file.relativePath
        });
        await onlyPreviewPreviewRegionService.present(host.hostToken, {
          workspaceId: file.workspaceId,
          relativePath: file.relativePath
        });
        if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, generation)) return;
        xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, { hostId: host.hostId });
      } finally {
        onlyPreviewSelectionCoordinator.finishSelection(host.hostToken, generation);
      }
    });
  }

  async openCurrentOfficeRead(request: OnlyPreviewOfficeReadBrokerRequest) {
    return await runOperation(async () => {
      return await onlyPreviewPreviewRegionService.getReadBroker().openCurrentOfficeRead(
        request.hostToken,
        request.brokerCapability,
        request.previewRuntimeToken,
        request.selectionRevision
      );
    });
  }

  async readCurrentOfficeChunk(request: OnlyPreviewOfficeReadChunkBrokerRequest) {
    return await runOperation(async () => {
      return await onlyPreviewPreviewRegionService.getReadBroker().readCurrentOfficeChunk(
        request.hostToken,
        request.brokerCapability,
        request.previewRuntimeToken,
        request.selectionRevision,
        request.grantId,
        request.offset
      );
    });
  }

  async cancelCurrentOfficeRead(request: OnlyPreviewOfficeReadCancelBrokerRequest) {
    return await runOperation(async () => {
      await onlyPreviewPreviewRegionService.getReadBroker().cancelCurrentOfficeRead(
        request.hostToken,
        request.brokerCapability,
        request.previewRuntimeToken,
        request.selectionRevision,
        request.grantId
      );
    });
  }

  async openCurrentPreviewText(request: OnlyPreviewPreviewTextBrokerRequest) {
    return await runOperation(async () => {
      return await onlyPreviewPreviewRegionService.getReadBroker().openCurrentPreviewText(
        request.hostToken,
        request.brokerCapability,
        request.previewRuntimeToken,
        request.selectionRevision
      );
    });
  }

  async readCurrentPreviewTextChunk(request: OnlyPreviewPreviewTextChunkBrokerRequest) {
    return await runOperation(async () => {
      return await onlyPreviewPreviewRegionService
        .getReadBroker()
        .readCurrentPreviewTextChunk(
        request.hostToken,
        request.brokerCapability,
        request.previewRuntimeToken,
        request.selectionRevision,
        request.grantId,
        request.sessionId,
        request.offset
      );
    });
  }

  async cancelCurrentPreviewText(request: OnlyPreviewPreviewTextCancelBrokerRequest) {
    return await runOperation(async () => {
      await onlyPreviewPreviewRegionService.getReadBroker().cancelCurrentPreviewText(
        request.hostToken,
        request.brokerCapability,
        request.previewRuntimeToken,
        request.selectionRevision,
        request.grantId,
        request.sessionId
      );
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
      const request = parseOnlyPreviewPreviewReadyRequest(params);
      onlyPreviewPreviewRegionService.reportVueReady(
        request.hostToken,
        request.selectionRevision,
        request.previewRuntimeToken,
        request.findCoverage,
        request.findAdapter
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

  async getPreviewFindSnapshot(
    params: ApiParams<'getPreviewFindSnapshot'>
  ): ReturnType<OnlyPreviewApi['getPreviewFindSnapshot']> {
    return await runOperation(async () =>
      onlyPreviewPreviewRegionService.findSnapshot(params?.hostToken)
    );
  }

  async submitPreviewFind(
    params: ApiParams<'submitPreviewFind'>
  ): ReturnType<OnlyPreviewApi['submitPreviewFind']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewFindIntent(params);
      onlyPreviewPreviewRegionService.submitFind(request.hostToken, {
        selectionRevision: request.selectionRevision,
        surface: request.surface,
        query: request.query,
        caseSensitive: request.caseSensitive,
        direction: request.direction,
        findNext: request.findNext
      });
    });
  }

  async closePreviewFind(
    params: ApiParams<'closePreviewFind'>
  ): ReturnType<OnlyPreviewApi['closePreviewFind']> {
    return await runOperation(async () => {
      onlyPreviewPreviewRegionService.closeFind(params?.hostToken);
      onlyPreviewPreviewRegionService.focusActiveContent(params?.hostToken);
    });
  }

  async reportGlobalSearchContext(
    params: ApiParams<'reportGlobalSearchContext'>
  ): ReturnType<OnlyPreviewApi['reportGlobalSearchContext']> {
    return await runOperation(async () => onlyPreviewGlobalSearchXpcService.reportContext(params));
  }

  async getGlobalSearchContext(
    params: ApiParams<'getGlobalSearchContext'>
  ): ReturnType<OnlyPreviewApi['getGlobalSearchContext']> {
    return await runOperation(async () =>
      onlyPreviewGlobalSearchXpcService.getContext(params?.hostToken)
    );
  }

  async revealGlobalSearchDirectory(
    params: ApiParams<'revealGlobalSearchDirectory'>
  ): ReturnType<OnlyPreviewApi['revealGlobalSearchDirectory']> {
    return await runOperation(
      async () => await onlyPreviewGlobalSearchXpcService.revealDirectory(params)
    );
  }

  async reportGlobalSearchDirectoryReveal(
    params: ApiParams<'reportGlobalSearchDirectoryReveal'>
  ): ReturnType<OnlyPreviewApi['reportGlobalSearchDirectoryReveal']> {
    return await runOperation(async () =>
      onlyPreviewGlobalSearchXpcService.completeDirectoryReveal(params)
    );
  }

  async closeGlobalSearch(
    params: ApiParams<'closeGlobalSearch'>
  ): ReturnType<OnlyPreviewApi['closeGlobalSearch']> {
    return await runOperation(async () => onlyPreviewGlobalSearchXpcService.close(params));
  }

  async reportPreviewFindResult(
    params: ApiParams<'reportPreviewFindResult'>
  ): ReturnType<OnlyPreviewApi['reportPreviewFindResult']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewFindResultRequest(params);
      onlyPreviewPreviewRegionService.reportVueFindResult(
        request.hostToken,
        request.previewRuntimeToken,
        request.result
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
      await onlyPreviewProjectNativeActionService.showFileContextMenu(window, params, {
        preview: (request) => void this.selectStandaloneFile(request),
        openExternally: (request) => void this.openExternally(request),
        revealInFolder: (request) => void this.revealInFolder(request)
      });
    });
  }

  async copyProjectItem(
    params: ApiParams<'copyProjectItem'>
  ): ReturnType<OnlyPreviewApi['copyProjectItem']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewProjectItemCopyRequest(params);
      const window = onlyPreviewWindowHelper.getStandaloneWindow(request.hostToken);
      await onlyPreviewProjectNativeActionService.copyProjectItemFromUi(
        window,
        request,
        request.copyKind
      );
    });
  }

  async showProjectRootContextMenu(
    params: ApiParams<'showProjectRootContextMenu'>
  ): ReturnType<OnlyPreviewApi['showProjectRootContextMenu']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewProjectRootRequest(params);
      const window = onlyPreviewWindowHelper.getStandaloneWindow(request.hostToken);
      await onlyPreviewProjectNativeActionService.showProjectRootContextMenu(window, request);
    });
  }

  async copyProjectRoot(
    params: ApiParams<'copyProjectRoot'>
  ): ReturnType<OnlyPreviewApi['copyProjectRoot']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewProjectRootCopyRequest(params);
      const window = onlyPreviewWindowHelper.getStandaloneWindow(request.hostToken);
      await onlyPreviewProjectNativeActionService.copyProjectRootFromUi(
        window,
        request,
        request.copyKind
      );
    });
  }

  async openExternally(
    params: ApiParams<'openExternally'>
  ): ReturnType<OnlyPreviewApi['openExternally']> {
    return await runOperation(async () => {
      await onlyPreviewProjectNativeActionService.openExternally(params);
    });
  }

  async revealInFolder(
    params: ApiParams<'revealInFolder'>
  ): ReturnType<OnlyPreviewApi['revealInFolder']> {
    return await runOperation(async () => {
      await onlyPreviewProjectNativeActionService.revealInFolder(params);
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
