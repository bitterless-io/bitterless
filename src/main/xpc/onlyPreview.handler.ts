import { app, clipboard, shell } from 'electron';
import { resolve } from 'node:path';
import { createXpcMainEmitter, XpcMainHandler, xpcMain } from 'electron-xpc/main';
import {
  OnlyPreviewContractError,
  onlyPreviewSuccess,
  parseOnlyPreviewBounds,
  parseOnlyPreviewFileRef,
  parseOnlyPreviewSelectionRevision,
  parseOnlyPreviewFindIntent,
  parseOnlyPreviewFindResultRequest,
  parseOnlyPreviewPreviewErrorRequest,
  parseOnlyPreviewPreviewReadyRequest,
  parseOnlyPreviewPreviewRuntimeRequest,
  parseOnlyPreviewPreviewRevisionRequest,
  parseOnlyPreviewProjectItemCopyRequest,
  parseOnlyPreviewProjectRootCopyRequest,
  parseOnlyPreviewCreateProjectFolderRequest,
  parseOnlyPreviewPasteProjectItemsRequest,
  parseOnlyPreviewProjectRootRequest,
  parseOnlyPreviewRenameProjectItemRequest,
  toOnlyPreviewErrorPayload
} from '@shared/onlypreview/onlyPreview.contract';
import {
  ONLY_PREVIEW_REFRESH_EVENT,
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
import { onlyPreviewLogService } from '@main/miniapps/onlypreview/onlyPreviewLog.runtime';
import { onlyPreviewHostRegistry } from '@main/miniapps/onlypreview/onlyPreviewHost.registry';
import { onlyPreviewWorkspaceRegistry } from '@main/miniapps/onlypreview/onlyPreviewWorkspace.registry';
import { onlyPreviewStorageStatusService } from '@main/miniapps/onlypreview/onlyPreviewStorageStatus.service';
import { onlyPreviewSettingsService } from '@main/miniapps/onlypreview/onlyPreviewSettings.service';
import { onlyPreviewAssetRegistry } from '@main/miniapps/onlypreview/onlyPreviewAsset.registry';
import { onlyPreviewDocumentRegistry } from '@main/miniapps/onlypreview/onlyPreviewDocument.registry';
import { onlyPreviewSelectionCoordinator } from '@main/miniapps/onlypreview/onlyPreviewSelectionCoordinator.service';
import { selectOnlyPreviewFile } from '@main/miniapps/onlypreview/onlyPreviewSelectFile.service';
import { onlyPreviewRecentsService } from '@main/miniapps/onlypreview/onlyPreviewRecents.runtime';
import { onlyPreviewBookmarksService } from '@main/miniapps/onlypreview/onlyPreviewBookmarks.runtime';
import { showOnlyPreviewBookmarkMenu } from '@main/miniapps/onlypreview/onlyPreviewBookmarkMenu.service';
import { openOnlyPreviewRecent, navigateOnlyPreviewRecent, reloadOnlyPreview, openOnlyPreviewMarkdownLink } from '@main/miniapps/onlypreview/onlyPreviewRecentNavigation.service';
import { presentOnlyPreviewRestoredSelection } from '@main/miniapps/onlypreview/onlyPreviewRestoreSelection.service';
import { ensureOnlyPreviewWorkspaceConfig } from '@main/miniapps/onlypreview/onlyPreviewWorkspaceConfigScaffold.service';
import * as projectIndex from '@main/miniapps/onlypreview/onlyPreviewProjectIndexState.service';
import {
  onlyPreviewPreviewRegionService,
  resolveOnlyPreviewPreviewRegion
} from '@main/miniapps/onlypreview/views/onlyPreviewPreviewRegion.service';
import { onlyPreviewGlobalSearchXpcService } from '@main/miniapps/onlypreview/views/onlyPreviewGlobalSearchXpc.service';
import { onlyPreviewAlertWindowService } from '@main/miniapps/onlypreview/views/onlyPreviewAlertWindow.service';
import { onlyPreviewWindowHelper } from '@main/windows/onlyPreviewWindow.helper';
import { onlyPreviewHostToggleService } from '@main/windows/onlyPreviewHostToggle.service';
import { chooseOnlyPreviewFolder } from '@main/windows/onlyPreviewChooseFolder.service';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import {
  onlyPreviewRecentDirectoryService,
  type OnlyPreviewRecentDirectoryStorage
} from '@main/miniapps/onlypreview/onlyPreviewRecentDirectory.service';
import {
  createOnlyPreviewAgentSkillGuideInfo,
  requireOnlyPreviewAgentSkillPath,
  resolveOnlyPreviewAgentSkillPath
} from '@main/miniapps/onlypreview/onlyPreviewAgentSkill.service';
import { onlyPreviewProjectNativeActionService } from '@main/miniapps/onlypreview/onlyPreviewProjectNativeAction.service';
import { collapseOnlyPreviewDeleteSelection } from '@shared/onlypreview/onlyPreviewDeleteSelection.shared';
import { showOnlyPreviewFileMenu } from '@main/miniapps/onlypreview/onlyPreviewFileMenu.service';
import { openOnlyPreviewInDefaultApp } from '@main/miniapps/onlypreview/onlyPreviewDefaultApp.service';
import { mcpHandler } from './mcp.handler';

export { openOnlyPreviewAbsoluteTarget } from '@main/miniapps/onlypreview/onlyPreviewExplicitOpen.service';

type ApiParams<T extends keyof OnlyPreviewApi> = Parameters<OnlyPreviewApi[T]>[0];

const runOperation = async <T>(
  operation: keyof OnlyPreviewHandler,
  run: () => Promise<T>
): Promise<OnlyPreviewResult<T>> => {
  try {
    return onlyPreviewSuccess(await run());
  } catch (error) {
    const payload = toOnlyPreviewErrorPayload(error, operation);
    onlyPreviewLogService.writeOperationFailure({ operation, code: payload.code, error });
    return { ok: false, error: payload };
  }
};

// 预览区**按 host 解析**(`onlyPreviewPreviewRegion.service.ts` 尾部的注释说明了为什么它不再是
// 一个进程级单例)。这里每一个调用点本来就有 `hostToken` 在手 —— 缺的只是"用它去挑实例"。
const readBroker = (
  hostToken: unknown
): ReturnType<typeof onlyPreviewPreviewRegionService.getReadBroker> =>
  resolveOnlyPreviewPreviewRegion(hostToken).getReadBroker();

const recentDirectoryStorage =
  createXpcMainEmitter<OnlyPreviewRecentDirectoryStorage>('SettingDao');
onlyPreviewRecentDirectoryService.configureStorage(recentDirectoryStorage);
onlyPreviewRecentsService.configureStorage(recentDirectoryStorage);
onlyPreviewRecentDirectoryService.configureTargetRuntime({
  inspectTarget: async (absoluteTarget) =>
    await fileSearchWindowService.inspectTarget(absoluteTarget),
  bindWorkspace: async (hostToken, workspace) => {
    // 先把配置目录落到盘上,再绑定。顺序是刻意的:绑定之后索引就开始按配置走,而这一步
    // 只在文件不存在时写一份空白配置 —— 早一步落盘,人第一次打开就能看到那个文件。
    // 失败一律不影响打开(只读介质、没有写权限、同名普通文件都只是"这次没建成")。
    await ensureOnlyPreviewWorkspaceConfig(workspace.displayPath);
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
      projectIndex.markOnlyPreviewProjectBound(hostToken, workspace.workspaceId);
    } catch (error) {
      await fileSearchWindowService
        .revokeProjectWorkspace({
          workspaceId: workspace.workspaceId,
          workspaceGeneration: binding.workspaceGeneration
        })
        .catch(() => undefined);
      throw error;
    }
  },
  presentSelection: presentOnlyPreviewRestoredSelection
});

