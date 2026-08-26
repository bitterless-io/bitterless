import {
  app,
  dialog,
  Menu,
  shell,
  type BaseWindow,
  type MenuItemConstructorOptions
} from 'electron';
import { basename } from 'node:path';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import {
  OnlyPreviewContractError,
  onlyPreviewFailure,
  onlyPreviewSuccess,
  parseOnlyPreviewBounds,
  parseOnlyPreviewFileRef,
  parseOnlyPreviewFindIntent,
  parseOnlyPreviewFindResultRequest,
  parseOnlyPreviewGlobalSearchFocusRequest,
  parseOnlyPreviewPreviewErrorRequest,
  parseOnlyPreviewPreviewReadyRequest,
  parseOnlyPreviewPreviewRuntimeRequest,
  parseOnlyPreviewPreviewRevisionRequest,
  parseOnlyPreviewProjectItemCopyRequest,
  parseOnlyPreviewProjectRootCopyRequest,
  parseOnlyPreviewProjectRootRequest,
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
import {
  onlyPreviewClipboardService,
  type OnlyPreviewClipboardCopyKind
} from '@main/onlypreview/onlyPreviewClipboard.service';
import { onlyPreviewSettingsService } from '@main/onlypreview/onlyPreviewSettings.service';
import { onlyPreviewAssetRegistry } from '@main/onlypreview/onlyPreviewAsset.registry';
import { onlyPreviewDocumentRegistry } from '@main/onlypreview/onlyPreviewDocument.registry';
import { onlyPreviewSelectionCoordinator } from '@main/onlypreview/onlyPreviewSelectionCoordinator.service';
import { onlyPreviewPreviewRegionService } from '@main/onlypreview/views/onlyPreviewPreviewRegion.service';
import { onlyPreviewGlobalSearchFocusService } from '@main/onlypreview/onlyPreviewGlobalSearchFocus.service';
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

const recentDirectoryStorage =
  createXpcMainEmitter<OnlyPreviewRecentDirectoryStorage>('SettingDao');
onlyPreviewRecentDirectoryService.configureStorage(recentDirectoryStorage);

onlyPreviewHostRegistry.onRevoke((host) => {
  onlyPreviewSelectionCoordinator.revoke(host.hostToken);
});

const displayOnlyPreviewFileName = (relativePath: string): string =>
  Array.from(basename(relativePath), (character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? '�' : character;
  }).join('');

const showOnlyPreviewDeleteFailure = async (window: BaseWindow): Promise<void> => {
  const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
  await dialog.showMessageBox(window, {
    type: 'error',
    title: labels.deleteFailureTitle,
    message: labels.deleteFailureMessage,
    buttons: [labels.deleteFailureOk],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
};

const showOnlyPreviewCopyFailure = async (window: BaseWindow): Promise<void> => {
  const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
  await dialog.showMessageBox(window, {
    type: 'error',
    title: labels.copyFailureTitle,
    message: labels.copyFailureMessage,
    buttons: [labels.copyFailureOk],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });
};

const copyOnlyPreviewProjectItemFromUi = async (
  window: BaseWindow,
  request: OnlyPreviewHostRequest & OnlyPreviewFileRef,
  copyKind: OnlyPreviewClipboardCopyKind
): Promise<void> => {
  try {
    const item = await onlyPreviewWorkspaceRegistry.resolveProjectItem(
      request.hostToken,
      request
    );
    await onlyPreviewClipboardService.copyProjectItem(item, copyKind);
  } catch {
    await showOnlyPreviewCopyFailure(window).catch(() => undefined);
  }
};

const copyOnlyPreviewProjectRootFromUi = async (
  window: BaseWindow,
  request: { hostToken: string; workspaceId: string },
  copyKind: OnlyPreviewClipboardCopyKind
): Promise<void> => {
  try {
    const root = await onlyPreviewWorkspaceRegistry.resolveProjectRoot(
      request.hostToken,
      request.workspaceId
    );
    await onlyPreviewClipboardService.copyProjectItem(root, copyKind);
  } catch {
    await showOnlyPreviewCopyFailure(window).catch(() => undefined);
  }
};

const deleteOnlyPreviewFileFromMenu = async (
  window: BaseWindow,
  request: OnlyPreviewHostRequest & OnlyPreviewFileRef
): Promise<void> => {
  const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
  let file: Awaited<ReturnType<typeof onlyPreviewWorkspaceRegistry.resolveProjectItem>>;
  try {
    file = await onlyPreviewWorkspaceRegistry.resolveProjectItem(request.hostToken, request);
    if (file.nodeKind !== 'file') {
      throw new OnlyPreviewContractError(
        'PATH_NOT_REGULAR_FILE',
        'Only regular files can be deleted.'
      );
    }
    const confirmation = await dialog.showMessageBox(window, {
      type: 'warning',
      title: labels.deleteConfirmTitle,
      message: labels.deleteConfirmMessage,
      detail: `${displayOnlyPreviewFileName(file.relativePath)}\n\n${labels.deleteConfirmDetail}`,
      buttons: [labels.deleteCancelButton, labels.deleteConfirmButton],
      defaultId: 0,
      cancelId: 0,
      destructiveId: 1,
      noLink: true
    });
    if (confirmation.response !== 1) return;
  } catch {
    await showOnlyPreviewDeleteFailure(window).catch(() => undefined);
    return;
  }

  let deleted: Awaited<ReturnType<typeof onlyPreviewWorkspaceRegistry.deleteOpenedFile>>;
  try {
    const opened = await onlyPreviewWorkspaceRegistry.openFile(request.hostToken, request);
    deleted = await onlyPreviewWorkspaceRegistry.deleteOpenedFile(opened);
  } catch {
    await showOnlyPreviewDeleteFailure(window).catch(() => undefined);
    return;
  }

  try {
    onlyPreviewSelectionCoordinator.invalidatePendingSelection(deleted.host.hostToken, {
      workspaceId: deleted.workspace.workspaceId,
      relativePath: deleted.relativePath
    });
    const cleared = onlyPreviewWorkspaceRegistry.clearSelection(deleted.host.hostToken, {
      workspaceId: deleted.workspace.workspaceId,
      relativePath: deleted.relativePath
    });
    if (!cleared) return;
    onlyPreviewPreviewRegionService.clearWorkspace(
      deleted.host.hostToken,
      deleted.workspace.workspaceId
    );
    xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, { hostId: deleted.host.hostId });
  } catch {
    // The file is already deleted; a closing host owns no UI state that still needs cleanup.
  }
};

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
      const fileRef = parseOnlyPreviewFileRef(params);
      const generation = onlyPreviewSelectionCoordinator.beginSelection(host.hostToken, fileRef);
      try {
        const file = await onlyPreviewWorkspaceRegistry.resolveFile(host.hostToken, fileRef);
        if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, generation)) return;
        onlyPreviewWorkspaceRegistry.select(host.hostToken, {
          workspaceId: file.workspace.workspaceId,
          relativePath: file.relativePath
        });
        await onlyPreviewPreviewRegionService.present(host.hostToken, {
          workspaceId: file.workspace.workspaceId,
          relativePath: file.relativePath
        });
        if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, generation)) return;
        xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, { hostId: host.hostId });
      } finally {
        onlyPreviewSelectionCoordinator.finishSelection(host.hostToken, generation);
      }
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

  async restoreGlobalSearchFocus(
    params: ApiParams<'restoreGlobalSearchFocus'>
  ): ReturnType<OnlyPreviewApi['restoreGlobalSearchFocus']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewGlobalSearchFocusRequest(params);
      onlyPreviewHostRegistry.require(request.hostToken, ['content']);
      if (request.mode === 'opener') {
        return onlyPreviewGlobalSearchFocusService.restoreOpener(request.hostToken);
      }
      onlyPreviewGlobalSearchFocusService.clear(request.hostToken);
      if (request.mode === 'discard') return false;
      onlyPreviewPreviewRegionService.focusActiveContent(request.hostToken);
      return true;
    });
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
      const item = await onlyPreviewWorkspaceRegistry.resolveProjectItem(params?.hostToken, params);
      const request: OnlyPreviewHostRequest & OnlyPreviewFileRef = {
        hostToken: item.host.hostToken,
        workspaceId: item.workspace.workspaceId,
        relativePath: item.relativePath
      };
      const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
      const template: MenuItemConstructorOptions[] = [];
      if (item.nodeKind === 'file') {
        template.push({
          id: 'onlypreview-preview',
          label: labels.preview,
          click: () => void this.selectStandaloneFile(request)
        });
        template.push({ type: 'separator' });
        template.push({
          id: 'onlypreview-open-externally',
          label: labels.openExternally,
          click: () => void this.openExternally(request)
        });
      }
      template.push({
        id: 'onlypreview-reveal-in-folder',
        label: labels.revealInFolder,
        click: () => void this.revealInFolder(request)
      });
      template.push(
        { type: 'separator' },
        {
          id: 'onlypreview-copy-item',
          label: item.nodeKind === 'file' ? labels.copyFile : labels.copyFolder,
          accelerator: 'CommandOrControl+C',
          click: () => void copyOnlyPreviewProjectItemFromUi(window, request, 'item')
        },
        {
          id: 'onlypreview-copy-path',
          label: labels.copyPath,
          accelerator: 'CommandOrControl+Shift+C',
          click: () => void copyOnlyPreviewProjectItemFromUi(window, request, 'absolute-path')
        },
        {
          id: 'onlypreview-copy-relative-path',
          label: labels.copyRelativePath,
          click: () => void copyOnlyPreviewProjectItemFromUi(window, request, 'relative-path')
        },
        {
          id: 'onlypreview-copy-name',
          label: labels.copyName,
          accelerator: 'CommandOrControl+Alt+C',
          click: () => void copyOnlyPreviewProjectItemFromUi(window, request, 'name')
        }
      );
      if (item.nodeKind === 'file') {
        template.push(
          { type: 'separator' },
          {
            id: 'onlypreview-delete',
            label: labels.delete,
            click: () => void deleteOnlyPreviewFileFromMenu(window, request)
          }
        );
      }
      Menu.buildFromTemplate(template).popup({ window });
    });
  }

  async copyProjectItem(
    params: ApiParams<'copyProjectItem'>
  ): ReturnType<OnlyPreviewApi['copyProjectItem']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewProjectItemCopyRequest(params);
      const window = onlyPreviewWindowHelper.getStandaloneWindow(request.hostToken);
      await copyOnlyPreviewProjectItemFromUi(
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
      const root = await onlyPreviewWorkspaceRegistry.resolveProjectRoot(
        request.hostToken,
        request.workspaceId
      );
      const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
      const template: MenuItemConstructorOptions[] = [
        {
          id: 'onlypreview-reveal-project-root',
          label: labels.revealInFolder,
          click: () => shell.showItemInFolder(root.realPath)
        },
        { type: 'separator' },
        {
          id: 'onlypreview-copy-project-root',
          label: labels.copyFolder,
          accelerator: 'CommandOrControl+C',
          click: () => void copyOnlyPreviewProjectRootFromUi(window, request, 'item')
        },
        {
          id: 'onlypreview-copy-project-root-path',
          label: labels.copyPath,
          accelerator: 'CommandOrControl+Shift+C',
          click: () => void copyOnlyPreviewProjectRootFromUi(window, request, 'absolute-path')
        },
        {
          id: 'onlypreview-copy-project-root-relative-path',
          label: labels.copyRelativePath,
          click: () => void copyOnlyPreviewProjectRootFromUi(window, request, 'relative-path')
        },
        {
          id: 'onlypreview-copy-project-root-name',
          label: labels.copyName,
          accelerator: 'CommandOrControl+Alt+C',
          click: () => void copyOnlyPreviewProjectRootFromUi(window, request, 'name')
        }
      ];
      Menu.buildFromTemplate(template).popup({ window });
    });
  }

  async copyProjectRoot(
    params: ApiParams<'copyProjectRoot'>
  ): ReturnType<OnlyPreviewApi['copyProjectRoot']> {
    return await runOperation(async () => {
      const request = parseOnlyPreviewProjectRootCopyRequest(params);
      const window = onlyPreviewWindowHelper.getStandaloneWindow(request.hostToken);
      await copyOnlyPreviewProjectRootFromUi(window, request, request.copyKind);
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
      const item = await onlyPreviewWorkspaceRegistry.resolveProjectItem(params?.hostToken, params);
      shell.showItemInFolder(item.realPath);
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
