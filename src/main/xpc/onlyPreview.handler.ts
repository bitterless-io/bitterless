import { app, dialog, shell } from 'electron';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import {
  OnlyPreviewContractError,
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
  parseOnlyPreviewProjectRootRequest,
  toOnlyPreviewErrorPayload
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
import { onlyPreviewLogService } from '@main/onlypreview/onlyPreviewLog.runtime';
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
  OnlyPreviewTargetMutationQueue,
  serializeOnlyPreviewOpenTarget
} from '@main/onlypreview/onlyPreviewOpenRouter.service';
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

const runOperation = async <T>(
  operation: keyof OnlyPreviewHandler,
  run: () => Promise<T>
): Promise<OnlyPreviewResult<T>> => {
  try {
    return onlyPreviewSuccess(await run());
  } catch (error) {
    const payload = toOnlyPreviewErrorPayload(error);
    onlyPreviewLogService.writeOperationFailure({ operation, code: payload.code, error });
    return { ok: false, error: payload };
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
    try {
      onlyPreviewWorkspaceRegistry.bindProjectAuthority(
        hostToken,
        workspace.workspaceId,
        binding.workspaceGeneration
      );
    } catch (error) {
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

onlyPreviewWorkspaceRegistry.onRevoke((workspace) => {
  try {
    onlyPreviewPreviewRegionService.handleWorkspaceRevoked(
      workspace.hostToken,
      workspace.workspaceId
    );
  } catch {
    // Workspace teardown must continue even if its visible host is already closing.
  }
  const workspaceGeneration = workspace.previewAuthorityGeneration;
  if (!Number.isSafeInteger(workspaceGeneration) || (workspaceGeneration as number) < 1) return;
  void fileSearchWindowService
    .revokePreviewReadWorkspace({
      workspaceId: workspace.workspaceId,
      workspaceGeneration: workspaceGeneration as number
    })
    .catch(() => undefined);
});

const onlyPreviewTargetMutations = new OnlyPreviewTargetMutationQueue();

class OnlyPreviewHandler
  extends XpcMainHandler
  implements OnlyPreviewApi, OnlyPreviewOfficeReadBrokerApi, OnlyPreviewPreviewTextBrokerApi
{
  async openOnlyPreviewWindow(): ReturnType<OnlyPreviewApi['openOnlyPreviewWindow']> {
    return await runOperation('openOnlyPreviewWindow', async () => {
      await onlyPreviewWindowHelper.ensureStandalone();
    });
  }

  async chooseFolder(
    params: ApiParams<'chooseFolder'>
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>> {
    return await runOperation('chooseFolder', async () => {
      const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      const window = onlyPreviewWindowHelper.getStandaloneWindow(host.hostToken);
      const result = await dialog.showOpenDialog(window, {
        title: 'Open Folder in OnlyPreview',
        properties: ['openDirectory']
      });
      const target = result.canceled ? null : (result.filePaths[0] ?? null);
      if (!target) return null;
      return await onlyPreviewTargetMutations.run(async () => {
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
    });
  }

  async restoreWorkspace(
    params: ApiParams<'restoreWorkspace'>
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>> {
    return await runOperation('restoreWorkspace', async () => {
      const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      const generation = onlyPreviewSelectionCoordinator.advance(host.hostToken);
      const current = onlyPreviewPreviewRegionService.snapshot(host.hostToken);
      const hasLiveExternalPresentation = Boolean(
        current.fileRef &&
        onlyPreviewWorkspaceRegistry.isExternalPreviewFileRef(host.hostToken, current.fileRef)
      );
      const workspace = hasLiveExternalPresentation
        ? onlyPreviewWorkspaceRegistry.restore(host.hostToken)
        : await onlyPreviewRecentDirectoryService.restoreWorkspace(host.hostToken);
      if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, generation)) return workspace;
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
      } else if (
        !hasLiveExternalPresentation &&
        (current.fileRef || current.workspaceId !== (workspace?.workspaceId ?? null))
      ) {
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
    return await runOperation('selectStandaloneFile', async () => {
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
        onlyPreviewWorkspaceRegistry.revokeExternalPreview(host.hostToken);
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
    return await runOperation('openCurrentOfficeRead', async () => {
      return await onlyPreviewPreviewRegionService
        .getReadBroker()
        .openCurrentOfficeRead(
          request.hostToken,
          request.brokerCapability,
          request.previewRuntimeToken,
          request.selectionRevision
        );
    });
  }

  async readCurrentOfficeChunk(request: OnlyPreviewOfficeReadChunkBrokerRequest) {
    return await runOperation('readCurrentOfficeChunk', async () => {
      return await onlyPreviewPreviewRegionService
        .getReadBroker()
        .readCurrentOfficeChunk(
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
    return await runOperation('cancelCurrentOfficeRead', async () => {
      await onlyPreviewPreviewRegionService
        .getReadBroker()
        .cancelCurrentOfficeRead(
          request.hostToken,
          request.brokerCapability,
          request.previewRuntimeToken,
          request.selectionRevision,
          request.grantId
        );
    });
  }

  async openCurrentPreviewText(request: OnlyPreviewPreviewTextBrokerRequest) {
    return await runOperation('openCurrentPreviewText', async () => {
      return await onlyPreviewPreviewRegionService
        .getReadBroker()
        .openCurrentPreviewText(
          request.hostToken,
          request.brokerCapability,
          request.previewRuntimeToken,
          request.selectionRevision
        );
    });
  }

  async readCurrentPreviewTextChunk(request: OnlyPreviewPreviewTextChunkBrokerRequest) {
    return await runOperation('readCurrentPreviewTextChunk', async () => {
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
    return await runOperation('cancelCurrentPreviewText', async () => {
      await onlyPreviewPreviewRegionService
        .getReadBroker()
        .cancelCurrentPreviewText(
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
    return await runOperation('updatePreviewBounds', async () => {
      onlyPreviewWindowHelper.updatePreviewBounds(
        params?.hostToken,
        parseOnlyPreviewBounds(params)
      );
    });
  }

  async getPreviewPresentation(
    params: ApiParams<'getPreviewPresentation'>
  ): ReturnType<OnlyPreviewApi['getPreviewPresentation']> {
    return await runOperation('getPreviewPresentation', async () =>
      onlyPreviewPreviewRegionService.snapshot(params?.hostToken)
    );
  }

  async getVuePreviewPresentation(
    params: ApiParams<'getVuePreviewPresentation'>
  ): ReturnType<OnlyPreviewApi['getVuePreviewPresentation']> {
    return await runOperation('getVuePreviewPresentation', async () => {
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
    return await runOperation('reportPreviewReady', async () => {
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
    return await runOperation('reportPreviewReset', async () => {
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
    return await runOperation('reportPreviewError', async () => {
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
    return await runOperation('getPreviewFindSnapshot', async () =>
      onlyPreviewPreviewRegionService.findSnapshot(params?.hostToken)
    );
  }

  async submitPreviewFind(
    params: ApiParams<'submitPreviewFind'>
  ): ReturnType<OnlyPreviewApi['submitPreviewFind']> {
    return await runOperation('submitPreviewFind', async () => {
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
    return await runOperation('closePreviewFind', async () => {
      onlyPreviewPreviewRegionService.closeFind(params?.hostToken);
      onlyPreviewPreviewRegionService.focusActiveContent(params?.hostToken);
    });
  }

  async reportGlobalSearchContext(
    params: ApiParams<'reportGlobalSearchContext'>
  ): ReturnType<OnlyPreviewApi['reportGlobalSearchContext']> {
    return await runOperation('reportGlobalSearchContext', async () =>
      onlyPreviewGlobalSearchXpcService.reportContext(params)
    );
  }

  async getGlobalSearchContext(
    params: ApiParams<'getGlobalSearchContext'>
  ): ReturnType<OnlyPreviewApi['getGlobalSearchContext']> {
    return await runOperation('getGlobalSearchContext', async () =>
      onlyPreviewGlobalSearchXpcService.getContext(params?.hostToken)
    );
  }

  async revealGlobalSearchDirectory(
    params: ApiParams<'revealGlobalSearchDirectory'>
  ): ReturnType<OnlyPreviewApi['revealGlobalSearchDirectory']> {
    return await runOperation(
      'revealGlobalSearchDirectory',
      async () => await onlyPreviewGlobalSearchXpcService.revealDirectory(params)
    );
  }

  async reportGlobalSearchDirectoryReveal(
    params: ApiParams<'reportGlobalSearchDirectoryReveal'>
  ): ReturnType<OnlyPreviewApi['reportGlobalSearchDirectoryReveal']> {
    return await runOperation('reportGlobalSearchDirectoryReveal', async () =>
      onlyPreviewGlobalSearchXpcService.completeDirectoryReveal(params)
    );
  }

  async closeGlobalSearch(
    params: ApiParams<'closeGlobalSearch'>
  ): ReturnType<OnlyPreviewApi['closeGlobalSearch']> {
    return await runOperation('closeGlobalSearch', async () =>
      onlyPreviewGlobalSearchXpcService.close(params)
    );
  }

  async reportPreviewFindResult(
    params: ApiParams<'reportPreviewFindResult'>
  ): ReturnType<OnlyPreviewApi['reportPreviewFindResult']> {
    return await runOperation('reportPreviewFindResult', async () => {
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
    return await runOperation('minimizeWindow', async () => {
      onlyPreviewWindowHelper.minimizeWindow(params?.hostToken);
    });
  }

  async toggleMaximizeWindow(
    params: ApiParams<'toggleMaximizeWindow'>
  ): ReturnType<OnlyPreviewApi['toggleMaximizeWindow']> {
    return await runOperation('toggleMaximizeWindow', async () => {
      onlyPreviewWindowHelper.toggleMaximizeWindow(params?.hostToken);
    });
  }

  async closeWindow(params: ApiParams<'closeWindow'>): ReturnType<OnlyPreviewApi['closeWindow']> {
    return await runOperation('closeWindow', async () => {
      onlyPreviewWindowHelper.closeWindow(params?.hostToken);
    });
  }

  async showFileContextMenu(
    params: ApiParams<'showFileContextMenu'>
  ): ReturnType<OnlyPreviewApi['showFileContextMenu']> {
    return await runOperation('showFileContextMenu', async () => {
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
    return await runOperation('copyProjectItem', async () => {
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
    return await runOperation('showProjectRootContextMenu', async () => {
      const request = parseOnlyPreviewProjectRootRequest(params);
      const window = onlyPreviewWindowHelper.getStandaloneWindow(request.hostToken);
      await onlyPreviewProjectNativeActionService.showProjectRootContextMenu(window, request);
    });
  }

  async copyProjectRoot(
    params: ApiParams<'copyProjectRoot'>
  ): ReturnType<OnlyPreviewApi['copyProjectRoot']> {
    return await runOperation('copyProjectRoot', async () => {
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
    return await runOperation('openExternally', async () => {
      const externalPath = onlyPreviewWorkspaceRegistry.getExternalPreviewNativePath(
        params?.hostToken,
        params
      );
      if (externalPath) {
        const inspected = await fileSearchWindowService.inspectTarget(externalPath);
        const revalidatedPath = onlyPreviewWorkspaceRegistry.revalidateExternalPreviewNativePath(
          params?.hostToken,
          params,
          inspected
        );
        const failure = await shell.openPath(revalidatedPath);
        if (failure) throw new Error('The operating system could not open this file.');
        return;
      }
      await onlyPreviewProjectNativeActionService.openExternally(params);
    });
  }

  async revealInFolder(
    params: ApiParams<'revealInFolder'>
  ): ReturnType<OnlyPreviewApi['revealInFolder']> {
    return await runOperation('revealInFolder', async () => {
      const externalPath = onlyPreviewWorkspaceRegistry.getExternalPreviewNativePath(
        params?.hostToken,
        params
      );
      if (externalPath) {
        const inspected = await fileSearchWindowService.inspectTarget(externalPath);
        const revalidatedPath = onlyPreviewWorkspaceRegistry.revalidateExternalPreviewNativePath(
          params?.hostToken,
          params,
          inspected
        );
        shell.showItemInFolder(revalidatedPath);
        return;
      }
      await onlyPreviewProjectNativeActionService.revealInFolder(params);
    });
  }

  async getSettings(params: ApiParams<'getSettings'>): ReturnType<OnlyPreviewApi['getSettings']> {
    return await runOperation('getSettings', async () => {
      onlyPreviewHostRegistry.require(params?.hostToken, ['content', 'settings']);
      return await onlyPreviewSettingsService.get();
    });
  }

  async saveSettings(
    params: ApiParams<'saveSettings'>
  ): ReturnType<OnlyPreviewApi['saveSettings']> {
    return await runOperation('saveSettings', async () => {
      onlyPreviewHostRegistry.require(params?.hostToken, ['settings']);
      return await onlyPreviewSettingsService.save(params?.settings);
    });
  }

  async openSettings(
    params: ApiParams<'openSettings'>
  ): ReturnType<OnlyPreviewApi['openSettings']> {
    return await runOperation('openSettings', async () => {
      onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      await onlyPreviewWindowHelper.openSettings(params.hostToken);
    });
  }

  async closeSettings(
    params: ApiParams<'closeSettings'>
  ): ReturnType<OnlyPreviewApi['closeSettings']> {
    return await runOperation('closeSettings', async () => {
      onlyPreviewWindowHelper.closeSettings(params?.hostToken);
    });
  }

  async openAgentSkillGuide(
    params: ApiParams<'openAgentSkillGuide'>
  ): ReturnType<OnlyPreviewApi['openAgentSkillGuide']> {
    return await runOperation('openAgentSkillGuide', async () => {
      const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      await onlyPreviewWindowHelper.openAgentSkillGuide(host.hostToken);
    });
  }

  async getAgentSkillGuideInfo(
    params: ApiParams<'getAgentSkillGuideInfo'>
  ): Promise<OnlyPreviewResult<OnlyPreviewAgentSkillGuideInfo>> {
    return await runOperation('getAgentSkillGuideInfo', async () => {
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

const performOpenOnlyPreviewAbsoluteTarget = async (target: string): Promise<void> => {
  const recentGeneration = onlyPreviewRecentDirectoryService.beginExplicitTarget();
  try {
    const host = await onlyPreviewWindowHelper.ensureStandalone();
    onlyPreviewRecentDirectoryService.bindExplicitTarget(host.hostToken, recentGeneration);
    const inspected = await fileSearchWindowService.inspectTarget(target);

    if (!inspected.selectedRelativePath) {
      const workspace = await onlyPreviewRecentDirectoryService.openExplicitTarget(
        host.hostToken,
        target,
        recentGeneration
      );
      if (workspace) {
        onlyPreviewSelectionCoordinator.advance(host.hostToken);
        onlyPreviewPreviewRegionService.clearWorkspace(host.hostToken, workspace.workspaceId);
        broadcastWorkspace(host.hostId);
        onlyPreviewWindowHelper.show();
      }
      return;
    }

    const selectionGeneration = onlyPreviewSelectionCoordinator.advance(host.hostToken);
    let fileRef = onlyPreviewWorkspaceRegistry.resolveProjectFileRef(host.hostToken, inspected);
    if (fileRef) {
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
      fileRef = onlyPreviewWorkspaceRegistry.registerExternalPreview(host.hostToken, inspected);
      onlyPreviewWorkspaceRegistry.clearProjectSelection(host.hostToken);
    }

    await onlyPreviewPreviewRegionService.present(host.hostToken, fileRef);
    if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, selectionGeneration)) {
      return;
    }
    xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, { hostId: host.hostId });
    onlyPreviewWindowHelper.show();
  } finally {
    onlyPreviewRecentDirectoryService.finishExplicitTarget(recentGeneration);
  }
};

export const openOnlyPreviewAbsoluteTarget = serializeOnlyPreviewOpenTarget(
  performOpenOnlyPreviewAbsoluteTarget,
  onlyPreviewTargetMutations
);

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
