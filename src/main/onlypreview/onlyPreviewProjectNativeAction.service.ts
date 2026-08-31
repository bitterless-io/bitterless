import { dialog, Menu, shell, type BaseWindow, type MenuItemConstructorOptions } from 'electron';
import { basename } from 'node:path';
import { OnlyPreviewContractError } from '@shared/onlypreview/onlyPreview.contract';
import type {
  OnlyPreviewFileRef,
  OnlyPreviewHostRequest
} from '@shared/onlypreview/onlyPreview.types';
import { fileSearchWindowService } from '@main/fileSearch/fileSearchWindow.service';
import { i18nHelper } from '@main/i18n/i18n.helper';
import {
  onlyPreviewClipboardService,
  type OnlyPreviewClipboardCopyKind
} from './onlyPreviewClipboard.service';
import { onlyPreviewSelectionCoordinator } from './onlyPreviewSelectionCoordinator.service';
import {
  onlyPreviewWorkspaceRegistry,
  type OnlyPreviewProjectAuthorityRef
} from './onlyPreviewWorkspace.registry';
import { onlyPreviewPreviewRegionService } from './views/onlyPreviewPreviewRegion.service';
import { ONLY_PREVIEW_SELECTION_CHANGED_EVENT } from '@shared/onlypreview/onlyPreview.types';
import { xpcMain } from 'electron-xpc/main';

type ProjectItemRequest = OnlyPreviewHostRequest & OnlyPreviewFileRef;
type ProjectItemRequestInput = {
  hostToken?: unknown;
  workspaceId?: unknown;
  relativePath?: unknown;
};
type ProjectRootRequest = { hostToken: string; workspaceId: string };

interface ProjectItemMenuActions {
  preview(request: ProjectItemRequest): void;
  openExternally(request: ProjectItemRequest): void;
  revealInFolder(request: ProjectItemRequest): void;
}

const displayFileName = (relativePath: string): string =>
  Array.from(basename(relativePath), (character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? '�' : character;
  }).join('');

const sameAuthority = (
  current: OnlyPreviewProjectAuthorityRef,
  expected: OnlyPreviewProjectAuthorityRef
): boolean =>
  current.host.hostToken === expected.host.hostToken &&
  current.host.hostId === expected.host.hostId &&
  current.workspaceId === expected.workspaceId &&
  current.workspaceGeneration === expected.workspaceGeneration &&
  current.relativePath === expected.relativePath;