onlyPreviewHostRegistry.onRevoke((host) => {
  onlyPreviewSelectionCoordinator.revoke(host.hostToken);
});

onlyPreviewWorkspaceRegistry.onRevoke((workspace) => {
  try {
    resolveOnlyPreviewPreviewRegion(workspace.hostToken).handleWorkspaceRevoked(
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

class OnlyPreviewHandler
  extends XpcMainHandler
  implements OnlyPreviewApi, OnlyPreviewOfficeReadBrokerApi, OnlyPreviewPreviewTextBrokerApi
{
  async getRecents(params: ApiParams<'getRecents'>): ReturnType<OnlyPreviewApi['getRecents']> {
    return await runOperation('getRecents', async () => await onlyPreviewRecentsService.snapshot(params?.hostToken));
  }

  async getBookmarks(params: ApiParams<'getBookmarks'>): ReturnType<OnlyPreviewApi['getBookmarks']> {
    return await runOperation('getBookmarks', () => onlyPreviewBookmarksService.snapshot(params));
  }

  async addBookmark(params: ApiParams<'addBookmark'>): ReturnType<OnlyPreviewApi['addBookmark']> {
    return await runOperation('addBookmark', () => onlyPreviewBookmarksService.add(params));
  }

  async removeBookmark(params: ApiParams<'removeBookmark'>): ReturnType<OnlyPreviewApi['removeBookmark']> {
    return await runOperation('removeBookmark', () => onlyPreviewBookmarksService.remove(params));
  }

  async showBookmarkContextMenu(
    params: ApiParams<'showBookmarkContextMenu'>
  ): ReturnType<OnlyPreviewApi['showBookmarkContextMenu']> {
    return await runOperation('showBookmarkContextMenu', async () => {
      const { relativePath } = parseOnlyPreviewFileRef(params);
      onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(params.hostToken, params.workspaceId);
      const window = onlyPreviewWindowHelper.getStandaloneWindow(params.hostToken);
      if (await showOnlyPreviewBookmarkMenu(window)) return await onlyPreviewBookmarksService.remove({ ...params, relativePath });
      return null;
    });
  }

  async openRecent(params: ApiParams<'openRecent'>): ReturnType<OnlyPreviewApi['openRecent']> {
    return await runOperation('openRecent', async () => await openOnlyPreviewRecent(params));
  }

  async navigateRecent(params: ApiParams<'navigateRecent'>): ReturnType<OnlyPreviewApi['navigateRecent']> {
    return await runOperation('navigateRecent', async () => await navigateOnlyPreviewRecent(params));
  }

  async reloadPreview(params: ApiParams<'reloadPreview'>): ReturnType<OnlyPreviewApi['reloadPreview']> {
    return await runOperation('reloadPreview', async () => await reloadOnlyPreview(params));
  }

  async openMarkdownLink(params: ApiParams<'openMarkdownLink'>): ReturnType<OnlyPreviewApi['openMarkdownLink']> {
    return await runOperation('openMarkdownLink', async () => await openOnlyPreviewMarkdownLink(params));
  }

  async getHostToggleState(
    params: ApiParams<'getHostToggleState'>
  ): ReturnType<OnlyPreviewApi['getHostToggleState']> {
    return await runOperation('getHostToggleState', async () =>
      onlyPreviewHostToggleService.getState(params?.hostToken)
    );
  }

  async toggleHost(params: ApiParams<'toggleHost'>): ReturnType<OnlyPreviewApi['toggleHost']> {
    return await runOperation(
      'toggleHost',
      async () => await onlyPreviewHostToggleService.toggle(params?.hostToken)
    );
  }

  /**
   * 占位页上「前往」那个按钮。**0 个参数** —— 那一格不持有 hostToken。
   *
   * 不走 `openOnlyPreviewWindow()`:它的冷分支会新建一个窗口
   * (docs/features/onlypreview-deferred-tab-placeholder.md #3)。
   */
  async focusOnlyPreviewWindow(): ReturnType<OnlyPreviewApi['focusOnlyPreviewWindow']> {
    return await runOperation(
      'focusOnlyPreviewWindow',
      async () => await onlyPreviewHostToggleService.focusStandaloneWindow()
    );
  }

  async openOnlyPreviewWindow(): ReturnType<OnlyPreviewApi['openOnlyPreviewWindow']> {
    return await runOperation('openOnlyPreviewWindow', async () => {
      await onlyPreviewWindowHelper.ensureStandalone();
    });
  }

  async reportShellMounted(
    params: ApiParams<'reportShellMounted'>
  ): ReturnType<OnlyPreviewApi['reportShellMounted']> {
    return await runOperation('reportShellMounted', async () => {
      if (
        !params ||
        typeof params.hostToken !== 'string' ||
        typeof params.openTag !== 'string' ||
        !/^[a-z][a-z0-9]{0,11}$/.test(params.openTag) ||
        ![
          'renderer-script',
          'renderer-language',
          'renderer-import',
          'renderer-mount',
          'renderer-receipt'
        ].includes(params.phase) ||
        (params.outcome !== undefined &&
          params.outcome !== 'success' &&
          params.outcome !== 'failure') ||
        (params.phase === 'renderer-receipt') !== (params.outcome !== undefined)
      ) {
        throw new OnlyPreviewContractError('INVALID_INPUT', 'Shell mount report is invalid.');
      }
      onlyPreviewWindowHelper.reportShellMounted(
        params.hostToken,
        params.openTag,
        params.phase,
        params.outcome
      );
    });
  }

  async chooseFolder(
    params: ApiParams<'chooseFolder'>
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>> {
    return await runOperation(
      'chooseFolder',
      async () => await chooseOnlyPreviewFolder(params?.hostToken)
    );
  }

  async restoreWorkspace(
    params: ApiParams<'restoreWorkspace'>
  ): Promise<OnlyPreviewResult<OnlyPreviewWorkspace | null>> {
    return await runOperation('restoreWorkspace', async () => {
      const host = onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      const generation = onlyPreviewSelectionCoordinator.advance(host.hostToken);
      const current = resolveOnlyPreviewPreviewRegion(host.hostToken).snapshot(host.hostToken);
      const hasLiveExternalPresentation = Boolean(
        current.fileRef &&
        onlyPreviewWorkspaceRegistry.isExternalPreviewFileRef(host.hostToken, current.fileRef)
      );
      const workspace = hasLiveExternalPresentation
        ? onlyPreviewWorkspaceRegistry.restore(host.hostToken)
        : await onlyPreviewRecentDirectoryService.restoreWorkspace(host.hostToken);
      if (!onlyPreviewSelectionCoordinator.isCurrent(host.hostToken, generation)) return workspace;
      // **恢复之后重新取一次快照。**
      //
      // 上面那次 `current` 是在恢复**之前**取的,而 `onlyPreviewRecentDirectoryService.restoreWorkspace`
      // 内部 `presentRestoredSelection` 缺省为 true —— 它自己已经把记住的文件呈现了一次。拿恢复前的
      // 快照来比对,条件必然成立,于是同一个文件又被呈现一遍:启动时预览视图挂上、拆掉、再挂上,
      // 日志里是两条 `preview-focus-claimed`,而那背后是两次真实的文件读取与渲染。
      //
      // 不能改成让 service 不呈现:它那一次带着 `authorizeProjectItem` 授权和 `workspaceRegistry.select`,
      // 这里这次没有。所以保留 service 那条路,只把这里的比对换成看得见它的快照。
      // `hasLiveExternalPresentation` 仍用恢复前的那份 —— 它决定的是要不要恢复,必须在恢复前判断。
      const presented = resolveOnlyPreviewPreviewRegion(host.hostToken).snapshot(host.hostToken);
      if (!hasLiveExternalPresentation && workspace?.selectedRelativePath) {
        if (
          presented.fileRef?.workspaceId !== workspace.workspaceId ||
          presented.fileRef.relativePath !== workspace.selectedRelativePath
        ) {
          await resolveOnlyPreviewPreviewRegion(host.hostToken).present(host.hostToken, {
            workspaceId: workspace.workspaceId,
            relativePath: workspace.selectedRelativePath
          });
        }
      } else if (
        !hasLiveExternalPresentation &&
        (presented.fileRef || presented.workspaceId !== (workspace?.workspaceId ?? null))
      ) {
        resolveOnlyPreviewPreviewRegion(host.hostToken).clearWorkspace(
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
    return await runOperation('selectStandaloneFile', async () =>
      await selectOnlyPreviewFile(params?.hostToken, parseOnlyPreviewFileRef(params))
    );
  }

  async openCurrentOfficeRead(request: OnlyPreviewOfficeReadBrokerRequest) {
    return await runOperation('openCurrentOfficeRead', async () => {
      return await readBroker(request.hostToken).openCurrentOfficeRead(
        request.hostToken,
        request.brokerCapability,
        request.previewRuntimeToken,
        request.selectionRevision
      );
    });
  }

  async readCurrentOfficeChunk(request: OnlyPreviewOfficeReadChunkBrokerRequest) {
    return await runOperation('readCurrentOfficeChunk', async () => {
      return await readBroker(request.hostToken).readCurrentOfficeChunk(
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
      await readBroker(request.hostToken).cancelCurrentOfficeRead(
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
      return await readBroker(request.hostToken).openCurrentPreviewText(
        request.hostToken,
        request.brokerCapability,
        request.previewRuntimeToken,
        request.selectionRevision
      );
    });
  }

  async readCurrentPreviewTextChunk(request: OnlyPreviewPreviewTextChunkBrokerRequest) {
    return await runOperation('readCurrentPreviewTextChunk', async () => {
      return await readBroker(request.hostToken).readCurrentPreviewTextChunk(
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
      await readBroker(request.hostToken).cancelCurrentPreviewText(
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
      resolveOnlyPreviewPreviewRegion(params?.hostToken).snapshot(params?.hostToken)
    );
  }

  async getVuePreviewPresentation(
    params: ApiParams<'getVuePreviewPresentation'>
  ): ReturnType<OnlyPreviewApi['getVuePreviewPresentation']> {
    return await runOperation('getVuePreviewPresentation', async () => {
      const request = parseOnlyPreviewPreviewRuntimeRequest(params);
      return resolveOnlyPreviewPreviewRegion(params?.hostToken).snapshotForVue(
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
      resolveOnlyPreviewPreviewRegion(params?.hostToken).reportVueReady(
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
      resolveOnlyPreviewPreviewRegion(params?.hostToken).reportVueReset(
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
      resolveOnlyPreviewPreviewRegion(params?.hostToken).reportVueError(
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
      resolveOnlyPreviewPreviewRegion(params?.hostToken).findSnapshot(params?.hostToken)
    );
  }

  async submitPreviewFind(
    params: ApiParams<'submitPreviewFind'>
  ): ReturnType<OnlyPreviewApi['submitPreviewFind']> {
    return await runOperation('submitPreviewFind', async () => {
      const request = parseOnlyPreviewFindIntent(params);
      resolveOnlyPreviewPreviewRegion(request.hostToken).submitFind(request.hostToken, {
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
      resolveOnlyPreviewPreviewRegion(params?.hostToken).closeFind(params?.hostToken);
      resolveOnlyPreviewPreviewRegion(params?.hostToken).focusActiveContent(params?.hostToken);
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
      resolveOnlyPreviewPreviewRegion(params?.hostToken).reportVueFindResult(
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

  async showPreviewFileMenu(
    params: ApiParams<'showPreviewFileMenu'>
  ): ReturnType<OnlyPreviewApi['showPreviewFileMenu']> {
    return await runOperation('showPreviewFileMenu', async () => {
      const window = onlyPreviewWindowHelper.getStandaloneWindow(params?.hostToken);
      const revision = parseOnlyPreviewSelectionRevision(params?.selectionRevision);
      const presentation = resolveOnlyPreviewPreviewRegion(params.hostToken).snapshot(params.hostToken);
      if (!presentation.fileRef || presentation.selectionRevision !== revision) return null;
      const action = await showOnlyPreviewFileMenu(window);
      if (!action || window.isDestroyed()) return null;
      const current = resolveOnlyPreviewPreviewRegion(params.hostToken).snapshot(params.hostToken);
      if (!current.fileRef || current.selectionRevision !== revision) return null;
      if (action === 'copy-path') {
        const authority = onlyPreviewWorkspaceRegistry.getPreviewAuthorityItemRef(
          params.hostToken, current.fileRef
        );
        clipboard.writeText(resolve(authority.rootPath, authority.relativePath));
        return null;
      }
      return action;
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

  async requestProjectDelete(
    params: ApiParams<'requestProjectDelete'>
  ): ReturnType<OnlyPreviewApi['requestProjectDelete']> {
    return await runOperation('requestProjectDelete', async () => {
      const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(
        params?.hostToken, params?.workspaceId
      );
      if (!Array.isArray(params.selection) || params.selection.length > 1000) {
        throw new OnlyPreviewContractError('INVALID_INPUT', 'Project delete selection is invalid.');
      }
      const plan = collapseOnlyPreviewDeleteSelection(params.selection);
      if (!plan.ok) {
        throw new OnlyPreviewContractError('INVALID_INPUT', 'Project delete selection is invalid.');
      }
      for (const entry of plan.entries) {
        onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(authority.host.hostToken, {
          workspaceId: authority.workspaceId, relativePath: entry.relativePath
        });
      }
      await onlyPreviewProjectNativeActionService.deleteProjectSelectionFromMenu({
        hostToken: authority.host.hostToken, workspaceId: authority.workspaceId,
        relativePath: plan.entries[0].relativePath
      }, plan.entries);
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
        request.copyKind,
        request.selection
      );
    });
  }

  async pasteProjectItems(
    params: ApiParams<'pasteProjectItems'>
  ): ReturnType<OnlyPreviewApi['pasteProjectItems']> {
    return await runOperation('pasteProjectItems', async () =>
      onlyPreviewProjectNativeActionService.pasteProjectItems(
        parseOnlyPreviewPasteProjectItemsRequest(params)
      )
    );
  }

  async reportProjectIndexFailed(
    params: ApiParams<'reportProjectIndexFailed'>
  ): ReturnType<OnlyPreviewApi['reportProjectIndexFailed']> {
    return await runOperation('reportProjectIndexFailed', async () =>
      projectIndex.reportOnlyPreviewProjectIndexFailure(parseOnlyPreviewProjectRootRequest(params))
    );
  }

  async createProjectFolder(
    params: ApiParams<'createProjectFolder'>
  ): ReturnType<OnlyPreviewApi['createProjectFolder']> {
    return await runOperation('createProjectFolder', async () => {
      const request = parseOnlyPreviewCreateProjectFolderRequest(params);
      return await onlyPreviewProjectNativeActionService.createUntitledProjectFolder(request);
    });
  }

  async renameProjectItem(
    params: ApiParams<'renameProjectItem'>
  ): ReturnType<OnlyPreviewApi['renameProjectItem']> {
    return await runOperation('renameProjectItem', async () => {
      const request = parseOnlyPreviewRenameProjectItemRequest(params);
      const window = onlyPreviewWindowHelper.getStandaloneWindow(request.hostToken);
      return await onlyPreviewProjectNativeActionService.renameProjectItemFromUi(window, request);
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
        await openOnlyPreviewInDefaultApp(revalidatedPath, () => {
          onlyPreviewWorkspaceRegistry.revalidateExternalPreviewNativePath(
            params.hostToken, params, inspected
          );
        });
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

  async showNotice(
    params: ApiParams<'showNotice'>
  ): ReturnType<OnlyPreviewApi['showNotice']> {
    return await runOperation('showNotice', async () => {
      onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      // 走 `showError` 那条路,只是语气是 `notice` —— 那一层的键盘规则与焦点管理正是提示要的。
      // 文案不在这里兜底:提示语属于发起它的界面,main 编不出一句有意义的默认提示。
      await onlyPreviewAlertWindowService.showError(params.hostToken, {
        title: params.title,
        message: params.message,
        confirmLabel: params.confirmLabel,
        tone: params.tone ?? 'notice'
      });
    });
  }

  async getStorageStatus(
    params: ApiParams<'getStorageStatus'>
  ): ReturnType<OnlyPreviewApi['getStorageStatus']> {
    return await runOperation('getStorageStatus', async () => {
      onlyPreviewHostRegistry.require(params?.hostToken, ['content']);
      return await onlyPreviewStorageStatusService.read();
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
      const skillPath = await requireOnlyPreviewAgentSkillPath(
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
      void resolveOnlyPreviewPreviewRegion(host.hostToken).refresh(host.hostToken).catch(() => undefined);
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