export class OnlyPreviewProjectNativeActionService {
  async showFileContextMenu(
    window: BaseWindow,
    request: ProjectItemRequestInput,
    actions: ProjectItemMenuActions
  ): Promise<void> {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
      request.hostToken,
      request
    );
    const item = await fileSearchWindowService.authorizeProjectItem({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath
    });
    this.requireCurrentItem(authority);
    const currentRequest: ProjectItemRequest = {
      hostToken: authority.host.hostToken,
      workspaceId: authority.workspaceId,
      relativePath: item.relativePath
    };
    const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
    const template: MenuItemConstructorOptions[] = [];
    if (item.nodeKind === 'file') {
      template.push({
        id: 'onlypreview-preview',
        label: labels.preview,
        click: () => actions.preview(currentRequest)
      });
      template.push({ type: 'separator' });
      template.push({
        id: 'onlypreview-open-externally',
        label: labels.openExternally,
        click: () => actions.openExternally(currentRequest)
      });
    }
    template.push({
      id: 'onlypreview-reveal-in-folder',
      label: labels.revealInFolder,
      click: () => actions.revealInFolder(currentRequest)
    });
    template.push(
      { type: 'separator' },
      {
        id: 'onlypreview-copy-item',
        label: item.nodeKind === 'file' ? labels.copyFile : labels.copyFolder,
        accelerator: 'CommandOrControl+C',
        click: () => void this.copyProjectItemFromUi(window, currentRequest, 'item')
      },
      {
        id: 'onlypreview-copy-path',
        label: labels.copyPath,
        accelerator: 'CommandOrControl+Shift+C',
        click: () => void this.copyProjectItemFromUi(window, currentRequest, 'absolute-path')
      },
      {
        id: 'onlypreview-copy-relative-path',
        label: labels.copyRelativePath,
        click: () => void this.copyProjectItemFromUi(window, currentRequest, 'relative-path')
      },
      {
        id: 'onlypreview-copy-name',
        label: labels.copyName,
        accelerator: 'CommandOrControl+Alt+C',
        click: () => void this.copyProjectItemFromUi(window, currentRequest, 'name')
      }
    );
    if (item.nodeKind === 'file') {
      template.push(
        { type: 'separator' },
        {
          id: 'onlypreview-delete',
          label: labels.delete,
          click: () => void this.deleteFileFromMenu(window, currentRequest)
        }
      );
    }
    this.requireCurrentItem(authority);
    Menu.buildFromTemplate(template).popup({ window });
  }

  async showProjectRootContextMenu(window: BaseWindow, request: ProjectRootRequest): Promise<void> {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(
      request.hostToken,
      request.workspaceId
    );
    await fileSearchWindowService.authorizeProjectRoot({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration
    });
    this.requireCurrentRoot(authority);
    const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
    const template: MenuItemConstructorOptions[] = [
      {
        id: 'onlypreview-reveal-project-root',
        label: labels.revealInFolder,
        click: () => void this.revealProjectRootFromUi(request)
      },
      { type: 'separator' },
      {
        id: 'onlypreview-copy-project-root',
        label: labels.copyFolder,
        accelerator: 'CommandOrControl+C',
        click: () => void this.copyProjectRootFromUi(window, request, 'item')
      },
      {
        id: 'onlypreview-copy-project-root-path',
        label: labels.copyPath,
        accelerator: 'CommandOrControl+Shift+C',
        click: () => void this.copyProjectRootFromUi(window, request, 'absolute-path')
      },
      {
        id: 'onlypreview-copy-project-root-relative-path',
        label: labels.copyRelativePath,
        click: () => void this.copyProjectRootFromUi(window, request, 'relative-path')
      },
      {
        id: 'onlypreview-copy-project-root-name',
        label: labels.copyName,
        accelerator: 'CommandOrControl+Alt+C',
        click: () => void this.copyProjectRootFromUi(window, request, 'name')
      }
    ];
    this.requireCurrentRoot(authority);
    Menu.buildFromTemplate(template).popup({ window });
  }

  async copyProjectItemFromUi(
    window: BaseWindow,
    request: ProjectItemRequest,
    copyKind: OnlyPreviewClipboardCopyKind
  ): Promise<void> {
    try {
      const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
        request.hostToken,
        request
      );
      const item = await fileSearchWindowService.authorizeProjectItem({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        relativePath: authority.relativePath
      });
      this.requireCurrentItem(authority);
      await onlyPreviewClipboardService.copyProjectItem(
        {
          realPath: item.canonicalPath,
          relativePath: item.relativePath,
          name: item.name
        },
        copyKind
      );
    } catch {
      await this.showCopyFailure(window).catch(() => undefined);
    }
  }

  async copyProjectRootFromUi(
    window: BaseWindow,
    request: ProjectRootRequest,
    copyKind: OnlyPreviewClipboardCopyKind
  ): Promise<void> {
    try {
      const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(
        request.hostToken,
        request.workspaceId
      );
      const root = await fileSearchWindowService.authorizeProjectRoot({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration
      });
      this.requireCurrentRoot(authority);
      await onlyPreviewClipboardService.copyProjectItem(
        {
          realPath: root.canonicalPath,
          relativePath: root.relativePath,
          name: root.name
        },
        copyKind
      );
    } catch {
      await this.showCopyFailure(window).catch(() => undefined);
    }
  }

  async openExternally(request: ProjectItemRequestInput): Promise<void> {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
      request.hostToken,
      request
    );
    const file = await fileSearchWindowService.authorizeProjectItem({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath
    });
    this.requireCurrentItem(authority);
    if (file.nodeKind !== 'file') {
      throw new OnlyPreviewContractError(
        'PATH_NOT_REGULAR_FILE',
        'Directories cannot be opened as files.'
      );
    }
    this.requireCurrentItem(authority);
    const failure = await shell.openPath(file.canonicalPath);
    if (failure) throw new Error('The operating system could not open this file.');
  }

  async revealInFolder(request: ProjectItemRequestInput): Promise<void> {
    const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
      request.hostToken,
      request
    );
    const item = await fileSearchWindowService.authorizeProjectItem({
      workspaceId: authority.workspaceId,
      workspaceGeneration: authority.workspaceGeneration,
      relativePath: authority.relativePath
    });
    this.requireCurrentItem(authority);
    shell.showItemInFolder(item.canonicalPath);
  }

  private async revealProjectRootFromUi(request: ProjectRootRequest): Promise<void> {
    try {
      const authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(
        request.hostToken,
        request.workspaceId
      );
      const root = await fileSearchWindowService.authorizeProjectRoot({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration
      });
      this.requireCurrentRoot(authority);
      shell.showItemInFolder(root.canonicalPath);
    } catch {
      // Native menu actions can outlive a closing or replaced workspace.
    }
  }

  private async deleteFileFromMenu(window: BaseWindow, request: ProjectItemRequest): Promise<void> {
    const labels = i18nHelper.getMessages().app.onlyPreviewFileMenu;
    let authority: OnlyPreviewProjectAuthorityRef | null = null;
    let prepared: Awaited<ReturnType<typeof fileSearchWindowService.prepareProjectDelete>> | null =
      null;
    try {
      authority = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
        request.hostToken,
        request
      );
      prepared = await fileSearchWindowService.prepareProjectDelete({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        relativePath: authority.relativePath
      });
      this.requireCurrentItem(authority);
      const confirmation = await dialog.showMessageBox(window, {
        type: 'warning',
        title: labels.deleteConfirmTitle,
        message: labels.deleteConfirmMessage,
        detail: `${displayFileName(prepared.name)}\n\n${labels.deleteConfirmDetail}`,
        buttons: [labels.deleteCancelButton, labels.deleteConfirmButton],
        defaultId: 0,
        cancelId: 0,
        destructiveId: 1,
        noLink: true
      });
      if (confirmation.response !== 1) {
        await this.cancelDelete(authority, prepared.grantId);
        return;
      }
    } catch {
      if (authority && prepared) await this.cancelDelete(authority, prepared.grantId);
      await this.showDeleteFailure(window).catch(() => undefined);
      return;
    }

    if (!authority || !prepared) return;
    try {
      this.requireCurrentItem(authority);
      const deleted = await fileSearchWindowService.commitProjectDelete({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        grantId: prepared.grantId,
        relativePath: authority.relativePath
      });
      if (deleted.relativePath !== authority.relativePath) {
        throw new OnlyPreviewContractError('PROTOCOL_ERROR', 'Delete result is invalid.');
      }
      try {
        this.requireCurrentItem(authority);
      } catch {
        return;
      }
      onlyPreviewSelectionCoordinator.invalidatePendingSelection(authority.host.hostToken, {
        workspaceId: authority.workspaceId,
        relativePath: deleted.relativePath
      });
      const cleared = onlyPreviewWorkspaceRegistry.clearSelection(authority.host.hostToken, {
        workspaceId: authority.workspaceId,
        relativePath: deleted.relativePath
      });
      if (!cleared) return;
      onlyPreviewPreviewRegionService.clearWorkspace(
        authority.host.hostToken,
        authority.workspaceId
      );
      xpcMain.broadcast(ONLY_PREVIEW_SELECTION_CHANGED_EVENT, {
        hostId: authority.host.hostId
      });
    } catch {
      await this.cancelDelete(authority, prepared.grantId);
      await this.showDeleteFailure(window).catch(() => undefined);
    }
  }

  private requireCurrentItem(expected: OnlyPreviewProjectAuthorityRef): void {
    const current = onlyPreviewWorkspaceRegistry.getProjectAuthorityItemRef(
      expected.host.hostToken,
      {
        workspaceId: expected.workspaceId,
        relativePath: expected.relativePath
      }
    );
    if (!sameAuthority(current, expected)) this.throwAuthorityChanged();
  }

  private requireCurrentRoot(expected: OnlyPreviewProjectAuthorityRef): void {
    const current = onlyPreviewWorkspaceRegistry.getProjectAuthorityRootRef(
      expected.host.hostToken,
      expected.workspaceId
    );
    if (!sameAuthority(current, expected)) this.throwAuthorityChanged();
  }

  private throwAuthorityChanged(): never {
    throw new OnlyPreviewContractError(
      'WORKSPACE_ACCESS_DENIED',
      'Project authority changed before the native action.'
    );
  }

  private async cancelDelete(
    authority: OnlyPreviewProjectAuthorityRef,
    grantId: string
  ): Promise<void> {
    await fileSearchWindowService
      .cancelProjectDelete({
        workspaceId: authority.workspaceId,
        workspaceGeneration: authority.workspaceGeneration,
        grantId,
        relativePath: authority.relativePath
      })
      .catch(() => undefined);
  }

  private async showDeleteFailure(window: BaseWindow): Promise<void> {
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
  }

  private async showCopyFailure(window: BaseWindow): Promise<void> {
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
  }
}

export const onlyPreviewProjectNativeActionService = new OnlyPreviewProjectNativeActionService();
